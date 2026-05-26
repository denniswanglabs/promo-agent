#!/usr/bin/env node
/**
 * auto-overlay-config.js
 *
 * Reads an action-log + base video + user goal, emits a JSON config that
 * AutoOverlay.tsx (Remotion) consumes. The goal is: anything the
 * explainer-agent records should become a polished overlay video without
 * a human writing a Remotion comp.
 *
 * Inputs:
 *   --action-log <path>   (required)
 *   --base-video  <path>  (required, mp4)
 *   --goal        <string> (required, original user goal text)
 *   --out         <path>  (required, where to write the JSON)
 *   --base-path   <string> (optional, value of baseVideo field in JSON; default "/auto-base.mp4")
 *   --fps         <int>   (default 60)
 *   --extra-freeze-sec <float> (default 6) — extra freeze frames AFTER base video
 *                                            so overlays can breathe past base length
 *
 * Derivation rules (heuristics — tuned to match v22 quality):
 *   - Title: trimmed goal, 3-7 words, prefixed with "Find " or "Navigate to "
 *   - One step label per click/drag/keyboard/freedraw action.
 *     Text = "Step N of M: <description>"
 *   - One sidebar callout per click that has resolvable click coords
 *   - One click ring at every click moment
 *   - One teaching panel at the end (bottom-right, 8s window)
 *     Headline = derived from goal or final action title
 *     Bullets  = derived from goal (split by punctuation) or a fallback
 *   - Outro stack: hardcoded Nemotron rows + tagline, last 4s
 *
 * Frame math:
 *   - baseFrames  = duration(base-video) * fps
 *   - totalFrames = baseFrames + extraFreezeFrames
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// ---------- arg parsing ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
for (const required of ["action-log", "base-video", "goal", "out"]) {
  if (!args[required]) {
    console.error(`missing --${required}`);
    process.exit(2);
  }
}

const ACTION_LOG = path.resolve(args["action-log"]);
const BASE_VIDEO = path.resolve(args["base-video"]);
const GOAL = String(args["goal"]);
const OUT = path.resolve(args["out"]);
const BASE_PATH = args["base-path"] || "/auto-base.mp4";
const FPS = parseInt(args["fps"] || "60", 10);
// Bumped 6s -> 10s so the teaching panel (6s) + fade bridge (1s) + outro
// (4.5s) all have room past the base video without getting clipped.
const EXTRA_FREEZE_SEC = parseFloat(args["extra-freeze-sec"] || "10");

// ---------- probe base video duration ----------
function probeDurationSec(file) {
  const raw = execSync(
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${file}"`,
    { encoding: "utf8" }
  );
  const d = parseFloat(raw.trim());
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`ffprobe could not determine duration of ${file}`);
  }
  return d;
}

// ---------- viewport scaling ----------
// Action-log coords are in CSS/recorded-viewport pixels (typically 1440x900).
// Base video renders at 2560x1440. We scale linearly.
function buildScaler(viewport) {
  const vw = (viewport && viewport.width) || 1440;
  const vh = (viewport && viewport.height) || 900;
  const TARGET_W = 2560;
  const TARGET_H = 1440;
  const sx = TARGET_W / vw;
  const sy = TARGET_H / vh;
  return {
    pt: (x, y) => [Math.round(x * sx), Math.round(y * sy)],
    rect: (r) => ({
      x: Math.round(r.x * sx),
      y: Math.round(r.y * sy),
      w: Math.round(r.w * sx),
      h: Math.round(r.h * sy),
    }),
    sx,
    sy,
  };
}

// ---------- title derivation ----------
function deriveTitle(goal, finalAction) {
  // Prefer the destination page title if we have it
  if (finalAction && finalAction.title) {
    const t = finalAction.title.split("|")[0].split(" - ")[0].trim();
    if (t && t.length <= 60 && t.split(/\s+/).length <= 8) {
      return `Find ${t}`;
    }
  }
  // Look for quoted phrases in the goal — usually the user is asking to find a specific named thing
  const quoted = goal.match(/['"]([^'"]+)['"]/);
  if (quoted) {
    return `Find ${quoted[1]}`;
  }
  // Strip common prefixes from goal
  let t = goal.trim();
  // Remove parenthetical hints
  t = t.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  // Trim trailing helper clauses like ", which is found under ..."
  t = t.split(/[,;:]/)[0].trim();
  // Strip leading "Find the", "Navigate to", "From the top of"
  t = t
    .replace(
      /^(find|navigate to|navigate from|from|locate|open|go to|show me)\s+/i,
      ""
    )
    .replace(/^(the\s+)/i, "")
    .replace(
      /\s+(from|in|of|on|to|under|via)\s+(the\s+)?(home\s+page|landing\s+page|start(ing)?\s+page|main\s+page).*$/i,
      ""
    )
    .trim();
  // Word-cap to 6 words
  const words = t.split(/\s+/);
  if (words.length > 6) t = words.slice(0, 6).join(" ");
  // Sentence case
  t = t.replace(/^[a-z]/, (c) => c.toUpperCase());
  return `Find ${t}`;
}

// ---------- step-label text ----------
function stepLabel(idx, total, action) {
  const desc = (action.description || action.kind || "action").trim();
  // Trim a trailing period
  const cleaned = desc.replace(/[.!]+$/, "");
  // Cap length so it fits one line in a badge
  const MAX = 70;
  const short = cleaned.length > MAX ? cleaned.slice(0, MAX - 1) + "…" : cleaned;
  return `Step ${idx + 1} of ${total}: ${short}`;
}

// ---------- teaching panel bullets ----------
function deriveBullets(goal, finalAction) {
  // Try splitting the goal by comma/semicolon — often the user lists 2-3
  // criteria. If we get 2-3 chunks, use them as bullets.
  const chunks = goal
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length >= 2 && chunks.length <= 4) {
    return chunks.slice(0, 3).map((c) => c.replace(/^and\s+/i, ""));
  }
  // Fallback: use the final action's reasoning / title / generic line
  const out = [];
  if (finalAction && finalAction.title) {
    out.push(`Destination page: ${finalAction.title}`);
  }
  if (finalAction && finalAction.judge && finalAction.judge.reasoning) {
    const reasoning = finalAction.judge.reasoning
      .split(/\.\s+/)[0]
      .slice(0, 110);
    out.push(reasoning);
  }
  out.push("Goal reached.");
  return out.slice(0, 3);
}

// ---------- per-action timing ----------
// Naive but works: distribute kept actions evenly across the base-video
// duration, with the title card occupying the first ~1.5s and the
// teaching+outro occupying the last ~5s (out of base + freeze).
//
// If the action-log carries `frameIndex` or `tSec` we'd use those; the
// current v11/v23/v26 logs do not, so we infer.

function distributeActions(actions, baseSec) {
  // Filter to the "interesting" actions — clicks, drags, keyboard, freedraw, scroll.
  // Scrolls are now included so we can render scroll-motion indicators and
  // keep the cursor visible during long scroll runs.
  // Skip the synthetic "done".
  const kept = actions.filter(
    (a) =>
      a.kind === "click" ||
      a.kind === "drag" ||
      a.kind === "type" ||
      a.kind === "keyboard" ||
      a.kind === "freedraw" ||
      a.kind === "scroll"
  );
  if (kept.length === 0) return [];

  // Reserve first 3.0s (title) and last 4.5s (teaching pre-roll + outro).
  // Actions land linearly in the middle.
  const FIRST_RESERVED = 3.0;
  const LAST_RESERVED = 4.5;
  const usableStart = FIRST_RESERVED;
  const usableEnd = Math.max(usableStart + kept.length * 0.6, baseSec - LAST_RESERVED);
  const span = usableEnd - usableStart;

  // Each action gets an action moment at: usableStart + (i+1)/(N+1) * span
  return kept.map((a, i) => {
    const tSec = usableStart + ((i + 1) / (kept.length + 1)) * span;
    return { action: a, tSec, indexInKept: i, totalKept: kept.length };
  });
}

// ---------- main ----------
const log = JSON.parse(fs.readFileSync(ACTION_LOG, "utf8"));
const baseSec = probeDurationSec(BASE_VIDEO);
const baseFrames = Math.round(baseSec * FPS);
const extraFreezeFrames = Math.round(EXTRA_FREEZE_SEC * FPS);
const totalFrames = baseFrames + extraFreezeFrames;

const scaler = buildScaler(log.viewport);
const actions = log.actions || [];
const distributed = distributeActions(actions, baseSec);

// Destination — prefer the `done` action (it carries the final-page title +
// URL), else the action judged `at_destination`, else the last non-done.
const doneAction = actions.find((a) => a.kind === "done");
const atDestAction = actions.find((a) => a.judge && a.judge.at_destination);
const lastReal =
  doneAction ||
  atDestAction ||
  [...actions].reverse().find((a) => a.kind !== "done") ||
  actions[actions.length - 1];

// Step labels — one per kept action.
// Skip pure scroll actions for label density (they get cursor + scroll
// indicators instead), but keep them in the distributed array so the
// cursor visibility logic in AutoOverlay can interpolate across them.
const stepLabels = distributed
  .filter(({ action }) => action.kind !== "scroll")
  .map(({ action, indexInKept, totalKept, tSec }) => {
    // Recount index-in-non-scroll for label text
    const nonScrollIdx = distributed
      .filter((d) => d.action.kind !== "scroll")
      .findIndex((d) => d === distributed[indexInKept]);
    const nonScrollTotal = distributed.filter((d) => d.action.kind !== "scroll").length;
    return {
      text: stepLabel(
        nonScrollIdx >= 0 ? nonScrollIdx : indexInKept,
        nonScrollTotal || totalKept,
        action
      ),
      startSec: Math.max(3.0, tSec - 2.2),
      durationSec: 2.0,
    };
  });

// Sidebar callouts — one per click that has coords + a target description
const sidebarCallouts = [];
for (const { action, tSec } of distributed) {
  if (action.kind !== "click") continue;
  const c = action.click || {};
  if (!c.x || !c.y) continue;
  // Fix #2: Prefer the action-log's reported rect, but VALIDATE it. The
  // recorded `click.rect` is in CSS px in the SAME viewport as the recorded
  // click point — so the click point should fall inside (or very close to)
  // the rect. If it doesn't (e.g. the agent's selector returned the wrong
  // element), or the rect is obviously implausible (too tiny, too far from
  // click point, off-viewport), fall back to a softer broad cover.
  let rect;
  let softFallback = false;
  if (c.rect && c.rect.w && c.rect.h) {
    const r = c.rect;
    const cx = c.x;
    const cy = c.y;
    const inside =
      cx >= r.x - 4 && cx <= r.x + r.w + 4 && cy >= r.y - 4 && cy <= r.y + r.h + 4;
    const sane = r.w > 4 && r.h > 4 && r.w < 1600 && r.h < 200;
    if (inside && sane) {
      rect = scaler.rect(r);
    } else {
      softFallback = true;
    }
  } else {
    softFallback = true;
  }
  if (softFallback) {
    // Softer broad cover (~280x60 CSS px, scaled). Doesn't pretend to be a
    // precise target — reads as a halo around the click point instead.
    const fallbackRect = {
      x: Math.max(0, c.x - 140),
      y: Math.max(0, c.y - 30),
      w: 280,
      h: 60,
    };
    rect = scaler.rect(fallbackRect);
  }
  // Label preference order: extract quoted text from description first
  // (cleanest: "Click 'Migrate to Stripe' link" -> "Migrate to Stripe"),
  // then fall back to target.text split on double-space (Stripe's separator
  // between link title and link description), then take first 5 words.
  let labelText;
  const descQuoted = (action.description || "").match(/['"]([^'"]+)['"]/);
  if (descQuoted) {
    labelText = descQuoted[1];
  } else if (action.target && action.target.text) {
    labelText = action.target.text.split(/\s{2,}/)[0];
    // If still long, truncate to ~5 words
    const ws = labelText.split(/\s+/);
    if (ws.length > 6) labelText = ws.slice(0, 5).join(" ");
  } else {
    labelText = (action.description || "Target").slice(0, 40);
  }
  const urlChip =
    (action.target && action.target.href) ||
    (action.url ? action.url.replace(/^https?:\/\/[^/]+/, "") : "");
  sidebarCallouts.push({
    rect: [rect.x, rect.y, rect.w, rect.h],
    startSec: Math.max(0, tSec - 1.4),
    durationSec: 1.3,
    labelText: labelText.slice(0, 60),
    urlChip: String(urlChip).slice(0, 80),
    soft: softFallback === true,
  });
}

// Click rings — at every click/drag moment
const clickRings = [];
for (const { action, tSec } of distributed) {
  if (action.kind === "click" && action.click) {
    const [x, y] = scaler.pt(action.click.x, action.click.y);
    clickRings.push({ x, y, size: 180, startSec: tSec, durationSec: 0.6 });
  } else if (action.kind === "drag" && action.from && action.to) {
    const [x1, y1] = scaler.pt(action.from.x, action.from.y);
    const [x2, y2] = scaler.pt(action.to.x, action.to.y);
    clickRings.push({ x: x1, y: y1, size: 180, startSec: tSec, durationSec: 0.5 });
    clickRings.push({
      x: x2,
      y: y2,
      size: 180,
      startSec: tSec + 0.35,
      durationSec: 0.5,
    });
  }
}

// ---------- Fix #3: cursor track + scroll indicators ----------
// Build a cursor track that's defined for the entire base video. Between
// known anchor points (click coords, drag from/to, scroll viewport center)
// AutoOverlay lerps the cursor position. This means the cursor is never
// fully hidden, even during long scroll runs.
const cursorTrack = [];
// Anchor at composition start: middle-top so it doesn't sit on title text
cursorTrack.push({ tSec: 0, x: Math.round(2560 * 0.5), y: Math.round(1440 * 0.35) });
for (const { action, tSec } of distributed) {
  if (action.kind === "click" && action.click) {
    const [x, y] = scaler.pt(action.click.x, action.click.y);
    cursorTrack.push({ tSec, x, y });
  } else if (action.kind === "drag" && action.from && action.to) {
    const [x1, y1] = scaler.pt(action.from.x, action.from.y);
    const [x2, y2] = scaler.pt(action.to.x, action.to.y);
    cursorTrack.push({ tSec, x: x1, y: y1 });
    cursorTrack.push({ tSec: tSec + 0.35, x: x2, y: y2 });
  } else if (action.kind === "scroll") {
    // Scroll: keep cursor parked near vertical center of viewport (where
    // a real user's hand would rest while scrolling with trackpad/wheel)
    // and shift it slightly to suggest motion.
    const cx = Math.round(2560 * 0.5);
    const cy = Math.round(1440 * 0.5);
    cursorTrack.push({ tSec, x: cx, y: cy });
  }
}
// Ensure track is sorted by time
cursorTrack.sort((a, b) => a.tSec - b.tSec);

// Scroll indicators — emitted for every scroll action. Each one is a small
// arrow badge that pulses up/down at the right edge of the viewport.
const scrollIndicators = [];
for (const { action, tSec } of distributed) {
  if (action.kind !== "scroll") continue;
  // Direction: prefer explicit `direction` field, else derive from
  // scrollYBefore -> scrollYAfter delta.
  let dir = action.direction;
  if (!dir && typeof action.scrollYBefore === "number" && typeof action.scrollYAfter === "number") {
    dir = action.scrollYAfter > action.scrollYBefore ? "down" : "up";
  }
  if (!dir) dir = "down";
  scrollIndicators.push({
    direction: dir,
    startSec: Math.max(0, tSec - 0.2),
    durationSec: 1.2,
    pixels: action.pixels || 0,
  });
}

// ---------- Camera events (Cursorful/Openscreen-inspired cinematic zoom) ----------
// Scan distributed actions for click clusters (2+ clicks within 3s AND 200 CSS-px
// of each other), and for scroll runs. Emit zoomIn → hold → zoomOut triples
// anchored at cluster centroid in *video pixels* (2560x1440).
//
// Heuristics:
//   - Click cluster:   scale 1.4, hold = max(1.5s, time-until-next-nav - 0.8s)
//   - Lone click:      subtle 1.2 emphasis, hold ~1.0s
//   - Scroll:          scale 1.15, anchored at viewport vertical center,
//                      slight directional bias (anchor shifts ±120px CSS for
//                      down/up scrolls)
//   - Easing:          easeInOutCubic on the IN/OUT ramps
//
// Budget rule: total time spent zoomed (sum of all in+hold+out durations)
// MUST NOT exceed 60% of baseSec. If we exceed the budget we drop the
// lowest-priority events first (lone-click emphasis, then scrolls).
const cameraEvents = [];
const clickEvents = distributed.filter((d) => d.action.kind === "click" && d.action.click);
const scrollEvents = distributed.filter((d) => d.action.kind === "scroll");

// Build click clusters
const CLUSTER_T_WINDOW = 3.0;     // seconds
const CLUSTER_PX_WINDOW = 200;    // CSS px (recorded viewport)
const claimed = new Set();
const clusters = [];
for (let i = 0; i < clickEvents.length; i++) {
  if (claimed.has(i)) continue;
  const seed = clickEvents[i];
  const members = [seed];
  claimed.add(i);
  for (let j = i + 1; j < clickEvents.length; j++) {
    if (claimed.has(j)) continue;
    const c = clickEvents[j];
    const last = members[members.length - 1];
    const dt = c.tSec - last.tSec;
    const dx = c.action.click.x - last.action.click.x;
    const dy = c.action.click.y - last.action.click.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dt <= CLUSTER_T_WINDOW && dist <= CLUSTER_PX_WINDOW) {
      members.push(c);
      claimed.add(j);
    } else {
      break;
    }
  }
  clusters.push(members);
}

// Helper: time to next nav action (any action that's not a scroll-after) for hold sizing
function timeUntilNextAction(afterTSec) {
  const next = distributed.find((d) => d.tSec > afterTSec);
  return next ? next.tSec - afterTSec : baseSec - afterTSec;
}

// Emit a camera triple. Returns the total seconds it occupies (zoomIn + hold + zoomOut).
function pushTriple({ targetCssX, targetCssY, anchorTSec, scale, holdSec, priority }) {
  const [ax, ay] = scaler.pt(targetCssX, targetCssY);
  // UV-space target: divide CSS coords by recorded-viewport dimensions
  // so the renderer can do edge-snap clamping in the source's coordinate
  // system, independent of the 2560×1440 video scale.
  const vw = (log.viewport && log.viewport.width) || 1440;
  const vh = (log.viewport && log.viewport.height) || 900;
  const uvX = Math.max(0, Math.min(1, targetCssX / vw));
  const uvY = Math.max(0, Math.min(1, targetCssY / vh));
  const ZOOM_IN_DUR = 1.0;
  const ZOOM_OUT_DUR = 0.8;
  // Camera should commit BEFORE the click moment so the action lands while
  // we're already zoomed-in. Start zoom-in 0.9s before the anchor time.
  const startSec = Math.max(0, anchorTSec - 0.9);
  const targetCenter = { x: uvX, y: uvY };
  cameraEvents.push({
    type: "zoomIn",
    startSec,
    durationSec: ZOOM_IN_DUR,
    target: { x: ax, y: ay },
    targetCenter,
    targetZoom: scale,
    scale,
    easing: "easeInOutCubic",
    priority,
  });
  cameraEvents.push({
    type: "hold",
    startSec: startSec + ZOOM_IN_DUR,
    durationSec: holdSec,
    target: { x: ax, y: ay },
    targetCenter,
    targetZoom: scale,
    scale,
    priority,
  });
  cameraEvents.push({
    type: "zoomOut",
    startSec: startSec + ZOOM_IN_DUR + holdSec,
    durationSec: ZOOM_OUT_DUR,
    target: { x: ax, y: ay },
    targetCenter,
    targetZoom: scale,
    scale,
    easing: "easeInOutCubic",
    priority,
  });
  return ZOOM_IN_DUR + holdSec + ZOOM_OUT_DUR;
}

// 1. Click clusters (highest priority)
for (const members of clusters) {
  const isCluster = members.length >= 2;
  const cx =
    members.reduce((s, m) => s + m.action.click.x, 0) / members.length;
  const cy =
    members.reduce((s, m) => s + m.action.click.y, 0) / members.length;
  const firstT = members[0].tSec;
  const lastT = members[members.length - 1].tSec;
  const tilNext = timeUntilNextAction(lastT);
  if (isCluster) {
    const holdSec = Math.max(1.5, Math.min(4.0, lastT - firstT + tilNext - 0.8));
    pushTriple({
      targetCssX: cx,
      targetCssY: cy,
      anchorTSec: firstT,
      scale: 1.25,
      holdSec,
      priority: 1, // cluster — keep first
    });
  } else {
    // Lone click — subtle emphasis (spec bump 1.12 -> 1.2 per 2533d8a)
    pushTriple({
      targetCssX: cx,
      targetCssY: cy,
      anchorTSec: firstT,
      scale: 1.15,
      holdSec: Math.max(1.0, Math.min(2.0, tilNext - 0.8)),
      priority: 3, // lone click — first to drop
    });
  }
}

// 2. Scroll runs — collapse consecutive scrolls into one camera event
//    (otherwise camera ping-pongs). Anchor at viewport vertical center
//    with directional bias.
{
  let i = 0;
  while (i < scrollEvents.length) {
    const seed = scrollEvents[i];
    let j = i + 1;
    while (j < scrollEvents.length && scrollEvents[j].tSec - scrollEvents[j - 1].tSec < 2.5) {
      j++;
    }
    const runStart = seed.tSec;
    const runEnd = scrollEvents[j - 1].tSec;
    // Direction — pick the majority
    const downCount = scrollEvents
      .slice(i, j)
      .filter((s) => {
        const dir = s.action.direction || "down";
        return dir.toLowerCase().startsWith("d");
      }).length;
    const isDown = downCount >= (j - i) / 2;
    const vw = (log.viewport && log.viewport.width) || 1440;
    const vh = (log.viewport && log.viewport.height) || 900;
    const yBias = isDown ? 120 : -120;
    const targetCssX = vw / 2;
    const targetCssY = vh / 2 + yBias;
    const tilAfter = timeUntilNextAction(runEnd);
    const holdSec = Math.max(1.0, Math.min(3.0, runEnd - runStart + tilAfter - 0.8));
    pushTriple({
      targetCssX,
      targetCssY,
      anchorTSec: runStart,
      scale: 1.10,
      holdSec,
      priority: 2, // scroll — drop after lone clicks
    });
    i = j;
  }
}

// Sort by startSec
cameraEvents.sort((a, b) => a.startSec - b.startSec);

// Resolve overlaps: if two events overlap, drop the lower-priority one entirely
// (priority number = lower is more important). Cheap O(n^2) is fine for <30 events.
function eventEnd(e) {
  return e.startSec + e.durationSec;
}
// Re-group: each triple shares same (target,priority). Identify triples by
// matching the zoomIn→hold→zoomOut chain at same target.
function tripleGroups() {
  const groups = [];
  for (let k = 0; k < cameraEvents.length; ) {
    const a = cameraEvents[k];
    const b = cameraEvents[k + 1];
    const c = cameraEvents[k + 2];
    if (
      a && b && c &&
      a.type === "zoomIn" && b.type === "hold" && c.type === "zoomOut" &&
      a.priority === b.priority && b.priority === c.priority &&
      Math.abs(a.target.x - c.target.x) < 1 && Math.abs(a.target.y - c.target.y) < 1
    ) {
      groups.push({ startIdx: k, events: [a, b, c] });
      k += 3;
    } else {
      // Fallback — orphan; treat as its own group
      groups.push({ startIdx: k, events: [a] });
      k += 1;
    }
  }
  return groups;
}

// Sort groups by start time and drop later ones that overlap an earlier one
// of higher priority. Build a "keep set".
let groups = tripleGroups();
groups.sort((g1, g2) => g1.events[0].startSec - g2.events[0].startSec);
const kept = [];
for (const g of groups) {
  const gStart = g.events[0].startSec;
  const gEnd = eventEnd(g.events[g.events.length - 1]);
  const gPri = g.events[0].priority;
  let conflicts = false;
  for (const kg of kept) {
    const kStart = kg.events[0].startSec;
    const kEnd = eventEnd(kg.events[kg.events.length - 1]);
    if (gStart < kEnd && gEnd > kStart) {
      // overlap — keep whichever has lower priority number
      if (kg.events[0].priority <= gPri) {
        conflicts = true;
        break;
      } else {
        // current is more important; remove the earlier one
        const idx = kept.indexOf(kg);
        if (idx >= 0) kept.splice(idx, 1);
      }
    }
  }
  if (!conflicts) kept.push(g);
}

// Enforce 60% budget: drop highest-priority-number (least important) groups
// until total camera-event coverage <= 0.60 * baseSec.
function coveredSec(gs) {
  return gs.reduce(
    (s, g) =>
      s +
      g.events.reduce((ss, e) => ss + e.durationSec, 0) -
      // Don't double-count the brief overlap between hold and zoomIn end
      0,
    0
  );
}
const BUDGET_FRAC = 0.6;
const budgetSec = baseSec * BUDGET_FRAC;
kept.sort((g1, g2) => g2.events[0].priority - g1.events[0].priority); // worst first
while (coveredSec(kept) > budgetSec && kept.length > 0) {
  // pop the least important
  kept.shift();
}
// Re-sort by time and flatten
kept.sort((g1, g2) => g1.events[0].startSec - g2.events[0].startSec);
const finalCameraEvents = [];
for (const g of kept) {
  for (const e of g.events) {
    // Strip internal "priority" field from output (config consumers don't need it)
    const { priority: _p, ...clean } = e;
    finalCameraEvents.push(clean);
  }
}

// Teaching panel — anchored late in the base video, holds into freeze territory.
// With the 10s freeze + 1s fade bridge + 4.5s outro, teaching needs to end
// no later than (baseSec + EXTRA_FREEZE_SEC) - FADE_BRIDGE_DUR - OUTRO_DUR + 0.5
// (the +0.5 = overlap between bridge peak and outro entry).
const TEACH_DUR = 5.5;
// Anchor teaching to end exactly where fade bridge starts. Work backwards.
const _totalSec = baseSec + EXTRA_FREEZE_SEC;
const _outroDurPreview = 4.5;
const _fadeBridgeDurPreview = 1.0;
const _outroStartTarget = _totalSec - _outroDurPreview - 0.3;
const _fadeBridgeStartTarget = _outroStartTarget - 0.5;
const teachStart = Math.max(3.0, _fadeBridgeStartTarget - TEACH_DUR + 0.2);
const headlineRaw =
  (lastReal && lastReal.title && lastReal.title.split("|")[0].split(" - ")[0].trim()) ||
  deriveTitle(GOAL, lastReal).replace(/^Find\s+/, "");
const destUrl = lastReal && lastReal.url ? lastReal.url : "";
const destUrlChip = destUrl
  ? destUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
  : "";
const teachingPanel = {
  headline: headlineRaw,
  url: destUrlChip,
  bullets: deriveBullets(GOAL, lastReal),
  startSec: teachStart,
  durationSec: TEACH_DUR,
  position: "bottom-right",
  widthFrac: 0.58,
};

// Fix #4: fade-to-dark bridge between teaching panel exit and outro entry.
// The teaching panel ends at teachStart + TEACH_DUR. We hold a brief gap,
// then run a 1s black-fade that ramps 0->100% in 0.4s, holds 0.2s, ramps
// 100%->0% in 0.4s as the outro fades in. The outro starts just before
// the fade midpoint so the cross is seamless.
const FADE_BRIDGE_DUR = 1.0;
const teachEnd = teachStart + TEACH_DUR;
const fadeBridgeStart = teachEnd - 0.2; // small overlap with teaching exit

// Outro — last ~4.5s of total composition. Push start to AFTER the fade
// reaches peak black (~0.5s into the bridge) so it never collides with the
// teaching panel content.
const OUTRO_DUR = 4.5;
const outroStart = Math.max(
  fadeBridgeStart + 0.5,
  baseSec + EXTRA_FREEZE_SEC - OUTRO_DUR - 0.3
);
const outro = {
  stack: [
    "Nemotron 3 Super 120B — picks the next action",
    "Nemotron 3 Nano Omni — judges visual progress",
    "NemoClaw + OpenClaw — sandboxes the agent loop",
    "NVIDIA NIM — proxies the model calls",
  ],
  tagline: "Safe by construction, not by prompt.",
  startSec: outroStart,
  durationSec: OUTRO_DUR,
};

const fadeBridge = {
  startSec: fadeBridgeStart,
  durationSec: FADE_BRIDGE_DUR,
};

// Fix #1: title card MUST be visible early. Bump to 3.0s and guarantee a
// non-empty fallback so a short goal never collapses to "Find " alone.
let titleText = deriveTitle(GOAL, lastReal);
if (!titleText || /^Find\s*$/i.test(titleText.trim())) {
  titleText = "Watch the agent navigate";
}

const config = {
  baseVideo: BASE_PATH,
  baseFrames,
  totalFrames,
  fps: FPS,
  extraFreezeFrames,
  viewport: log.viewport || { width: 1440, height: 900 },
  goal: GOAL,
  title: {
    text: titleText,
    startSec: 0,
    durationSec: 3.0,
  },
  stepLabels,
  sidebarCallouts,
  clickRings,
  cursorTrack,
  scrollIndicators,
  cameraEvents: finalCameraEvents,
  teachingPanel,
  outro,
  fadeBridge,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(config, null, 2));

console.log(`wrote ${OUT}`);
console.log(`baseFrames=${baseFrames} totalFrames=${totalFrames} fps=${FPS}`);
console.log(
  `steps=${stepLabels.length} callouts=${sidebarCallouts.length} rings=${clickRings.length} cursorAnchors=${cursorTrack.length} scrollInds=${scrollIndicators.length} cameraEvents=${finalCameraEvents.length}`
);
