/* ============================================================
   achievements.js — 50+ achievements. Each unlocked achievement
   grants +1% permanent income (stacks). test(ctx) reads a derived
   snapshot supplied by sim.checkAchievements().
   ============================================================ */

export function fmtBig(n) {
  const units = ["", "K", "M", "B", "T", "Qa", "Qi"];
  let u = 0, v = n;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  return (v % 1 === 0 ? v : v.toFixed(1)) + units[u];
}

// generate a tiered set: id prefix, label, ctx key, threshold list, name fn
function tier(prefix, key, values, nameFn, descFn) {
  return values.map((v, i) => ({
    id: prefix + i,
    name: nameFn(v),
    desc: descFn(v),
    test: (c) => c[key] >= v,
  }));
}

export const ACHIEVEMENTS = [
  // lifetime earnings
  ...tier("earn", "lifetime", [1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e15, 1e18],
    (v) => `Tycoon $${fmtBig(v)}`, (v) => `Earn $${fmtBig(v)} lifetime`),
  // drills owned at once
  ...tier("drill", "drills", [10, 25, 50, 100, 250, 500],
    (v) => `${v} Drills`, (v) => `Own ${v} drills at once`),
  // rovers owned at once
  ...tier("rover", "rovers", [5, 10, 50, 100, 250, 500, 1000],
    (v) => `${v} Rovers`, (v) => `Own ${v} rovers at once`),
  // launches total
  ...tier("launch", "launchesTotal", [10, 100, 1000, 10000],
    (v) => `${fmtBig(v)} Launches`, (v) => `Launch ${fmtBig(v)} rockets total`),
  // ore mined
  ...tier("ore", "oreTotal", [1e3, 1e5, 1e7, 1e9],
    (v) => `${fmtBig(v)} Ore`, (v) => `Mine ${fmtBig(v)} ore total`),
  // refined produced
  ...tier("ref", "refinedTotal", [1e3, 1e5, 1e7, 1e9],
    (v) => `${fmtBig(v)} Refined`, (v) => `Refine ${fmtBig(v)} material total`),
  // research points
  ...tier("rp", "rp", [10, 100, 1000],
    (v) => `${fmtBig(v)} Research`, (v) => `Bank ${fmtBig(v)} research points`),
  // reputation
  ...tier("rep", "reputation", [1, 10, 50],
    (v) => `${v} Reputation`, (v) => `Earn ${v} reputation`),

  // prestige
  { id: "warp1", name: "First Warp", desc: "Complete your first warp", test: (c) => c.warps >= 1 },
  { id: "warp5", name: "Frequent Flyer", desc: "Complete 5 warps", test: (c) => c.warps >= 5 },
  { id: "warp10", name: "Dimensional Drifter", desc: "Complete 10 warps", test: (c) => c.warps >= 10 },
  { id: "warp25", name: "Sector Hopper", desc: "Complete 25 warps", test: (c) => c.warps >= 25 },
  { id: "warp100", name: "Warp Lord", desc: "Complete 100 warps", test: (c) => c.warps >= 100 },
  { id: "sec2", name: "Into the Ice", desc: "Reach the Ice Belt", test: (c) => c.maxSector >= 2 },
  { id: "sec3", name: "Heavy Hitter", desc: "Reach Heavy Metal", test: (c) => c.maxSector >= 3 },
  { id: "sec4", name: "Reef Runner", desc: "Reach Crystal Reef", test: (c) => c.maxSector >= 4 },
  { id: "sec5", name: "Into the Fire", desc: "Reach the Lava Core", test: (c) => c.maxSector >= 5 },
  { id: "secAll", name: "Galactic Cartographer", desc: "Unlock 6 sectors", test: (c) => c.unlockedSectors >= 6 },

  // contracts
  { id: "gold1", name: "Gold Standard", desc: "Earn 1 gold contract", test: (c) => c.gold >= 1 },
  { id: "gold10", name: "Golden Touch", desc: "Earn 10 gold contracts", test: (c) => c.gold >= 10 },
  { id: "gold50", name: "Midas", desc: "Earn 50 gold contracts", test: (c) => c.gold >= 50 },
  { id: "ct10", name: "Contractor", desc: "Complete 10 contracts", test: (c) => c.contracts >= 10 },
  { id: "ct100", name: "Logistics Empire", desc: "Complete 100 contracts", test: (c) => c.contracts >= 100 },
  { id: "ct500", name: "Quota Crusher", desc: "Complete 500 contracts", test: (c) => c.contracts >= 500 },

  // events
  { id: "risk1", name: "Gambler", desc: "Accept a risky choice event", test: (c) => c.risky >= 1 },
  { id: "risk10", name: "High Roller", desc: "Accept 10 risky choice events", test: (c) => c.risky >= 10 },
  { id: "met1", name: "Duck and Cover", desc: "Survive a meteor shower", test: (c) => c.meteors >= 1 },
  { id: "met5", name: "Storm Chaser", desc: "Survive 5 meteor showers", test: (c) => c.meteors >= 5 },

  // behavioral / silly
  { id: "fastrocket", name: "Speed Run", desc: "Launch a rocket within 60s of a run start", test: (c) => c.firstRocketFast },
  { id: "norover", name: "Drills Only", desc: "Finish a run without buying a rover", test: (c) => c.noRoverRun },
  { id: "watchwarp", name: "Eyes Open", desc: "Watch a full warp animation", test: (c) => c.warpWatched },
  { id: "drillpow", name: "Overclocked", desc: "Reach Drill Power level 10", test: (c) => c.drillPowerLvl >= 10 },
  { id: "cores100", name: "Core Collector", desc: "Hold 100 unspent Warp Cores", test: (c) => c.warpCores >= 100 },
  { id: "cores1000", name: "Singularity", desc: "Hold 1,000 unspent Warp Cores", test: (c) => c.warpCores >= 1000 },
];
