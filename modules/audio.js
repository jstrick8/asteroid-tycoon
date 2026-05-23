/* ============================================================
   audio.js — synthesized Web Audio (no asset files).
   Lazily unlocked on first user gesture. Provides:
     clunk()    — rover loads ore at a drill
     chaching() — rover delivers ore at the smelter
     setWhirr() — ambient fleet hum, scaled by rover count
   All SFX are rate-limited so a busy colony doesn't machine-gun.
   ============================================================ */

let ctx = null;
let master = null, sfxBus = null, musicBus = null;
let whirrGain = null;
let whirrOsc = null;
let whirrFilter = null;
let enabled = true;

// volumes (0..1), settable from the settings panel
let volMaster = 0.6, volSfx = 1.0, volMusic = 0.6;

// rate limiting
let lastClunk = 0;
let lastChaching = 0;
let lastHover = 0;
const SFX_MIN_GAP = 0.05; // seconds between same-type sfx

// ambient music engine
let musicOsc = [], musicGains = [], musicFilter = null, musicTimer = null, musicMood = 0;

export function init() {
  const unlock = () => {
    ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volMaster;
  master.connect(ctx.destination);
  // sub-buses so the settings panel can balance SFX vs music
  sfxBus = ctx.createGain(); sfxBus.gain.value = volSfx; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = volMusic; musicBus.connect(master);

  // persistent ambient whirr chain (silent until setWhirr raises gain)
  whirrOsc = ctx.createOscillator();
  whirrOsc.type = "sawtooth";
  whirrOsc.frequency.value = 55;
  const subOsc = ctx.createOscillator();
  subOsc.type = "sine";
  subOsc.frequency.value = 110;
  whirrFilter = ctx.createBiquadFilter();
  whirrFilter.type = "lowpass";
  whirrFilter.frequency.value = 320;
  whirrFilter.Q.value = 0.7;
  whirrGain = ctx.createGain();
  whirrGain.gain.value = 0;
  whirrOsc.connect(whirrFilter);
  subOsc.connect(whirrFilter);
  whirrFilter.connect(whirrGain);
  whirrGain.connect(sfxBus);
  whirrOsc.start();
  subOsc.start();

  startMusic();
  return ctx;
}

export function getContext() { return ctx; }
export function setEnabled(on) { enabled = on; if (master) master.gain.value = on ? volMaster : 0; }
export function isEnabled() { return enabled; }

export function setMasterVolume(v) { volMaster = v; if (master) master.gain.value = enabled ? v : 0; }
export function setSfxVolume(v) { volSfx = v; if (sfxBus) sfxBus.gain.value = v; }
export function setMusicVolume(v) { volMusic = v; if (musicBus) musicBus.gain.value = v; }

function tone(freq, dur, type, peak, when = 0) {
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(sfxBus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/* low woody thud when a rover loads */
export function clunk() {
  if (!enabled || !ensureContext()) return;
  if (ctx.currentTime - lastClunk < SFX_MIN_GAP) return;
  lastClunk = ctx.currentTime;
  tone(150, 0.12, "triangle", 0.18);
  tone(90, 0.14, "sine", 0.14);
}

/* bright two-note "cha-ching" on delivery */
export function chaching() {
  if (!enabled || !ensureContext()) return;
  if (ctx.currentTime - lastChaching < SFX_MIN_GAP) return;
  lastChaching = ctx.currentTime;
  tone(880, 0.08, "square", 0.09);
  tone(1320, 0.12, "square", 0.08, 0.06);
}

/* ambient fleet hum; intensity in [0,1] */
export function setWhirr(intensity) {
  if (!ctx || !whirrGain) return;
  const target = enabled ? 0.06 * Math.max(0, Math.min(1, intensity)) : 0;
  // smooth, click-free changes
  whirrGain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  if (whirrFilter) {
    whirrFilter.frequency.setTargetAtTime(280 + intensity * 220, ctx.currentTime, 0.3);
  }
}

/* heavy bass WHOOSH for a rocket launch */
export function whoosh() {
  if (!enabled || !ensureContext()) return;
  const t0 = ctx.currentTime;

  // descending sub-bass sweep
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(95, t0);
  osc.frequency.exponentialRampToValueAtTime(32, t0 + 1.0);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.exponentialRampToValueAtTime(0.55, t0 + 0.06);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
  osc.connect(og).connect(master);
  osc.start(t0); osc.stop(t0 + 1.4);

  // filtered noise "rush"
  const dur = 1.3;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1900, t0);
  lp.frequency.exponentialRampToValueAtTime(180, t0 + 1.0);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(0.4, t0 + 0.1);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(lp).connect(ng).connect(master);
  src.start(t0); src.stop(t0 + dur);
}

/* bright ascending chime for an upgrade purchase */
export function purchaseChime() {
  if (!enabled || !ensureContext()) return;
  tone(660, 0.12, "triangle", 0.16, 0.0);
  tone(880, 0.12, "triangle", 0.16, 0.07);
  tone(1320, 0.18, "triangle", 0.14, 0.14);
}

/* contract completion fanfare; bigger/brighter for higher tiers */
export function contractComplete(tier) {
  if (!enabled || !ensureContext()) return;
  const seqs = {
    bronze: [523, 659],
    silver: [523, 659, 784],
    gold: [523, 659, 784, 1047],
  };
  const notes = seqs[tier] || seqs.bronze;
  const peak = tier === "gold" ? 0.18 : 0.14;
  notes.forEach((f, i) => tone(f, 0.22, "triangle", peak, i * 0.09));
}

/* "incoming transmission" chime for a choice event */
export function transmission() {
  if (!enabled || !ensureContext()) return;
  tone(988, 0.10, "sine", 0.12, 0.0);
  tone(988, 0.10, "sine", 0.12, 0.16);
  tone(1319, 0.16, "sine", 0.12, 0.32);
}

/* short sting when a buff/debuff lands (rising = buff, falling = debuff) */
export function eventSting(kind) {
  if (!enabled || !ensureContext()) return;
  if (kind === "buff") { tone(523, 0.1, "triangle", 0.12); tone(784, 0.14, "triangle", 0.12, 0.08); }
  else { tone(440, 0.1, "sawtooth", 0.12); tone(294, 0.18, "sawtooth", 0.12, 0.08); }
}

/* rising synth crescendo for the start of a warp */
export function warpCrescendo() {
  if (!enabled || !ensureContext()) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(120, t0);
  osc.frequency.exponentialRampToValueAtTime(1400, t0 + 1.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 1.0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(400, t0);
  lp.frequency.exponentialRampToValueAtTime(4000, t0 + 1.1);
  osc.connect(lp).connect(g).connect(master);
  osc.start(t0); osc.stop(t0 + 1.5);
}

/* deep boom at the warp flash */
export function warpBoom() {
  if (!enabled || !ensureContext()) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, t0);
  osc.frequency.exponentialRampToValueAtTime(28, t0 + 1.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
  osc.connect(g).connect(master);
  osc.start(t0); osc.stop(t0 + 1.7);
}

/* brief ambient hum when arriving in a new sector */
export function warpHum() {
  if (!enabled || !ensureContext()) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 70;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.5);
  osc.connect(g).connect(master);
  osc.start(t0); osc.stop(t0 + 2.6);
}

/* sparkly achievement-unlock chime */
export function achievementChime() {
  if (!enabled || !ensureContext()) return;
  [784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.16, "sine", 0.12, i * 0.05));
}

/* ---- ambient music: slow evolving minor pad, per-sector mood ---- */
const MOODS = [
  { root: 110, intervals: [0, 3, 7, 10] }, // Inner Belt — A minor 7
  { root: 123, intervals: [0, 3, 10, 14] }, // Ice — airy/open
  { root: 98,  intervals: [0, 3, 6, 10] },  // Heavy Metal — darker, diminished
  { root: 130, intervals: [0, 4, 7, 11] },  // Crystal — maj7 shimmer
  { root: 87,  intervals: [0, 3, 7, 10] },  // Lava — low minor
];
const TRANSPOSE = [-5, -2, 0, 3, 5, 7];

function startMusic() {
  if (musicOsc.length) return;
  musicFilter = ctx.createBiquadFilter();
  musicFilter.type = "lowpass";
  musicFilter.frequency.value = 650;
  musicFilter.Q.value = 0.4;
  musicFilter.connect(musicBus);
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? "triangle" : "sine";
    const g = ctx.createGain();
    g.gain.value = 0.045;
    osc.connect(g).connect(musicFilter);
    osc.start();
    musicOsc.push(osc);
    musicGains.push(g);
  }
  // low asteroid drone (always-on hum)
  const hum = ctx.createOscillator();
  hum.type = "sine";
  hum.frequency.value = 44;
  const hg = ctx.createGain();
  hg.gain.value = 0.06;
  hum.connect(hg).connect(musicBus);
  hum.start();

  scheduleChord();
}

function scheduleChord() {
  if (!ctx || !musicOsc.length) return;
  const mood = MOODS[musicMood] || MOODS[0];
  const tr = TRANSPOSE[(Math.random() * TRANSPOSE.length) | 0];
  const root = mood.root * Math.pow(2, tr / 12);
  for (let i = 0; i < musicOsc.length; i++) {
    const semi = mood.intervals[(i + 1) % mood.intervals.length];
    const f = root * Math.pow(2, semi / 12);
    musicOsc[i].frequency.setTargetAtTime(f, ctx.currentTime, 2.5); // glide
  }
  musicTimer = setTimeout(scheduleChord, 13000 + Math.random() * 5000);
}

export function setMusicSector(id) {
  musicMood = ((id - 1) % MOODS.length + MOODS.length) % MOODS.length;
  if (ctx && musicOsc.length) scheduleChord();
}

/* ---- UI sounds ---- */
export function hoverTick() {
  if (!enabled || !ensureContext()) return;
  if (ctx.currentTime - lastHover < 0.04) return;
  lastHover = ctx.currentTime;
  tone(2200, 0.03, "sine", 0.04);
}
export function clickConfirm() {
  if (!enabled || !ensureContext()) return;
  tone(660, 0.06, "triangle", 0.1);
  tone(990, 0.08, "triangle", 0.09, 0.04);
}

export function blip(freq = 440, dur = 0.08) { if (!enabled || !ensureContext()) return; tone(freq, dur, "square", 0.18); }
