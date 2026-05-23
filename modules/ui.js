/* ============================================================
   ui.js — DOM overlay. Reads sim state; writes only on change.
   Owns: cash counter, buy bar, launch HUD, and the upgrade panel
   (per-category lists + confirmation modal + purchase flash).
   ============================================================ */

import {
  state, drillCost, roverCost, batchCrates, contractTarget,
  upgradeLevel, upgradeCost, upgradeUnlocked, upgradeMaxed, canBuyUpgrade,
  buyUpgrade, researchUnlocked,
  acceptContract, manualRefreshContracts,
  warpUnlocked, computeWarpCores, warpUpgradeCost, warpUpgradeMaxed,
  canBuyWarpUpgrade, buyWarpUpgrade, warpLevel, achievementMult,
} from "./sim.js";
import * as C from "./config.js";
import { UPGRADES, CATEGORIES } from "./upgrades.js";
import { WARP_UPGRADES, WARP_ORDER } from "./warp.js";
import { getSector } from "./sectors.js";
import { ACHIEVEMENTS, fmtBig } from "./achievements.js";
import { settings, save as saveSettings, reset as resetSettings, QUALITY } from "./settings.js";
import * as audio from "./audio.js";

const els = {};
let activeTab = "mining";
let cb = {};

let displayedCash = 0;
let lastCashText = null;
let lastDrillCost = -1, lastRoverCost = -1;
let lastDrillAfford = null, lastRoverAfford = null;
let lastBgText = null, lastLaunchStatus = null, lastLaunching = null;
let bannerTimer = null;
let lastClock = performance.now() / 1000;

// upgrade row element refs for the active category
let rowRefs = {};       // id -> { row, lvl, cost }
let modalId = null;

// contracts
let lastRP = -1, lastRep = -1, lastPC = -1;
let cardRefs = {};      // contractId -> refs
let activeSig = "";     // signature of the active set, to know when to rebuild cards
let contractsModalOpen = false;
let contractAccum = 0;  // throttle contract-card refresh to ~10Hz
let contractBannerTimer = null;

// events
let eventBannerTimer = null;
let vignetteTimer = null;
let choiceOpen = false;
let lastEffectSig = "";
let eventAccum = 0;

// warp
let selectedSector = 1;
let lastWarpBtnShown = null;
let titleAccum = 0;

// onboarding
let onboardShown = 0;
let onboardAck = 0;

function fmt(n) { return "$" + Math.floor(n).toLocaleString("en-US"); }

function makeButton(id, title) {
  const btn = document.createElement("button");
  btn.id = id;
  btn.className = "build-btn";
  btn.innerHTML =
    `<span class="build-title">${title}</span>` +
    `<span class="build-cost"></span>` +
    `<span class="build-badge" hidden></span>`;
  return btn;
}

export function init(callbacks = {}) {
  cb = callbacks;
  els.cash = document.getElementById("cash-value");
  els.tabs = Array.from(document.querySelectorAll(".tab"));
  els.buyBar = document.getElementById("buy-bar");
  els.launchHud = document.getElementById("launch-hud");
  els.launchFill = document.getElementById("launch-fill");
  els.launchStatus = document.getElementById("launch-status");
  els.banner = document.getElementById("launch-banner");
  els.bannerText = document.getElementById("launch-banner-text");
  els.floatLayer = document.getElementById("float-layer");

  // upgrade panel
  els.catTitle = document.getElementById("upgrade-cat-title");
  els.upgList = document.getElementById("upgrade-list");
  els.upgLock = document.getElementById("upgrade-lock");

  // modal
  els.modal = document.getElementById("upgrade-modal");
  els.modalTitle = document.getElementById("modal-title");
  els.modalDesc = document.getElementById("modal-desc");
  els.modalLevel = document.getElementById("modal-level");
  els.modalCost = document.getElementById("modal-cost");
  els.flash = document.getElementById("flash");
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-confirm").addEventListener("click", confirmModal);

  els.tabs.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // currencies + contracts
  els.rp = document.getElementById("rp-value");
  els.rep = document.getElementById("rep-value");
  els.pc = document.getElementById("pc-value");
  els.contractsBtn = document.getElementById("contracts-btn");
  els.contractsActive = document.getElementById("contracts-active");
  els.cModal = document.getElementById("contracts-modal");
  els.cmList = document.getElementById("cm-list");
  els.cmCurrency = document.getElementById("cm-currency");
  els.cBanner = document.getElementById("contract-banner");
  els.cBannerText = document.getElementById("contract-banner-text");
  els.contractsBtn.addEventListener("click", openContractsModal);
  document.getElementById("cm-close").addEventListener("click", closeContractsModal);
  document.getElementById("cm-refresh").addEventListener("click", () => {
    if (manualRefreshContracts()) buildContractsList();
  });

  // events: badges, banner, choice modal, log
  els.effectBadges = document.getElementById("effect-badges");
  els.eventBanner = document.getElementById("event-banner");
  els.eventBannerText = document.getElementById("event-banner-text");
  els.vignette = document.getElementById("vignette");
  els.choiceModal = document.getElementById("choice-modal");
  els.choiceTitle = document.getElementById("choice-title");
  els.choiceDesc = document.getElementById("choice-desc");
  els.choiceTimer = document.getElementById("choice-timer");
  els.choiceAccept = document.getElementById("choice-accept");
  els.choiceDecline = document.getElementById("choice-decline");
  els.choiceAccept.addEventListener("click", () => cb.onChoice && cb.onChoice(true));
  els.choiceDecline.addEventListener("click", () => cb.onChoice && cb.onChoice(false));
  els.statsBtn = document.getElementById("stats-btn");
  els.statsModal = document.getElementById("stats-modal");
  els.logList = document.getElementById("event-log-list");
  els.statsBtn.addEventListener("click", openStatsModal);
  document.getElementById("stats-close").addEventListener("click", () => { els.statsModal.hidden = true; });

  // warp
  els.warpBtn = document.getElementById("warp-btn");
  els.warpModal = document.getElementById("warp-modal");
  els.warpCoresLabel = document.getElementById("warp-cores-label");
  els.warpTree = document.getElementById("warp-tree");
  els.sectorSelect = document.getElementById("sector-select");
  els.warpYield = document.getElementById("warp-yield");
  els.warpNow = document.getElementById("warp-now");
  els.warpFlash = document.getElementById("warp-flash");
  els.warpResult = document.getElementById("warp-result");
  els.warpResultTitle = document.getElementById("warp-result-title");
  els.warpResultSub = document.getElementById("warp-result-sub");
  els.warpBtn.addEventListener("click", openWarpModal);
  document.getElementById("warp-close").addEventListener("click", () => { els.warpModal.hidden = true; });
  els.warpNow.addEventListener("click", () => { if (cb.onWarp) cb.onWarp(selectedSector); });
  document.getElementById("warp-result-close").addEventListener("click", () => { els.warpResult.hidden = true; });

  // achievements
  els.achBtn = document.getElementById("ach-btn");
  els.achModal = document.getElementById("ach-modal");
  els.achGrid = document.getElementById("ach-grid");
  els.achSummary = document.getElementById("ach-summary");
  els.achToast = document.getElementById("ach-toast");
  els.achToastText = document.getElementById("ach-toast-text");
  els.achBtn.addEventListener("click", openAchModal);
  document.getElementById("ach-close").addEventListener("click", () => { els.achModal.hidden = true; });

  // stats body + save management
  els.statsBody = document.getElementById("stats-body");
  els.saveText = document.getElementById("save-text");
  document.getElementById("save-export").addEventListener("click", () => { if (cb.onExport) els.saveText.value = cb.onExport(); });
  document.getElementById("save-import").addEventListener("click", () => { if (cb.onImport) cb.onImport(els.saveText.value.trim()); });
  document.getElementById("save-reset").addEventListener("click", () => { if (cb.onHardReset) cb.onHardReset(); });

  // welcome back
  els.welcomeModal = document.getElementById("welcome-modal");
  els.welcomeBody = document.getElementById("welcome-body");
  els.welcomeCollect = document.getElementById("welcome-collect");

  // splash
  els.splash = document.getElementById("splash");
  els.splashFill = document.getElementById("splash-fill");

  // settings
  els.settingsModal = document.getElementById("settings-modal");
  els.settingsBody = document.getElementById("settings-body");
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("settings-close").addEventListener("click", () => { els.settingsModal.hidden = true; });
  document.getElementById("settings-reset").addEventListener("click", () => { resetSettings(); applyAndRefresh(); buildSettings(); });

  // onboarding
  els.onboard = document.getElementById("onboard");
  els.onboardText = document.getElementById("onboard-text");
  document.getElementById("onboard-dismiss").addEventListener("click", dismissOnboard);

  // subtle hover tick on any button
  document.addEventListener("pointerover", (e) => {
    if (e.target.closest && e.target.closest("button")) audio.hoverTick();
  });

  // buy bar buttons
  els.buyBar.innerHTML = "";
  const drillBtn = makeButton("build-drill-btn", "BUILD DRILL");
  drillBtn.addEventListener("click", () => cb.onBuildDrill && cb.onBuildDrill());
  els.buyBar.appendChild(drillBtn);
  const roverBtn = makeButton("build-rover-btn", "BUILD ROVER");
  roverBtn.addEventListener("click", () => cb.onBuildRover && cb.onBuildRover());
  els.buyBar.appendChild(roverBtn);
  els.drillBtn = drillBtn; els.drillCost = drillBtn.querySelector(".build-cost");
  els.roverBtn = roverBtn; els.roverCost = roverBtn.querySelector(".build-cost");
  els.roverBadge = roverBtn.querySelector(".build-badge");

  displayedCash = state.cash;
  buildRows(activeTab);
}

function setTab(tab) {
  activeTab = tab;
  els.tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  els.catTitle.textContent = tab.toUpperCase();
  buildRows(tab);
}
export function getActiveTab() { return activeTab; }

function buildRows(cat) {
  els.upgList.innerHTML = "";
  rowRefs = {};
  for (const id of CATEGORIES[cat]) {
    const def = UPGRADES[id];
    const row = document.createElement("button");
    row.className = "upg-row";
    row.innerHTML =
      `<div class="upg-head"><span class="upg-name">${def.name}</span><span class="upg-lvl"></span></div>` +
      `<div class="upg-desc">${def.desc}</div>` +
      `<div class="upg-cost"></div>`;
    row.addEventListener("click", () => openModal(id));
    els.upgList.appendChild(row);
    rowRefs[id] = { row, lvl: row.querySelector(".upg-lvl"), cost: row.querySelector(".upg-cost") };
  }
}

function updateUpgradeRows() {
  // research category is gated behind lifetime earnings
  if (activeTab === "research") {
    const unlocked = researchUnlocked();
    els.upgLock.hidden = unlocked;
    els.upgList.style.display = unlocked ? "" : "none";
    if (!unlocked) return;
  } else {
    els.upgLock.hidden = true;
    els.upgList.style.display = "";
  }

  for (const id in rowRefs) {
    const def = UPGRADES[id];
    const ref = rowRefs[id];
    const level = upgradeLevel(id);
    const maxed = upgradeMaxed(id);
    const unlocked = upgradeUnlocked(id);
    const affordable = canBuyUpgrade(id);

    const lvlText = maxed ? "MAX" : `Lv ${level}`;
    if (ref.lvl.textContent !== lvlText) ref.lvl.textContent = lvlText;

    let costText;
    if (maxed) costText = "MAXED";
    else if (!unlocked) costText = `LOCKED · ${fmt(def.unlock)} lifetime`;
    else costText = fmt(upgradeCost(id));
    if (ref.cost.textContent !== costText) ref.cost.textContent = costText;

    const cl = ref.row.classList;
    cl.toggle("maxed", maxed);
    cl.toggle("locked", !maxed && !unlocked);
    cl.toggle("affordable", affordable);
    cl.toggle("pulse", affordable);
    cl.toggle("unaffordable", !maxed && unlocked && !affordable);
  }
}

function openModal(id) {
  if (upgradeMaxed(id) || !upgradeUnlocked(id)) return;
  modalId = id;
  const def = UPGRADES[id];
  const level = upgradeLevel(id);
  els.modalTitle.textContent = def.name;
  els.modalDesc.textContent = def.desc;
  els.modalLevel.textContent = `Level ${level} → ${level + 1}`;
  els.modalCost.textContent = fmt(upgradeCost(id));
  els.modal.hidden = false;
}
function closeModal() { els.modal.hidden = true; modalId = null; }
function confirmModal() {
  if (modalId && buyUpgrade(modalId)) {
    audio.purchaseChime();
    fireFlash();
  }
  closeModal();
}
function fireFlash() {
  els.flash.classList.remove("fire");
  void els.flash.offsetWidth; // restart animation
  els.flash.classList.add("fire");
}

export function update() {
  const now = performance.now() / 1000;
  let dt = now - lastClock; lastClock = now;
  if (dt > 0.1) dt = 0.1;

  // eased cash — faster for big jumps (rocket payouts)
  const delta = Math.abs(state.cash - displayedCash);
  const rate = 12 + Math.min(delta / 60, 40);
  displayedCash += (state.cash - displayedCash) * (1 - Math.exp(-rate * dt));
  if (delta < 0.5) displayedCash = state.cash;
  const cashText = fmt(displayedCash);
  if (cashText !== lastCashText) { lastCashText = cashText; if (els.cash) els.cash.textContent = cashText; }

  const dc = drillCost();
  if (dc !== lastDrillCost) { lastDrillCost = dc; els.drillCost.textContent = fmt(dc); }
  const rc = roverCost();
  if (rc !== lastRoverCost) { lastRoverCost = rc; els.roverCost.textContent = fmt(rc); }
  const da = state.cash >= dc;
  if (da !== lastDrillAfford) { lastDrillAfford = da; els.drillBtn.classList.toggle("disabled", !da); }
  const ra = state.cash >= rc;
  if (ra !== lastRoverAfford) { lastRoverAfford = ra; els.roverBtn.classList.toggle("disabled", !ra); }

  const bgText = state.bgRovers > 0 ? `+${state.bgRovers} FLEET` : "";
  if (bgText !== lastBgText) {
    lastBgText = bgText;
    if (bgText) { els.roverBadge.textContent = bgText; els.roverBadge.hidden = false; }
    else els.roverBadge.hidden = true;
  }

  updateLaunchHud();
  updateUpgradeRows();
  updateContracts(dt);
  updateEvents(dt);
  updateWarpButton();
  updateOnboarding();

  titleAccum += dt;
  if (titleAccum >= 1) { titleAccum = 0; document.title = `⛏️ $${fmtBig(state.cash)} — Asteroid Tycoon`; }
}

function updateLaunchHud() {
  const rk = state.rocket;
  const batch = batchCrates();
  const launching = rk.phase !== "IDLE";
  if (launching !== lastLaunching) {
    lastLaunching = launching;
    els.launchHud.classList.toggle("launching", launching);
  }
  let pct, status;
  if (rk.phase === "IDLE") {
    const crates = Math.floor(state.refinedStock);
    pct = Math.min(100, (crates / batch) * 100);
    status = `${Math.min(crates, batch)} / ${batch} CRATES`;
  } else if (rk.phase === "LOADING") { pct = 100; status = "LOADING CARGO…"; }
  else if (rk.phase === "COUNTDOWN") { pct = 100; status = `LAUNCH IN ${Math.max(1, Math.ceil(rk.timer))}…`; }
  else if (rk.phase === "ASCENT") { pct = 100; status = "LIFTOFF!"; }
  else { pct = 0; status = "PREPARING ROCKET…"; }
  if (status !== lastLaunchStatus) { lastLaunchStatus = status; els.launchStatus.textContent = status; }
  if (!launching) els.launchFill.style.width = pct + "%";
}

// ---- contracts modal ----
function openContractsModal() { contractsModalOpen = true; els.cModal.hidden = false; buildContractsList(); }
function closeContractsModal() { contractsModalOpen = false; els.cModal.hidden = true; }

function buildContractsList() {
  els.cmCurrency.textContent = `${state.researchPoints} RP · ${state.reputation} REP`;
  const list = state.contracts.available;
  els.cmList.innerHTML = "";
  if (!list || list.length === 0) {
    els.cmList.innerHTML = `<div class="cm-empty">No contracts available — refresh or wait.</div>`;
    return;
  }
  const full = state.contracts.active.length >= C.MAX_ACTIVE_CONTRACTS;
  for (const c of list) {
    const r = c.reward;
    const row = document.createElement("div");
    row.className = "cm-row" + (c.type === "combo" ? " combo" : "");
    row.innerHTML =
      `<div class="cm-row-head"><span class="cm-name">${c.name}</span><span class="cm-desc">${c.minutes} min</span></div>` +
      `<div class="cm-desc">${c.desc}</div>` +
      `<div class="cm-rewards">` +
        `Bronze (50%): <b>${fmt(r.bronzeCash)}</b> &nbsp;·&nbsp; ` +
        `Silver (100%): <b>${fmt(r.silverCash)}</b> +${r.silverRP} RP &nbsp;·&nbsp; ` +
        `Gold (150%): <b>${fmt(r.goldCash)}</b> +${r.goldRP} RP +${r.goldRep} REP` +
      `</div>`;
    const btn = document.createElement("button");
    btn.className = "cm-accept";
    btn.textContent = full ? "MAX ACTIVE (3)" : "ACCEPT";
    btn.disabled = full;
    btn.addEventListener("click", () => { if (acceptContract(c.id)) buildContractsList(); });
    row.appendChild(btn);
    els.cmList.appendChild(row);
  }
}

function mmss(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function updateContracts(dt) {
  // currencies (diffed)
  if (state.researchPoints !== lastRP) { lastRP = state.researchPoints; els.rp.textContent = lastRP; }
  if (state.reputation !== lastRep) { lastRep = state.reputation; els.rep.textContent = lastRep; }
  if (state.prophecyCores !== lastPC) { lastPC = state.prophecyCores; els.pc.textContent = lastPC; }

  // active cards — throttle to ~10Hz
  contractAccum += dt;
  if (contractAccum < 0.1) return;
  contractAccum = 0;

  const active = state.contracts.active;
  const sig = active.map((c) => c.id).join(",");
  if (sig !== activeSig) { activeSig = sig; rebuildContractCards(active); }

  for (const c of active) {
    const ref = cardRefs[c.id];
    if (!ref) continue;
    const remaining = c.deadline - state.time;
    ref.time.textContent = mmss(remaining);
    ref.time.classList.toggle("urgent", remaining < 30);
    const tgt = contractTarget(c);
    const fill = Math.min(1, c.progress / (tgt * 1.5)) * 100;
    ref.fill.style.width = fill + "%";
    ref.prog.textContent = `${Math.floor(c.progress).toLocaleString()} / ${Math.round(tgt).toLocaleString()}`;
    ref.pipB.classList.toggle("on", c.tiersGranted >= 1);
    ref.pipS.classList.toggle("on", c.tiersGranted >= 2);
    ref.pipG.classList.toggle("on", c.tiersGranted >= 3);
  }

  if (contractsModalOpen) {
    els.cmCurrency.textContent = `${state.researchPoints} RP · ${state.reputation} REP`;
  }
}

function rebuildContractCards(active) {
  els.contractsActive.innerHTML = "";
  cardRefs = {};
  for (const c of active) {
    const card = document.createElement("div");
    card.className = "contract-card panel";
    card.innerHTML =
      `<div class="cc-top"><span class="cc-name">${c.name}</span><span class="cc-time"></span></div>` +
      `<div class="cc-bar"><div class="cc-fill"></div></div>` +
      `<div class="cc-foot"><span class="cc-prog"></span>` +
      `<span class="cc-pips"><span class="cc-pip b"></span><span class="cc-pip s"></span><span class="cc-pip g"></span></span></div>`;
    els.contractsActive.appendChild(card);
    cardRefs[c.id] = {
      time: card.querySelector(".cc-time"),
      fill: card.querySelector(".cc-fill"),
      prog: card.querySelector(".cc-prog"),
      pipB: card.querySelector(".cc-pip.b"),
      pipS: card.querySelector(".cc-pip.s"),
      pipG: card.querySelector(".cc-pip.g"),
    };
  }
}

// ---- warp UI ----
function fmtCores(n) { return Math.floor(n).toLocaleString("en-US"); }

function openWarpModal() {
  selectedSector = state.currentSector;
  els.warpModal.hidden = false;
  buildWarpTree();
  buildSectorSelect();
  updateWarpModal();
}

function buildWarpTree() {
  els.warpTree.innerHTML = "";
  for (const id of WARP_ORDER) {
    const def = WARP_UPGRADES[id];
    const row = document.createElement("button");
    row.className = "warp-row";
    row.dataset.id = id;
    row.innerHTML =
      `<div class="warp-row-head"><span class="warp-name">${def.name}</span><span class="warp-lvl"></span></div>` +
      `<div class="warp-desc">${def.desc}</div>` +
      `<div class="warp-cost"></div>`;
    row.addEventListener("click", () => {
      if (buyWarpUpgrade(id)) { audio.purchaseChime(); updateWarpModal(); }
    });
    els.warpTree.appendChild(row);
  }
}

function buildSectorSelect() {
  els.sectorSelect.innerHTML = "";
  for (const id of state.unlockedSectors.slice().sort((a, b) => a - b)) {
    const s = getSector(id);
    const tile = document.createElement("div");
    tile.className = "sector-tile" + (id === selectedSector ? " selected" : "");
    tile.dataset.id = id;
    const bonusKeys = Object.keys(s.bonuses);
    const bonusText = bonusKeys.length
      ? bonusKeys.map((k) => `${k} ×${s.bonuses[k]}`).join(", ")
      : "balanced";
    tile.innerHTML = `${s.name}<span class="sector-bonus">${bonusText}</span>`;
    tile.addEventListener("click", () => {
      selectedSector = id;
      els.sectorSelect.querySelectorAll(".sector-tile").forEach((t) => t.classList.toggle("selected", +t.dataset.id === id));
    });
    els.sectorSelect.appendChild(tile);
  }
}

function updateWarpModal() {
  const pcMult = Math.pow(1.03, state.prophecyCores);
  const totalIncome = (1 + 0.01 * state.warpCores) * pcMult;
  const pctText = ((totalIncome - 1) * 100).toFixed(totalIncome > 10 ? 0 : 1);
  els.warpCoresLabel.textContent =
    `${fmtCores(state.warpCores)} CORES · ${state.prophecyCores} PC · +${pctText}% income`;
  els.warpYield.textContent = `Warping now earns +${fmtCores(computeWarpCores())} cores`;
  for (const row of els.warpTree.children) {
    const id = row.dataset.id;
    const lvl = warpLevel(id);
    const maxed = warpUpgradeMaxed(id);
    row.querySelector(".warp-lvl").textContent = maxed ? "MAX" : `Lv ${lvl}`;
    const costEl = row.querySelector(".warp-cost");
    costEl.textContent = maxed ? "MAXED" : `${fmtCores(warpUpgradeCost(id))} cores`;
    costEl.classList.toggle("maxed", maxed);
    row.classList.toggle("maxed", maxed);
    row.classList.toggle("affordable", !maxed && canBuyWarpUpgrade(id));
    row.classList.toggle("unaffordable", !maxed && !canBuyWarpUpgrade(id));
  }
}

export function startWarpFlash() { els.warpFlash.classList.add("show"); }
export function endWarpFlash() { els.warpFlash.classList.remove("show"); }
export function closeWarpModal() { els.warpModal.hidden = true; }
export function showWarpResult(sectorName, cores) {
  els.warpResultTitle.textContent = `WARPED TO ${sectorName}`;
  els.warpResultSub.textContent = `+${fmtCores(cores)} WARP CORES EARNED`;
  els.warpResult.hidden = false;
}

function updateWarpButton() {
  const show = warpUnlocked();
  if (show !== lastWarpBtnShown) {
    lastWarpBtnShown = show;
    els.warpBtn.hidden = !show;
  }
  // keep modal live while open
  if (!els.warpModal.hidden) updateWarpModal();
}

// ---- settings panel ----
function applyAndRefresh() {
  // also reflect FPS toggle locally
  const fpsEl = document.getElementById("fps-counter");
  if (fpsEl) fpsEl.classList.toggle("hidden", !settings.fpsVisible);
  if (cb.onApplySettings) cb.onApplySettings();
}

function openSettings() { els.settingsModal.hidden = false; buildSettings(); }

function buildSettings() {
  const pct = (v) => Math.round(v * 100) + "%";
  els.settingsBody.innerHTML = `
    <div class="set-row"><span class="set-label">GRAPHICS QUALITY</span>
      <div class="set-seg" id="set-quality">
        ${["low", "medium", "high", "ultra"].map((q) => `<button data-q="${q}" class="${settings.quality === q ? "on" : ""}">${q.toUpperCase()}</button>`).join("")}
      </div></div>
    <div class="set-row"><span class="set-label">FPS COUNTER</span>
      <div class="set-seg" id="set-fps">
        <button data-fps="1" class="${settings.fpsVisible ? "on" : ""}">ON</button>
        <button data-fps="0" class="${!settings.fpsVisible ? "on" : ""}">OFF</button>
      </div></div>
    <div class="set-row"><span class="set-label">MASTER VOLUME <span class="val">${pct(settings.volMaster)}</span></span><input type="range" id="set-master" min="0" max="1" step="0.05" value="${settings.volMaster}"></div>
    <div class="set-row"><span class="set-label">SFX VOLUME <span class="val">${pct(settings.volSfx)}</span></span><input type="range" id="set-sfx" min="0" max="1" step="0.05" value="${settings.volSfx}"></div>
    <div class="set-row"><span class="set-label">MUSIC VOLUME <span class="val">${pct(settings.volMusic)}</span></span><input type="range" id="set-music" min="0" max="1" step="0.05" value="${settings.volMusic}"></div>
    <div class="set-row"><span class="set-label">PARTICLE DENSITY <span class="val">${pct(settings.particleDensity)}</span></span><input type="range" id="set-particle" min="0" max="2" step="0.1" value="${settings.particleDensity}"></div>
    <div class="set-row"><span class="set-label">SCREEN SHAKE <span class="val">${pct(settings.shakeIntensity)}</span></span><input type="range" id="set-shake" min="0" max="2" step="0.1" value="${settings.shakeIntensity}"></div>
    <div class="set-row"><span class="set-label">AUTOSAVE</span>
      <div class="set-seg" id="set-autosave">
        ${[5, 15, 30, 60].map((s) => `<button data-as="${s}" class="${settings.autosaveSec === s ? "on" : ""}">${s}s</button>`).join("")}
      </div></div>`;

  els.settingsBody.querySelectorAll("#set-quality button").forEach((b) => b.onclick = () => { settings.quality = b.dataset.q; saveSettings(); applyAndRefresh(); buildSettings(); });
  els.settingsBody.querySelectorAll("#set-fps button").forEach((b) => b.onclick = () => { settings.fpsVisible = b.dataset.fps === "1"; saveSettings(); applyAndRefresh(); buildSettings(); });
  els.settingsBody.querySelectorAll("#set-autosave button").forEach((b) => b.onclick = () => { settings.autosaveSec = +b.dataset.as; saveSettings(); applyAndRefresh(); buildSettings(); });
  const slider = (id, key) => {
    const el = els.settingsBody.querySelector(id);
    el.oninput = () => { settings[key] = +el.value; applyAndRefresh(); el.previousElementSibling; };
    el.onchange = () => { saveSettings(); buildSettings(); };
  };
  slider("#set-master", "volMaster"); slider("#set-sfx", "volSfx"); slider("#set-music", "volMusic");
  slider("#set-particle", "particleDensity"); slider("#set-shake", "shakeIntensity");
}

// ---- onboarding (first run only) ----
function dismissOnboard() {
  onboardAck = onboardShown;
  els.onboard.hidden = true;
  if (onboardShown >= 3) { settings.onboardingDone = true; saveSettings(); }
}
const ONBOARD_TEXT = {
  1: "Click 'Build Drill' (bottom bar) to start mining the asteroid.",
  2: "Drills produce ore into a pile. Build a Rover to haul it to the smelter.",
  3: "Cargo Rockets launch automatically when refined crates pile up — that's your big payout. Good luck, Captain.",
};
function updateOnboarding() {
  if (settings.onboardingDone) { if (!els.onboard.hidden) els.onboard.hidden = true; return; }
  const target = state.totalOre > 0 ? 3 : state.drills.length >= 1 ? 2 : 1;
  if (target > onboardAck && onboardShown !== target) {
    onboardShown = target;
    els.onboardText.textContent = ONBOARD_TEXT[target];
    els.onboard.hidden = false;
  }
}

// ---- random events UI ----
export function showEventBanner(kind, name, desc) {
  els.eventBanner.className = kind === "buff" ? "buff show" : "debuff show";
  els.eventBannerText.innerHTML = `${name}<span class="eb-sub">${desc || ""}</span>`;
  if (eventBannerTimer) clearTimeout(eventBannerTimer);
  eventBannerTimer = setTimeout(() => els.eventBanner.classList.remove("show"), 4200);
  if (kind === "debuff") {
    els.vignette.classList.add("show");
    if (vignetteTimer) clearTimeout(vignetteTimer);
    vignetteTimer = setTimeout(() => els.vignette.classList.remove("show"), 1400);
  }
}

function openStatsModal() {
  els.statsModal.hidden = false;
  buildStats();
  const log = state.eventLog;
  els.logList.innerHTML = log.length
    ? log.map((e) => `<div class="log-row"><span class="log-name">${e.name}</span><span class="log-outcome">${e.outcome}</span><span class="log-time">${mmss(e.t)}</span></div>`).join("")
    : `<div class="log-empty">No events yet — they begin after 90 seconds.</div>`;
}

function buildStats() {
  const s = state.stat;
  const wt = s.warpTimes;
  const best = wt.length ? Math.min(...wt) : 0;
  const worst = wt.length ? Math.max(...wt) : 0;
  const avg = wt.length ? Math.round(wt.reduce((a, b) => a + b, 0) / wt.length) : 0;
  const achCount = Object.keys(state.achievements).length;
  const rows = [
    ["Lifetime earnings", "$" + fmtBig(state.lifetimeEarnings)],
    ["This run", "$" + fmtBig(state.runEarnings)],
    ["Ore mined", fmtBig(state.totalOre)],
    ["Refined produced", fmtBig(state.totalRefined)],
    ["Rockets launched", fmtBig(state.totalLaunches)],
    ["Drills built", fmtBig(s.drillsBuilt)],
    ["Max drills at once", s.maxDrills],
    ["Rovers built", fmtBig(s.roversBuilt)],
    ["Max rovers at once", s.maxRovers],
    ["Warps completed", s.warps],
    ["Warp time best/avg/worst", `${mmss(best)} / ${mmss(avg)} / ${mmss(worst)}`],
    ["Sector", getSector(state.currentSector).name],
    ["Warp cores (unspent)", state.warpCores],
    ["Contracts B/S/G", `${s.contractsBronze}/${s.contractsSilver}/${s.contractsGold}`],
    ["Total contracts", state.totalContractsCompleted],
    ["Reputation", state.reputation],
    ["Events triggered", s.eventsTriggered],
    ["Events accepted/declined", `${s.eventsAccepted}/${s.eventsDeclined}`],
    ["Meteor showers survived", s.meteorsSurvived],
    ["Achievements", `${achCount}/${ACHIEVEMENTS.length} (+${achCount}% income)`],
    ["Time played", mmss(s.timePlayedTotal)],
  ];
  els.statsBody.innerHTML = rows.map((r) => `<div class="stat-row"><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`).join("");
}

function openAchModal() {
  els.achModal.hidden = false;
  const count = Object.keys(state.achievements).length;
  els.achSummary.textContent = `${count}/${ACHIEVEMENTS.length} · +${count}% income`;
  els.achGrid.innerHTML = ACHIEVEMENTS.map((a) => {
    const got = !!state.achievements[a.id];
    return `<div class="ach-tile ${got ? "unlocked" : ""}"><span class="ach-name">${got ? a.name : "???"}</span><span class="ach-desc">${a.desc}</span></div>`;
  }).join("");
}

let achToastTimer = null;
export function showAchievementToast(name) {
  els.achToastText.innerHTML = `<span class="at-label">ACHIEVEMENT UNLOCKED</span>${name} · +1% income`;
  els.achToast.classList.add("show");
  if (achToastTimer) clearTimeout(achToastTimer);
  achToastTimer = setTimeout(() => els.achToast.classList.remove("show"), 3200);
}

export function showWelcomeBack(off, onCollect) {
  els.welcomeBody.innerHTML =
    `While you were away (<b>${mmss(off.seconds)}</b>), your operation earned ` +
    `<b>$${fmtBig(off.earnings)}</b> and launched <b>${fmtBig(off.launches)}</b> cargo rockets.`;
  els.welcomeModal.hidden = false;
  els.welcomeCollect.onclick = () => { els.welcomeModal.hidden = true; if (onCollect) onCollect(); };
}

export function hideSplash() {
  if (els.splashFill) els.splashFill.style.width = "100%";
  setTimeout(() => els.splash && els.splash.classList.add("hide"), 320);
}
export function setSplashProgress(p) { if (els.splashFill) els.splashFill.style.width = Math.round(p * 100) + "%"; }

export function cycleTab() {
  const order = ["mining", "fleet", "refining", "research"];
  const i = order.indexOf(activeTab);
  setTab(order[(i + 1) % order.length]);
}
export function closeAllModals() {
  ["upgrade-modal", "contracts-modal", "stats-modal", "ach-modal", "warp-modal", "warp-result", "welcome-modal"].forEach((id) => {
    const e = document.getElementById(id); if (e) e.hidden = true;
  });
}

function updateEvents(dt) {
  // choice modal follows sim.pendingChoice (sim never pauses)
  const pc = state.pendingChoice;
  if (pc && !choiceOpen) {
    choiceOpen = true;
    els.choiceTitle.textContent = pc.name;
    els.choiceDesc.textContent = pc.desc;
    els.choiceAccept.textContent = pc.acceptLabel || "ACCEPT";
    els.choiceDecline.textContent = pc.declineLabel || "DECLINE";
    els.choiceModal.hidden = false;
  } else if (!pc && choiceOpen) {
    choiceOpen = false;
    els.choiceModal.hidden = true;
  }
  if (choiceOpen) {
    els.choiceTimer.textContent = Math.max(0, Math.ceil(state.choiceDeadline - state.time));
  }

  // effect badges — throttle ~10Hz, rebuild only when the set changes
  eventAccum += dt;
  if (eventAccum < 0.1) return;
  eventAccum = 0;
  const eff = state.activeEffects;
  const sig = eff.map((e) => e.id).join(",");
  if (sig !== lastEffectSig) {
    lastEffectSig = sig;
    els.effectBadges.innerHTML = eff
      .map((e) => `<span class="effect-badge ${e.kind}" data-id="${e.id}">${e.name} <span class="eb-rem"></span></span>`)
      .join("");
  }
  // update remaining countdowns
  const badges = els.effectBadges.children;
  for (let i = 0; i < badges.length && i < eff.length; i++) {
    badges[i].querySelector(".eb-rem").textContent = Math.ceil(eff[i].remaining) + "s";
  }
}

export function showContractComplete(tier, name) {
  const colors = { bronze: "#cd7f32", silver: "#d8d8e0", gold: "#ffd24a" };
  els.cBannerText.textContent = `CONTRACT ${tier.toUpperCase()} · ${name}`;
  els.cBanner.style.color = colors[tier] || "var(--amber)";
  els.cBanner.style.textShadow = `0 0 16px ${colors[tier] || "#ffb454"}`;
  els.cBanner.classList.add("show");
  if (contractBannerTimer) clearTimeout(contractBannerTimer);
  contractBannerTimer = setTimeout(() => els.cBanner.classList.remove("show"), 2800);
}

export function showLaunchBanner(payout) {
  els.bannerText.textContent = `CARGO LAUNCH  +${fmt(payout)}`;
  els.banner.classList.add("show");
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => els.banner.classList.remove("show"), 2600);
}

export function showFloatingPayout(x, y, payout) {
  const el = document.createElement("div");
  el.className = "float-payout";
  el.textContent = `+${fmt(payout)}`;
  el.style.left = x + "px";
  el.style.top = y + "px";
  els.floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 1850);
}
