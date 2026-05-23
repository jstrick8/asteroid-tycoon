/* ============================================================
   config.js — shared tunables (plain numbers only, no THREE).
   Imported by both sim (logical) and render (visual) so the two
   layers agree on geometry and timing. Keep this dependency-free.
   ============================================================ */

// --- production / economy ---
// Enough to bootstrap the loop: one drill + one rover (10 + 50).
export const STARTING_CASH    = 60;
export const PROD_INTERVAL    = 3.0;   // seconds per ore, per drill
export const MAX_STOCKPILE    = 10;    // ore a drill holds before it pauses
export const ORE_VALUE        = 1;     // $ per ore delivered

export const BASE_DRILL_COST   = 10;
export const DRILL_COST_GROWTH = 1.12;
export const BASE_ROVER_COST   = 50;
export const ROVER_COST_GROWTH = 1.14;

// --- drill animation / geometry ---
export const DEPLOY_DUR        = 0.8;
export const DRILL_DROP_HEIGHT = 11;
export const ASTEROID_RADIUS   = 8;
export const DRILL_HEIGHT       = 2.0; // surface -> emit/light point

// --- rovers ---
export const ROVER_SPEED   = 5.5;   // surface units / second — slowed from 7 for pacing
export const CARGO_CAP     = 5;     // ore per trip
export const LOAD_TIME     = 0.6;
export const UNLOAD_TIME   = 0.6;
export const ROVER_HOVER   = 0.35;  // ride height above the surface
export const WHEEL_RADIUS  = 0.18;
// rovers depart from / return to a point on the surface under the smelter
export const ROVER_HOME    = { x: 0, y: 1, z: 0, r: 8.0 }; // dir (unit-ish) + radius

// --- caps / fleet abstraction ---
export const DRILL_CAP          = 256; // instanced capacity for drills
export const ROVER_VISIBLE_CAP  = 200; // beyond this -> background fleet
export const BG_ROVER_RATE      = 0.8; // ore/sec each background rover can haul

// --- audio ---
export const ROVER_WHIRR_CAP = 30;  // rover count where ambient whirr maxes out

// --- geometry: smelter (homeBody-local space) ---
export const SMELTER_POS     = { x: 0, y: 6.5, z: 0 };
export const SMELTER_INTAKE  = { x: 0, y: 9.2, z: 0 };

// --- refining + cargo rockets ---
export const LAUNCH_THRESHOLD   = 10;   // crates that trigger a launch (× batchSize)
export const BASE_CRATE_VALUE   = 20;   // $ per crate — reduced from 30 for slower money curve
export const MAX_VISIBLE_CRATES = 20;
export const ROCKET_LOAD_DUR     = 1.2;
export const ROCKET_COUNTDOWN    = 3.0;
export const ROCKET_ASCENT_DUR   = 3.5;
export const ROCKET_RESPAWN_DUR  = 5.0;
export const ROCKET_ASCENT_HEIGHT = 90;
// launch + crate pads (homeBody-local, on the upper surface beside the smelter)
export const LAUNCH_PAD  = { x: 3.3, y: 7.0, z: -0.6 };
export const REFINED_PAD = { x: -3.1, y: 7.0, z: 1.0 };

// --- refining + research ---
export const BASE_REFINE_RATE = 4.0;    // ore/sec the smelter refines at base
export const RESEARCH_UNLOCK  = 10000;  // lifetime $ earned to unlock the Research lab panel

// --- contracts ---
export const MAX_ACTIVE_CONTRACTS    = 3;
export const CONTRACT_REFRESH_SECONDS = 1800; // sim-seconds (~30 min of play) between auto-refreshes
export const CONTRACT_REFRESH_RP_COST = 3;    // research points to manually refresh
export const CONTRACT_TIER_FRACTIONS = { bronze: 0.5, silver: 1.0, gold: 1.5 };
// research lab placement (homeBody-local direction, projected to the surface)
export const LAB_POS = { x: -3.6, y: 4.6, z: -3.8 };

// --- screen shake ---
export const SHAKE_MAX = 0.55;

// --- prestige / warp ---
export const WARP_THRESHOLD = 1e12;  // lifetime $ to unlock the Warp Gate
// warp gate placement (homeBody-local direction, projected to the surface)
export const WARP_PAD = { x: 4.2, y: 5.6, z: 2.4 };

// --- instanced pools ---
export const ORE_POOL   = 3000; // stockpile cubes + in-flight cargo cubes
export const DUST_POOL  = 1400; // deploy puffs, sparks, rover trails, rocket fire
export const CRATE_POOL = 48;   // refined crates on the pad + loading + cargo
export const SMOKE_POOL = 700;  // rocket exhaust smoke
