/* ============================================================
   events.js — random event templates.
   makeEvent(kind, snap) returns an event object scaled to the
   player's progression. Effects/scheduling/resolution live in sim;
   this file is just the catalogue + parameter sizing.
   ============================================================ */

const BUFFS = ["solarFlare", "resourceVein", "taxHoliday", "roverOverdrive"];
const DEBUFFS = ["meteorShower", "engineFailure", "fuelShortage"];
const CHOICES = ["wanderingTrader", "salvageSignal", "researchOpportunity", "pirates"];
const pick = (a) => a[(Math.random() * a.length) | 0];
const money = (n) => "$" + Math.floor(n).toLocaleString("en-US");

// buffs slightly more common than debuffs (~60/40); choices less common
export function rollKind() {
  const r = Math.random();
  if (r < 0.20) return "choice";
  if (r < 0.68) return "buff";
  return "debuff";
}

export function makeEvent(kind, snap) {
  const id = kind === "buff" ? pick(BUFFS) : kind === "debuff" ? pick(DEBUFFS) : pick(CHOICES);
  const e = { kind, id };
  switch (id) {
    case "solarFlare":
      Object.assign(e, { name: "SOLAR FLARE", desc: "All drills run at 5× speed for 60s", duration: 60 }); break;
    case "resourceVein":
      Object.assign(e, { name: "RESOURCE VEIN", desc: "A drill hits a rich vein — 10× ore for 90s", duration: 90 }); break;
    case "taxHoliday":
      Object.assign(e, { name: "TAX HOLIDAY", desc: "Rocket payouts doubled for 2 min", duration: 120 }); break;
    case "roverOverdrive":
      Object.assign(e, { name: "ROVER OVERDRIVE", desc: "Rover speed 3× for 60s", duration: 60 }); break;

    case "meteorShower":
      Object.assign(e, { name: "METEOR SHOWER", desc: "Drills knocked offline over the next 60s", duration: 60 }); break;
    case "engineFailure":
      Object.assign(e, { name: "ENGINE FAILURE", desc: "A rover is offline for 90s", duration: 90 }); break;
    case "fuelShortage":
      Object.assign(e, { name: "FUEL SHORTAGE", desc: "Launches 50% slower for 2 min", duration: 120 }); break;

    case "wanderingTrader": {
      const cost = Math.max(50, Math.round(3 * snap.drillCost));
      Object.assign(e, { name: "WANDERING TRADER", desc: `Buy 5 instant drills for ${money(cost)}?`, cost, drills: 5, acceptLabel: `BUY · ${money(cost)}`, declineLabel: "DECLINE" });
      break;
    }
    case "salvageSignal": {
      const reward = Math.max(200, Math.round(snap.payout * 3));
      Object.assign(e, { name: "SALVAGE SIGNAL", desc: `Detour a rocket to investigate. 70%: +${money(reward)}. 30%: lose cargo + 60s downtime.`, reward, acceptLabel: "INVESTIGATE", declineLabel: "IGNORE" });
      break;
    }
    case "researchOpportunity": {
      const rpCost = 5;
      Object.assign(e, { name: "RESEARCH OPPORTUNITY", desc: `Spend ${rpCost} RP for a guaranteed GOLD reward on your next contract.`, rpCost, acceptLabel: `PAY ${rpCost} RP`, declineLabel: "DECLINE" });
      break;
    }
    case "pirates": {
      const tribute = Math.max(100, Math.round(snap.payout * 2));
      const bounty = Math.max(500, Math.round(snap.payout * 5));
      Object.assign(e, { name: "ASTEROID PIRATES", desc: `Raiders demand tribute. Pay ${money(tribute)} — or fight (lose a rover, win ${money(bounty)}).`, tribute, bounty, acceptLabel: `PAY ${money(tribute)}`, declineLabel: "FIGHT!" });
      break;
    }
  }
  return e;
}
