/* ============================================================
   settings.js — device-level settings (persisted separately from
   the game save, since they belong to the machine, not the run).
   ============================================================ */

const KEY = "asteroid-tycoon/settings/v1";

const DEFAULTS = {
  quality: "high",        // low | medium | high | ultra
  fpsVisible: false,
  volMaster: 0.6,
  volSfx: 1.0,
  volMusic: 0.6,
  particleDensity: 1.0,   // 0..2 slider
  shakeIntensity: 1.0,    // 0..2 slider
  autosaveSec: 5,
  onboardingDone: false,
};

export const settings = { ...DEFAULTS };

export const QUALITY = {
  low:    { shadows: false, pixelRatio: 1.0,  particle: 0.4, bloom: false },
  medium: { shadows: true,  pixelRatio: 1.25, particle: 0.7, bloom: true },
  high:   { shadows: true,  pixelRatio: 2.0,  particle: 1.0, bloom: true },
  ultra:  { shadows: true,  pixelRatio: 2.0,  particle: 1.4, bloom: true },
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch (e) { /* ignore */ }
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}
export function reset() { Object.assign(settings, DEFAULTS); save(); }
export function qualityProfile() { return QUALITY[settings.quality] || QUALITY.high; }
