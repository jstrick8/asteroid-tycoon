/* ============================================================
   contracts.js — contract templates + generation.
   generateContract(snap) returns a fresh contract sized to the
   player's current progression so it's always challenging-but-
   doable. Rewards are tiered: bronze (50%), silver (100%),
   gold (150%). Deadline/startMetric are filled in on accept (sim).
   ============================================================ */

let _id = 1;
function nextId() { return _id++; }
const ri = (n) => Math.max(1, Math.round(n));

/* snap = {
     drills, rovers, orePerMin, refinedPerMin, launchPerMin, batch, crateValue
   } */
export function generateContract(snap) {
  // weighted type pick — combo is rare and lucrative
  const roll = Math.random();
  let type;
  if (roll < 0.30) type = "mine";
  else if (roll < 0.55) type = "refine";
  else if (roll < 0.78) type = "launch";
  else if (roll < 0.92) type = "drills";
  else type = "combo";

  const cv = Math.max(1, snap.crateValue);
  let name, desc, target, minutes, comboRovers = 0, basis, difficulty;

  switch (type) {
    case "mine": {
      minutes = 5;
      target = Math.max(60, ri(snap.orePerMin * minutes * 0.55));
      basis = target * cv * 0.18;
      difficulty = 1;
      name = "Ore Quota";
      desc = `Mine ${target.toLocaleString()} ore in ${minutes} min`;
      break;
    }
    case "refine": {
      minutes = 5;
      target = Math.max(50, ri(snap.refinedPerMin * minutes * 0.55));
      basis = target * cv * 0.22;
      difficulty = 1;
      name = "Refinery Push";
      desc = `Refine ${target.toLocaleString()} material in ${minutes} min`;
      break;
    }
    case "launch": {
      minutes = 8;
      target = Math.max(3, ri(snap.launchPerMin * minutes * 0.6));
      basis = target * snap.batch * cv * 0.28;
      difficulty = 2;
      name = "Shipping Run";
      desc = `Launch ${target} cargo rockets in ${minutes} min`;
      break;
    }
    case "drills": {
      minutes = 6;
      target = Math.max(snap.drills + 3, ri(snap.drills * 1.5));
      basis = target * cv * 4.5;
      difficulty = 1;
      name = "Expand Operations";
      desc = `Have ${target} drills active at once`;
      break;
    }
    case "combo": {
      minutes = 10;
      target = Math.max(3, ri(snap.launchPerMin * minutes * 0.45));
      comboRovers = Math.max(3, ri(snap.rovers * 1.2 + 2));
      basis = target * snap.batch * cv * 0.55;
      difficulty = 3;
      name = "Coordinated Launch";
      desc = `Launch ${target} rockets while running ${comboRovers}+ rovers`;
      break;
    }
  }

  const silverCash = ri(basis);
  const bronzeCash = ri(basis * 0.35);
  const goldCash = ri(basis * 1.7);
  const silverRP = difficulty;
  const goldRP = difficulty * 2 + 1;

  return {
    id: nextId(),
    type, name, desc, target, minutes, comboRovers,
    reward: { bronzeCash, silverCash, silverRP, goldCash, goldRP, goldRep: 1 },
    tier: ["bronze", "silver", "gold"], // labels (50/100/150%)
    // filled on accept:
    deadline: 0, startMetric: 0, progress: 0, tiersGranted: 0, done: false, expired: false,
  };
}
