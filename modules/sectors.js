/* ============================================================
   sectors.js — sector variants for prestige/warp.
   Each sector tints the asteroid and applies mechanical bonuses
   (multipliers; 1 = no change). drillSpeed/refine/payout/etc > 1
   are better; values < 1 are penalties. tint multiplies the
   asteroid's grey vertex colors; emissive adds a glow.
   ============================================================ */

export const SECTORS = {
  1: { id: 1, name: "INNER BELT",   tint: 0xffffff, emissive: 0x000000, bonuses: {} },
  2: { id: 2, name: "ICE BELT",     tint: 0x9fc4ee, emissive: 0x09131f, bonuses: { roverSpeed: 1.10 } },
  3: { id: 3, name: "HEAVY METAL",  tint: 0xb5615a, emissive: 0x1a0604, bonuses: { payout: 1.20, drillSpeed: 0.90 } },
  4: { id: 4, name: "CRYSTAL REEF", tint: 0xb98cff, emissive: 0x180a2a, bonuses: { refine: 1.30 } },
  5: { id: 5, name: "LAVA CORE",    tint: 0xff8a3a, emissive: 0x3a1404, bonuses: { drillPower: 1.25, roverSpeed: 0.80 } },
};

export const MAX_SECTOR = 12; // 5 hand-authored + procedural beyond

// deterministic procedural sectors for id > 5
function proceduralSector(id) {
  // golden-ratio hue spin keeps colours distinct
  const hue = ((id * 0.61803398875) % 1);
  const tint = hslToHex(hue, 0.45, 0.6);
  const emissive = hslToHex(hue, 0.6, 0.12);
  // rotate which axis gets the buff/penalty
  const axes = ["drillPower", "roverSpeed", "payout", "refine", "drillSpeed"];
  const buff = axes[id % axes.length];
  const pen = axes[(id + 2) % axes.length];
  const bonuses = {};
  bonuses[buff] = 1.2 + ((id * 7) % 5) * 0.05;   // +20%..+40%
  bonuses[pen] = 0.85;                            // -15%
  return { id, name: `SECTOR ${id}`, tint, emissive, bonuses, procedural: true };
}

export function getSector(id) {
  return SECTORS[id] || proceduralSector(id);
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
