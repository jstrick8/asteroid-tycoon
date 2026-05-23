/* ============================================================
   entities.js — Three.js factories.
   Drills and rovers are rendered as InstancedMeshes (a few draw
   calls total regardless of count) so the colony can scale to
   hundreds of units while holding the monitor's refresh rate.
   ============================================================ */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as C from "./config.js";

// ---------- noise + asteroid + starfield (unchanged behavior) ----------
function lumpyNoise(x, y, z) {
  return (
    Math.sin(x * 1.7 + y * 0.3) * 0.5 +
    Math.cos(y * 1.3 + z * 0.7) * 0.3 +
    Math.sin(z * 1.1 + x * 0.5) * 0.2 +
    Math.sin((x + y + z) * 2.3) * 0.15
  );
}

export function createAsteroid(radius = 8) {
  const geo = new THREE.IcosahedronGeometry(radius, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const colors = [];
  const baseColor = new THREE.Color(0x4a4a52);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = lumpyNoise(v.x * 0.35, v.y * 0.35, v.z * 0.35);
    v.multiplyScalar(1 + n * 0.16);
    pos.setXYZ(i, v.x, v.y, v.z);
    const shade = 0.78 + n * 0.18;
    const c = baseColor.clone().multiplyScalar(shade);
    c.r += n * 0.04; c.b -= n * 0.02;
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.08 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "home-asteroid";
  return mesh;
}

export function createStarfield(count = 3000, shellRadius = 600) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tmp = new THREE.Vector3();
  const palette = [new THREE.Color(0xffffff), new THREE.Color(0xbcd6ff), new THREE.Color(0xfff0c4), new THREE.Color(0xffd0a0)];
  for (let i = 0; i < count; i++) {
    tmp.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (tmp.lengthSq() < 1e-4) tmp.set(0, 0, 1);
    tmp.normalize().multiplyScalar(shellRadius * (0.7 + Math.random() * 0.3));
    positions[i * 3] = tmp.x; positions[i * 3 + 1] = tmp.y; positions[i * 3 + 2] = tmp.z;
    const c = palette[(Math.random() * palette.length) | 0];
    const b = 0.5 + Math.random() * 0.5;
    colors[i * 3] = c.r * b; colors[i * 3 + 1] = c.g * b; colors[i * 3 + 2] = c.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.name = "starfield";
  points.frustumCulled = false;
  return points;
}

export function createSmelter() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 2.6, 12),
    new THREE.MeshStandardMaterial({ color: 0x5b5f6b, metalness: 0.55, roughness: 0.5, flatShading: true }));
  shell.position.y = 1.3; shell.castShadow = true; shell.receiveShadow = true; g.add(shell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.2, 0.7, 12),
    new THREE.MeshStandardMaterial({ color: 0x44474f, metalness: 0.6, roughness: 0.45, flatShading: true }));
  cap.position.y = 2.7; cap.castShadow = true; g.add(cap);
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x2a1a06, emissive: 0xffb454, emissiveIntensity: 1.3, side: THREE.DoubleSide });
  const slit = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 2.42, 0.32, 12, 1, true), glowMat);
  slit.position.y = 1.5; g.add(slit);
  g.userData.glow = glowMat;
  g.position.set(C.SMELTER_POS.x, C.SMELTER_POS.y, C.SMELTER_POS.z);
  g.name = "smelter";
  return g;
}

// surface point sampler (local-space, rotation independent)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _n = new THREE.Vector3();
export function pickSurfacePoint(asteroidMesh) {
  const posAttr = asteroidMesh.geometry.attributes.position;
  const triCount = posAttr.count / 3;
  const i0 = Math.floor(Math.random() * triCount) * 3;
  _a.fromBufferAttribute(posAttr, i0);
  _b.fromBufferAttribute(posAttr, i0 + 1);
  _c.fromBufferAttribute(posAttr, i0 + 2);
  const cx = (_a.x + _b.x + _c.x) / 3, cy = (_a.y + _b.y + _c.y) / 3, cz = (_a.z + _b.z + _c.z) / 3;
  _ab.subVectors(_b, _a); _ac.subVectors(_c, _a);
  _n.crossVectors(_ab, _ac).normalize();
  if (_n.x * cx + _n.y * cy + _n.z * cz < 0) _n.negate();
  return { pos: { x: cx, y: cy, z: cz }, nrm: { x: _n.x, y: _n.y, z: _n.z } };
}

// ---------- shared instanced-mesh helper ----------
function instanced(geo, mat, capacity, { color = false, shadow = false } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (color) {
    mesh.setColorAt(0, new THREE.Color(0xffffff));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.castShadow = shadow;
  mesh.frustumCulled = false;
  mesh.count = capacity;
  return mesh;
}

// ---------- DRILLS (instanced: body / bit / light) ----------
export function createDrillMeshes(capacity = C.DRILL_CAP) {
  // body = base + housing + antenna, baked at their local offsets (+Y up)
  const base = new THREE.CylinderGeometry(0.7, 0.85, 0.5, 6); base.translate(0, 0.25, 0);
  const body = new THREE.CylinderGeometry(0.42, 0.55, 0.8, 6); body.translate(0, 0.9, 0);
  const ant = new THREE.CylinderGeometry(0.04, 0.05, 0.9, 5); ant.translate(0.18, 1.6, 0);
  const bodyGeo = mergeGeometries([base, body, ant], false);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6a6e78, metalness: 0.6, roughness: 0.45, flatShading: true });
  const bodyMesh = instanced(bodyGeo, bodyMat, capacity, { shadow: true });
  bodyMesh.name = "drill-bodies";

  // bit — pentagonal cone, apex baked downward; spins about local Y per instance
  const bitGeo = new THREE.ConeGeometry(0.26, 1.1, 5);
  bitGeo.rotateX(Math.PI);
  bitGeo.translate(0, 0.15, 0);
  const bitMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.7, roughness: 0.35, flatShading: true });
  const bitMesh = instanced(bitGeo, bitMat, capacity, { shadow: true });
  bitMesh.name = "drill-bits";

  // tip light — flat-colored sphere, brightness pulsed via instanceColor
  const lightGeo = new THREE.SphereGeometry(0.13, 10, 8);
  lightGeo.translate(0.18, 2.05, 0);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lightMesh = instanced(lightGeo, lightMat, capacity, { color: true });
  lightMesh.name = "drill-lights";

  return { body: bodyMesh, bit: bitMesh, light: lightMesh };
}

// ---------- ROVERS (instanced: body / wheels / headlight) ----------
export const WHEEL_OFFSETS = [
  [-0.42, 0.18, 0.45], [0.42, 0.18, 0.45],
  [-0.42, 0.18, 0.0],  [0.42, 0.18, 0.0],
  [-0.42, 0.18, -0.45],[0.42, 0.18, -0.45],
];

export function createRoverMeshes(capacity = C.ROVER_VISIBLE_CAP) {
  // body: chassis + cargo bed (floor + rails) + cab + sensor mast. +Z forward.
  const parts = [];
  const chassis = new THREE.BoxGeometry(0.8, 0.18, 1.4); chassis.translate(0, 0.22, 0); parts.push(chassis);
  const bedFloor = new THREE.BoxGeometry(0.62, 0.05, 0.7); bedFloor.translate(0, 0.31, -0.25); parts.push(bedFloor);
  const railL = new THREE.BoxGeometry(0.05, 0.16, 0.7); railL.translate(-0.31, 0.39, -0.25); parts.push(railL);
  const railR = new THREE.BoxGeometry(0.05, 0.16, 0.7); railR.translate(0.31, 0.39, -0.25); parts.push(railR);
  const railB = new THREE.BoxGeometry(0.62, 0.16, 0.05); railB.translate(0, 0.39, -0.58); parts.push(railB);
  const cab = new THREE.BoxGeometry(0.5, 0.24, 0.4); cab.translate(0, 0.4, 0.45); parts.push(cab);
  const mast = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5); mast.translate(0, 0.62, 0.5); parts.push(mast);
  const dish = new THREE.SphereGeometry(0.07, 8, 6); dish.translate(0, 0.88, 0.5); parts.push(dish);
  const bodyGeo = mergeGeometries(parts, false);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a9bb5, metalness: 0.55, roughness: 0.45, flatShading: true });
  const bodyMesh = instanced(bodyGeo, bodyMat, capacity, { shadow: true });
  bodyMesh.name = "rover-bodies";

  // wheels: axis baked to local X so a per-instance Rx() rolls them
  const wheelGeo = new THREE.CylinderGeometry(C.WHEEL_RADIUS, C.WHEEL_RADIUS, 0.12, 8);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, metalness: 0.4, roughness: 0.7 });
  const wheelMesh = instanced(wheelGeo, wheelMat, capacity * 6);
  wheelMesh.name = "rover-wheels";

  // headlight: a fake emissive cone pointing +Z, baked at the front
  const hlGeo = new THREE.ConeGeometry(0.16, 0.55, 10, 1, true);
  hlGeo.rotateX(Math.PI / 2); // apex -> +Z
  hlGeo.translate(0, 0.42, 0.95);
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const hlMesh = instanced(hlGeo, hlMat, capacity);
  hlMesh.name = "rover-headlights";

  return { body: bodyMesh, wheels: wheelMesh, headlight: hlMesh };
}

// ---------- ORE cubes (stockpiles + cargo) ----------
export function createOreInstancedMesh(capacity = C.ORE_POOL) {
  const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const mat = new THREE.MeshStandardMaterial({ color: 0x99c6ff, emissive: 0x6fb4ff, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.4 });
  const mesh = instanced(geo, mat, capacity, { color: true });
  mesh.name = "ore-pool";
  return mesh;
}

// ---------- DUST / sparks / fire (additive) ----------
export function createDustInstancedMesh(capacity = C.DUST_POOL) {
  const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = instanced(geo, mat, capacity, { color: true });
  mesh.name = "dust-pool";
  return mesh;
}

// ---------- SMOKE (alpha-blended grey) ----------
export function createSmokeInstancedMesh(capacity = C.SMOKE_POOL) {
  const geo = new THREE.IcosahedronGeometry(0.3, 0);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false });
  const mesh = instanced(geo, mat, capacity, { color: true });
  mesh.name = "smoke-pool";
  return mesh;
}

// ---------- CHUNK (clickable manual-mining ore — hovering, glowy) ----------
export function createChunkInstancedMesh(capacity = C.CHUNK_POOL) {
  // bigger + glowier than stockpile ore so the player can find them in space
  const geo = new THREE.OctahedronGeometry(0.38, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfff0a0,
    emissive: 0xffae3b,
    emissiveIntensity: 1.6,
    metalness: 0.2,
    roughness: 0.35,
    flatShading: true,
  });
  const mesh = instanced(geo, mat, capacity, { color: true });
  mesh.name = "chunk-pool";
  return mesh;
}

// ---------- DRILL CLICK HITBOX (invisible, generous picking target) ----------
/* The visible drill is small; making the click target as small as the
   visible mesh is frustrating. This hitbox is a transparent sphere ~3x the
   drill radius, rendered at opacity 0 (still raycasts) so the user gets a
   forgiving click area without changing how the drill looks. */
export function createDrillHitboxInstancedMesh(capacity = C.DRILL_CAP) {
  const geo = new THREE.SphereGeometry(1.6, 8, 6);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = instanced(geo, mat, capacity);
  mesh.name = "drill-hitboxes";
  mesh.count = 0;
  mesh.renderOrder = -1;
  return mesh;
}

// ---------- DRILL HALO (upgrade-tier visual aura) ----------
export function createDrillHaloInstancedMesh(capacity = C.DRILL_CAP) {
  // a soft additive sphere that bloom can lift to a real glow
  const geo = new THREE.SphereGeometry(1.05, 14, 10);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = instanced(geo, mat, capacity);
  mesh.name = "drill-halos";
  mesh.count = 0;
  return mesh;
}

// ---------- REFINED CRATES (gold, instanced) ----------
export function createCrateInstancedMesh(capacity = C.CRATE_POOL) {
  const geo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffae3b, emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.45 });
  const mesh = instanced(geo, mat, capacity, { shadow: true });
  mesh.name = "crate-pool";
  return mesh;
}

// ---------- RESEARCH LAB (dome + rotating dish + pulsing lights) ----------
export function createResearchLab() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3d45, metalness: 0.55, roughness: 0.5 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.75, 0.5, 8), dark);
  base.position.y = 0.25; base.castShadow = true; base.receiveShadow = true; g.add(base);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.45, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x7c8696, metalness: 0.45, roughness: 0.4, flatShading: true }));
  dome.position.y = 0.5; dome.castShadow = true; g.add(dome);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.0, 6), dark);
  mast.position.y = 2.0; g.add(mast);

  // rotating dish on a pivot
  const dishPivot = new THREE.Group();
  dishPivot.position.y = 2.5;
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.15, 0.5, 14, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xcdd3df, metalness: 0.4, roughness: 0.45, side: THREE.DoubleSide, flatShading: true }));
  dish.rotation.z = Math.PI / 2.6; // tilt the dish
  dish.position.set(0.35, 0, 0);
  dishPivot.add(dish);
  g.add(dishPivot);
  g.userData.dish = dishPivot;

  // pulsing perimeter lights
  const lights = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const mat = new THREE.MeshBasicMaterial({ color: 0x5cc8ff });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat);
    led.position.set(Math.cos(a) * 1.55, 0.55, Math.sin(a) * 1.55);
    led.userData.phase = i * 1.4;
    g.add(led);
    lights.push(led);
  }
  g.userData.lights = lights;

  g.name = "research-lab";
  return g;
}

// ---------- WARP GATE (appears at $1T lifetime) ----------
export function createWarpGate() {
  const g = new THREE.Group();

  // base plinth
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.6, roughness: 0.5, flatShading: true }));
  base.position.y = 0.25; base.castShadow = true; g.add(base);

  // glowing ring (stands upright)
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x102a3a, emissive: 0x46c8ff, emissiveIntensity: 1.4, metalness: 0.4, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 12, 32), ringMat);
  ring.position.y = 2.0;
  g.add(ring);
  g.userData.ring = ring;
  g.userData.ringMat = ringMat;

  // rotating inner core (counter-spins inside the ring)
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x0a1830, emissive: 0x8a5cff, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.4, flatShading: true });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), coreMat);
  core.position.y = 2.0;
  g.add(core);
  g.userData.core = core;

  // event-horizon disc (additive shimmer)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.42, 32),
    new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  disc.position.y = 2.0;
  g.add(disc);
  g.userData.disc = disc;

  g.name = "warp-gate";
  return g;
}

// ---------- LAUNCH PAD ----------
export function createLaunchPad() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3d45, metalness: 0.6, roughness: 0.5, flatShading: true }));
  disc.position.y = 0.1; disc.receiveShadow = true; g.add(disc);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.28, 0.07, 8, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2a1a06, emissive: 0xffb454, emissiveIntensity: 1.0, side: THREE.DoubleSide }));
  ring.position.y = 0.16; g.add(ring);
  g.name = "launch-pad";
  return g;
}

// ---------- CARGO ROCKET (single, reused; +Y up, base at y=0) ----------
export function createRocket() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xd7dbe4, metalness: 0.5, roughness: 0.4, flatShading: true });
  const accent = new THREE.MeshStandardMaterial({ color: 0xb2452f, metalness: 0.5, roughness: 0.5, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3d45, metalness: 0.6, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 2.0, 14), metal);
  body.position.y = 1.0; body.castShadow = true; g.add(body);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.51, 0.51, 0.25, 14), accent);
  band.position.y = 1.5; g.add(band);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.95, 14), accent);
  nose.position.y = 2.48; nose.castShadow = true; g.add(nose);

  // three fins around the base
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.55), dark);
    fin.position.set(Math.cos(a) * 0.52, 0.42, Math.sin(a) * 0.52);
    fin.rotation.y = -a;
    fin.castShadow = true;
    g.add(fin);
  }

  // nozzle (apex down) + emissive thruster glow
  const nozGeo = new THREE.ConeGeometry(0.36, 0.45, 12); nozGeo.rotateX(Math.PI);
  const nozzle = new THREE.Mesh(nozGeo, dark);
  nozzle.position.y = 0.05; g.add(nozzle);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.0 });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glowMat);
  glow.position.y = -0.1; g.add(glow);
  g.userData.glow = glowMat;

  g.name = "cargo-rocket";
  return g;
}
