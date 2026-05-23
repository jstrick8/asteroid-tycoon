/* ============================================================
   render.js — all Three.js. Reads sim state, never mutates it
   (except draining state.events). Drills and rovers are drawn via
   InstancedMeshes filled each frame from logical state, so draw
   calls stay flat as the colony scales. Allocates nothing per
   frame: pools + scratch objects are created once.
   ============================================================ */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  createAsteroid, createStarfield, createSmelter, pickSurfacePoint,
  createDrillMeshes, createRoverMeshes, createOreInstancedMesh,
  createDustInstancedMesh, createSmokeInstancedMesh, createCrateInstancedMesh,
  createLaunchPad, createRocket, createResearchLab, createWarpGate, WHEEL_OFFSETS,
  createChunkInstancedMesh, createDrillHaloInstancedMesh,
} from "./entities.js";
import {
  state, prev, upgradeLevel, warpUnlocked,
  clickAsteroid as simClickAsteroid, collectChunk as simCollectChunk,
} from "./sim.js";
import { getSector } from "./sectors.js";
import * as C from "./config.js";
import * as audio from "./audio.js";
import * as ui from "./ui.js";

let renderer, scene, camera, controls;
let homeBody, asteroid, starfield, smelter;
let drillBody, drillBit, drillLight, drillHalo;
let roverBody, roverWheel, roverHeadlight, oreMesh, dustMesh;
let crateMesh, smokeMesh, researchLab, sun, warpGate;
let chunkMesh;
const launchPads = [];   // [{ pad: Mesh, rocket: Group, pos: Vec3, normal: Vec3, quat: Quat }]
let warpStreak = 0;
let starBaseSize = 2.2;
let stormTime = 0;     // offline-collect rocket-storm celebration
let stormSub = 0;
let composer = null, bloomPass = null;
let particleScale = 1;
let shakeScale = 1;

// event visuals
let flareLevel = 0;
let meteorTimer = 0;
const meteors = []; // cosmetic background streaks
const BASE_FOG = new THREE.Color(0x04060f);
const FLARE_FOG = new THREE.Color(0x3a1c08);
const BASE_BG = new THREE.Color(0x04060f);
const FLARE_BG = new THREE.Color(0x140a06);
const BASE_SUN = new THREE.Color(0xfff2dd);
const FLARE_SUN = new THREE.Color(0xff8a3a);

// crate stack near the smelter — refined output shared across all pads
const RPAD_POS = new THREE.Vector3();
const RPAD_QUAT = new THREE.Quaternion();
const CRATE_STACK = [];
const _ndc = new THREE.Vector3();

// drill tier visuals (changes the SHARED drill body/bit material colors based
// on the player's drillPower upgrade level — every drill on the field reflects
// the current tier without per-instance material churn).
const DRILL_TIERS = [
  { upTo: 4,  body: 0x6a6e78, bodyEmissive: 0x000000, bodyEI: 0.0, bit: 0x9aa0aa, bitEI: 0.0, light: [1.0, 0.706, 0.329], halo: 0x000000, haloOpacity: 0 },
  { upTo: 9,  body: 0x886648, bodyEmissive: 0x3a1c08, bodyEI: 0.35, bit: 0xd7a259, bitEI: 0.15, light: [1.0, 0.62, 0.20], halo: 0xff8a3a, haloOpacity: 0.10 },
  { upTo: 14, body: 0xb89656, bodyEmissive: 0x6a4a10, bodyEI: 0.45, bit: 0xffd27a, bitEI: 0.35, light: [1.0, 0.88, 0.36], halo: 0xffc060, haloOpacity: 0.20 },
  { upTo: 19, body: 0x6fb4ff, bodyEmissive: 0x1a4c80, bodyEI: 0.65, bit: 0xa0e0ff, bitEI: 0.55, light: [0.45, 0.85, 1.0], halo: 0x46c8ff, haloOpacity: 0.30 },
  { upTo: 29, body: 0xb080ff, bodyEmissive: 0x4a1a90, bodyEI: 0.85, bit: 0xd6c2ff, bitEI: 0.7, light: [0.78, 0.55, 1.0], halo: 0x8a5cff, haloOpacity: 0.4 },
  { upTo: 999, body: 0xffa0d0, bodyEmissive: 0x802040, bodyEI: 1.1, bit: 0xffd0e0, bitEI: 0.95, light: [1.0, 0.55, 0.78], halo: 0xff80a0, haloOpacity: 0.55 },
];
let currentDrillTierKey = -1; // forces a refresh on first frame

// render-side smoke pool
const smoke = [];
let smokeCursor = 0;
let shake = 0;

// per-drill render caches (static unless drill count grows)
const drillQuat = [];     // THREE.Quaternion
const drillSurf = [];     // THREE.Vector3
const drillNorm = [];     // THREE.Vector3
const drillBitAngle = []; // number
const drillPhase = [];    // number

// per-rover render caches (recomputed each frame)
const roverPos = [];      // THREE.Vector3
const roverQuat = [];     // THREE.Quaternion
const roverTrail = [];    // trail spawn timer

// render-side dust pool
const dust = [];
let dustCursor = 0;

// scratch
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _basis = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dirA = new THREE.Vector3();
const _dirB = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v = new THREE.Vector3();
const _wheelOff = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Vector3(0, 0, 0);
const _scaleA = new THREE.Vector3();
const _scaleB = new THREE.Vector3();
const _scaleC = new THREE.Vector3();
const ORE_COLOR = new THREE.Color(0.6, 0.78, 1.0);

// global visual size of entities relative to the asteroid (1.0 = original).
// Smaller numbers make the asteroid feel bigger by contrast.
const DRILL_SCALE = 0.60;
const ROVER_SCALE = 0.60;

// stockpile + cargo cube layouts
const PILE = makePile(C.MAX_STOCKPILE + C.CARGO_CAP);
const BED = [
  [-0.13, 0.42, -0.08], [0.13, 0.42, -0.08],
  [-0.13, 0.42, -0.42], [0.13, 0.42, -0.42],
  [0.0, 0.62, -0.25],
];
function makePile(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / 6);
    const w = i % 6;
    const cx = ((w % 3) - 1) * 0.24;
    const cz = (Math.floor(w / 3) - 0.5) * 0.24;
    out.push([0.95 + cx, 0.12 + layer * 0.22, cz]);
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t) => t * t * (3 - 2 * t);

let renderClock = performance.now() / 1000;
let smelterFlash = 0;

export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060f);
  scene.fog = new THREE.FogExp2(0x04060f, 0.0016);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
  const dist = 32, elev = THREE.MathUtils.degToRad(35);
  camera.position.set(Math.cos(elev) * dist * 0.72, Math.sin(elev) * dist, Math.cos(elev) * dist * 0.72);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 16;
  controls.maxDistance = 70;
  controls.minPolarAngle = THREE.MathUtils.degToRad(12);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(82);

  sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(-30, 38, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -22; sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x33405e, 0.55));
  const fill = new THREE.DirectionalLight(0x4a6cff, 0.35);
  fill.position.set(25, 10, -20);
  scene.add(fill);

  starfield = createStarfield(3000, 600);
  scene.add(starfield);

  homeBody = new THREE.Group();
  scene.add(homeBody);

  asteroid = createAsteroid(C.ASTEROID_RADIUS);
  homeBody.add(asteroid);
  smelter = createSmelter();
  homeBody.add(smelter);

  const d = createDrillMeshes();
  drillBody = d.body; drillBit = d.bit; drillLight = d.light;
  homeBody.add(drillBody, drillBit, drillLight);

  const r = createRoverMeshes();
  roverBody = r.body; roverWheel = r.wheels; roverHeadlight = r.headlight;
  homeBody.add(roverBody, roverWheel, roverHeadlight);

  oreMesh = createOreInstancedMesh();
  homeBody.add(oreMesh);
  dustMesh = createDustInstancedMesh();
  homeBody.add(dustMesh);
  smokeMesh = createSmokeInstancedMesh();
  homeBody.add(smokeMesh);
  crateMesh = createCrateInstancedMesh();
  homeBody.add(crateMesh);

  // crate-staging pad orientation (shared by all rockets — refined stockpile
  // lives next to the smelter, regardless of how many launchpads exist)
  RPAD_POS.set(C.REFINED_PAD.x, C.REFINED_PAD.y, C.REFINED_PAD.z).normalize().multiplyScalar(7.9);
  const _refNorm = _v.clone().set(C.LAUNCH_PAD.x, C.LAUNCH_PAD.y, C.LAUNCH_PAD.z).normalize();
  RPAD_QUAT.setFromUnitVectors(UP, _refNorm);

  // build initial launchpad(s) — at start there's always pad #0. Additional
  // pads are added dynamically in drainEvents() when state.pads grows.
  for (let i = 0; i < state.pads; i++) ensureLaunchPad(i);

  // clickable chunk mesh (manual mining: hovering ore the player taps)
  chunkMesh = createChunkInstancedMesh();
  homeBody.add(chunkMesh);

  // drill halo — only visible at high upgrade tiers. instanced so the cost is
  // flat regardless of drill count.
  drillHalo = createDrillHaloInstancedMesh();
  homeBody.add(drillHalo);

  // research lab — visible from the start, seated on the surface
  researchLab = createResearchLab();
  _dir.set(C.LAB_POS.x, C.LAB_POS.y, C.LAB_POS.z).normalize();
  researchLab.position.copy(_dir).multiplyScalar(7.9);
  researchLab.quaternion.setFromUnitVectors(UP, _dir);
  homeBody.add(researchLab);

  // warp gate — hidden until $1T lifetime
  warpGate = createWarpGate();
  _dir.set(C.WARP_PAD.x, C.WARP_PAD.y, C.WARP_PAD.z).normalize();
  warpGate.position.copy(_dir).multiplyScalar(7.9);
  warpGate.quaternion.setFromUnitVectors(UP, _dir);
  warpGate.visible = false;
  homeBody.add(warpGate);

  starBaseSize = starfield.material.size;
  applySector(state.currentSector);

  // post-processing: subtle bloom on emissive materials
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55, // strength (tuned low)
      0.5,  // radius
      0.82  // threshold — only bright emissives bloom
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composer.setSize(window.innerWidth, window.innerHeight);
  } catch (e) {
    console.warn("[render] bloom unavailable, falling back to direct render", e);
    composer = null;
  }

  for (let i = 0; i < C.SMOKE_POOL; i++) {
    smoke.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, scale: 1, grow: 1, r: 0.4, g: 0.4, b: 0.4 });
  }
  buildCrateStack();

  // cosmetic meteor streaks (world space, used during meteor showers)
  // big, dramatic streaks — wide, long, and bright so they read against the sky
  const meteorGeo = new THREE.BoxGeometry(3.2, 3.2, 90);
  for (let i = 0; i < 7; i++) {
    const meteorMat = new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(meteorGeo, meteorMat);
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    meteors.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0 });
  }

  for (let i = 0; i < C.DUST_POOL; i++) {
    dust.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, scale: 1, r: 1, g: 1, b: 1 });
  }
  // start everything hidden
  drillBody.count = drillBit.count = drillLight.count = 0;
  roverBody.count = roverWheel.count = roverHeadlight.count = 0;
  oreMesh.count = 0;
  crateMesh.count = 0;
  dustMesh.count = C.DUST_POOL;
  smokeMesh.count = C.SMOKE_POOL;
  for (let i = 0; i < C.DUST_POOL; i++) { _m.compose(ZERO, _q.identity(), ZERO); dustMesh.setMatrixAt(i, _m); }
  for (let i = 0; i < C.SMOKE_POOL; i++) { _m.compose(ZERO, _q.identity(), ZERO); smokeMesh.setMatrixAt(i, _m); }
  dustMesh.instanceMatrix.needsUpdate = true;
  smokeMesh.instanceMatrix.needsUpdate = true;

  return { renderer, scene, camera, controls };
}

export function pickPlacement() { return pickSurfacePoint(asteroid); }

/* Build a launchpad mesh + rocket pair at slot `i`. Each pad has its own
   frame (position/normal/quaternion) so rockets spread around the upper
   hemisphere as the player buys more. */
function ensureLaunchPad(i) {
  if (launchPads[i]) return launchPads[i];
  const off = C.LAUNCH_PAD_OFFSETS[i] || C.LAUNCH_PAD;
  const normal = new THREE.Vector3(off.x, off.y, off.z).normalize();
  const pos = normal.clone().multiplyScalar(7.9);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, normal);
  const pad = createLaunchPad();
  pad.position.copy(pos);
  pad.quaternion.copy(quat);
  homeBody.add(pad);
  const rk = createRocket();
  rk.position.copy(pos);
  rk.quaternion.copy(quat);
  homeBody.add(rk);
  const entry = { pad, rocket: rk, pos, normal, quat };
  launchPads[i] = entry;
  return entry;
}

/* Hit-test a click against the asteroid mesh and return a homeBody-local
   surface point + normal (or null if the click missed). Used by the manual
   mining loop in main.js. */
export function pickAsteroidClickPoint(clientX, clientY) {
  if (!asteroid) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  _mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _ray.setFromCamera(_mouse, camera);
  // raycast against asteroid in world space, then invert through homeBody
  // so the position lives in the spinning frame (chunks track the spin).
  const hits = _ray.intersectObject(asteroid, false);
  if (!hits.length) return null;
  const h = hits[0];
  const inv = _q2.copy(homeBody.quaternion).invert();
  const lp = _pos2.copy(h.point).applyQuaternion(inv);
  const ln = _v2.copy(h.face.normal).applyQuaternion(inv).normalize();
  // accumulate a pockmark at the hit point for visible wear
  addPockmark(lp, 0.6);
  return { pos: { x: lp.x, y: lp.y, z: lp.z }, nrm: { x: ln.x, y: ln.y, z: ln.z } };
}

/* Hit-test a click against the chunk mesh — returns the matching chunk id
   in state.chunks if hit, otherwise null. */
export function pickChunkAt(clientX, clientY) {
  if (!chunkMesh || chunkMesh.count <= 0) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  _mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _ray.setFromCamera(_mouse, camera);
  const hit = _ray.intersectObject(chunkMesh, false);
  if (!hit.length || hit[0].instanceId == null) return null;
  const idx = hit[0].instanceId;
  const c = state.chunks[idx];
  return c ? c.id : null;
}

// scratch added for pickAsteroidClickPoint (avoid creating each click)
const _q2 = new THREE.Quaternion();
const _pos2 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function spawnMeteor() {
  for (const mt of meteors) {
    if (mt.life > 0) continue;
    // start high on one side, streak diagonally across the sky
    const side = Math.random() < 0.5 ? -1 : 1;
    mt.mesh.position.set(side * (160 + Math.random() * 120), 120 + Math.random() * 80, -120 + Math.random() * 240);
    mt.vx = -side * (180 + Math.random() * 120);
    mt.vy = -(90 + Math.random() * 70);
    mt.vz = (Math.random() - 0.5) * 80;
    mt.life = 1.4 + Math.random() * 0.8;
    mt.mesh.visible = true;
    _v.set(mt.vx, mt.vy, mt.vz).normalize();
    mt.mesh.lookAt(mt.mesh.position.x + _v.x, mt.mesh.position.y + _v.y, mt.mesh.position.z + _v.z);
    return;
  }
}

function updateEventVisuals(dt) {
  // solar flare: warm the fog/background/sun
  flareLevel += (state.fx.flare - flareLevel) * (1 - Math.exp(-dt * 2.5));
  scene.fog.color.copy(BASE_FOG).lerp(FLARE_FOG, flareLevel * 0.85);
  scene.background.copy(BASE_BG).lerp(FLARE_BG, flareLevel * 0.6);
  sun.color.copy(BASE_SUN).lerp(FLARE_SUN, flareLevel);
  sun.intensity = 2.4 + flareLevel * 0.9;

  // meteor streaks during a shower
  if (state.fx.meteor > 0) {
    meteorTimer -= dt;
    if (meteorTimer <= 0) { spawnMeteor(); meteorTimer = 0.5 + Math.random() * 1.0; }
  }
  for (const mt of meteors) {
    if (mt.life <= 0) continue;
    mt.life -= dt;
    mt.mesh.position.x += mt.vx * dt;
    mt.mesh.position.y += mt.vy * dt;
    mt.mesh.position.z += mt.vz * dt;
    mt.mesh.material.opacity = Math.min(1, mt.life) * 0.9;
    if (mt.life <= 0) mt.mesh.visible = false;
  }
}

const SECTOR_SUN = {
  1: 0xfff2dd, 2: 0xcfe4ff, 3: 0xffd0b0, 4: 0xe6ccff, 5: 0xffb070,
};
export function applySector(id) {
  const s = getSector(id);
  asteroid.material.color.setHex(s.tint);
  asteroid.material.emissive.setHex(s.emissive || 0x000000);
  asteroid.material.emissiveIntensity = s.emissive ? 0.35 : 0;
  // sector-specific sunlight colour (cool for ice, red for lava, etc.)
  if (sun) { BASE_SUN.setHex(SECTOR_SUN[id] || 0xffe2c0); sun.color.copy(BASE_SUN); }
}

export function triggerWarpStreak() { warpStreak = 1; shake = Math.max(shake, 0.45); }

export function rocketStorm(seconds = 3) { stormTime = seconds; stormSub = 0; }

function updateStorm(dt) {
  if (stormTime <= 0) return;
  stormTime -= dt;
  stormSub -= dt;
  if (stormSub <= 0) {
    stormSub = 0.16;
    // launch plume bursts on every pad we own — more pads, bigger storm
    for (let pi = 0; pi < launchPads.length; pi++) {
      const pad = launchPads[pi];
      if (!pad) continue;
      _v.copy(pad.pos).addScaledVector(pad.normal, 0.4);
      spawnFire(_v, pad.normal, 18);
      spawnSmoke(_v, pad.normal, 6);
    }
    shake = Math.max(shake, 0.35);
  }
}

function updateWarp(now, dt) {
  if (!warpGate) return;
  const unlocked = warpUnlocked();
  warpGate.visible = unlocked || warpStreak > 0.01;
  if (warpGate.visible) {
    warpGate.userData.ring.rotation.z = now * 0.5;
    warpGate.userData.core.rotation.y = now * 1.3;
    warpGate.userData.core.rotation.x = now * 0.8;
    const pulse = 1.2 + Math.sin(now * 3) * 0.5 + warpStreak * 3;
    warpGate.userData.ringMat.emissiveIntensity = pulse;
    warpGate.userData.disc.material.opacity = 0.18 + warpStreak * 0.6;
  }
  // starfield streak during a warp jump
  if (warpStreak > 0.001) {
    warpStreak = Math.max(0, warpStreak - dt * 0.7);
    starfield.material.size = starBaseSize * (1 + warpStreak * 8);
    shake = Math.max(shake, warpStreak * 0.4);
  } else if (starfield.material.size !== starBaseSize) {
    starfield.material.size = starBaseSize;
  }
}

function updateLab(now) {
  if (!researchLab) return;
  researchLab.userData.dish.rotation.y = now * 0.6;
  const leds = researchLab.userData.lights;
  for (let i = 0; i < leds.length; i++) {
    const p = 0.4 + Math.abs(Math.sin(now * 2 + leds[i].userData.phase)) * 0.9;
    leds[i].material.color.setRGB(0.36 * p, 0.78 * p, 1.0 * p);
  }
}

// ---- math helpers ----
function slerpDir(ax, ay, az, bx, by, bz, angle, t, out) {
  if (angle < 1e-4) { out.set(ax, ay, az); return out; }
  const s = Math.sin(angle);
  const w0 = Math.sin((1 - t) * angle) / s;
  const w1 = Math.sin(t * angle) / s;
  out.set(ax * w0 + bx * w1, ay * w0 + by * w1, az * w0 + bz * w1).normalize();
  return out;
}
function basisQuat(up, fwd, outQuat) {
  // re-orthonormalize: up fixed, forward projected onto tangent plane
  _fwd.copy(fwd).addScaledVector(up, -fwd.dot(up));
  if (_fwd.lengthSq() < 1e-8) _fwd.set(up.z, up.x, up.y); // arbitrary fallback
  _fwd.normalize();
  _right.crossVectors(_fwd, up).normalize();
  _basis.makeBasis(_right, up, _fwd); // model: +X right, +Y up, +Z forward
  outQuat.setFromRotationMatrix(_basis);
}

// ---- pockmarks: visible wear on the asteroid surface ----
/* Darkens vertex colors near a hit point on the asteroid. We never modify
   the geometry positions (would require recomputing normals every time);
   shading + emissive falloff is enough to read as a crater. Cheap: scans
   the position attribute once per drill cycle / click. */
const _pp = new THREE.Vector3();
function addPockmark(localPos, intensity = 0.5) {
  if (!asteroid) return;
  const geo = asteroid.geometry;
  const posAttr = geo.attributes.position;
  const colAttr = geo.attributes.color;
  if (!posAttr || !colAttr) return;
  const r2 = 1.8 * 1.8; // damage radius squared
  for (let i = 0; i < posAttr.count; i++) {
    _pp.fromBufferAttribute(posAttr, i);
    const dx = _pp.x - localPos.x, dy = _pp.y - localPos.y, dz = _pp.z - localPos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const falloff = 1 - (d2 / r2);
    const k = Math.max(0.55, 1 - intensity * falloff * 0.45);
    const r = colAttr.getX(i) * k;
    const g = colAttr.getY(i) * k;
    const b = colAttr.getZ(i) * k;
    colAttr.setXYZ(i, r, g, b);
  }
  colAttr.needsUpdate = true;
}

// ---- chunks: clickable hovering ore from manual mining ----
const _chunkScale = new THREE.Vector3();
function updateChunks(now) {
  if (!chunkMesh) return;
  const chunks = state.chunks;
  const n = Math.min(chunks.length, C.CHUNK_POOL);
  chunkMesh.count = n;
  for (let i = 0; i < n; i++) {
    const c = chunks[i];
    _pos.set(c.x, c.y, c.z);
    // wobble + spin so chunks are clearly interactive in world
    const wob = Math.sin(now * 4 + c.id * 0.7) * 0.08;
    const k = 1 + wob;
    _q.setFromAxisAngle(UP, now * 1.2 + c.id);
    _chunkScale.set(k, k, k);
    _m.compose(_pos, _q, _chunkScale);
    chunkMesh.setMatrixAt(i, _m);
    // pulse color brighter when about to expire (last 1.5s)
    const fade = c.life < 1.5 ? Math.max(0.3, c.life / 1.5) : 1;
    _col.setRGB(1.0 * fade, 0.85 * fade, 0.35 * fade);
    chunkMesh.setColorAt(i, _col);
  }
  chunkMesh.instanceMatrix.needsUpdate = true;
  if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true;
  // InstancedMesh.raycast caches boundingSphere from the first call and never
  // updates it. Chunks move from origin to hover positions, so the cached
  // sphere (centered at origin) won't include them — invalidate every frame
  // so the next click recomputes against current positions.
  chunkMesh.boundingSphere = null;
}

// ---- drill render caches ----
const drillCyclesSeen = []; // per-drill cycle count we've last processed (for pockmarks)
function ensureDrillCaches() {
  const drills = state.drills;
  for (let i = drillQuat.length; i < drills.length; i++) {
    const d = drills[i];
    const surf = new THREE.Vector3(d.x, d.y, d.z);
    const norm = new THREE.Vector3(d.nx, d.ny, d.nz);
    const qn = new THREE.Quaternion().setFromUnitVectors(UP, norm);
    drillSurf.push(surf);
    drillNorm.push(norm);
    drillQuat.push(qn);
    drillBitAngle.push(0);
    drillPhase.push(Math.random() * Math.PI * 2);
    drillCyclesSeen.push(d.cycles || 0);
  }
}

/* Apply the current drillPower tier to the shared drill body/bit materials.
   Costs nothing per-frame past the boundary check — we cache the active tier
   key and only touch material props when the player crosses a level band. */
function refreshDrillTier(tier) {
  const bodyMat = drillBody.material;
  const bitMat = drillBit.material;
  bodyMat.color.setHex(tier.body);
  bodyMat.emissive.setHex(tier.bodyEmissive);
  bodyMat.emissiveIntensity = tier.bodyEI;
  bodyMat.needsUpdate = true;
  bitMat.color.setHex(tier.bit);
  bitMat.emissive = bitMat.emissive || new THREE.Color();
  bitMat.emissive.setHex(tier.bit);
  bitMat.emissiveIntensity = tier.bitEI;
  bitMat.needsUpdate = true;
  // halo opacity (per-instance color is set elsewhere; opacity is material-wide)
  if (drillHalo) {
    drillHalo.material.opacity = tier.haloOpacity;
    drillHalo.material.color.setHex(tier.halo || 0x000000);
  }
}

function updateDrills(alpha, now, dt) {
  ensureDrillCaches();
  const drills = state.drills;
  const n = Math.min(drills.length, C.DRILL_CAP);
  drillBody.count = drillBit.count = drillLight.count = n;

  // upgrade-tier visuals (color/emissive shared across all instances)
  const dpow = upgradeLevel("drillPower");
  const dspd = upgradeLevel("drillSpeed");
  let tierIdx = 0;
  for (let t = 0; t < DRILL_TIERS.length; t++) {
    if (dpow <= DRILL_TIERS[t].upTo) { tierIdx = t; break; }
  }
  const tier = DRILL_TIERS[tierIdx];
  if (tierIdx !== currentDrillTierKey) {
    currentDrillTierKey = tierIdx;
    refreshDrillTier(tier);
  }

  // visual growth from upgrades (global — all drills share levels)
  const bodyS = (1 + Math.min(dpow * 0.025, 0.8)) * DRILL_SCALE;
  const bitS  = (1 + Math.min(dpow * 0.04, 1.3)) * DRILL_SCALE;
  const lightS = (1 + Math.min(dspd * 0.04, 0.8)) * DRILL_SCALE;
  const lightBoost = 1 + Math.min(dspd * 0.05, 1.0);
  _scaleA.set(bodyS, bodyS, bodyS);
  _scaleB.set(bitS, bitS, bitS);
  _scaleC.set(lightS, lightS, lightS);

  // halo only renders when the tier wants it (cheap: count==0 skips draw)
  const showHalo = tier.haloOpacity > 0.01;
  if (drillHalo) drillHalo.count = showHalo ? n : 0;
  const haloScale = (1.0 + Math.min(dpow * 0.02, 0.6)) * DRILL_SCALE;
  const haloPulse = 0.85 + Math.sin(now * 2.3) * 0.15;

  for (let i = 0; i < n; i++) {
    const d = drills[i];
    const deploy = lerp(d.deployPrev, d.deploy, alpha);
    const off = (1 - deploy) * C.DRILL_DROP_HEIGHT;
    const norm = drillNorm[i], surf = drillSurf[i], qn = drillQuat[i];
    _pos.set(surf.x + norm.x * off, surf.y + norm.y * off, surf.z + norm.z * off);

    _m.compose(_pos, qn, _scaleA);
    drillBody.setMatrixAt(i, _m);

    if (d.deploy >= 1) drillBitAngle[i] += dt * 9;
    _qSpin.setFromAxisAngle(UP, drillBitAngle[i]);
    _q.multiplyQuaternions(qn, _qSpin);
    _m.compose(_pos, _q, _scaleB);
    drillBit.setMatrixAt(i, _m);

    _m.compose(_pos, qn, _scaleC);
    drillLight.setMatrixAt(i, _m);
    const lc = tier.light;
    const pulse = (1.3 + Math.sin(now * 5 + drillPhase[i]) * 0.7) * lightBoost;
    _col.setRGB(lc[0] * pulse, lc[1] * pulse, lc[2] * pulse);
    drillLight.setColorAt(i, _col);

    if (showHalo && drillHalo) {
      const hs = haloScale * (1.0 + Math.sin(now * 3 + drillPhase[i]) * 0.08);
      _scaleA.set(hs, hs, hs);
      _m.compose(_pos, qn, _scaleA);
      drillHalo.setMatrixAt(i, _m);
    }

    // wear the surface where this drill operates — once per completed cycle.
    if (d.deploy >= 1 && d.cycles > drillCyclesSeen[i]) {
      drillCyclesSeen[i] = d.cycles;
      addPockmark(surf, 0.25);
    }
  }
  drillBody.instanceMatrix.needsUpdate = true;
  drillBit.instanceMatrix.needsUpdate = true;
  drillLight.instanceMatrix.needsUpdate = true;
  if (drillLight.instanceColor) drillLight.instanceColor.needsUpdate = true;
  if (showHalo && drillHalo) drillHalo.instanceMatrix.needsUpdate = true;
  // reset body scale tracker since we used it for halos
  _scaleA.set(bodyS, bodyS, bodyS);
}

// ---- rover poses + instances ----
function computeRoverPose(r, alpha, outPos, outQuat) {
  if (r.state === "IDLE") {
    const i = r.homeIndex;
    const a = i * 2.39996323;
    const ring = 1.6 + (i % 5) * 0.5;
    const ox = Math.cos(a) * ring, oz = Math.sin(a) * ring;
    _dir.set(ox, C.ROVER_HOME.r, oz).normalize();
    outPos.copy(_dir).multiplyScalar(C.ROVER_HOME.r + C.ROVER_HOVER);
    _v.set(-ox, 0, -oz); // face toward smelter center
    basisQuat(_dir, _v, outQuat);
    return;
  }
  const t = clamp01(lerp(r.pPrev, r.p, alpha));
  slerpDir(r.fx, r.fy, r.fz, r.tx, r.ty, r.tz, r.angle, t, _dir);
  const rad = lerp(r.fr, r.tr, t) + C.ROVER_HOVER;
  outPos.copy(_dir).multiplyScalar(rad);
  // tangent (direction of travel)
  const dlt = 0.012;
  const t0 = clamp01(t - dlt), t1 = clamp01(t + dlt);
  slerpDir(r.fx, r.fy, r.fz, r.tx, r.ty, r.tz, r.angle, t0, _dirA);
  slerpDir(r.fx, r.fy, r.fz, r.tx, r.ty, r.tz, r.angle, t1, _dirB);
  _v.subVectors(_dirB, _dirA);
  if (_v.lengthSq() < 1e-9) _v.set(-_dir.z, 0, _dir.x);
  basisQuat(_dir, _v, outQuat);
}

function updateRovers(alpha, now, dt) {
  const rovers = state.rovers;
  const n = rovers.length;
  roverBody.count = n;
  roverHeadlight.count = n;
  roverWheel.count = n * 6;

  for (let i = roverPos.length; i < n; i++) {
    roverPos.push(new THREE.Vector3());
    roverQuat.push(new THREE.Quaternion());
    roverTrail.push(0);
  }

  // visual growth from upgrades (bigger cargo bed, brighter headlights),
  // then uniformly shrunk by ROVER_SCALE so the asteroid reads as larger.
  const rcap = upgradeLevel("roverCapacity");
  const rspd = upgradeLevel("roverSpeed");
  _scaleA.set(
    (1 + Math.min(rcap * 0.05, 0.3)) * ROVER_SCALE,
    (1 + Math.min(rcap * 0.08, 0.5)) * ROVER_SCALE,
    (1 + Math.min(rcap * 0.06, 0.45)) * ROVER_SCALE
  );
  roverHeadlight.material.opacity = 0.35 + Math.min(rspd * 0.05, 0.45);

  for (let i = 0; i < n; i++) {
    const r = rovers[i];
    const pos = roverPos[i], quat = roverQuat[i];
    computeRoverPose(r, alpha, pos, quat);

    _m.compose(pos, quat, _scaleA);
    roverBody.setMatrixAt(i, _m);
    roverHeadlight.setMatrixAt(i, _m);

    // wheels: rover transform * (translate(offset) * Rx(spin))
    const moving = r.state === "TO_DRILL" || r.state === "TO_SMELTER";
    const spin = (clamp01(lerp(r.pPrev, r.p, alpha)) * r.arcLen) / C.WHEEL_RADIUS;
    _qSpin.setFromAxisAngle(_right.set(1, 0, 0), spin);
    for (let w = 0; w < 6; w++) {
      const o = WHEEL_OFFSETS[w];
      _wheelOff.set(o[0], o[1], o[2]);
      _m2.compose(_wheelOff, _qSpin, ONE);
      _m2.premultiply(_m); // _m is rover body matrix
      roverWheel.setMatrixAt(i * 6 + w, _m2);
    }

    // dust trail behind moving rovers
    if (moving) {
      roverTrail[i] -= dt;
      if (roverTrail[i] <= 0) {
        roverTrail[i] = 0.09;
        _v.set(0, 0, 1).applyQuaternion(quat);              // forward
        spawnDust(pos.x - _v.x * 0.5, pos.y - _v.y * 0.5 + 0.05, pos.z - _v.z * 0.5,
          pos.x, pos.y, pos.z, 1, 0.5, 0.42, 0.3, 0.45);
      }
    }
  }
  roverBody.instanceMatrix.needsUpdate = true;
  roverHeadlight.instanceMatrix.needsUpdate = true;
  roverWheel.instanceMatrix.needsUpdate = true;
}

// ---- ore cubes: stockpiles (+ in-transit) and rover cargo ----
function updateOre(alpha) {
  const drills = state.drills;
  const rovers = state.rovers;
  let k = 0;

  // in-transit cubes (leaving the pile, entering the bed) still shown at the pile
  // accumulate per drill index
  for (let i = 0; i < rovers.length; i++) {
    const r = rovers[i];
    if (r.state === "LOADING" && r.drillIndex >= 0 && drills[r.drillIndex]) {
      drills[r.drillIndex]._extra = (drills[r.drillIndex]._extra || 0) + Math.round(r.cargo * (1 - clamp01(r.loadT)));
    }
  }

  // stockpile cubes follow drill shrink (offsets + cube size both scale)
  const oreDrillScale = _scaleA.set(DRILL_SCALE, DRILL_SCALE, DRILL_SCALE);
  for (let i = 0; i < drills.length && k < C.ORE_POOL; i++) {
    const d = drills[i];
    if (d.deploy < 1) { d._extra = 0; continue; }
    let show = d.stockpile + (d._extra || 0);
    d._extra = 0;
    if (show > PILE.length) show = PILE.length;
    const qn = drillQuat[i], surf = drillSurf[i];
    for (let j = 0; j < show && k < C.ORE_POOL; j++) {
      const o = PILE[j];
      _v.set(o[0] * DRILL_SCALE, o[1] * DRILL_SCALE, o[2] * DRILL_SCALE).applyQuaternion(qn).add(surf);
      _m.compose(_v, qn, oreDrillScale);
      oreMesh.setMatrixAt(k, _m);
      oreMesh.setColorAt(k, ORE_COLOR);
      k++;
    }
  }

  // cargo cubes follow rover shrink
  const oreRoverScale = _scaleB.set(ROVER_SCALE, ROVER_SCALE, ROVER_SCALE);
  for (let i = 0; i < rovers.length && k < C.ORE_POOL; i++) {
    const r = rovers[i];
    let show = 0;
    if (r.state === "LOADING") show = Math.round(r.cargo * clamp01(r.loadT));
    else if (r.state === "TO_SMELTER") show = r.cargo;
    else if (r.state === "UNLOADING") show = Math.round(r.cargo * (1 - clamp01(r.loadT)));
    if (show <= 0) continue;
    if (show > BED.length) show = BED.length;
    const pos = roverPos[i], quat = roverQuat[i];
    for (let j = 0; j < show && k < C.ORE_POOL; j++) {
      const b = BED[j];
      _v.set(b[0] * ROVER_SCALE, b[1] * ROVER_SCALE, b[2] * ROVER_SCALE).applyQuaternion(quat).add(pos);
      _m.compose(_v, quat, oreRoverScale);
      oreMesh.setMatrixAt(k, _m);
      oreMesh.setColorAt(k, ORE_COLOR);
      k++;
    }
  }

  oreMesh.count = k;
  oreMesh.instanceMatrix.needsUpdate = true;
  if (oreMesh.instanceColor) oreMesh.instanceColor.needsUpdate = true;
}

// ---- dust ----
function spawnDust(x, y, z, nx, ny, nz, count, r, g, b, spread = 2.0) {
  if (count > 1) count = Math.max(1, Math.round(count * particleScale));
  // normalize the surface normal hint
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  for (let c = 0; c < count; c++) {
    let slot = -1;
    for (let s = 0; s < C.DUST_POOL; s++) {
      const idx = (dustCursor + s) % C.DUST_POOL;
      if (!dust[idx].active) { slot = idx; break; }
    }
    if (slot < 0) return;
    dustCursor = (slot + 1) % C.DUST_POOL;
    const d = dust[slot];
    d.x = x + nx * 0.15; d.y = y + ny * 0.15; d.z = z + nz * 0.15;
    d.vx = nx * (1.0 + Math.random() * 1.6) + (Math.random() - 0.5) * spread;
    d.vy = ny * (1.0 + Math.random() * 1.6) + (Math.random() - 0.5) * spread;
    d.vz = nz * (1.0 + Math.random() * 1.6) + (Math.random() - 0.5) * spread;
    d.maxLife = 0.3 + Math.random() * 0.35;
    d.life = d.maxLife;
    d.scale = 0.45 + Math.random() * 0.5;
    d.r = r; d.g = g; d.b = b;
    d.active = true;
  }
}
function updateDust(dt) {
  for (let i = 0; i < C.DUST_POOL; i++) {
    const d = dust[i];
    if (!d.active) continue;
    d.life -= dt;
    if (d.life <= 0) {
      d.active = false;
      _m.compose(ZERO, _q.identity(), ZERO);
      dustMesh.setMatrixAt(i, _m);
      continue;
    }
    d.vx *= 0.95; d.vy *= 0.95; d.vz *= 0.95;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    const f = d.life / d.maxLife;
    const sc = d.scale * f;
    _q.setFromAxisAngle(UP, d.life * 7);
    _m.compose(_pos.set(d.x, d.y, d.z), _q, _v.set(sc, sc, sc));
    dustMesh.setMatrixAt(i, _m);
    _col.setRGB(d.r * f, d.g * f, d.b * f);
    dustMesh.setColorAt(i, _col);
  }
  dustMesh.instanceMatrix.needsUpdate = true;
  if (dustMesh.instanceColor) dustMesh.instanceColor.needsUpdate = true;
}

// ---- crates (refined stockpile + load fly-in) ----
function buildCrateStack() {
  CRATE_STACK.length = 0;
  for (let i = 0; i < C.MAX_VISIBLE_CRATES; i++) {
    const layer = Math.floor(i / 5);
    const w = i % 5;
    const cx = ((w % 3) - 1) * 0.46;
    const cz = (Math.floor(w / 3) - 0.5) * 0.46;
    CRATE_STACK.push([cx, 0.24 + layer * 0.44, cz]);
  }
}
function crateWorld(slot, out) {
  const o = CRATE_STACK[Math.min(slot, CRATE_STACK.length - 1)];
  out.set(o[0], o[1], o[2]).applyQuaternion(RPAD_QUAT).add(RPAD_POS);
  return out;
}
function updateCrates() {
  let k = 0;
  const rest = Math.min(Math.floor(state.refinedStock), C.MAX_VISIBLE_CRATES);
  for (let j = 0; j < rest && k < C.CRATE_POOL; j++) {
    crateWorld(j, _v);
    _m.compose(_v, RPAD_QUAT, ONE);
    crateMesh.setMatrixAt(k++, _m);
  }
  // loading fly-in for each rocket independently — multiple pads can be
  // loading at once, each pulling from the shared staging stack.
  for (let pi = 0; pi < state.rockets.length; pi++) {
    const rk = state.rockets[pi];
    const pad = launchPads[pi];
    if (!pad || rk.phase !== "LOADING") continue;
    _pos.copy(pad.pos).addScaledVector(pad.normal, 0.5);
    for (let j = 0; j < rk.cargo && k < C.CRATE_POOL; j++) {
      crateWorld(j, _v);
      const t = smoothstep(clamp01(rk.loadT * 1.15 - j * 0.03));
      _v.lerp(_pos, t);
      _m.compose(_v, RPAD_QUAT, ONE);
      crateMesh.setMatrixAt(k++, _m);
    }
  }
  crateMesh.count = k;
  crateMesh.instanceMatrix.needsUpdate = true;
}

// ---- rockets (one per launchpad) ----
function updateRocket(alpha, now, dt) {
  const capScale = 1 + Math.min(upgradeLevel("rocketCapacity") * 0.10, 1.3);
  for (let pi = 0; pi < state.rockets.length; pi++) {
    const rk = state.rockets[pi];
    const pad = launchPads[pi];
    if (!pad) continue;
    const rocket = pad.rocket;
    const fade = rk.fade;
    rocket.visible = fade > 0.02;
    if (!rocket.visible) continue;

    const asc = clamp01(lerp(rk.ascentPrev, rk.ascent, alpha));
    const offset = rk.phase === "ASCENT" ? asc * asc * C.ROCKET_ASCENT_HEIGHT : 0;

    _pos.copy(pad.pos).addScaledVector(pad.normal, offset);
    // slight launch wobble, fading as it climbs
    if (rk.phase === "ASCENT") {
      const wob = Math.sin(now * 22 + pi * 0.7) * 0.12 * (1 - asc);
      _right.set(1, 0, 0).applyQuaternion(pad.quat);
      _pos.addScaledVector(_right, wob);
    }
    rocket.position.copy(_pos);
    rocket.quaternion.copy(pad.quat);
    const s = Math.min(1, fade) * capScale;
    rocket.scale.set(s, s, s);

    const glow = rocket.userData.glow;
    if (rk.phase === "ASCENT") {
      glow.opacity = 0.85;
      _v.copy(_pos);
      const burst = asc < 0.12 ? 3 : 1;
      spawnFire(_v, pad.normal, 6 * burst);
      spawnSmoke(_v, pad.normal, 3 * burst);
    } else if (rk.phase === "COUNTDOWN") {
      glow.opacity = 0.2 + Math.abs(Math.sin(now * 12 + pi * 0.5)) * 0.25;
    } else {
      glow.opacity = 0;
    }
  }
}

function spawnFire(pos, up, count) {
  count = Math.max(0, Math.round(count * particleScale));
  const fires = [[1.0, 0.55, 0.15], [1.0, 0.8, 0.3], [1.0, 0.92, 0.7]];
  for (let c = 0; c < count; c++) {
    const col = fires[(Math.random() * fires.length) | 0];
    // emit downward (-up) with spread
    spawnDust(
      pos.x - up.x * 0.3, pos.y - up.y * 0.3, pos.z - up.z * 0.3,
      -up.x, -up.y, -up.z, 1, col[0], col[1], col[2], 2.6
    );
  }
}

// ---- smoke ----
function spawnSmoke(pos, up, count) {
  count = Math.max(0, Math.round(count * particleScale));
  for (let c = 0; c < count; c++) {
    let slot = -1;
    for (let s = 0; s < C.SMOKE_POOL; s++) {
      const idx = (smokeCursor + s) % C.SMOKE_POOL;
      if (!smoke[idx].active) { slot = idx; break; }
    }
    if (slot < 0) return;
    smokeCursor = (slot + 1) % C.SMOKE_POOL;
    const d = smoke[slot];
    d.x = pos.x - up.x * 0.4; d.y = pos.y - up.y * 0.4; d.z = pos.z - up.z * 0.4;
    d.vx = -up.x * (2 + Math.random() * 2) + (Math.random() - 0.5) * 2.2;
    d.vy = -up.y * (2 + Math.random() * 2) + (Math.random() - 0.5) * 2.2;
    d.vz = -up.z * (2 + Math.random() * 2) + (Math.random() - 0.5) * 2.2;
    d.maxLife = 1.0 + Math.random() * 0.7;
    d.life = d.maxLife;
    d.scale = 0.4 + Math.random() * 0.4;
    d.grow = 2.2;
    const g = 0.32 + Math.random() * 0.18;
    d.r = g; d.g = g; d.b = g + 0.03;
    d.active = true;
  }
}
function updateSmoke(dt) {
  for (let i = 0; i < C.SMOKE_POOL; i++) {
    const d = smoke[i];
    if (!d.active) continue;
    d.life -= dt;
    if (d.life <= 0) {
      d.active = false;
      _m.compose(ZERO, _q.identity(), ZERO);
      smokeMesh.setMatrixAt(i, _m);
      continue;
    }
    d.vx *= 0.94; d.vy *= 0.94; d.vz *= 0.94;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    const age = 1 - d.life / d.maxLife;        // 0 -> 1
    const sc = d.scale * (1 + age * d.grow);
    _q.setFromAxisAngle(UP, d.life * 3);
    _m.compose(_pos.set(d.x, d.y, d.z), _q, _v.set(sc, sc, sc));
    smokeMesh.setMatrixAt(i, _m);
    const fade = (1 - age) * 0.55;
    _col.setRGB(d.r * fade, d.g * fade, d.b * fade);
    smokeMesh.setColorAt(i, _col);
  }
  smokeMesh.instanceMatrix.needsUpdate = true;
  if (smokeMesh.instanceColor) smokeMesh.instanceColor.needsUpdate = true;
}

// ---- events from sim ----
function drainEvents() {
  const ev = state.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.type === "dust") {
      spawnDust(e.x, e.y, e.z, e.nx, e.ny, e.nz, 16, 0.85, 0.7, 0.45, 2.4);
    } else if (e.type === "load") {
      spawnDust(e.x + e.nx * 2, e.y + e.ny * 2, e.z + e.nz * 2, e.nx, e.ny, e.nz, 5, 0.7, 0.85, 1.0, 1.4);
      audio.clunk();
    } else if (e.type === "unload") {
      spawnDust(e.x, e.y, e.z, 0, 1, 0, 8, 0.5, 0.75, 1.0, 1.8);
      smelterFlash = 1;
      audio.chaching();
    } else if (e.type === "eventBanner") {
      ui.showEventBanner(e.kind, e.name, e.desc);
      audio.eventSting(e.kind);
    } else if (e.type === "eventChoice") {
      audio.transmission();
    } else if (e.type === "achievement") {
      ui.showAchievementToast(e.name);
      audio.achievementChime();
      spawnDust(C.SMELTER_INTAKE.x, C.SMELTER_INTAKE.y, C.SMELTER_INTAKE.z, 0, 1, 0, 10, 1.0, 0.88, 0.4, 2.2);
    } else if (e.type === "contract") {
      // celebration: flash + spark burst at the smelter, fanfare + banner
      const big = e.tier === "gold";
      shake = Math.max(shake, big ? 0.3 : 0.16);
      const intake = C.SMELTER_INTAKE;
      const col = e.tier === "gold" ? [1.0, 0.82, 0.29] : e.tier === "silver" ? [0.85, 0.85, 0.9] : [0.8, 0.5, 0.2];
      spawnDust(intake.x, intake.y, intake.z, 0, 1, 0, big ? 26 : 14, col[0], col[1], col[2], 3.0);
      audio.contractComplete(e.tier);
      ui.showContractComplete(e.tier, e.name);
    } else if (e.type === "launch") {
      // screen shake scaled to the payout
      shake = Math.min(C.SHAKE_MAX, 0.14 + (e.payout / 40000) * C.SHAKE_MAX);
      audio.whoosh();
      ui.showLaunchBanner(e.payout);
      // project the pad to screen space for the floating "+$" text
      const pad = launchPads[e.padIndex || 0] || launchPads[0];
      const src = pad ? pad.pos : _v.set(C.LAUNCH_PAD.x, C.LAUNCH_PAD.y, C.LAUNCH_PAD.z);
      _v.copy(src).applyQuaternion(homeBody.quaternion);
      _ndc.copy(_v).project(camera);
      const sx = (_ndc.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-_ndc.y * 0.5 + 0.5) * window.innerHeight;
      ui.showFloatingPayout(sx, sy, e.payout);
    } else if (e.type === "padBuilt") {
      ensureLaunchPad(e.padIndex);
      const pad = launchPads[e.padIndex];
      if (pad) {
        _v.copy(pad.pos).addScaledVector(pad.normal, 0.5);
        spawnDust(_v.x, _v.y, _v.z, pad.normal.x, pad.normal.y, pad.normal.z, 30, 0.9, 0.95, 1.0, 3.0);
        spawnSmoke(_v, pad.normal, 8);
        shake = Math.max(shake, 0.3);
        audio.purchaseChime && audio.purchaseChime();
      }
    } else if (e.type === "alienTech") {
      // big sparkly burst at the drill — rainbow because tech is alien
      const cols = [[1, 0.4, 0.9], [0.4, 1, 0.9], [1, 0.95, 0.45], [0.6, 0.7, 1]];
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        spawnDust(e.x, e.y, e.z, e.nx, e.ny, e.nz, 10, col[0], col[1], col[2], 4.2);
      }
      shake = Math.max(shake, 0.22);
      audio.achievementChime && audio.achievementChime();
      // project the drill to screen space for a "+$jackpot" floater
      _v.set(e.x, e.y, e.z).applyQuaternion(homeBody.quaternion);
      _ndc.copy(_v).project(camera);
      const sx = (_ndc.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-_ndc.y * 0.5 + 0.5) * window.innerHeight;
      ui.showFloatingPayout(sx, sy, e.payout);
    } else if (e.type === "asteroidHit") {
      spawnDust(e.x, e.y, e.z, e.nx, e.ny, e.nz, 6, 0.95, 0.78, 0.45, 2.0);
      audio.clunk && audio.clunk();
    } else if (e.type === "chunkCollected") {
      spawnDust(e.x, e.y, e.z, 0, 1, 0, 5, 1.0, 0.92, 0.45, 1.6);
      audio.chaching && audio.chaching();
      _v.set(e.x, e.y, e.z).applyQuaternion(homeBody.quaternion);
      _ndc.copy(_v).project(camera);
      const sx = (_ndc.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-_ndc.y * 0.5 + 0.5) * window.innerHeight;
      ui.showFloatingPayout(sx, sy, e.value || 0);
    }
  }
  ev.length = 0;
}

// ---- camera focus on first drill ----
const cam = { active: false, t: 0, dur: 2.4, fromPos: new THREE.Vector3(), closePos: new THREE.Vector3(), fromLook: new THREE.Vector3(), toLook: new THREE.Vector3() };
export function focusCamera(localPos) {
  if (cam.active) return;
  _pos.set(localPos.x, localPos.y, localPos.z).applyQuaternion(homeBody.quaternion);
  cam.fromPos.copy(camera.position);
  cam.fromLook.copy(controls.target);
  cam.toLook.copy(_pos);
  _v.subVectors(camera.position, controls.target).normalize();
  cam.closePos.copy(_pos).addScaledVector(_v, 20);
  cam.t = 0; cam.active = true; controls.enabled = false;
}
function updateCamera(dt) {
  if (!cam.active) return;
  cam.t += dt;
  const p = Math.min(cam.t / cam.dur, 1);
  if (p < 0.42) {
    const k = smoothstep(p / 0.42);
    camera.position.lerpVectors(cam.fromPos, cam.closePos, k);
    _pos.lerpVectors(cam.fromLook, cam.toLook, k);
  } else if (p < 0.58) {
    camera.position.copy(cam.closePos); _pos.copy(cam.toLook);
  } else {
    const k = smoothstep((p - 0.58) / 0.42);
    camera.position.lerpVectors(cam.closePos, cam.fromPos, k);
    _pos.lerpVectors(cam.toLook, cam.fromLook, k);
  }
  camera.lookAt(_pos);
  if (p >= 1) {
    cam.active = false;
    controls.target.copy(cam.fromLook);
    camera.position.copy(cam.fromPos);
    controls.enabled = true;
    controls.update();
  }
}

export function render(alpha) {
  const now = performance.now() / 1000;
  let dt = now - renderClock;
  renderClock = now;
  if (dt > 0.1) dt = 0.1;

  const spin = lerp(prev.asteroidSpin, state.asteroidSpin, alpha);
  homeBody.rotation.y = spin;
  starfield.rotation.y = -spin * 0.05;

  drainEvents();
  updateEventVisuals(dt);
  updateWarp(now, dt);
  updateStorm(dt);
  updateLab(now);
  updateDrills(alpha, now, dt);
  updateRovers(alpha, now, dt);
  updateOre(alpha);
  updateCrates();
  updateRocket(alpha, now, dt);
  updateChunks(now);
  updateDust(dt);
  updateSmoke(dt);

  // ambient rover whirr scales with the visible fleet
  audio.setWhirr(Math.min(state.rovers.length / C.ROVER_WHIRR_CAP, 1));

  if (smelterFlash > 0) {
    smelterFlash = Math.max(0, smelterFlash - dt * 3);
    smelter.userData.glow.emissiveIntensity = 1.3 + smelterFlash * 2.5;
  }

  updateCamera(dt);
  if (controls.enabled) controls.update();

  // screen shake (applied after controls; OrbitControls recomputes next frame so it never accumulates)
  if (shake > 0.001) {
    const s = shake * shakeScale;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
    shake *= Math.exp(-dt * 2.6);
  }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// ---- settings hooks ----
export function setParticleScale(v) { particleScale = Math.max(0, v); }
export function setShakeScale(v) { shakeScale = Math.max(0, v); }
export function setQuality(profile) {
  renderer.shadowMap.enabled = profile.shadows;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.pixelRatio));
  if (composer) composer.setPixelRatio(Math.min(window.devicePixelRatio, profile.pixelRatio));
  if (bloomPass) bloomPass.enabled = profile.bloom;
  // force shadow-capable materials to refresh when toggling shadows
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}

export function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);
}

// hover pick for tooltips (raycast against the instanced drill/rover bodies)
const _ray = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
export function pickEntity(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  _mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _ray.setFromCamera(_mouse, camera);
  if (roverBody && roverBody.count > 0) {
    const hit = _ray.intersectObject(roverBody);
    if (hit.length && hit[0].instanceId != null) {
      const r = state.rovers[hit[0].instanceId];
      return r ? `Rover #${hit[0].instanceId + 1} — ${r.state.replace("_", " ")}` : null;
    }
  }
  if (drillBody && drillBody.count > 0) {
    const hit = _ray.intersectObject(drillBody);
    if (hit.length && hit[0].instanceId != null) {
      const id = hit[0].instanceId;
      const cyc = state.stats.drillCycleTime / (state.fx.drillSpeedMult || 1);
      return `Drill #${id + 1} — producing every ${cyc.toFixed(1)}s`;
    }
  }
  return null;
}

export function getContext() { return { renderer, scene, camera, controls, homeBody }; }
