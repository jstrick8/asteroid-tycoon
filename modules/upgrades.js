/* ============================================================
   upgrades.js — declarative upgrade catalogue.
   Pure data: names, categories, base costs, level caps, lifetime
   unlock gates, and a human description. The level->effect mapping
   lives in sim.recomputeStats(); this file just defines what exists.
   Cost curve: base * GROWTH^currentLevel.
   ============================================================ */

// Cost growth per level. Lower means more affordable late-game upgrades but
// also softer scaling — paired with smaller per-level effect multipliers so
// every purchase feels meaningful without "draining 90% of your cash" jumps.
export const GROWTH = 1.5;

export const UPGRADES = {
  // ---- MINING ----
  drillPower:    { cat: "mining", name: "Drill Power",       base: 60,   max: 50, desc: "+10% ore per drill cycle" },
  drillSpeed:    { cat: "mining", name: "Drill Speed",       base: 80,   max: 30, desc: "-5% drill cycle time (min 0.5s)" },
  stockpile:     { cat: "mining", name: "Larger Stockpiles", base: 150,  max: 5,  desc: "Drills hold more before pausing: 10 → 20 → 40 → 80 → 160 → 320" },
  autoSurveyor:  { cat: "mining", name: "Auto-Surveyor",     base: 1500, max: 1,  desc: "Drills find richer nodes (+10% ore, permanent)" },

  // ---- FLEET ----
  roverSpeed:     { cat: "fleet", name: "Rover Speed",      base: 200,   max: 30, unlock: 50000,  desc: "+5% rover speed" },
  roverCapacity:  { cat: "fleet", name: "Rover Capacity",   base: 400,   max: 6,  unlock: 50000,  desc: "More ore per trip: 1 → 3 → 5 → 8 → 12 → 20 → 30" },
  cargoBins:      { cat: "fleet", name: "Cargo Bins",       base: 700,   max: 25, unlock: 75000,  desc: "+10% rover cargo capacity per level (smooth growth on top of the Capacity tiers)" },
  quickLoad:      { cat: "fleet", name: "Quick Load",       base: 600,   max: 15, unlock: 50000,  desc: "-8% rover load + unload time per level (min 0.1s each)" },
  roverPads:      { cat: "fleet", name: "Expanded Pads",    base: 2000,  max: 5,  unlock: 100000, desc: "+50 max visible rovers per level" },
  backgroundBoost:{ cat: "fleet", name: "Convoy Logistics", base: 4000,  max: 20, unlock: 250000, desc: "+10% background-fleet haul rate per level (off-screen rovers carry more)" },
  drivetrain:     { cat: "fleet", name: "Reinforced Drivetrain", base: 1200, max: 20, unlock: 100000, desc: "+8% rover speed per level (stacks on Rover Speed for late-game scaling)" },

  // ---- REFINING ----
  refineSpeed:    { cat: "refining", name: "Refining Speed",  base: 90,   max: 30, desc: "+10% smelter refining rate" },
  crateDensity:   { cat: "refining", name: "Crate Density",   base: 100,  max: 30, desc: "+10% $ value per crate" },
  rocketCapacity: { cat: "refining", name: "Rocket Capacity", base: 300,  max: 8,  desc: "Bigger launches: 10 → 14 → 20 → 30 → 50 → 75 → 100 → 150 → 200 crates" },
  hullExpansion:  { cat: "refining", name: "Hull Expansion",  base: 600,  max: 25, desc: "+15% rocket cargo capacity per level (stacks on top of Rocket Capacity tiers)" },
  rapidLaunch:    { cat: "refining", name: "Rapid Launch",    base: 200,  max: 20, desc: "+10% faster rocket turnaround" },

  // ---- RESEARCH (gated by lifetime earnings) ----
  // Auto-Buy Drills + Auto-Buy Rovers were removed — building units is part
  // of the deliberate gameplay (manual placement, capital decisions).
  smelterEff: { cat: "research", name: "Improved Smelter",     base: 15000, max: 1, unlock: 50000,  desc: "1 ore refines into 1.5 material" },
  offline:    { cat: "research", name: "Offline Production",   base: 40000, max: 1, unlock: 100000, desc: "Colony keeps working while you're away" },
  telescope:  { cat: "research", name: "Deep-Space Telescope", base: 75000, max: 1, unlock: 250000, desc: "Reveal the next sector early" },
};

export const CATEGORIES = {
  mining:   ["drillPower", "drillSpeed", "stockpile", "autoSurveyor"],
  fleet:    ["roverSpeed", "drivetrain", "roverCapacity", "cargoBins", "quickLoad", "roverPads", "backgroundBoost"],
  refining: ["refineSpeed", "crateDensity", "rocketCapacity", "hullExpansion", "rapidLaunch"],
  research: ["smelterEff", "offline", "telescope"],
};
