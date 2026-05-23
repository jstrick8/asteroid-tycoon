/* ============================================================
   config.js — shared tunables (plain numbers only, no THREE).
   Imported by both sim (logical) and render (visual) so the two
   layers agree on geometry and timing. Keep this dependency-free.
   ============================================================ */

// --- production / economy ---
// Player starts with NO cash. Must manually mine the asteroid for the
// first ~$100 to afford the first drill. Pure clicker phase.
export const STARTING_CASH    = 0;
// Drills run on a slow base cycle so the manual mining loop stays relevant
// even after the first drill is built — players have to keep their hands
// busy (click-to-harvest) until the Drill Speed upgrades catch up.
export const PROD_INTERVAL    = 10.0;  // seconds per ore, per drill (was 3.0 — 70% slower)
export const MAX_STOCKPILE    = 10;    // ore a drill holds before it pauses
export const ORE_VALUE        = 1;     // $ per ore delivered

// --- manual mining (Phase 1 click loop) ---
export const CLICK_ORE_VALUE   = 2;    // $ per clicked ore chunk
export const CLICK_CHUNK_LIFE  = 6.0;  // seconds before an unclicked chunk fades
export const CLICK_CHUNK_VEL   = 6.0;  // initial outward velocity
export const CLICK_GRAVITY     = -4.5; // tug back to surface (we use spherical "down")
export const CLICK_COOLDOWN    = 0.18; // min seconds between asteroid clicks (avoid spam)
export const CLICK_DAMAGE      = 1;    // pockmark depth added per click

export const BASE_DRILL_COST   = 100;   // first drill — earned by manual mining
export const DRILL_COST_GROWTH = 1.15;
export const BASE_ROVER_COST   = 20000; // rovers are a midgame goal, not early
export const ROVER_COST_GROWTH = 1.6;
export const ROVER_UNLOCK_LIFETIME = 50000;  // lifetime $ required before rovers can be built

// --- drill animation / geometry ---
export const DEPLOY_DUR        = 0.8;
export const DRILL_DROP_HEIGHT = 11;
export const ASTEROID_RADIUS   = 8;
export const DRILL_HEIGHT       = 2.0; // surface -> emit/light point

// --- rovers ---
export const ROVER_SPEED   = 3.8;   // base speed — slowed; upgrades crank it back up
export const CARGO_CAP     = 1;     // ore per trip at level 0 — capacity upgrades raise it
export const LOAD_TIME     = 0.6;
export const UNLOAD_TIME   = 0.6;
export const ROVER_HOVER   = 0.35;  // ride height above the surface
export const WHEEL_RADIUS  = 0.18;
// rovers depart from / return to a point on the surface under the smelter
export const ROVER_HOME    = { x: 0, y: 1, z: 0, r: 8.0 }; // dir (unit-ish) + radius

// --- mining zone (dedicated drill slots on the lower hemisphere) ---
/* Drills used to land on random asteroid triangles, leaving an untidy
   scatter all over the surface. They now snap to a pre-computed Fibonacci
   spiral on a BAND below the equator — not the full hemisphere, since
   slots near the south pole get hidden behind the asteroid from most
   camera angles. Constrains y to [Y_FAR, Y_NEAR] (just below equator down
   to a comfortable mid-belt) so every drill stays in clear view. */
const _Y_NEAR = -0.12;  // upper bound (just below equator)
const _Y_FAR  = -0.62;  // lower bound (mid-belt — well above south pole)
function _generateMiningBand(n) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const out = [];
  // walk a finer-grained spiral and only keep points inside our band
  for (let i = 0; out.length < n && i < n * 6; i++) {
    const t = (i + 0.5) / (n * 3);
    const y = 1 - 2 * t;
    if (y > _Y_NEAR || y < _Y_FAR) continue;
    const r = Math.sqrt(1 - y * y);
    const theta = i * Math.PI * 2 / phi;
    out.push({ x: r * Math.cos(theta), y, z: r * Math.sin(theta) });
  }
  return out;
}
// 40 slots packed tightly in the visible mining band
export const DRILL_SLOTS = _generateMiningBand(40);
export const DRILL_SLOT_SURFACE_R = 7.6; // radius at which drills sit (matches lumpy asteroid hull)

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
export const BASE_CRATE_VALUE   = 20;   // $ per crate — slower money curve
export const MAX_VISIBLE_CRATES = 20;
export const ROCKET_LOAD_DUR     = 1.2;
export const ROCKET_COUNTDOWN    = 3.0;
export const ROCKET_ASCENT_DUR   = 3.5;
export const ROCKET_RESPAWN_DUR  = 5.0;
export const ROCKET_ASCENT_HEIGHT = 90;

// auto-launch behaviour to prevent overflow when refinedStock builds up faster
// than the rocket cycle can process:
//   - launch at 80% of batch (instead of waiting for 100%)
//   - or launch every 15s if at least 1 crate is queued (drains stragglers)
export const ROCKET_AUTO_LAUNCH_FRACTION = 0.80;
export const ROCKET_AUTO_LAUNCH_TIMEOUT  = 15.0;

// extra launchpads — bought as in-game capital expenditure (not an upgrade).
// each additional pad runs an independent rocket cycle, doubling throughput.
export const BASE_PAD_COST    = 25000;
export const PAD_COST_GROWTH  = 4.0;
export const MAX_LAUNCH_PADS  = 4;
// launchpad layout — 4 pads at cardinal compass points around the upper
// belt of the asteroid. Each rocket has its own quadrant so they don't
// occlude each other or get hidden behind the smelter. y is moderate
// (above equator but below the smelter dome) so all 4 are visible from
// any single camera angle.
export const LAUNCH_PAD       = { x: 5.5, y: 4.5, z: 0 };
export const LAUNCH_PAD_OFFSETS = [
  { x: 5.5,  y: 4.5, z: 0    },  // pad 1 — east
  { x: 0,    y: 4.5, z: 5.5  },  // pad 2 — south
  { x: -5.5, y: 4.5, z: 0    },  // pad 3 — west
  { x: 0,    y: 4.5, z: -5.5 },  // pad 4 — north
];
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

// --- alien tech (rare drill drops) ---
export const ALIEN_TECH_CHANCE   = 0.01;  // 1% per drill cycle
export const ALIEN_TECH_REWARD_X = 200;   // multiplier on current crateValue for jackpot $

// --- radio chatter ---
export const RADIO_INTERVAL_MIN  = 35;    // seconds between transmissions (range)
export const RADIO_INTERVAL_MAX  = 70;
export const RADIO_TYPING_CPS    = 32;    // characters/sec for the typewriter effect

// --- screen shake ---
export const SHAKE_MAX = 0.55;

// --- prestige / warp ---
export const WARP_THRESHOLD = 1e12;  // lifetime $ to unlock the Warp Gate
// warp gate placement (homeBody-local direction, projected to the surface)
export const WARP_PAD = { x: 4.2, y: 5.6, z: 2.4 };

// --- instanced pools ---
export const ORE_POOL   = 3000; // stockpile cubes + in-flight cargo cubes
export const DUST_POOL  = 1400; // deploy puffs, sparks, rover trails, rocket fire
export const CRATE_POOL = 96;   // refined crates on pads + loading + cargo (multi-pad needs more)
export const SMOKE_POOL = 700;  // rocket exhaust smoke
export const CHUNK_POOL = 64;   // clickable ore chunks from manual mining
