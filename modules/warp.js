/* ============================================================
   warp.js — permanent Warp Drive upgrade tree (bought with Warp
   Cores, persists across prestige). Multi-level upgrades scale
   their cost by ×2 per level. The level->effect mapping lives in
   sim.recomputeStats / warpReset; this is just the catalogue.
   ============================================================ */

export const WARP_UPGRADES = {
  startCash:      { name: "Seed Capital",          base: 200,  max: 1, desc: "Start each run with $100,000" },
  startDrills:    { name: "Pioneer Drills",        base: 50,   max: 1, desc: "Start each run with 5 drills" },
  startRovers:    { name: "Pioneer Fleet",         base: 150,  max: 1, desc: "Start each run with 3 rovers" },
  rocketCap:      { name: "Warp Cargo Bays",       base: 300,  max: 1, desc: "+50% rocket capacity permanently" },
  fastContracts:  { name: "Temporal Sync",         base: 400,  max: 1, desc: "Contract targets 25% lower" },
  doubleRP:       { name: "Quantum Lab",           base: 600,  max: 1, desc: "Research Points earned ×2" },
  sectorBoost:    { name: "Sector Attunement",     base: 500,  max: 1, desc: "All sector bonuses 2× stronger" },
  keepResearch:   { name: "Knowledge Retention",   base: 450,  max: 1, desc: "Keep Research upgrades through warp" },
  coreYield:      { name: "Core Resonance",        base: 800,  max: 3, desc: "+25% Warp Cores earned per level" },
  permDrillPower: { name: "Eternal Drills",        base: 350,  max: 5, desc: "+50% drill power per level (permanent)" },
  permRoverSpeed: { name: "Eternal Rovers",        base: 300,  max: 5, desc: "+30% rover speed per level (permanent)" },
  autoWarp:       { name: "Auto-Warp Protocol",    base: 5000, max: 1, desc: "Endgame: auto-warp at a lifetime threshold" },
};

// display order
export const WARP_ORDER = [
  "startCash", "startDrills", "startRovers", "rocketCap",
  "permDrillPower", "permRoverSpeed", "fastContracts", "doubleRP",
  "sectorBoost", "keepResearch", "coreYield", "autoWarp",
];

export function warpCostFor(id, level) {
  return Math.round(WARP_UPGRADES[id].base * Math.pow(2, level));
}
