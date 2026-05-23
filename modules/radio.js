/* ============================================================
   radio.js — periodic flavor transmissions.
   Triggers ambient "radio chatter" at semi-random intervals to make the
   colony feel alive. Lines are picked from progression-aware buckets so the
   patter matches what the player is actually doing.
   ============================================================ */

import * as C from "./config.js";
import { state, upgradeLevel } from "./sim.js";

const LINES_EARLY = [
  ["MISSION CONTROL", "Welcome to the field, captain. Tap the rock to begin."],
  ["MISSION CONTROL", "Manual extraction is slow — but cheaper than a union dispute."],
  ["FOREMAN", "Found a vein in the lower stratum. Might be worth a click."],
  ["SCIENTIST", "Preliminary spectrography suggests this asteroid is mostly… asteroid."],
  ["FOREMAN", "We're starting from zero, boss. Time to swing the proverbial pickaxe."],
  ["MISSION CONTROL", "Every empire began with one tap."],
];

const LINES_DRILL = [
  ["FOREMAN", "First drill is humming. We're in business."],
  ["MISSION CONTROL", "Automation feels good, doesn't it?"],
  ["ENGINEER", "Drill bearings holding within spec. For now."],
  ["FOREMAN", "Got that 'rotating chunk of money' feeling. Love it."],
  ["UNKNOWN", "Tracking your output... — *static* —"],
  ["MISSION CONTROL", "Wall Street called. They're interested."],
];

const LINES_MID = [
  ["ENGINEER", "Refinery's running hot. Smelter glow visible from orbit."],
  ["FOREMAN", "Crew's asking about hazard pay. I told them you'd ignore them."],
  ["MISSION CONTROL", "Cargo bay 7 reports nominal. Cargo bay 8 reports nominally caffeinated."],
  ["SCIENTIST", "Interesting trace element in the ore. Investigating."],
  ["TRADER", "Heard you've got product. We've got buyers. Talk to me."],
  ["MYSTERY", "...if you can hear this, the signal is *coming from inside the asteroid*..."],
];

const LINES_LATE = [
  ["MISSION CONTROL", "The corporate fleet is taking notice."],
  ["FOREMAN", "We just outproduced last quarter. By thirty thousand percent."],
  ["ENGINEER", "I love what you've done with the place. Mostly the explosions."],
  ["SCIENTIST", "The alien tech samples are responding to your gravity wells."],
  ["UNKNOWN", "We watch from beyond the heliosphere. You impress us, miner."],
  ["TRADER", "Name your price. Any price. We need this material."],
];

const LINES_ROVER = [
  ["FOREMAN", "Rovers are out. Look at them go."],
  ["ENGINEER", "Six-wheel articulation is overrated. Now eight-wheel — that's a project."],
  ["MISSION CONTROL", "Logistics feels like watching ants. Productive ants."],
];

const LINES_WARP = [
  ["MISSION CONTROL", "The warp gate is showing readings we haven't seen since Voyager."],
  ["SCIENTIST", "I've been studying the gate's emissions. It's... humming a tune."],
  ["MYSTERY", "The next sector remembers you."],
];

function pickList() {
  const earnings = state.lifetimeEarnings;
  const buckets = [];
  if (earnings < 500) buckets.push(LINES_EARLY);
  if (state.drills.length > 0 && earnings < 25000) buckets.push(LINES_DRILL);
  if (earnings >= 5000 && earnings < 500000) buckets.push(LINES_MID);
  if (earnings >= 500000) buckets.push(LINES_LATE);
  if (state.rovers.length > 0 || state.bgRovers > 0) buckets.push(LINES_ROVER);
  if (earnings >= C.WARP_THRESHOLD * 0.5) buckets.push(LINES_WARP);
  if (!buckets.length) buckets.push(LINES_EARLY);
  const bucket = buckets[(Math.random() * buckets.length) | 0];
  return bucket[(Math.random() * bucket.length) | 0];
}

let timer = Math.random() * C.RADIO_INTERVAL_MIN; // first one fires fairly soon
let currentEl = null;
let currentTextEl = null;
let typeIndex = 0;
let displayedLine = "";
let pendingLine = "";
let pendingFrom = "";
let typewriterTimer = 0;
let visibleUntil = 0;

export function init(rootEl, textEl) {
  currentEl = rootEl;
  currentTextEl = textEl;
}

export function tick(dt) {
  if (!currentEl || !currentTextEl) return;

  // typewriter reveal of the current line
  if (pendingLine && typeIndex < pendingLine.length) {
    typewriterTimer += dt;
    const chars = Math.floor(typewriterTimer * C.RADIO_TYPING_CPS);
    if (chars > typeIndex) {
      typeIndex = Math.min(pendingLine.length, chars);
      displayedLine = pendingLine.slice(0, typeIndex);
      currentTextEl.textContent = displayedLine;
    }
    return;
  }
  // hold the line on screen, then fade out
  if (visibleUntil > 0 && performance.now() / 1000 < visibleUntil) return;
  if (visibleUntil > 0) {
    visibleUntil = 0;
    currentEl.classList.remove("show");
    pendingLine = "";
    displayedLine = "";
  }

  // schedule the next transmission
  timer -= dt;
  if (timer > 0) return;
  timer = C.RADIO_INTERVAL_MIN + Math.random() * (C.RADIO_INTERVAL_MAX - C.RADIO_INTERVAL_MIN);
  const [from, line] = pickList();
  pendingFrom = from;
  pendingLine = `[${from}]  ${line}`;
  typeIndex = 0;
  typewriterTimer = 0;
  displayedLine = "";
  currentTextEl.textContent = "";
  currentEl.classList.add("show");
  // show duration scales with line length so longer lines stay readable
  const showTime = 2.5 + pendingLine.length / C.RADIO_TYPING_CPS + 0.4;
  visibleUntil = performance.now() / 1000 + showTime;
}
