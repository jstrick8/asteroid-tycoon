/* ============================================================
   upgrades.js — declarative upgrade catalogue.
   Pure data: names, categories, base costs, level caps, lifetime
   unlock gates, and a human description. The level->effect mapping
   lives in sim.recomputeStats(); this file just defines what exists.
   Cost curve: base * GROWTH^currentLevel.
   ============================================================ */

export const GROWTH = 5;

export const UPGRADES = {
  // ---- MINING ----
  drillPower:    { cat: "mining", name: "Drill Power",       base: 60,  max: 25, desc: "+50% ore per drill cycle" },
  drillSpeed:    { cat: "mining", name: "Drill Speed",       base: 80,  max: 15, desc: "-10% drill cycle time (min 0.5s)" },
  stockpile:     { cat: "mining", name: "Larger Stockpiles", base: 150, max: 3,  desc: "Drills hold more before pausing: 10 → 20 → 40 → 80" },
  autoSurveyor:  { cat: "mining", name: "Auto-Surveyor",     base: 800, max: 1,  desc: "Drills find richer nodes (+10% ore)" },

  // ---- FLEET ----
  roverSpeed:    { cat: "fleet", name: "Rover Speed",     base: 70,  max: 15, desc: "+12% rover speed" },
  roverCapacity: { cat: "fleet", name: "Rover Capacity",  base: 120, max: 4,  desc: "More ore per trip: 5 → 8 → 12 → 20 → 30" },
  roverPads:     { cat: "fleet", name: "Expanded Pads",   base: 500, max: 5,  desc: "+50 max visible rovers per level" },

  // ---- REFINING ----
  refineSpeed:    { cat: "refining", name: "Refining Speed",  base: 90,  max: 15, desc: "+30% smelter refining rate" },
  crateDensity:   { cat: "refining", name: "Crate Density",   base: 100, max: 15, desc: "+50% $ value per crate" },
  rocketCapacity: { cat: "refining", name: "Rocket Capacity", base: 300, max: 4,  desc: "Bigger launches: 10 → 20 → 50 → 100 → 200 crates" },
  rapidLaunch:    { cat: "refining", name: "Rapid Launch",    base: 200, max: 10, desc: "+15% faster rocket turnaround" },

  // ---- RESEARCH (gated by lifetime earnings) ----
  autoDrills: { cat: "research", name: "Auto-Buy Drills",      base: 5000,  max: 1, unlock: 10000,  desc: "Automatically build drills when affordable" },
  autoRovers: { cat: "research", name: "Auto-Buy Rovers",      base: 8000,  max: 1, unlock: 25000,  desc: "Automatically build rovers when affordable" },
  smelterEff: { cat: "research", name: "Improved Smelter",     base: 15000, max: 1, unlock: 50000,  desc: "1 ore refines into 1.5 material" },
  offline:    { cat: "research", name: "Offline Production",   base: 40000, max: 1, unlock: 100000, desc: "Colony keeps working while you're away" },
  telescope:  { cat: "research", name: "Deep-Space Telescope", base: 75000, max: 1, unlock: 250000, desc: "Reveal the next sector early" },
};

export const CATEGORIES = {
  mining:   ["drillPower", "drillSpeed", "stockpile", "autoSurveyor"],
  fleet:    ["roverSpeed", "roverCapacity", "roverPads"],
  refining: ["refineSpeed", "crateDensity", "rocketCapacity", "rapidLaunch"],
  research: ["autoDrills", "autoRovers", "smelterEff", "offline", "telescope"],
};
