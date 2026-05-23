/* ============================================================
   main.js — entry point. Wires modules and runs the master loop
   (fixed-timestep sim + interpolated render).
   ============================================================ */

import * as sim from "./modules/sim.js";
import * as render from "./modules/render.js";
import * as ui from "./modules/ui.js";
import * as save from "./modules/save.js";
import * as audio from "./modules/audio.js";
import { getSector } from "./modules/sectors.js";
import * as settings from "./modules/settings.js";

settings.load();
const canvas = document.getElementById("scene");

render.init(canvas);

/* Build one drill: spend cash (unless silent), place it, spawn its mesh.
   Runs from a UI click or load — never inside the render loop. */
function deployDrill(silent = false) {
  if (!silent) {
    const cost = sim.drillCost();
    if (!sim.canAfford(cost)) return false;
    sim.spend(cost);
  }
  const isFirst = sim.state.drills.length === 0;
  const { pos, nrm } = render.pickPlacement();
  sim.addDrill(pos, nrm, /*deployed=*/ silent); // render reflects drills via instancing
  if (!silent && isFirst) render.focusCamera(pos);
  return true;
}

function deployRover(silent = false) {
  if (!silent) {
    // gate: rovers unlock only after a lifetime-earnings threshold so the
    // early game is hand-built drills + manual mining (intentionally slow).
    // the button itself shows "LOCKED · $50,000 lifetime" so no extra prompt.
    if (!sim.roverUnlocked()) return false;
    const cost = sim.roverCost();
    if (!sim.canAfford(cost)) return false;
    sim.spend(cost);
    sim.state.run.boughtRover = true; // for the "Drills Only" achievement
  }
  sim.addRover(); // render reflects rovers via instancing
  return true;
}

/* Buy a new launchpad — a capital expenditure not tied to research. Each pad
   gets its own rocket and roughly doubles throughput. */
function buyLaunchPad() {
  if (!sim.canBuyPad()) return false;
  return sim.buyPad();
}

/* Resolve a choice event. Decline (incl. pirates "fight") is handled in sim;
   accept branches that need drill placement live here. */
function resolveChoice(accept) {
  const c = sim.state.pendingChoice;
  if (!c) return;
  if (!accept) { sim.declineChoice(); return; }

  sim.state.stat.eventsAccepted += 1;
  if (c.id === "salvageSignal") sim.state.stat.riskyAccepted += 1;

  if (c.id === "wanderingTrader") {
    if (sim.canAfford(c.cost)) {
      sim.spend(c.cost);
      for (let i = 0; i < c.drills; i++) deployDrill(true);
      sim.logEvent(c.name, `bought ${c.drills} drills`);
    } else sim.logEvent(c.name, "declined (insufficient $)");
  } else if (c.id === "salvageSignal") {
    if (Math.random() < 0.7) {
      sim.addCash(c.reward);
      sim.addEarnings(c.reward);
      sim.logEvent(c.name, `salvage won +$${c.reward.toLocaleString()}`);
    } else {
      Object.assign(sim.state.rocket, { phase: "COOLDOWN", timer: 60, cargo: 0, fade: 0 });
      sim.logEvent(c.name, "lost cargo + 60s downtime");
    }
  } else if (c.id === "researchOpportunity") {
    if (sim.state.researchPoints >= c.rpCost) {
      sim.state.researchPoints -= c.rpCost;
      sim.state.nextContractGold = true;
      sim.logEvent(c.name, "next contract guaranteed GOLD");
    } else sim.logEvent(c.name, "declined (insufficient RP)");
  } else if (c.id === "pirates") {
    if (sim.canAfford(c.tribute)) { sim.spend(c.tribute); sim.logEvent(c.name, "paid tribute"); }
    else sim.logEvent(c.name, "declined (insufficient $)");
  }
  sim.clearChoice();
  sim.scheduleNextEvent();
}

/* Prestige jump. Drives the warp animation, then resets the run at the
   flash peak and re-adds starting drills/rovers (placement needs render). */
let warping = false;
function doWarp(targetSector) {
  if (warping || !sim.warpUnlocked()) return;
  warping = true;
  ui.closeWarpModal();
  ui.startWarpFlash();
  render.triggerWarpStreak();
  audio.warpCrescendo();

  setTimeout(() => {
    const earned = sim.warpReset(targetSector);
    const nd = sim.startingDrills(), nr = sim.startingRovers();
    for (let i = 0; i < nd; i++) deployDrill(true);
    for (let i = 0; i < nr; i++) deployRover(true);
    render.applySector(targetSector);
    audio.setMusicSector(targetSector);
    audio.warpBoom();
    window.__warpResult = { name: getSector(targetSector).name, earned };
  }, 650);

  setTimeout(() => {
    ui.endWarpFlash();
    const r = window.__warpResult || { name: "SECTOR", earned: 0 };
    ui.showWarpResult(r.name, r.earned);
    audio.warpHum();
    warping = false;
  }, 1550);
}

function applySettings() {
  const q = settings.qualityProfile();
  render.setQuality(q);
  render.setParticleScale(q.particle * settings.settings.particleDensity);
  render.setShakeScale(settings.settings.shakeIntensity);
  audio.setMasterVolume(settings.settings.volMaster);
  audio.setSfxVolume(settings.settings.volSfx);
  audio.setMusicVolume(settings.settings.volMusic);
  save.startAutosave(settings.settings.autosaveSec);
  const fpsEl = document.getElementById("fps-counter");
  if (fpsEl) fpsEl.classList.toggle("hidden", !settings.settings.fpsVisible);
}

ui.setSplashProgress(0.6);

ui.init({
  onBuildDrill: () => deployDrill(false),
  onBuildRover: () => deployRover(false),
  onBuildPad: () => buyLaunchPad(),
  onChoice: resolveChoice,
  onWarp: doWarp,
  onExport: () => save.exportSave(),
  onImport: (str) => { if (save.importSave(str)) location.reload(); },
  onHardReset: () => {
    if (confirm("Hard reset? This permanently wipes ALL progress.") &&
        confirm("Are you absolutely sure? This cannot be undone.")) {
      save.wipe(); location.reload();
    }
  },
  onApplySettings: applySettings,
});
audio.init();
applySettings();
audio.setMusicSector(sim.state.currentSector);

/* Auto-buy (from Research upgrades). Throttled so a rich player doesn't
   build hundreds in one frame; one purchase per type per ~0.25s. */
let autoTimer = 0;
function autoBuy(frameTime) {
  autoTimer += frameTime;
  if (autoTimer < 0.25) return;
  autoTimer = 0;
  const st = sim.state.stats;
  if (st.autoBuyDrills && sim.canAfford(sim.drillCost())) deployDrill(false);
  if (st.autoBuyRovers && sim.roverUnlocked() && sim.canAfford(sim.roverCost())) {
    // silent so the "first manual rover" achievement flag isn't tripped by auto
    sim.spend(sim.roverCost());
    sim.addRover();
  }
}

// ---- load saved progress ----
const saved = save.load();
const { drillCount, roverCount } = sim.applySave(saved);
for (let i = 0; i < drillCount; i++) deployDrill(/*silent=*/ true);
for (let i = 0; i < roverCount; i++) deployRover(/*silent=*/ true);
render.applySector(sim.state.currentSector);

// ---- offline progress (gated by the Offline Production research upgrade) ----
const offline = sim.computeOffline(saved && saved.savedAt);
if (offline) {
  ui.showWelcomeBack(offline, () => {
    sim.applyOffline(offline);
    render.rocketStorm(3);
    for (let i = 0; i < 6; i++) setTimeout(() => audio.whoosh(), i * 450);
  });
}

ui.setSplashProgress(1);
ui.hideSplash();

save.startAutosave(5);
window.addEventListener("resize", render.onResize);
window.addEventListener("beforeunload", save.save);

/* ============================================================
   FPS / refresh meter
   ============================================================ */
const fps = {
  el: document.getElementById("fps-counter"),
  now: document.getElementById("fps-now"),
  target: document.getElementById("fps-target"),
  frames: 0, accum: 0, smoothed: 0, minDelta: Infinity, targetHz: 0, visible: true,
};
const COMMON_HZ = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240, 360];
function snapToCommonHz(hz) {
  let best = COMMON_HZ[0], bestErr = Infinity;
  for (const c of COMMON_HZ) { const e = Math.abs(c - hz); if (e < bestErr) { bestErr = e; best = c; } }
  return best;
}
function updateFps(frameTime) {
  if (frameTime > 0 && frameTime < fps.minDelta) {
    fps.minDelta = frameTime;
    fps.targetHz = snapToCommonHz(1 / fps.minDelta);
  }
  fps.frames += 1;
  fps.accum += frameTime;
  if (fps.accum >= 0.5) {
    fps.smoothed = fps.frames / fps.accum;
    fps.frames = 0; fps.accum = 0;
    if (fps.now) fps.now.textContent = Math.round(fps.smoothed);
    if (fps.target) fps.target.textContent = fps.targetHz || "--";
  }
}
window.addEventListener("keydown", (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "f" || e.key === "F") {
    fps.visible = !fps.visible;
    fps.el.classList.toggle("hidden", !fps.visible);
  } else if (e.key === "b" || e.key === "B") {
    deployDrill(false);
  } else if (e.key === "r" || e.key === "R") {
    deployRover(false);
  } else if (e.key === "Tab") {
    e.preventDefault();
    ui.cycleTab();
  } else if (e.key === "Escape") {
    ui.closeAllModals();
  }
});

/* ============================================================
   Click-to-mine: tap the asteroid to chip ore, tap chunks to collect.
   Distinguishes a tap from a drag (OrbitControls handles drag) by tracking
   pointer travel between down and up events. Canvas-only so HTML UI clicks
   pass through normally.
   ============================================================ */
let clickDown = { x: 0, y: 0, t: 0 };
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  clickDown = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener("pointerup", (e) => {
  if (e.button !== 0) return;
  const dx = e.clientX - clickDown.x;
  const dy = e.clientY - clickDown.y;
  const dt = performance.now() - clickDown.t;
  if (Math.hypot(dx, dy) > 8 || dt > 400) return; // it was a drag, ignore
  // chunk first (small target, satisfying to collect)
  const cid = render.pickChunkAt(e.clientX, e.clientY);
  if (cid != null) { sim.collectChunk(cid); return; }
  // otherwise hit the asteroid surface
  const hit = render.pickAsteroidClickPoint(e.clientX, e.clientY);
  if (hit) sim.clickAsteroid(hit.pos, hit.nrm);
});

// ---- hover tooltips (raycast, throttled) ----
const tooltipEl = document.getElementById("entity-tooltip");
let tipAccum = 0, tipX = 0, tipY = 0;
window.addEventListener("pointermove", (e) => {
  tipX = e.clientX; tipY = e.clientY;
  const now = performance.now();
  if (now - tipAccum < 80) return;
  tipAccum = now;
  const info = render.pickEntity(e.clientX, e.clientY);
  if (info) {
    tooltipEl.textContent = info;
    tooltipEl.style.display = "block";
    tooltipEl.style.left = (tipX + 14) + "px";
    tooltipEl.style.top = (tipY + 14) + "px";
  } else {
    tooltipEl.style.display = "none";
  }
});

/* ============================================================
   Master loop — accumulator-based fixed timestep.
   ============================================================ */
let lastTime = performance.now() / 1000;
let accumulator = 0;
let lastRenderClock = 0;
const MAX_FRAME = 1.0;            // allow sim catch-up when frames are sparse (hidden tab)
const MAX_STEPS = 90;            // ...but cap steps/frame to avoid a spiral of death

function frame(nowMs) {
  const now = nowMs / 1000;
  let frameTime = now - lastTime;
  lastTime = now;

  updateFps(frameTime);

  if (frameTime > MAX_FRAME) frameTime = MAX_FRAME;
  accumulator += frameTime;

  let steps = 0;
  while (accumulator >= sim.FIXED_DT && steps < MAX_STEPS) {
    sim.step(sim.FIXED_DT);
    accumulator -= sim.FIXED_DT;
    steps++;
  }
  if (steps >= MAX_STEPS) accumulator = 0; // drop backlog we couldn't process

  autoBuy(frameTime);

  // throttle render + UI to ~4Hz when the tab is hidden; sim still runs above
  if (!document.hidden || now - lastRenderClock >= 0.25) {
    lastRenderClock = now;
    const alpha = accumulator / sim.FIXED_DT;
    render.render(alpha);
    ui.update();
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame((t) => {
  lastTime = t / 1000;
  requestAnimationFrame(frame);
});

// expose for console debugging / verification
window.AT = { sim, render, ui, save, audio, deployDrill, deployRover, resolveChoice, doWarp };
