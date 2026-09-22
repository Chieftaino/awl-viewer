import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const KEY = Uint8Array.from('9b3fe17c42a8d05e6f1183c7ad2be964f0c95a3d7e8b21c6'.match(/../g).map(h => parseInt(h, 16)));
const XAXIS = new THREE.Vector3(1, 0, 0);
const isMobile = matchMedia('(max-width: 820px)').matches;

// ------------------------------------------------------------------ renderer / post
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060606);

const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 1500);
camera.position.set(84, 9, 30);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.4, 1.0));
composer.addPass(new OutputPass());

// ------------------------------------------------------------------ environment: dark studio with light strips
function studioEnv() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.BackSide })));
  const strip = (w, h, pos, color, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  strip(60, 3, [0, 30, 8], 0xffffff, 2.2);       // long overhead strip -> highlight line along the brushed flats
  strip(14, 22, [-30, 8, 22], 0xfff0dc, 1.5);    // warm key
  strip(10, 30, [32, 4, -20], 0xcfdcff, 1.3);    // cool rim
  strip(40, 2, [0, -26, 10], 0x9aa2b5, 0.7);     // thin underlight
  strip(30, 24, [8, 2, 44], 0x8d929c, 0.55);     // soft camera-side fill
  return env;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studioEnv(), 0.02).texture;

const keyL = new THREE.DirectionalLight(0xffe9d2, 2.0);
keyL.position.set(-60, 90, 70);
scene.add(keyL);
const rimL = new THREE.DirectionalLight(0xbfd2ff, 2.0);
rimL.position.set(70, 40, -80);
scene.add(rimL);
scene.add(new THREE.HemisphereLight(0x2a2620, 0x000000, 0.35));

const steel = new THREE.MeshPhysicalMaterial({ color: 0xd9dbe0, metalness: 1, roughness: 0.24, envMapIntensity: 1.1 });

const tool = new THREE.Group();
scene.add(tool);
const TIP = new THREE.Vector3(67.5, 0, 0);
let toolReady = false;

// ------------------------------------------------------------------ helpers
const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = u => u * u * (3 - 2 * u);
const sstep = (a, b, v) => smooth(clamp01((v - a) / (b - a)));
const V3 = (...a) => new THREE.Vector3(...a);

function quatFromDirRoll(dir, roll) {
  const q = new THREE.Quaternion().setFromUnitVectors(XAXIS, dir.clone().normalize());
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(XAXIS, roll));
}
function localProgress(el) {
  const r = el.getBoundingClientRect();
  const total = r.height - innerHeight;
  return total > 0 ? clamp01(-r.top / total) : 0;
}
function coverage(el) {            // fraction of the viewport covered by the element
  const r = el.getBoundingClientRect();
  const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
  return clamp01((bottom - top) / innerHeight);
}

// ------------------------------------------------------------------ camera path along the lying awl (tip -> eyelet)
const flyKeys = [
  { t: 0.00, cam: V3(84, 9, 30), look: V3(56, 0, 0) },
  { t: 0.30, cam: V3(34, 12, 34), look: V3(14, 0, 0) },
  { t: 0.62, cam: V3(-22, 15, 36), look: V3(-36, 0, 0) },
  { t: 1.00, cam: V3(-56, 18, 26), look: V3(-61, 0, 0) },
];
function flyCam(p, outCam, outLook) {
  let i = 0;
  while (i < flyKeys.length - 2 && flyKeys[i + 1].t < p) i++;
  const a = flyKeys[i], b = flyKeys[i + 1];
  const u = smooth(clamp01((p - a.t) / (b.t - a.t)));
  outCam.lerpVectors(a.cam, b.cam, u);
  outLook.lerpVectors(a.look, b.look, u);
}

// ------------------------------------------------------------------ DOM / state
const flyEl = document.getElementById('details');
const packEl = document.getElementById('pack');
const sheetEl = document.querySelector('.sheet');
const video = document.getElementById('packvid');
const caps = [...document.querySelectorAll('.cap')];
const spinBtn = document.getElementById('spin');
const controls = new OrbitControls(camera, canvas);
controls.enabled = false; controls.enableDamping = true;
let orbit = false;

const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('pointermove', e => { mouse.x = (e.clientX / innerWidth - 0.5) * 2; mouse.y = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });

const camTarget = V3(), lookTarget = V3(), dir = V3(1, 0, 0);
const clock = new THREE.Clock();
let videoLive = false;

function update() {
  const time = clock.getElapsedTime();
  mouse.sx += (mouse.x - mouse.sx) * 0.06; mouse.sy += (mouse.y - mouse.sy) * 0.06;

  const heroP = clamp01(scrollY / innerHeight);
  const flyP = localProgress(flyEl);
  const packCover = coverage(packEl);
  const sheetCover = coverage(sheetEl);

  // awl: idle roll in the hero, settles (logo up) once the fly-along starts
  const idle = 1 - sstep(0, 0.25, flyP);
  const roll = time * 0.35 * idle + Math.sin(time * 0.7) * 0.08 * idle;
  dir.set(1, Math.sin(time * 0.5) * 0.02 * idle, Math.cos(time * 0.4) * 0.02 * idle).normalize();
  tool.quaternion.copy(quatFromDirRoll(dir, roll));
  tool.position.set(0, Math.sin(time * 0.8) * 0.6 * idle, 0);

  flyCam(flyP, camTarget, lookTarget);
  camTarget.x += mouse.sx * 3; camTarget.y += -mouse.sy * 2;
  if (!orbit) {
    const f = camera.aspect < 1.5 ? 1.5 / camera.aspect : 1;   // narrow screens: step back so the awl fits
    camTarget.sub(lookTarget).multiplyScalar(f).add(lookTarget);
    camera.position.lerp(camTarget, 0.12);
    controls.target.lerp(lookTarget, 0.12);
    camera.lookAt(controls.target);
  }

  // canvas hides under the video and the sheet
  const hide = Math.max(sstep(0.15, 0.6, packCover), sstep(0.05, 0.4, sheetCover));
  canvas.style.opacity = orbit ? '1' : String(1 - hide);

  // video plays only while on screen
  const live = packCover > 0.2;
  if (live !== videoLive) {
    videoLive = live;
    packEl.classList.toggle('live', live);
    if (live) video.play().catch(() => {}); else video.pause();
  }

  const ranges = [[0.03, 0.30], [0.36, 0.62], [0.68, 0.97]];
  caps.forEach((el, i) => el.classList.toggle('on', flyP > ranges[i][0] && flyP < ranges[i][1] && heroP > 0.9));

  controls.update();
  if (hide < 0.999 || orbit) composer.render();
}

// ------------------------------------------------------------------ model
async function loadModel() {
  const res = await fetch('model.bin');
  const buf = new Uint8Array(await res.arrayBuffer());
  for (let i = 0; i < buf.length; i++) buf[i] ^= KEY[i % KEY.length] ^ (i & 0xff);
  const gltf = await new Promise((ok, err) => new GLTFLoader().parse(buf.buffer, '', ok, err));
  const root = gltf.scene;
  root.traverse(o => { if (o.isMesh) o.material = steel; });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(V3());
  root.scale.setScalar(135 / Math.max(size.x, size.y, size.z));
  const box2 = new THREE.Box3().setFromObject(root);
  const c = box2.getCenter(V3());
  root.position.sub(c);
  TIP.set(box2.max.x - c.x, 0, 0);
  tool.add(root);
  toolReady = true;
  const load = document.getElementById('load');
  load.classList.add('done');
  setTimeout(() => load.remove(), 700);
}

spinBtn.addEventListener('click', () => {
  orbit = !orbit;
  document.body.classList.toggle('orbit', orbit);
  controls.enabled = orbit;
  spinBtn.textContent = orbit ? 'Назад' : '360°';
  if (orbit) {
    controls.minDistance = 10; controls.maxDistance = 320;
    controls.autoRotate = true; controls.autoRotateSpeed = 1.2;
    controls.target.set(0, 0, 0);
    camera.position.set(60, 40, 120);
  } else {
    controls.autoRotate = false;
  }
});
controls.addEventListener('start', () => { controls.autoRotate = false; });

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

loadModel().catch(err => {
  console.error(err);
  document.getElementById('load')?.classList.add('done');
});

renderer.setAnimationLoop(() => { if (toolReady) update(); });
