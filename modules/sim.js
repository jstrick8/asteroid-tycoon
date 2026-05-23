/* ============================================================
   sim.js — authoritative, deterministic, Three-free.
   Production chain: drills -> stockpile -> rovers -> smelter raw
   buffer -> refined crates -> cargo rocket -> cash. All gameplay
   numbers derive from upgrade levels via recomputeStats().
   ============================================================ */

import * as C from "./config.js";
import { UPGRADES, GROWTH, CATEGORIES } from "./upgrades.js";
import { generateContract } from "./contracts.js";
import { rollKind, makeEvent } from "./events.js";
import { getSector, MAX_SECTOR } from "./sectors.js";
import { WARP_UPGRADES, warpCostFor } from "./warp.js";
import { ACHIEVEMENTS } from "./achievements.js";

export const FIXED_HZ = 60;
export const FIXED_DT = 1 / FIXED_HZ;

/* Make a fresh rocket-state object. One per launchpad. */
function makeRocket(padIndex = 0) {
  return {
    padIndex,
    phase: "IDLE", timer: 0, idleTimer: 0,
    loadT: 0, ascent: 0, ascentPrev: 0,
    cargo: 0, payout: 0, fade: 1,
  };
}

export const state = {
  tick: 0,
  time: 0,
  cash: C.STARTING_CASH,
  totalOre: 0,
  totalRefined: 0,       // cumulative refined material ever produced (for contracts)
  totalLaunches: 0,      // cumulative rockets launched (for contracts)
  lifetimeEarnings: 0,   // total $ ever earned, ALL runs (gates research + warp)
  runEarnings: 0,        // $ earned since the last warp (drives core yield)

  // manual mining (Phase 1 click loop)
  clicksMined: 0,                  // lifetime asteroid clicks
  chunksCollected: 0,              // lifetime chunks tapped
  clickCooldown: 0,                // sim seconds until next valid asteroid click
  chunks: [],                      // [{ id, x, y, z, vx, vy, vz, life, value }]
  _chunkId: 0,

  researchPoints: 0,     // earned from contracts (silver+)
  reputation: 0,         // earned from gold-tier contracts
  totalContractsCompleted: 0,

  // prestige / warp (persist across resets)
  warpCores: 0,          // unspent cores (each gives +1% income, linear)
  warpCoresSpent: 0,
  prophecyCores: 0,      // earned on gold contracts; each gives ×1.03 income (compounds)
  warpUpgrades: {},      // { id: level }
  unlockedSectors: [1],
  currentSector: 1,

  // achievements + lifetime statistics (persist across warp)
  achievements: {},   // { id: true }
  flags: { firstRocketFast: false, noRoverRun: false, warpWatched: false },
  run: { boughtRover: false, startTime: 0 },
  stat: {
    drillsBuilt: 0, roversBuilt: 0, maxDrills: 0, maxRovers: 0,
    warps: 0, warpTimes: [],
    contractsBronze: 0, contractsSilver: 0, contractsGold: 0,
    eventsTriggered: 0, eventsAccepted: 0, eventsDeclined: 0,
    riskyAccepted: 0, meteorsSurvived: 0,
    timePlayedTotal: 0,
    alienTechHits: 0,
    clicksMinedTotal: 0,
  },
  achCheck: 0,        // throttle accumulator

  rawOre: 0,             // delivered ore awaiting refining at the smelter
  refinedStock: 0,       // refined crates ready to launch

  contracts: { active: [], available: [], lastRefresh: 0, initialized: false },

  upgrades: {},          // { upgradeId: level }
  stats: {},             // derived from upgrades (see recomputeStats)

  // launchpads (1 by default, up to MAX_LAUNCH_PADS)
  pads: 1,
  rockets: [makeRocket(0)],

  // legacy single-rocket alias — kept so older saves can hydrate gracefully.
  // updated each frame to mirror rockets[0] for any read sites that still touch
  // state.rocket directly (only render does, and it's been migrated below).
  rocket: { phase: "IDLE", timer: 0, loadT: 0, ascent: 0, ascentPrev: 0, cargo: 0, payout: 0, fade: 1 },

  // random events
  activeEffects: [],   // [{ id, kind, name, remaining, duration, sub, drillIndex }]
  fx: { drillSpeedMult: 1, roverSpeedMult: 1, payoutMult: 1, launchDelayMult: 1, veinDrill: -1, veinMult: 1, flare: 0, meteor: 0 },
  pendingChoice: null,
  choiceDeadline: 0,
  eventLog: [],        // [{ name, outcome, t }] newest first, capped 20
  eventTimer: 110 + Math.random() * 90,
  nextContractGold: false,

  asteroidSpin: 0,
  drills: [],
  rovers: [],
  bgRovers: 0,
  bgCarry: 0,
  events: [],
};

export const prev = { asteroidSpin: 0 };

const TUNING = { asteroidSpinRate: 0.06 };

const HOME_LEN = Math.hypot(C.ROVER_HOME.x, C.ROVER_HOME.y, C.ROVER_HOME.z) || 1;
const HOME = {
  x: (C.ROVER_HOME.x / HOME_LEN) * C.ROVER_HOME.r,
  y: (C.ROVER_HOME.y / HOME_LEN) * C.ROVER_HOME.r,
  z: (C.ROVER_HOME.z / HOME_LEN) * C.ROVER_HOME.r,
};
const HOME_DIR = { x: HOME.x / C.ROVER_HOME.r, y: HOME.y / C.ROVER_HOME.r, z: HOME.z / C.ROVER_HOME.r };

// ---- upgrades ----
export function upgradeLevel(id) { return state.upgrades[id] || 0; }
export function upgradeCost(id) {
  return Math.ceil(UPGRADES[id].base * Math.pow(GROWTH, upgradeLevel(id)));
}
export function upgradeUnlocked(id) {
  return state.lifetimeEarnings >= (UPGRADES[id].unlock || 0);
}
export function upgradeMaxed(id) { return upgradeLevel(id) >= UPGRADES[id].max; }
export function canBuyUpgrade(id) {
  return upgradeUnlocked(id) && !upgradeMaxed(id) && state.cash >= upgradeCost(id);
}
export function buyUpgrade(id) {
  if (!canBuyUpgrade(id)) return false;
  spend(upgradeCost(id));
  state.upgrades[id] = upgradeLevel(id) + 1;
  recomputeStats();
  return true;
}
export function researchUnlocked() { return state.lifetimeEarnings >= C.RESEARCH_UNLOCK; }
export function roverUnlocked() { return state.lifetimeEarnings >= C.ROVER_UNLOCK_LIFETIME; }

// Stockpile / capacity / rocket tiers — the index is the upgrade level
const STOCKPILE_TIERS = [10, 20, 40, 80, 160, 320];
// Tiered capacity per Rover Capacity level — first 7 keep the original
// curve, then extended out 10 more steps for the bumped max level.
const CAPACITY_TIERS  = [1, 3, 5, 8, 12, 20, 30, 45, 65, 90, 120, 160, 210, 275, 350, 450, 600];
const ROCKET_TIERS    = [10, 14, 20, 30, 50, 75, 100, 150, 200];

export function warpLevel(id) { return state.warpUpgrades[id] || 0; }

export function recomputeStats() {
  const L = upgradeLevel;
  const W = warpLevel;
  const s = state.stats;

  // sector bonuses (deltas amplified by Sector Attunement)
  const sector = getSector(state.currentSector);
  const boost = W("sectorBoost") > 0 ? 2 : 1;
  const sb = (m) => (m == null ? 1 : 1 + (m - 1) * boost);
  const b = sector.bonuses;

  // Unspent Warp Cores: +1% income each (linear).
  // Prophecy Cores: ×1.03 each (compounds — small numbers, huge long-term curve).
  // Each achievement: +1% income.
  const coreMult = (1 + 0.01 * state.warpCores)
    * Math.pow(1.03, state.prophecyCores)
    * (1 + 0.01 * Object.keys(state.achievements).length);

  // ---- mining (+10% per level instead of +50% → many more meaningful levels) ----
  s.drillOrePerCycle = Math.pow(1.10, L("drillPower")) * (L("autoSurveyor") > 0 ? 1.1 : 1)
    * sb(b.drillPower) * Math.pow(1.5, W("permDrillPower"));
  s.drillCycleTime = Math.max(0.5, C.PROD_INTERVAL * Math.pow(0.95, L("drillSpeed")) / sb(b.drillSpeed));
  s.stockpileMax = STOCKPILE_TIERS[Math.min(L("stockpile"), STOCKPILE_TIERS.length - 1)];

  // ---- fleet ----
  // Drivetrain stacks on Rover Speed (+8%/level smooth on top of +5%/level tier).
  s.roverSpeed = C.ROVER_SPEED
    * Math.pow(1.05, L("roverSpeed"))
    * Math.pow(1.08, L("drivetrain"))
    * sb(b.roverSpeed)
    * Math.pow(1.3, W("permRoverSpeed"));
  // Cargo Bins is smooth +10%/level on top of the Capacity tier table.
  s.roverCapacity = CAPACITY_TIERS[Math.min(L("roverCapacity"), CAPACITY_TIERS.length - 1)]
    * Math.pow(1.10, L("cargoBins"));
  s.maxVisibleRovers = C.ROVER_VISIBLE_CAP + L("roverPads") * 50;
  // Quick Load shaves load/unload time. Min 0.1s so rovers don't teleport.
  const qlMult = Math.max(0.15, Math.pow(0.92, L("quickLoad"))); // .92^15 ≈ 0.286
  s.loadTimeMult = qlMult;
  // Convoy Logistics boosts background-fleet hauling for big fleets.
  s.bgRoverMult = Math.pow(1.10, L("backgroundBoost"));

  // ---- refining (+10% per level) ----
  s.refineRate = C.BASE_REFINE_RATE * Math.pow(1.10, L("refineSpeed")) * sb(b.refine);
  s.refineEfficiency = L("smelterEff") > 0 ? 1.5 : 1.0;
  s.crateValue = C.BASE_CRATE_VALUE * Math.pow(1.10, L("crateDensity")) * sb(b.payout) * coreMult;
  // Rocket Capacity = stepwise tier (10 -> 200 over 8 levels).
  // Hull Expansion = smooth +15% per level on top, stackable up to 25 levels.
  // The two combine multiplicatively so the curve has a clear "tier jump"
  // every Rocket Capacity buy and steady growth from each Hull Expansion.
  s.batch = ROCKET_TIERS[Math.min(L("rocketCapacity"), ROCKET_TIERS.length - 1)]
    * Math.pow(1.15, L("hullExpansion"))
    * (W("rocketCap") > 0 ? 1.5 : 1);
  s.cadence = Math.pow(1.10, L("rapidLaunch"));

  s.incomeMult = coreMult;                    // applied to contract cash rewards
  s.rpMult = W("doubleRP") > 0 ? 2 : 1;
  s.contractTargetMult = W("fastContracts") > 0 ? 0.75 : 1;

  // auto-buy removed for both drills and rovers — manual placement only.
  s.offline = L("offline") > 0;
  s.telescope = L("telescope") > 0;
}
recomputeStats();

// ---- economy ----
export function drillCost() {
  return Math.ceil(C.BASE_DRILL_COST * Math.pow(C.DRILL_COST_GROWTH, state.drills.length));
}
export function roverCount() { return state.rovers.length + state.bgRovers; }
export function roverCost() {
  return Math.ceil(C.BASE_ROVER_COST * Math.pow(C.ROVER_COST_GROWTH, roverCount()));
}
export function padCost() {
  if (state.pads >= C.MAX_LAUNCH_PADS) return Infinity;
  return Math.ceil(C.BASE_PAD_COST * Math.pow(C.PAD_COST_GROWTH, state.pads - 1));
}
export function canBuyPad() {
  return state.pads < C.MAX_LAUNCH_PADS && state.cash >= padCost();
}
export function buyPad() {
  if (!canBuyPad()) return false;
  spend(padCost());
  state.pads += 1;
  state.rockets.push(makeRocket(state.pads - 1));
  state.events.push({ type: "padBuilt", padIndex: state.pads - 1 });
  return true;
}
export function canAfford(amount) { return state.cash >= amount; }
export function spend(amount) {
  if (!Number.isFinite(amount) || amount < 0) return;
  // any visible state.cash mutation goes through here. defensive clamp at 0
  // (can never go negative even if a caller miscomputes a cost).
  state.cash = Math.max(0, state.cash - amount);
}

/* Clamp helpers — JS Numbers cap at ~1.8e308 (Infinity beyond that), and
   JSON.stringify writes non-finite as `null`, which round-trips to 0 on the
   next load. So every cash-increment goes through addCash and every earnings
   tally through addEarnings — both keep the value finite and precise. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER; // ~9.007e15
export function addCash(n) {
  // recover if cash is somehow already non-finite (corrupted older save etc.)
  if (!Number.isFinite(state.cash)) state.cash = MAX_SAFE;
  // a non-finite input (e.g. crateValue blew up at extreme upgrade levels)
  // saturates the bucket rather than silently dropping the payout.
  if (!Number.isFinite(n)) { state.cash = MAX_SAFE; return; }
  state.cash = Math.min(MAX_SAFE, state.cash + n);
}
export function addEarnings(n) {
  if (!Number.isFinite(state.lifetimeEarnings)) state.lifetimeEarnings = MAX_SAFE;
  if (!Number.isFinite(state.runEarnings)) state.runEarnings = 0;
  if (!Number.isFinite(n)) { state.lifetimeEarnings = MAX_SAFE; state.runEarnings = MAX_SAFE; return; }
  state.lifetimeEarnings = Math.min(MAX_SAFE, state.lifetimeEarnings + n);
  state.runEarnings = Math.min(MAX_SAFE, state.runEarnings + n);
}
export function batchCrates() { return Math.max(1, Math.round(state.stats.batch)); }
export function crateValue() { return state.stats.crateValue; }

// ============================================================
//  MANUAL MINING (click loop before drills)
// ============================================================
/* Player click on the asteroid surface. Spawns a hovering ore chunk with
   outward velocity that the player can then click to collect $. Position is
   local to the asteroid (so it stays "on" the spinning asteroid in render). */
export function clickAsteroid(pos, nrm) {
  if (state.clickCooldown > 0) return false;
  state.clickCooldown = C.CLICK_COOLDOWN;
  state.clicksMined += 1;
  state.stat.clicksMinedTotal += 1;
  // Sometimes a click pops a tiny instant payout (free $1 to kickstart Phase 0)
  // and always spawns one collectable chunk.
  const id = ++state._chunkId;
  const v = C.CLICK_CHUNK_VEL * (0.7 + Math.random() * 0.6);
  state.chunks.push({
    id,
    kind: "asteroid",                    // raw asteroid rubble (gold visual)
    x: pos.x, y: pos.y, z: pos.z,
    vx: nrm.x * v + (Math.random() - 0.5) * 1.6,
    vy: nrm.y * v + (Math.random() - 0.5) * 1.6,
    vz: nrm.z * v + (Math.random() - 0.5) * 1.6,
    life: C.CLICK_CHUNK_LIFE,
    value: C.CLICK_ORE_VALUE,
    nx: nrm.x, ny: nrm.y, nz: nrm.z,
  });
  state.events.push({ type: "asteroidHit", x: pos.x, y: pos.y, z: pos.z, nx: nrm.x, ny: nrm.y, nz: nrm.z });
  return true;
}

/* Player clicks a drill — scoop its stockpile out as flying chunks the
   player can then tap for cash. Bridge mechanic between "first drill" and
   "rovers unlocked": gives you a way to monetize your drill's output before
   the automated hauling chain comes online. Each ore in the pile spawns a
   chunk worth more than the raw asteroid click — you earned this. */
export function harvestDrill(drillIndex) {
  const d = state.drills[drillIndex];
  if (!d) return 0;
  // empty-drill feedback — push a "drill is empty" event so the player knows
  // their click landed (vs silently falling through). still returns 0.
  if (d.deploy < 1 || d.stockpile < 1) {
    state.events.push({ type: "drillEmpty", x: d.x, y: d.y, z: d.z, nx: d.nx, ny: d.ny, nz: d.nz });
    return 0;
  }
  const amount = Math.min(8, Math.floor(d.stockpile)); // cap so a fat pile doesn't fountain too hard
  d.stockpile -= amount;
  // each scooped ore pops out as a clickable chunk. value scales with the
  // current crateValue (post-upgrades) so harvesting stays viable even when
  // the player has lots of drillPower / crateDensity upgrades.
  const baseValue = Math.max(3, Math.round(crateValue() * 0.5));
  for (let i = 0; i < amount; i++) {
    const id = ++state._chunkId;
    const v = C.CLICK_CHUNK_VEL * (0.8 + Math.random() * 0.5);
    state.chunks.push({
      id,
      kind: "drill",                     // refined drill ore (blue visual)
      x: d.x, y: d.y, z: d.z,
      vx: d.nx * v + (Math.random() - 0.5) * 2.4,
      vy: d.ny * v + (Math.random() - 0.5) * 2.4,
      vz: d.nz * v + (Math.random() - 0.5) * 2.4,
      life: C.CLICK_CHUNK_LIFE,
      value: baseValue,
      nx: d.nx, ny: d.ny, nz: d.nz,
    });
  }
  state.events.push({ type: "drillHarvested", x: d.x, y: d.y, z: d.z, nx: d.nx, ny: d.ny, nz: d.nz, amount });
  return amount;
}

/* Player clicks a chunk in the world: collect, pay out, despawn. */
export function collectChunk(id) {
  for (let i = 0; i < state.chunks.length; i++) {
    if (state.chunks[i].id === id) {
      const c = state.chunks[i];
      state.chunks.splice(i, 1);
      addCash(c.value);
      addEarnings(c.value);
      state.chunksCollected += 1;
      state.events.push({ type: "chunkCollected", x: c.x, y: c.y, z: c.z, value: c.value });
      return true;
    }
  }
  return false;
}

function stepChunks(dt) {
  if (state.clickCooldown > 0) state.clickCooldown = Math.max(0, state.clickCooldown - dt);
  const arr = state.chunks;
  const R = C.ASTEROID_RADIUS;
  for (let i = arr.length - 1; i >= 0; i--) {
    const c = arr[i];
    c.life -= dt;
    if (c.life <= 0) { arr.splice(i, 1); continue; }
    // tug back toward asteroid center (spherical "gravity")
    const r = Math.hypot(c.x, c.y, c.z) || 1;
    const gx = -c.x / r * 1.5, gy = -c.y / r * 1.5, gz = -c.z / r * 1.5;
    c.vx += gx * dt; c.vy += gy * dt; c.vz += gz * dt;
    c.vx *= 0.985; c.vy *= 0.985; c.vz *= 0.985; // mild drag → hover-like
    c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
    // soft clamp inside an outer shell so chunks don't fly off-screen
    const r2 = Math.hypot(c.x, c.y, c.z);
    if (r2 > R + 3) {
      const k = (R + 3) / r2;
      c.x *= k; c.y *= k; c.z *= k;
      c.vx *= -0.4; c.vy *= -0.4; c.vz *= -0.4;
    }
    if (r2 < R + 0.4) {
      // bobbing prevention — push back out a touch
      const k = (R + 0.4) / (r2 || 1);
      c.x *= k; c.y *= k; c.z *= k;
    }
  }
}

// ---- builders ----
export function addDrill(pos, nrm, deployed = false) {
  const d = {
    x: pos.x, y: pos.y, z: pos.z,
    nx: nrm.x, ny: nrm.y, nz: nrm.z,
    cooldown: Math.random() * state.stats.drillCycleTime,
    deploy: deployed ? 1 : 0,
    deployPrev: deployed ? 1 : 0,
    dustDone: deployed,
    stockpile: 0,
    inbound: 0,
    disabledUntil: 0,
    cycles: 0,                // total completed cycles (used for pockmark intensity)
  };
  state.drills.push(d);
  state.stat.drillsBuilt += 1;
  return d;
}
export function addRover() {
  if (state.rovers.length >= state.stats.maxVisibleRovers) {
    state.bgRovers += 1;
    return null;
  }
  const r = {
    state: "IDLE", p: 0, pPrev: 0, cargo: 0, loadT: 0, drillIndex: -1,
    fx: 0, fy: 1, fz: 0, fr: C.ROVER_HOME.r,
    tx: 0, ty: 1, tz: 0, tr: C.ROVER_HOME.r,
    angle: 0, arcLen: 0.001,
    homeIndex: state.rovers.length,
    disabledUntil: 0,
  };
  state.rovers.push(r);
  state.stat.roversBuilt += 1;
  return r;
}

function setLeg(r, from, to) {
  const fr = Math.hypot(from.x, from.y, from.z) || 1;
  const tr = Math.hypot(to.x, to.y, to.z) || 1;
  r.fx = from.x / fr; r.fy = from.y / fr; r.fz = from.z / fr; r.fr = fr;
  r.tx = to.x / tr;   r.ty = to.y / tr;   r.tz = to.z / tr;   r.tr = tr;
  let dot = r.fx * r.tx + r.fy * r.ty + r.fz * r.tz;
  dot = dot < -1 ? -1 : dot > 1 ? 1 : dot;
  r.angle = Math.acos(dot);
  const avgR = (fr + tr) / 2 + C.ROVER_HOVER;
  r.arcLen = Math.max(r.angle * avgR, 0.001);
  r.p = 0; r.pPrev = 0;
}

function bestDrillFor() {
  // pick the drill with the most unclaimed ore (location-agnostic so every
  // face of the asteroid stays serviced)
  const drills = state.drills;
  const cap = state.stats.roverCapacity;
  let best = -1, bestAvail = 0;
  for (let i = 0; i < drills.length; i++) {
    const d = drills[i];
    if (d.deploy < 1) continue;
    const avail = d.stockpile - d.inbound * cap;
    if (avail > bestAvail) { bestAvail = avail; best = i; }
  }
  return best;
}

function runBackgroundFleet(dt) {
  if (state.bgRovers <= 0) return;
  const bgMult = state.stats.bgRoverMult || 1;
  state.bgCarry += state.bgRovers * C.BG_ROVER_RATE * bgMult * dt;
  let want = state.bgCarry;
  if (want < 1) return;
  const drills = state.drills;
  for (let i = 0; i < drills.length && want >= 1; i++) {
    const d = drills[i];
    if (d.deploy < 1 || d.stockpile <= 0) continue;
    const take = Math.min(d.stockpile, want);
    d.stockpile -= take;
    want -= take;
    state.rawOre += take;
    state.totalOre += take;
    state.bgCarry -= take;
  }
}

export function step(dt = FIXED_DT) {
  prev.asteroidSpin = state.asteroidSpin;
  state.tick += 1;
  state.time += dt;
  state.asteroidSpin += TUNING.asteroidSpinRate * dt;
  if (state.asteroidSpin > Math.PI * 2) state.asteroidSpin -= Math.PI * 2;

  stepEvents(dt); // refresh fx + fire/expire events before production uses them
  stepChunks(dt);

  const st = state.stats;
  const fx = state.fx;
  const drills = state.drills;

  // ---- drills ----
  for (let i = 0; i < drills.length; i++) {
    const d = drills[i];
    d.deployPrev = d.deploy;
    if (d.deploy < 1) {
      d.deploy += dt / C.DEPLOY_DUR;
      if (d.deploy >= 1) {
        d.deploy = 1;
        if (!d.dustDone) {
          d.dustDone = true;
          state.events.push({ type: "dust", x: d.x, y: d.y, z: d.z, nx: d.nx, ny: d.ny, nz: d.nz });
        }
      }
      continue;
    }
    if (state.time < d.disabledUntil) continue; // knocked offline by a meteor
    d.cooldown -= dt;
    if (d.cooldown <= 0) {
      if (d.stockpile < st.stockpileMax) {
        const mult = i === fx.veinDrill ? fx.veinMult : 1;
        d.stockpile = Math.min(st.stockpileMax, d.stockpile + st.drillOrePerCycle * mult);
        d.cooldown += st.drillCycleTime / fx.drillSpeedMult;
        d.cycles += 1;

        // alien tech jackpot — 1% chance per cycle. instant huge payout +
        // log entry + visual burst. scales with current crateValue so it
        // remains exciting deep into late-game.
        if (Math.random() < C.ALIEN_TECH_CHANCE) {
          const payout = Math.max(50, Math.round(crateValue() * C.ALIEN_TECH_REWARD_X));
          addCash(payout);
          addEarnings(payout);
          state.stat.alienTechHits += 1;
          logEvent("ALIEN TECH RECOVERED", `+$${payout.toLocaleString()}`);
          state.events.push({ type: "alienTech", x: d.x, y: d.y, z: d.z, nx: d.nx, ny: d.ny, nz: d.nz, payout });
        }
      } else {
        d.cooldown = 0;
      }
    }
  }

  // ---- rovers ----
  const rovers = state.rovers;
  const roverSpeed = st.roverSpeed * fx.roverSpeedMult;
  for (let i = 0; i < rovers.length; i++) {
    const r = rovers[i];
    r.pPrev = r.p;
    if (state.time < r.disabledUntil) continue; // engine failure
    switch (r.state) {
      case "IDLE": {
        const idx = bestDrillFor();
        if (idx >= 0) {
          drills[idx].inbound += 1;
          r.drillIndex = idx;
          setLeg(r, HOME, { x: drills[idx].x, y: drills[idx].y, z: drills[idx].z });
          r.state = "TO_DRILL";
        }
        break;
      }
      case "TO_DRILL": {
        r.p += (roverSpeed * dt) / r.arcLen;
        if (r.p >= 1) {
          r.p = 1;
          const d = drills[r.drillIndex];
          const amt = d ? Math.min(st.roverCapacity, d.stockpile) : 0;
          if (d) { d.stockpile -= amt; d.inbound = Math.max(0, d.inbound - 1); }
          r.cargo = amt; r.loadT = 0;
          if (amt <= 0) { r.state = "IDLE"; r.drillIndex = -1; }
          else { r.state = "LOADING"; state.events.push({ type: "load", x: d.x, y: d.y, z: d.z, nx: d.nx, ny: d.ny, nz: d.nz }); }
        }
        break;
      }
      case "LOADING": {
        // Quick Load upgrade shortens this — divide normal load time by mult
        const lt = Math.max(0.1, C.LOAD_TIME * (st.loadTimeMult || 1));
        r.loadT += dt / lt;
        if (r.loadT >= 1) {
          r.loadT = 1;
          const d = drills[r.drillIndex];
          setLeg(r, { x: d.x, y: d.y, z: d.z }, HOME);
          r.drillIndex = -1;
          r.state = "TO_SMELTER";
        }
        break;
      }
      case "TO_SMELTER": {
        r.p += (roverSpeed * dt) / r.arcLen;
        if (r.p >= 1) { r.p = 1; r.loadT = 0; r.state = "UNLOADING"; }
        break;
      }
      case "UNLOADING": {
        const ut = Math.max(0.1, C.UNLOAD_TIME * (st.loadTimeMult || 1));
        r.loadT += dt / ut;
        if (r.loadT >= 1) {
          state.rawOre += r.cargo;
          state.totalOre += r.cargo;
          state.events.push({ type: "unload", x: C.SMELTER_INTAKE.x, y: C.SMELTER_INTAKE.y, z: C.SMELTER_INTAKE.z, nx: 0, ny: 1, nz: 0 });
          r.cargo = 0; r.state = "IDLE";
        }
        break;
      }
    }
  }

  runBackgroundFleet(dt);

  // lifetime stat tracking
  state.stat.timePlayedTotal += dt;
  if (state.drills.length > state.stat.maxDrills) state.stat.maxDrills = state.drills.length;
  const rc = roverCount();
  if (rc > state.stat.maxRovers) state.stat.maxRovers = rc;
  state.achCheck += dt;
  if (state.achCheck >= 1) { state.achCheck = 0; checkAchievements(); }

  // ---- smelter: refine raw ore into crates ----
  if (state.rawOre > 0) {
    const refined = Math.min(state.rawOre, st.refineRate * dt);
    state.rawOre -= refined;
    const made = refined * st.refineEfficiency;
    state.refinedStock += made;
    state.totalRefined += made;
  }

  // ---- rockets: one cycle per pad ----
  for (let pi = 0; pi < state.rockets.length; pi++) {
    stepRocket(state.rockets[pi], dt);
  }
  // mirror first pad into legacy alias so any old reads still work
  Object.assign(state.rocket, state.rockets[0]);

  stepContracts(dt);
}

/* Per-pad rocket FSM. Each pad pulls from the shared refinedStock pool.
   Auto-launch logic: launches at 80% batch fill OR every 15s if any crates
   are queued, preventing buildup overflow when production outpaces capacity. */
function stepRocket(rk, dt) {
  rk.ascentPrev = rk.ascent;
  const delay = state.fx.launchDelayMult || 1;
  const cadence = (state.stats.cadence || 1) / delay;

  switch (rk.phase) {
    case "IDLE": {
      rk.fade = Math.min(1, rk.fade + dt * 2.5);
      rk.idleTimer += dt;
      const batch = batchCrates();
      const triggerFull = batch;
      const triggerEarly = Math.max(1, Math.floor(batch * C.ROCKET_AUTO_LAUNCH_FRACTION));
      const wantsLaunch =
        state.refinedStock >= triggerFull ||
        (state.refinedStock >= triggerEarly && rk.idleTimer >= C.ROCKET_AUTO_LAUNCH_TIMEOUT) ||
        (state.refinedStock >= 1 && rk.idleTimer >= C.ROCKET_AUTO_LAUNCH_TIMEOUT * 2);
      if (wantsLaunch) {
        const take = Math.min(batch, Math.floor(state.refinedStock));
        if (take >= 1) {
          state.refinedStock -= take;
          rk.cargo = take;
          rk.payout = Math.round(take * crateValue());
          rk.loadT = 0;
          rk.idleTimer = 0;
          rk.phase = "LOADING";
        }
      }
      break;
    }
    case "LOADING": {
      rk.loadT += dt / (C.ROCKET_LOAD_DUR / cadence);
      if (rk.loadT >= 1) { rk.loadT = 1; rk.phase = "COUNTDOWN"; rk.timer = C.ROCKET_COUNTDOWN * delay; }
      break;
    }
    case "COUNTDOWN": {
      rk.timer -= dt;
      if (rk.timer <= 0) {
        rk.phase = "ASCENT"; rk.ascent = 0; rk.ascentPrev = 0;
        const pay = Math.round(rk.payout * (state.fx.payoutMult || 1)); // tax holiday etc.
        rk.payout = pay;
        addCash(pay);
        addEarnings(pay);
        state.totalLaunches += 1;
        if (!state.flags.firstRocketFast && state.time - state.run.startTime < 60) state.flags.firstRocketFast = true;
        // combo contracts only count launches made with enough rovers running
        const rc = roverCount();
        for (const c of state.contracts.active) {
          if (c.type === "combo" && rc >= c.comboRovers) c.progress += 1;
        }
        state.events.push({ type: "launch", payout: pay, padIndex: rk.padIndex });
      }
      break;
    }
    case "ASCENT": {
      rk.ascent += dt / C.ROCKET_ASCENT_DUR;
      if (rk.ascent >= 1) { rk.ascent = 1; rk.phase = "COOLDOWN"; rk.timer = (C.ROCKET_RESPAWN_DUR / cadence); rk.cargo = 0; rk.fade = 0; }
      break;
    }
    case "COOLDOWN": {
      rk.timer -= dt;
      if (rk.timer <= 0) { rk.phase = "IDLE"; rk.fade = 0; rk.ascent = 0; rk.ascentPrev = 0; rk.idleTimer = 0; }
      break;
    }
  }
}

// ============================================================
//  CONTRACTS
// ============================================================
function deployedDrillCount() {
  let n = 0;
  for (const d of state.drills) if (d.deploy >= 1) n++;
  return n;
}

function progressionSnapshot() {
  const st = state.stats;
  const orePerMin = state.drills.length * st.drillOrePerCycle * (60 / st.drillCycleTime);
  const refinedPerMin = orePerMin * st.refineEfficiency;
  const batch = batchCrates();
  const launchPerMin = batch > 0 ? refinedPerMin / batch : 0;
  return {
    drills: state.drills.length, rovers: roverCount(),
    orePerMin, refinedPerMin, launchPerMin, batch, crateValue: crateValue(),
  };
}

export function refreshAvailableContracts() {
  const snap = progressionSnapshot();
  state.contracts.available = [generateContract(snap), generateContract(snap), generateContract(snap)];
  state.contracts.lastRefresh = state.time;
}

export function manualRefreshContracts() {
  if (state.researchPoints < C.CONTRACT_REFRESH_RP_COST) return false;
  state.researchPoints -= C.CONTRACT_REFRESH_RP_COST;
  refreshAvailableContracts();
  return true;
}

function startMetricFor(type) {
  if (type === "mine") return state.totalOre;
  if (type === "refine") return state.totalRefined;
  if (type === "launch") return state.totalLaunches;
  return 0; // drills (instantaneous), combo (tracked incrementally)
}

export function acceptContract(id) {
  const av = state.contracts.available;
  const idx = av.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  if (state.contracts.active.length >= C.MAX_ACTIVE_CONTRACTS) return false;
  const c = av[idx];
  c.deadline = state.time + c.minutes * 60;
  c.startMetric = startMetricFor(c.type);
  c.progress = 0; c.tiersGranted = 0; c.done = false; c.expired = false;
  av.splice(idx, 1);

  // "Research opportunity" event grants an instant gold-tier completion
  if (state.nextContractGold) {
    state.nextContractGold = false;
    grantTier(c, "bronze"); grantTier(c, "silver"); grantTier(c, "gold");
    return true; // resolved instantly, never enters the active list
  }

  state.contracts.active.push(c);
  return true;
}

function contractProgress(c) {
  switch (c.type) {
    case "mine": return state.totalOre - c.startMetric;
    case "refine": return state.totalRefined - c.startMetric;
    case "launch": return state.totalLaunches - c.startMetric;
    case "drills": return deployedDrillCount();
    case "combo": return c.progress; // tracked on launch
  }
  return 0;
}

function grantTier(c, tier) {
  const r = c.reward;
  const im = state.stats.incomeMult || 1;
  const rpm = state.stats.rpMult || 1;
  let cash = 0;
  if (tier === "bronze") { cash = r.bronzeCash; state.stat.contractsBronze += 1; }
  else if (tier === "silver") { cash = r.silverCash; state.researchPoints += Math.round(r.silverRP * rpm); state.stat.contractsSilver += 1; }
  else if (tier === "gold") {
    cash = r.goldCash;
    state.researchPoints += Math.round(r.goldRP * rpm);
    state.reputation += r.goldRep;
    state.prophecyCores += 1;   // gold = 1 Prophecy Core (compounding +3% income)
    state.totalContractsCompleted += 1;
    state.stat.contractsGold += 1;
  }
  cash = Math.round(cash * im);
  addCash(cash);
  addEarnings(cash);
  if (tier === "gold") recomputeStats(); // PC count changed
  state.events.push({ type: "contract", tier, name: c.name });
}

export function contractTarget(c) { return c.target * (state.stats.contractTargetMult || 1); }

function stepContracts(dt) {
  const C_ = state.contracts;
  if (!C_.initialized) { refreshAvailableContracts(); C_.initialized = true; }
  if (state.time - C_.lastRefresh >= C.CONTRACT_REFRESH_SECONDS) refreshAvailableContracts();

  const active = C_.active;
  for (let i = active.length - 1; i >= 0; i--) {
    const c = active[i];
    if (c.type !== "combo") c.progress = contractProgress(c);
    const t = contractTarget(c);
    if (c.tiersGranted < 1 && c.progress >= t * C.CONTRACT_TIER_FRACTIONS.bronze) { c.tiersGranted = 1; grantTier(c, "bronze"); }
    if (c.tiersGranted < 2 && c.progress >= t * C.CONTRACT_TIER_FRACTIONS.silver) { c.tiersGranted = 2; grantTier(c, "silver"); }
    if (c.tiersGranted < 3 && c.progress >= t * C.CONTRACT_TIER_FRACTIONS.gold) { c.tiersGranted = 3; grantTier(c, "gold"); c.done = true; }
    if (state.time >= c.deadline) c.expired = true;
    if (c.done || c.expired) active.splice(i, 1);
  }
}

// ============================================================
//  RANDOM EVENTS
// ============================================================
export function scheduleNextEvent() { state.eventTimer = 180 + Math.random() * 240; }
export function logEvent(name, outcome) {
  state.eventLog.unshift({ name, outcome, t: Math.floor(state.time) });
  if (state.eventLog.length > 20) state.eventLog.pop();
}
export function clearChoice() { state.pendingChoice = null; }

function eventSnapshot() {
  return {
    drills: state.drills.length, rovers: roverCount(),
    drillCost: drillCost(), payout: batchCrates() * crateValue(),
    rp: state.researchPoints, crateValue: crateValue(), batch: batchCrates(),
  };
}

function fireEvent() {
  const kind = rollKind();
  const ev = makeEvent(kind, eventSnapshot());
  state.stat.eventsTriggered += 1;
  if (kind === "choice") {
    state.pendingChoice = ev;
    state.choiceDeadline = state.time + 15;
    state.events.push({ type: "eventChoice" });
    logEvent(ev.name, "offered");
    return;
  }
  const e = { id: ev.id, kind, name: ev.name, remaining: ev.duration, duration: ev.duration };
  if (ev.id === "resourceVein") e.drillIndex = state.drills.length ? (Math.random() * state.drills.length) | 0 : -1;
  if (ev.id === "meteorShower") e.sub = 2;
  if (ev.id === "engineFailure" && state.rovers.length) {
    state.rovers[(Math.random() * state.rovers.length) | 0].disabledUntil = state.time + 90;
  }
  state.activeEffects.push(e);
  state.events.push({ type: "eventBanner", kind, name: ev.name, desc: ev.desc });
  logEvent(ev.name, kind === "buff" ? "buff active" : "debuff active");
}

// resolve the decline / timeout branch (pirates "fight" lives here)
export function declineChoice() {
  const c = state.pendingChoice;
  if (!c) return;
  state.stat.eventsDeclined += 1;
  let outcome = "declined";
  if (c.id === "pirates") {
    state.stat.riskyAccepted += 1; // fighting pirates is a risky choice
    if (state.rovers.length) state.rovers.pop();
    else if (state.bgRovers > 0) state.bgRovers -= 1;
    addCash(c.bounty);
    addEarnings(c.bounty);
    outcome = `fought — won $${c.bounty.toLocaleString()}, lost a rover`;
    state.events.push({ type: "eventBanner", kind: "buff", name: "PIRATES REPELLED", desc: `+$${c.bounty.toLocaleString()}` });
  }
  logEvent(c.name, outcome);
  clearChoice();
  scheduleNextEvent();
}

function stepEvents(dt) {
  const fx = state.fx;
  fx.drillSpeedMult = 1; fx.roverSpeedMult = 1; fx.payoutMult = 1; fx.launchDelayMult = 1;
  fx.veinDrill = -1; fx.veinMult = 1; fx.flare = 0; fx.meteor = 0;

  if (state.pendingChoice && state.time >= state.choiceDeadline) declineChoice();

  const eff = state.activeEffects;
  for (let i = eff.length - 1; i >= 0; i--) {
    const e = eff[i];
    e.remaining -= dt;
    switch (e.id) {
      case "solarFlare": fx.drillSpeedMult *= 5; fx.flare = 1; break;
      case "resourceVein": fx.veinDrill = e.drillIndex; fx.veinMult = 10; break;
      case "taxHoliday": fx.payoutMult *= 2; break;
      case "roverOverdrive": fx.roverSpeedMult *= 3; break;
      case "fuelShortage": fx.launchDelayMult *= 1.5; break;
      case "meteorShower":
        fx.meteor = 1;
        e.sub -= dt;
        if (e.sub <= 0 && state.drills.length) {
          const idx = (Math.random() * state.drills.length) | 0;
          state.drills[idx].disabledUntil = Math.max(state.drills[idx].disabledUntil, state.time + 30);
          e.sub = 8;
        }
        break;
    }
    if (e.remaining <= 0) {
      if (e.id === "meteorShower") state.stat.meteorsSurvived += 1;
      eff.splice(i, 1);
    }
  }

  state.eventTimer -= dt;
  if (state.time > 90 && state.eventTimer <= 0 && !state.pendingChoice) {
    fireEvent();
    scheduleNextEvent();
  }
}

// ============================================================
//  PRESTIGE / WARP
// ============================================================
export function warpUnlocked() { return state.lifetimeEarnings >= C.WARP_THRESHOLD; }

export function computeWarpCores() {
  const yieldMult = 1 + 0.25 * warpLevel("coreYield");
  return Math.floor(100 * Math.sqrt(Math.max(0, state.runEarnings) / 1e12) * yieldMult);
}

export function warpUpgradeCost(id) { return warpCostFor(id, warpLevel(id)); }
export function warpUpgradeMaxed(id) { return warpLevel(id) >= WARP_UPGRADES[id].max; }
export function canBuyWarpUpgrade(id) { return !warpUpgradeMaxed(id) && state.warpCores >= warpUpgradeCost(id); }
export function buyWarpUpgrade(id) {
  if (!canBuyWarpUpgrade(id)) return false;
  const cost = warpUpgradeCost(id);
  state.warpCores -= cost;        // spending reduces the unspent (+1%/core) pool
  state.warpCoresSpent += cost;
  state.warpUpgrades[id] = warpLevel(id) + 1;
  recomputeStats();
  return true;
}

/* Reset the run and jump to a sector. Returns cores earned.
   Caller (main) re-adds starting drills/rovers since placement needs render. */
export function warpReset(targetSector) {
  const earned = computeWarpCores();
  state.warpCores += earned;

  // lifetime stats + behavioral flags
  state.stat.warps += 1;
  state.stat.warpTimes.push(Math.round(state.time - state.run.startTime));
  if (state.stat.warpTimes.length > 50) state.stat.warpTimes.shift();
  state.flags.warpWatched = true;
  if (!state.run.boughtRover && state.totalLaunches > 0) state.flags.noRoverRun = true;

  // unlock the next sequential sector (one new sector per warp)
  const highest = Math.max(...state.unlockedSectors);
  if (highest < MAX_SECTOR && !state.unlockedSectors.includes(highest + 1)) {
    state.unlockedSectors.push(highest + 1);
  }
  state.currentSector = targetSector;

  // reset run-scoped progress
  state.cash = warpLevel("startCash") > 0 ? 100000 : C.STARTING_CASH;
  state.drills.length = 0;
  state.rovers.length = 0;
  state.bgRovers = 0; state.bgCarry = 0;
  state.rawOre = 0; state.refinedStock = 0;
  state.totalOre = 0; state.totalRefined = 0; state.totalLaunches = 0;
  state.runEarnings = 0;
  state.chunks.length = 0; state.clickCooldown = 0;
  state.pads = 1;
  state.rockets = [makeRocket(0)];

  // wipe run upgrades (keep research only if Knowledge Retention owned)
  const wipe = [...CATEGORIES.mining, ...CATEGORIES.fleet, ...CATEGORIES.refining];
  if (warpLevel("keepResearch") === 0) wipe.push(...CATEGORIES.research);
  for (const id of wipe) delete state.upgrades[id];

  // research points: keep half
  state.researchPoints = Math.floor(state.researchPoints * 0.5);

  // reset rocket + transient systems
  Object.assign(state.rocket, { phase: "IDLE", timer: 0, loadT: 0, ascent: 0, ascentPrev: 0, cargo: 0, payout: 0, fade: 1 });
  state.contracts = { active: [], available: [], lastRefresh: 0, initialized: false };
  state.activeEffects = []; state.pendingChoice = null; state.eventTimer = 130; state.nextContractGold = false;

  // fresh run flags
  state.run.boughtRover = false;
  state.run.startTime = state.time;
  state.flags.firstRocketFast = false;

  recomputeStats();
  return earned;
}

export function startingDrills() { return warpLevel("startDrills") > 0 ? 5 : 0; }
export function startingRovers() { return warpLevel("startRovers") > 0 ? 3 : 0; }

// ============================================================
//  ACHIEVEMENTS + OFFLINE
// ============================================================
export function achievementMult() { return 1 + 0.01 * Object.keys(state.achievements).length; }

function achievementCtx() {
  return {
    lifetime: state.lifetimeEarnings,
    drills: state.drills.length,
    rovers: roverCount(),
    launchesTotal: state.totalLaunches,
    oreTotal: state.totalOre,
    refinedTotal: state.totalRefined,
    rp: state.researchPoints,
    reputation: state.reputation,
    warps: state.stat.warps,
    maxSector: Math.max(...state.unlockedSectors),
    unlockedSectors: state.unlockedSectors.length,
    gold: state.stat.contractsGold,
    contracts: state.totalContractsCompleted,
    risky: state.stat.riskyAccepted,
    meteors: state.stat.meteorsSurvived,
    firstRocketFast: state.flags.firstRocketFast,
    noRoverRun: state.flags.noRoverRun,
    warpWatched: state.flags.warpWatched,
    drillPowerLvl: upgradeLevel("drillPower"),
    warpCores: state.warpCores,
  };
}

export function checkAchievements() {
  const ctx = achievementCtx();
  let unlockedAny = false;
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id]) continue;
    if (a.test(ctx)) {
      state.achievements[a.id] = true;
      state.events.push({ type: "achievement", id: a.id, name: a.name });
      unlockedAny = true;
    }
  }
  if (unlockedAny) recomputeStats(); // income multiplier changed
}

/* Derive offline gains from current rates (no tick-by-tick sim).
   Gated behind the Offline Production research upgrade. */
export function computeOffline(savedAt) {
  if (!state.stats.offline || !savedAt) return null;
  const maxOffline = 12 * 3600;
  let elapsed = (Date.now() - savedAt) / 1000;
  if (!isFinite(elapsed) || elapsed < 60) return null;
  elapsed = Math.min(elapsed, maxOffline);

  const st = state.stats;
  const oreRate = state.drills.length * st.drillOrePerCycle / st.drillCycleTime;
  const roverRate = roverCount() * st.roverCapacity / 6; // ~6s round trip estimate
  const refinedRate = Math.min(oreRate, roverRate, st.refineRate) * st.refineEfficiency;
  const batch = batchCrates();
  const launchRate = batch > 0 ? refinedRate / batch : 0;
  const incomePerSec = launchRate * batch * crateValue();

  const factor = 0.6; // offline efficiency
  const earnings = Math.floor(incomePerSec * elapsed * factor);
  const launches = Math.floor(launchRate * elapsed * factor);
  if (earnings <= 0) return null;
  return { seconds: Math.floor(elapsed), earnings, launches };
}

export function applyOffline(off) {
  if (!off) return;
  addCash(off.earnings);
  addEarnings(off.earnings);
  state.totalLaunches += off.launches;
  checkAchievements();
}

export function hardReset() {
  // clears everything (caller wipes localStorage + reloads)
}

// ---- save / load ----
/* defence-in-depth: any non-finite slips through become MAX_SAFE on save
   (instead of JSON-stringify turning Infinity into null → 0 on next load). */
const safeNum = (n) => (Number.isFinite(n) ? n : MAX_SAFE);

export function serialize() {
  return {
    time: state.time,
    cash: safeNum(state.cash),
    totalOre: safeNum(state.totalOre),
    totalRefined: safeNum(state.totalRefined),
    totalLaunches: state.totalLaunches,
    lifetimeEarnings: safeNum(state.lifetimeEarnings),
    runEarnings: safeNum(state.runEarnings),
    clicksMined: state.clicksMined,
    chunksCollected: state.chunksCollected,
    researchPoints: state.researchPoints,
    reputation: state.reputation,
    totalContractsCompleted: state.totalContractsCompleted,
    rawOre: state.rawOre,
    refinedStock: state.refinedStock,
    pads: state.pads,
    upgrades: state.upgrades,
    contracts: state.contracts,
    eventLog: state.eventLog,
    nextContractGold: state.nextContractGold,
    warpCores: state.warpCores,
    warpCoresSpent: state.warpCoresSpent,
    prophecyCores: state.prophecyCores,
    warpUpgrades: state.warpUpgrades,
    unlockedSectors: state.unlockedSectors,
    currentSector: state.currentSector,
    achievements: state.achievements,
    flags: state.flags,
    stat: state.stat,
    run: state.run,
    drillCount: state.drills.length,
    roverCount: roverCount(),
    savedAt: Date.now(),
  };
}

export function applySave(data) {
  if (!data) { recomputeStats(); return { drillCount: 0, roverCount: 0 }; }
  /* sanitize loaded numbers: null / Infinity / NaN (from a pre-fix overflow
     save) recovers to MAX_SAFE when the player clearly had progress,
     otherwise the field's default. */
  const num = (v, def = 0) => Number.isFinite(v) ? v : def;
  const lifetime = num(data.lifetimeEarnings ?? data.totalOre, 0);
  const cashFallback = lifetime > 0 ? MAX_SAFE : 0; // recover from null cash with progress
  state.time = num(data.time, 0);
  state.cash = Number.isFinite(data.cash) ? data.cash : cashFallback;
  state.totalOre = num(data.totalOre, 0);
  state.totalRefined = num(data.totalRefined, 0);
  state.totalLaunches = num(data.totalLaunches, 0);
  state.lifetimeEarnings = lifetime;
  state.runEarnings = num(data.runEarnings, 0);
  state.clicksMined = num(data.clicksMined, 0);
  state.chunksCollected = num(data.chunksCollected, 0);
  state.researchPoints = num(data.researchPoints, 0);
  state.reputation = num(data.reputation, 0);
  state.totalContractsCompleted = num(data.totalContractsCompleted, 0);
  state.rawOre = num(data.rawOre, 0);
  state.refinedStock = num(data.refinedStock, 0);
  state.pads = Math.max(1, Math.min(C.MAX_LAUNCH_PADS, num(data.pads, 1)));
  state.rockets = [];
  for (let i = 0; i < state.pads; i++) state.rockets.push(makeRocket(i));
  if (data.upgrades) state.upgrades = data.upgrades;
  if (data.contracts && data.contracts.initialized) state.contracts = data.contracts;
  if (Array.isArray(data.eventLog)) state.eventLog = data.eventLog;
  state.nextContractGold = !!data.nextContractGold;
  state.warpCores = num(data.warpCores, 0);
  state.warpCoresSpent = num(data.warpCoresSpent, 0);
  state.prophecyCores = num(data.prophecyCores, 0);
  if (data.warpUpgrades) state.warpUpgrades = data.warpUpgrades;
  if (Array.isArray(data.unlockedSectors) && data.unlockedSectors.length) state.unlockedSectors = data.unlockedSectors;
  state.currentSector = data.currentSector ?? 1;
  if (data.achievements) state.achievements = data.achievements;
  if (data.flags) Object.assign(state.flags, data.flags);
  if (data.stat) Object.assign(state.stat, data.stat);
  if (data.run) Object.assign(state.run, data.run);
  recomputeStats();

  const drillCount = data.drillCount ?? 0;
  const roverCount = data.roverCount ?? 0;
  // (no auto-floor on cash — the 5M-feels-like-reset issue was actually
  // GROWTH=5 making single upgrades cost most of your bank, not a save bug.
  // every spend goes through spend() which clamps at 0 cleanly.)
  return { drillCount, roverCount };
}

export { HOME };
