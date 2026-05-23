/* ============================================================
   save.js — localStorage persistence.
   Persists cash, total ore mined, and drill count (positions are
   re-randomized on load). Autosaves on a wall-clock interval.
   ============================================================ */

import { serialize } from "./sim.js";

const KEY = "asteroid-tycoon/save/v1";

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(serialize()));
    return true;
  } catch (e) {
    console.warn("[save] failed:", e);
    return false;
  }
}

/* Returns the parsed save object (or null). Caller applies it. */
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[save] load failed:", e);
    return null;
  }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

/* base64-encoded JSON for clipboard export/import */
export function exportSave() {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(serialize())))); }
  catch (e) { return ""; }
}
export function importSave(b64) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(b64.trim()))));
    if (!data || typeof data !== "object") return false;
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) { console.warn("[save] import failed:", e); return false; }
}

let timer = null;
export function startAutosave(seconds = 5) {
  stopAutosave();
  timer = setInterval(save, seconds * 1000);
}
export function stopAutosave() {
  if (timer) clearInterval(timer);
  timer = null;
}
