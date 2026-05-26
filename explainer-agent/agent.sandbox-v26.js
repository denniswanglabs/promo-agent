// /sandbox/explainer-agent/agent.js
// Explainer-agent loop with optional Tier 1 multi-tab beam search.
//
// Modes:
//   BEAM=0 (default): single-tab loop (v13 — Nemotron-all-the-way-down).
//   BEAM=1: K-way beam search with pre-click ranking + Cmd+K search scout.
//
// Contract (BEAM=0):
//   - Nemotron-3-Super-120B picks the next action (click | scroll | done).
//   - After each action, Nemotron-3-Nano-Omni-30B-A3B judges
//     {at_destination, on_right_track}.
//   - Off-track -> rollback URL + scrollY, re-prompt with attempted_actions.
//
// Contract (BEAM=1):
//   - Per round: Super 120B returns ranked top-K candidates with scores+reasoning.
//   - Slot 0 is reserved for the Cmd+K search scout (best-effort site search).
//     If scout returns null, slot 0 falls back to the highest-ranked Super candidate.
//   - K independent browser.newContext() execute candidates in parallel.
//   - All K after-shots judged in parallel by Nano Omni.
//   - Winner = first at_destination, else highest-on-track. Losers' contexts close.
//   - All off-track -> rollback to previous URL, request fresh top-K excluding rejected.
//
// Outputs:
//   action-log.json       — winning route only (linear, performer input).
//   attempted-log.json    — every attempt (back-compat with watchdog).
//   exploration-log.json  — BEAM=1: all K branches per round (narrative bonus).

import { chromium } from 'playwright';
import {
  writeFileSync,
  mkdirSync,
  appendFileSync,
  existsSync,
  copyFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const GOAL      = process.env.GOAL      || 'Find the installation command for the Button component';
const START_URL = process.env.START_URL || 'https://ui.shadcn.com';
const MAX_STEPS = Number(process.env.MAX_STEPS || 20);
const BEAM      = String(process.env.BEAM || '0') === '1';
const BEAM_K    = Math.max(2, Number(process.env.BEAM_K || 4));
const OUT_DIR   = '/sandbox/explainer-agent/run';
const OBS_DIR   = '/sandbox/explainer-agent/observe';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

if (!NVIDIA_API_KEY) {
  console.error('NVIDIA_API_KEY not set in env');
  process.exit(1);
}

mkdirSync(join(OUT_DIR, 'screenshots'), { recursive: true });
mkdirSync(join(OUT_DIR, 'attempted-screenshots'), { recursive: true });
mkdirSync(join(OUT_DIR, 'beam-screenshots'), { recursive: true });
mkdirSync(join(OUT_DIR, 'scout-frames'), { recursive: true });
mkdirSync(OBS_DIR, { recursive: true });

const LOG_PATH = join(OBS_DIR, 'log.txt');
writeFileSync(LOG_PATH, '');
const log = (msg) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`;
  process.stdout.write(line);
  appendFileSync(LOG_PATH, line);
};

let judgeCallCount = 0;
let superCallCount = 0;

// ----------------------------------------------------------------------------
// Per-slot CDP screencast helper (v21 parallel-scouts video).
// Records the page as a sequence of jpeg frames + metadata jsonl.
// Returns a stop() closure that flushes a manifest and closes the CDP session.
// ----------------------------------------------------------------------------
async function attachScoutScreencast(context, page, roundIdx, slotIdx) {
  const dir = join(OUT_DIR, 'scout-frames', `r${roundIdx}_s${slotIdx}`);
  mkdirSync(dir, { recursive: true });
  const metaPath = join(dir, 'meta.jsonl');
  writeFileSync(metaPath, '');
  let frameN = 0;
  const startedAtMs = Date.now();
  let session;
  try {
    session = await context.newCDPSession(page);
  } catch (e) {
    log(`[scout-rec r${roundIdx}_s${slotIdx}] could not open CDP session: ${e.message}`);
    return { stop: async () => {}, dir, frameN: 0, startedAtMs };
  }
  session.on('Page.screencastFrame', async (frame) => {
    const n = frameN++;
    const tMs = Date.now() - startedAtMs;
    try {
      const buf = Buffer.from(frame.data, 'base64');
      writeFileSync(join(dir, `f${String(n).padStart(5, '0')}.jpg`), buf);
      appendFileSync(metaPath, JSON.stringify({ n, tMs, ts: frame.metadata?.timestamp || null }) + '\n');
      await session.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    } catch (e) {}
  });
  try {
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 1,
    });
  } catch (e) {
    log(`[scout-rec r${roundIdx}_s${slotIdx}] startScreencast failed: ${e.message}`);
  }
  return {
    dir,
    startedAtMs,
    get frameN() { return frameN; },
    stop: async () => {
      try { await session.send('Page.stopScreencast'); } catch {}
      try { await session.detach(); } catch {}
      const elapsedMs = Date.now() - startedAtMs;
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
        roundIdx, slotIdx, frameN, elapsedMs, startedAtMs,
      }, null, 2));
    },
  };
}

async function callNemotron(messages, { maxTokens = 1600 } = {}) {
  superCallCount++;
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${NVIDIA_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'nvidia/nemotron-3-super-120b-a12b',
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Nemotron HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return {
    text: (msg.content ?? '').trim(),
    reasoning: (msg.reasoning_content ?? '').trim(),
    finish: data.choices?.[0]?.finish_reason,
  };
}

async function callNemotronOmniJudge({ goal, screenshotPath }) {
  judgeCallCount++;
  const imgB64 = readFileSync(screenshotPath).toString('base64');
  const body = {
    model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    messages: [
      {
        role: 'system',
        content:
          `You are a strict visual judge for an autonomous web-navigation agent. ` +
          `Return ONLY a single valid JSON object matching the schema ` +
          `{"at_destination": boolean, "on_right_track": boolean, "reasoning": string}. ` +
          `Do not include markdown formatting, code fences, or any text outside the JSON object.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `GOAL: "${goal}"\n\n` +
              `Judge whether the screenshot shows that the agent has reached its destination AND whether it is on the right track.\n\n` +
              `Definitions (STRICT — these are the only valid criteria):\n` +
              `- on_right_track=true if EITHER (a) the page's primary content (H1 / main heading / focus) is about the goal topic, OR (b) the page is a long doc page where the body content (visible section headings, code-block titles, table-of-contents in main column) clearly leads toward the goal — for example the goal target name appears as a visible subsection heading or code-block title in the main body. Mentions in the sidebar nav, "related docs" lists, breadcrumbs, or footnotes do NOT count. If the page is primarily about a different unrelated topic that only references the goal in passing, on_right_track=false.\n` +
              `- at_destination=true ONLY if the page's primary content includes BOTH (a) the specific target described in the goal as a visible heading or code-block title AND (b) a code block or example demonstrating it. Sidebar mentions alone do not count.\n` +
              `- For DRAWING tasks (e.g. "draw a square", "draw a rectangle on the canvas", "draw the NVIDIA wordmark", "draw the NVIDIA eye logo", "freedraw an almond shape"): at_destination=true ONLY if the screenshot shows the specific shape OR text described in the goal (e.g. a square, rectangle, circle, the word "NVIDIA", an elongated almond/eye outline) clearly visible on a canvas with appropriate proportions. on_right_track=true LIBERALLY for drawing tasks — return TRUE if any of: (a) the relevant drawing tool appears selected/highlighted in the toolbar (including the freedraw / pencil tool for curve/logo goals), (b) a partial shape, partial freedraw stroke, OR partial text is in progress on the canvas, (c) a dropdown/menu related to shapes/tools/colors is open, (d) the page is the drawing app (Excalidraw, etc.) with the canvas visible and ready to draw, (e) any drawing tool other than the default selection arrow is active, (f) the canvas is empty but the drawing app is loaded, (g) a text caret / blinking insertion point is visible on the canvas, (h) a color-picker / stroke panel is visible, (i) ANY freedraw / pencil strokes are visible on the canvas — even messy or incomplete polylines count toward a freeform-logo goal. Welcome screens, instructional overlays like "Pick a tool & Start drawing!", and empty canvases ALL count as on_right_track for drawing goals because the canvas is reachable. Only return on_right_track=false if the page is clearly broken or navigated away from the drawing surface.\n` +
              `- The "reasoning" field MUST cite WHAT you saw on screen as the page's primary content (e.g. "primary H1 reads 'RAG Pipelines' — sidebar lists LoRA but body is about RAG", or "subsection heading 'LoRA Training' visible in main column with a python code block below", or "Excalidraw canvas visible with a completed rectangle in the center"). Be specific about the visible primary heading and any subsection headings / code-block titles in the main body, or the canvas state.\n\n` +
              `Return ONLY: {"at_destination": false, "on_right_track": false, "reasoning": "(cite what you see as the page's primary content)"}`,
          },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imgB64}` } },
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    chat_template_kwargs: { enable_thinking: false },
  };
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${NVIDIA_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    log(`[nemotron-omni] judge HTTP ${res.status}: ${t.slice(0, 250)}`);
    return { at_destination: false, on_right_track: true, reasoning: `judge-fail; defaulted to on-track (HTTP ${res.status})` };
  }
  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  const finishReason = data?.choices?.[0]?.finish_reason || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const cleaned = text
      .replace(/^[\s\S]*?(?=\{)/, '')
      .replace(/```(?:json)?/g, '')
      .trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {}
    if (!parsed) {
      const matches = text.match(/\{[\s\S]*\}/g) || [];
      matches.sort((a, b) => b.length - a.length);
      for (const m of matches) {
        try { parsed = JSON.parse(m); if (parsed) break; } catch {}
      }
    }
    if (!parsed) {
      log(`[nemotron-omni] could not parse (finish=${finishReason}): ${text.slice(0, 250)}`);
      parsed = { at_destination: false, on_right_track: true, reasoning: `judge parse error (finish=${finishReason}) — defaulted to on-track` };
    }
  }
  return {
    at_destination: !!parsed.at_destination,
    on_right_track: !!parsed.on_right_track,
    reasoning: String(parsed.reasoning || ''),
  };
}

function parseJsonLoose(raw) {
  if (!raw) throw new Error('Empty response');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const matches = cleaned.match(/\{[\s\S]*\}/g) || [];
  matches.sort((a, b) => b.length - a.length);
  for (const m of matches) {
    try { return JSON.parse(m); } catch {}
  }
  const idMatch = cleaned.match(/"id"\s*:\s*(\d+)/);
  const scrollMatch = cleaned.match(/"scroll"\s*:\s*"(up|down)"/i);
  const doneMatch = cleaned.match(/"done"\s*:\s*true/i);
  const dragMatch = cleaned.match(/"drag"\s*:\s*\{\s*"from"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]\s*,\s*"to"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/i);
  const freedrawMatch = cleaned.match(/"freedraw"\s*:\s*(\[\s*\[[\s\S]*?\]\s*\])/i);
  const keyboardMatch = cleaned.match(/"keyboard"\s*:\s*"([^"]+)"/i);
  const clickAtMatch = cleaned.match(/"clickAt"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/i);
  const typeMatch = cleaned.match(/"type"\s*:\s*"([^"]*)"/);
  if (doneMatch) return { done: true, reasoning: 'parsed from partial JSON' };
  if (dragMatch) {
    return {
      drag: { from: [Number(dragMatch[1]), Number(dragMatch[2])], to: [Number(dragMatch[3]), Number(dragMatch[4])] },
      description: 'Drag (recovered)', reasoning: 'parsed from partial JSON',
    };
  }
  if (freedrawMatch) {
    try {
      const points = JSON.parse(freedrawMatch[1]);
      if (Array.isArray(points) && points.length >= 2) {
        return {
          freedraw: points,
          description: `Freedraw ${points.length}-point polyline (recovered)`,
          reasoning: 'parsed from partial JSON',
        };
      }
    } catch {}
  }
  if (keyboardMatch) {
    return { keyboard: keyboardMatch[1], description: `Press ${keyboardMatch[1]} (recovered)`, reasoning: 'parsed from partial JSON' };
  }
  if (clickAtMatch) {
    return { clickAt: [Number(clickAtMatch[1]), Number(clickAtMatch[2])], description: `Click at (${clickAtMatch[1]}, ${clickAtMatch[2]}) (recovered)`, reasoning: 'parsed from partial JSON' };
  }
  if (typeMatch) {
    return { type: typeMatch[1], description: `Type "${typeMatch[1]}" (recovered)`, reasoning: 'parsed from partial JSON' };
  }
  if (scrollMatch) {
    const pxMatch = cleaned.match(/"px"\s*:\s*(\d+)/);
    return { scroll: scrollMatch[1].toLowerCase(), px: pxMatch ? Number(pxMatch[1]) : 600, description: 'Scroll the page', reasoning: 'parsed from partial JSON' };
  }
  if (idMatch) {
    const descMatch = cleaned.match(/"description"\s*:\s*"([^"]+)"/);
    return { id: Number(idMatch[1]), description: descMatch ? descMatch[1] : 'Click element', reasoning: 'parsed from partial JSON' };
  }
  throw new Error(`Could not parse JSON. Raw:\n${raw}`);
}

// ----------------------------------------------------------------------------
// computeSceneTiming — v25 agent-driven scene-timing architecture.
//
// Augments every kept action with {scene_weight, min_hold_seconds} so the
// performer (replay-60fps.js) knows how long to hold each beat for and the
// Remotion overlay (OverlayedV22.tsx) knows how much head-room to allocate
// for teaching panels.
//
// The agent itself does NOT choose these values — the runtime computes them
// from observable page state (word count, climactic destination flag,
// transient cursor moves). The agent's system prompt acknowledges the system
// so its reasoning aligns.
//
// Categories:
//   climactic    — goal-reached / payoff page (8-14s hold)
//   informative  — body content, doc page (3-10s hold based on word count)
//   transient    — cursor moves, tool selection, palette click (1-2s)
//   transitional — page in-between, settled but not destination (2s)
// ----------------------------------------------------------------------------
function computeSceneTiming(entry, goalKeyword) {
  const kind = entry.kind || 'click';
  const judge = entry.judge || {};
  const urlAfter = String(entry.urlAfter || entry.url || '').toLowerCase();
  const description = String(entry.description || '');
  const reasoning = String(entry.reasoning || '');
  // Page text approximation: agent doesn't preserve full pageText on filtered
  // entries, so we use description + judge.reasoning as a content proxy. Words
  // of length >2 only — drops "a", "an", "to", "the".
  const proxyText = (description + ' ' + reasoning).trim();
  const wordCount = proxyText.split(/\s+/).filter((w) => w.length > 2).length;

  const goalKw = String(goalKeyword || '').toLowerCase().trim();
  const isGoalSubstring =
    goalKw.length > 2 &&
    (urlAfter.includes(goalKw) || description.toLowerCase().includes(goalKw));

  let sceneWeight = 'informative';
  let minHold = Math.max(3, Math.ceil(wordCount / 4) + 1);

  // Climactic: destination reached. Long hold so viewers can read.
  if (judge.at_destination === true || isGoalSubstring) {
    sceneWeight = 'climactic';
    minHold = Math.min(14, Math.max(8, Math.ceil(wordCount / 4) + 2));
  }

  // Transient: cursor-only beats (scroll that didn't load new content; tool
  // selection via keyboard; canvas-coord click for caret placement; type).
  if (kind === 'scroll') {
    // scroll-only is usually transitional unless judge marks destination above
    if (sceneWeight !== 'climactic') {
      sceneWeight = 'transitional';
      minHold = 2;
    }
  }
  if (kind === 'keyboard' || kind === 'clickAt' || kind === 'type') {
    if (sceneWeight !== 'climactic') {
      sceneWeight = 'transient';
      minHold = Math.max(2, Math.min(minHold, 3));
    }
  }
  if (kind === 'drag') {
    // drawing on canvas — give it a beat
    if (sceneWeight !== 'climactic') {
      sceneWeight = 'informative';
      minHold = Math.max(3, Math.min(minHold, 5));
    }
  }
  if (kind === 'freedraw') {
    // freedraw is a longer drawing beat than drag — viewer needs time to see
    // the stroke land and recognize the shape.
    if (sceneWeight !== 'climactic') {
      sceneWeight = 'informative';
      minHold = Math.max(4, Math.min(minHold, 7));
    }
  }
  if (kind === 'done') {
    // synthetic / terminal done — climactic by definition
    sceneWeight = 'climactic';
    minHold = Math.min(14, Math.max(8, minHold));
  }

  // Cap informative at 10s — no body page should hold past that.
  if (sceneWeight === 'informative') minHold = Math.min(10, minHold);
  // Final safety: never < 1, never > 14.
  minHold = Math.max(1, Math.min(14, Math.round(minHold)));

  return { scene_weight: sceneWeight, min_hold_seconds: minHold };
}

function deriveGoalKeyword(goal) {
  // Pick the last noun-ish token from the goal (3+ letters, not in stopword
  // list). For Stripe goal "Navigate ... to 'Map payment data' (found ...)",
  // this yields "data" or "import" — okay as a weak signal. The climactic
  // detection primarily leans on judge.at_destination.
  if (!goal) return '';
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'find', 'show', 'navigate', 'page', 'docs', 'documentation']);
  const tokens = String(goal).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
  return tokens[tokens.length - 1] || '';
}


// ----------------------------------------------------------------------------
// Single-action picker (BEAM=0 path) — unchanged from v13.
// ----------------------------------------------------------------------------
async function pickNextAction({
  goal, url, title, pageText, clickables, history, blacklist = [],
  scrollY = 0, fullPageHeight = 0, viewportHeight = 900,
  attemptedActions = [],
}) {
  const listing = clickables.map((c, i) =>
    `[${i}]${blacklist.includes(i) ? ' [BANNED - already tried, no effect]' : ''} <${c.tag}> "${(c.text || c.aria || '(no text)').slice(0, 70)}"${c.href ? ` href=${c.href.slice(0, 60)}` : ''}`
  ).join('\n');
  const hist = history.length ? history.map((h, i) => `  ${i + 1}. ${h}`).join('\n') : '  (none yet)';
  const canScrollDown = fullPageHeight > scrollY + viewportHeight + 40;
  const canScrollUp   = scrollY > 40;
  const scrollHint = `Scroll position: ${scrollY}px / ${fullPageHeight}px total (viewport ${viewportHeight}px). ${canScrollDown ? 'CAN scroll DOWN.' : 'At bottom — cannot scroll down.'} ${canScrollUp ? 'CAN scroll UP.' : ''}`;

  const attemptedBlock = attemptedActions.length
    ? `\nYou previously attempted the following actions from THIS exact page state. Each one was judged to NOT advance toward the goal. Pick something DIFFERENT:\n${attemptedActions.map((a, i) => `  X${i + 1}. ${a}`).join('\n')}\n`
    : '';

  const messages = [
    {
      role: 'system',
      content: `You drive a web browser to demonstrate a UI task end-to-end.
Reply with valid JSON ONLY — no prose, no markdown fences.
You have EIGHT possible actions: click a listed element by id, scroll the page, drag (to draw a primitive shape on a canvas), press a keyboard shortcut, click at raw canvas coordinates, type text into the focused input, freedraw a freeform polyline path on a canvas (for curves / logos / signatures), or finish.
Prefer specific elements over generic navigation.
NEVER pick an element marked [BANNED] — those were tried and didn't change the page.

When to SCROLL:
  - The page text mentions the goal content but you don't see it in the visible snippet.
  - No clickable element on screen matches the goal.
  - You just clicked into a new page and haven't scrolled yet (often the goal is below the fold).
  - You can see we're partway through a long doc page and the relevant section is likely below.

When to CLICK (by id):
  - A clickable element directly advances toward the goal.

When to DRAG:
  - You're on a canvas/drawing surface and need to create a shape.
  - You see a "rectangle tool" or similar tool is selected, and the canvas has whitespace where a shape can go.
  - The goal involves drawing or creating something visual.
  - Viewport is 1440x900 — pick from/to coordinates within that range, leaving whitespace around the shape.

When to use KEYBOARD shortcut:
  - The site has known hotkeys that are faster than clicking a toolbar.
  - You need to open a command palette (Cmd+K, Cmd+/).
  - You need to press Escape to cancel a state.

When to use CLICKAT (raw canvas coords):
  - The canvas/drawing surface has no listed clickable id for the spot you need.
  - You need to place a text-tool cursor on the canvas to start typing.
  - You need to click a color swatch / panel item that doesn't show up as a labelled id.
  - Coords are in the 1440x900 sandbox viewport.

When to TYPE:
  - You just selected the text tool and clicked on the canvas (a text caret should be active).
  - You just clicked a search/input field.
  - Pass the exact text to type as a plain string.

When to FREEDRAW (freeform polyline on canvas, for curves/logos/signatures):
  - The goal requires a CURVE or non-primitive shape that a rectangle/ellipse/diamond can't approximate (e.g. an almond/eye, a leaf, a heart, a wordmark logo).
  - The Excalidraw freedraw tool ("p" or "7") is selected and you can see the canvas.
  - Pass an array of [x, y] points; the runtime traces them in order with mouse-down -> stepped move -> mouse-up. 15-40 points usually approximates a smooth curve.
  - Coords are in the 1440x900 sandbox viewport. Stay inside the drawable area roughly (200..1300, 80..880) and leave whitespace around the shape.
  - To draw a CLOSED shape, repeat the first point at the end of the array.
  - You can issue MULTIPLE freedraw actions back-to-back to layer strokes (e.g. outer outline + inner highlight).

NVIDIA EYE LOGO HINT: the NVIDIA eye is an elongated almond/lens shape (wider than tall, pointed at left and right). A reasonable approximation as a freedraw polyline in the 1440x900 sandbox viewport, centered horizontally around x=720, vertically around y=450, sized roughly 600px wide and 200px tall:

  Outer almond (close back to start) — ~15 points:
  [[420,450],[470,400],[560,370],[680,360],[800,360],[920,370],[1010,400],[1060,450],[1010,500],[920,530],[800,540],[680,540],[560,530],[470,500],[420,450]]

  Inner highlight curve (optional second freedraw) — ~11 points:
  [[520,460],[600,430],[700,420],[800,420],[900,430],[960,460],[900,490],[800,500],[700,500],[600,490],[520,460]]

  Use these coordinates DIRECTLY in a freedraw action if the goal is the NVIDIA eye logo. If the goal allows a different center/size, scale uniformly but keep the aspect ratio.

EXCALIDRAW DRAWING GUIDE:
  - Rectangle tool: keyboard "r" or "2"
  - Ellipse/circle: "o" or "3"
  - Arrow: "a" or "5"
  - Line: "l" or "6"
  - Diamond: "d" or "4"
  - Text: "t" or "8"
  - Freedraw: "p" or "7"
  - Selection: "v" or "1"
  - To draw a shape: keyboard the tool key, then drag from one corner to the other on the canvas (coords within 1440x900, leave whitespace).
  - To type text: keyboard "t" to pick the text tool, clickAt the spot on the canvas where the text should start (e.g. [620, 380] for upper-center), then type the desired string.
  - To change a shape's color: with the shape selected, the right-side panel shows "Stroke" color swatches. clickAt the swatch coordinates if visible (Excalidraw's stroke colors panel appears on the right side after selection).
  - The canvas drawable area is roughly (200..1300, 80..880) — leave space for the UI.
  - Goal completion for drawing tasks: the goal shape/text must be visible at the destination.

When DONE:
  - The goal content/shape/text is visible on the page, OR you are genuinely stuck (no scroll/click/drag/type/clickAt can help).

The performer uses scene_weight and min_hold_seconds to pace the video. Goal-reached / payoff pages get longer holds (8-14s); transient cursor moves get 1-2s. The runtime computes these values from page state — you don't need to choose them, but be aware that your reasoning's clarity helps the runtime classify each step.`,
    },
    {
      role: 'user',
      content: `Goal: ${goal}
URL: ${url}
Page title: ${title}
Visible text (first 600 chars): ${pageText.slice(0, 600)}

${scrollHint}
${attemptedBlock}
Actions taken so far (these were judged good):
${hist}

Clickable elements on screen:
${listing}

Reply with EXACTLY ONE of these JSON shapes:
  {"id": <number>, "description": "Click ...", "reasoning": "..."}
  {"scroll": "down" | "up", "px": <number, default 600>, "description": "Scroll to see ...", "reasoning": "..."}
  {"drag": {"from": [x1, y1], "to": [x2, y2]}, "description": "Drag from (x1,y1) to (x2,y2) to draw rectangle", "reasoning": "..."}
  {"keyboard": "<key>", "description": "Press <key> to ...", "reasoning": "..."}
  {"clickAt": [x, y], "description": "Click canvas at (x,y) to ...", "reasoning": "..."}
  {"type": "<text>", "description": "Type '...' into the active input", "reasoning": "..."}
  {"freedraw": [[x1,y1], [x2,y2], ..., [xn,yn]], "description": "Freedraw a polyline of N points to trace ...", "reasoning": "..."}
  {"done": true, "reasoning": "..."}`,
    },
  ];

  let { text, reasoning, finish } = await callNemotron(messages);
  if (!text && finish === 'length') {
    log(`[nemotron] retry with 3000 tokens (first call hit length cap)`);
    ({ text, reasoning, finish } = await callNemotron(messages, { maxTokens: 3000 }));
  }
  log(`[nemotron] reasoning: ${reasoning.slice(0, 300)}`);
  if (!text && reasoning) {
    log(`[nemotron] empty content; mining JSON from reasoning trace`);
    try { return { decision: parseJsonLoose(reasoning), reasoning }; } catch (e) {}
  }
  return { decision: parseJsonLoose(text || reasoning), reasoning };
}

// ----------------------------------------------------------------------------
// Top-K picker (BEAM=1 path).
// Returns { candidates: [{action, score, reasoning}, ...], done?: bool, reasoning?: str }.
// ----------------------------------------------------------------------------
async function pickTopKCandidates({
  goal, url, title, pageText, clickables, history,
  scrollY = 0, fullPageHeight = 0, viewportHeight = 900,
  rejectedDescriptions = [],
  K = 4,
}) {
  const listing = clickables.map((c, i) =>
    `[${i}] <${c.tag}> "${(c.text || c.aria || '(no text)').slice(0, 70)}"${c.href ? ` href=${c.href.slice(0, 60)}` : ''}`
  ).join('\n');
  const hist = history.length ? history.map((h, i) => `  ${i + 1}. ${h}`).join('\n') : '  (none yet)';
  const canScrollDown = fullPageHeight > scrollY + viewportHeight + 40;
  const canScrollUp   = scrollY > 40;
  const scrollHint = `Scroll position: ${scrollY}px / ${fullPageHeight}px total (viewport ${viewportHeight}px). ${canScrollDown ? 'CAN scroll DOWN.' : 'At bottom — cannot scroll down.'} ${canScrollUp ? 'CAN scroll UP.' : ''}`;

  const rejectedBlock = rejectedDescriptions.length
    ? `\nThe following candidates were already explored from THIS exact state and judged off-track. Do NOT propose them again — propose DIFFERENT directions:\n${rejectedDescriptions.map((a, i) => `  X${i + 1}. ${a}`).join('\n')}\n`
    : '';

  const messages = [
    {
      role: 'system',
      content: `You are an exploration planner for a multi-tab beam-search web agent.
Instead of picking one action, you rank the top ${K} most promising next actions.
Each candidate will be executed in PARALLEL in its own browser tab; the best result wins.
Diversity is valuable: include different categories (e.g. nav click, sidebar click, scroll, search) when they all plausibly advance.

Reply with valid JSON ONLY — no prose, no markdown fences. Shape:
{
  "candidates": [
    {"action": {"id": <n>, "description": "...", "reasoning": "..."}, "score": 0.0-1.0},
    {"action": {"scroll": "down"|"up", "px": <n>, "description": "...", "reasoning": "..."}, "score": 0.0-1.0},
    ...
  ]
}
OR if the goal is clearly already visible on this page:
{"done": true, "reasoning": "..."}

Rules:
- Return EXACTLY ${K} candidates ordered by score (highest first), unless "done".
- Scores in [0,1]; reflect confidence the action advances toward the goal.
- Each action is one of: click ({"id": n, "description": "...", "reasoning": "..."}) or scroll ({"scroll": "down"|"up", "px": n, "description": "...", "reasoning": "..."}).
- Prefer specific over generic. Prefer matches over guesses. Use scroll only if no on-screen click looks promising.`,
    },
    {
      role: 'user',
      content: `Goal: ${goal}
URL: ${url}
Page title: ${title}
Visible text (first 600 chars): ${pageText.slice(0, 600)}

${scrollHint}
${rejectedBlock}
Actions taken so far (judged good):
${hist}

Clickable elements on screen:
${listing}

Return the top ${K} ranked candidates as specified.`,
    },
  ];

  let { text, reasoning, finish } = await callNemotron(messages, { maxTokens: 2400 });
  if (!text && finish === 'length') {
    log(`[nemotron-topk] retry with 4000 tokens (first call hit length cap)`);
    ({ text, reasoning, finish } = await callNemotron(messages, { maxTokens: 4000 }));
  }
  log(`[nemotron-topk] reasoning: ${reasoning.slice(0, 300)}`);
  const raw = text || reasoning;
  let parsed;
  try {
    parsed = parseJsonLoose(raw);
  } catch (e) {
    log(`[nemotron-topk] could not parse top-K response: ${e.message}`);
    // v21 hardened fallback: scan reasoning for click ids that look like candidate proposals.
    // Pattern: "candidate N: click ... (id X)" or "click <id N>" or "id N" mentioned positively.
    const idMatches = [...(raw || '').matchAll(/\b(?:click|id)\s*[#:]?\s*(?:id\s*)?(\d{1,3})\b/gi)];
    const seen = new Set();
    const fallbackCands = [];
    for (const m of idMatches) {
      const id = Number(m[1]);
      if (seen.has(id)) continue;
      seen.add(id);
      // Validate id is within range.
      if (id < 0 || id >= 200) continue;
      fallbackCands.push({
        action: { id, description: `Click element id=${id} (fallback)`, reasoning: 'extracted from reasoning_content' },
        score: Math.max(0.3, 0.7 - fallbackCands.length * 0.1),
      });
      if (fallbackCands.length >= K) break;
    }
    if (fallbackCands.length >= 2) {
      log(`[nemotron-topk] recovered ${fallbackCands.length} candidates from reasoning text`);
      return { candidates: fallbackCands };
    }
    throw e;
  }
  if (parsed.done) return { done: true, reasoning: parsed.reasoning || 'model declared done' };
  let candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  // Normalize: filter invalid actions, clamp scores.
  candidates = candidates
    .map((c) => {
      const action = c.action || c;
      const score = typeof c.score === 'number' ? Math.max(0, Math.min(1, c.score)) : 0.5;
      return { action, score };
    })
    .filter((c) => {
      const a = c.action || {};
      const isClick = Number.isInteger(Number(a.id)) && Number(a.id) >= 0;
      const isScroll = a.scroll === 'up' || a.scroll === 'down';
      return isClick || isScroll;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, K);
  return { candidates };
}

// ----------------------------------------------------------------------------
// DOM helpers — same shape as v13 but parameterized by Page (so beam workers
// share the implementation).
// ----------------------------------------------------------------------------
async function gatherClickables(page) {
  return await page.evaluate(() => {
    const sel = 'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';
    const all = Array.from(document.querySelectorAll(sel));
    const seen = new Set();
    const out = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      if (r.width < 4 || r.height < 4) continue;
      if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
      if (r.bottom < 0 || r.top > window.innerHeight + 800) continue;
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const aria = el.getAttribute('aria-label') || '';
      const key = `${el.tagName}|${text}|${aria}|${Math.round(r.x)},${Math.round(r.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 120),
        aria,
        href: el.getAttribute('href') || '',
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      });
      if (out.length >= 80) break;
    }
    return out;
  });
}

async function gatherPageText(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    return (main.innerText || '').trim().replace(/\s+/g, ' ');
  });
}

async function scrollAndMark(page, idx) {
  return await page.evaluate((i) => {
    const sel = 'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';
    const all = Array.from(document.querySelectorAll(sel));
    const seen = new Set();
    const visible = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      if (r.width < 4 || r.height < 4) continue;
      if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
      if (r.bottom < 0 || r.top > window.innerHeight + 800) continue;
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const aria = el.getAttribute('aria-label') || '';
      const key = `${el.tagName}|${text}|${aria}|${Math.round(r.x)},${Math.round(r.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      visible.push(el);
      if (visible.length >= 80) break;
    }
    const target = visible[i];
    if (!target) return null;
    target.setAttribute('data-explainer-target', '1');
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return null;
  }, idx);
}

async function remeasureMarked(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('[data-explainer-target="1"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    el.removeAttribute('data-explainer-target');
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

// ----------------------------------------------------------------------------
// Cmd+K / Ctrl+K search scout — slot 0 in beam mode.
// Returns the page if it successfully navigated to a search result, else null.
// ----------------------------------------------------------------------------
async function trySearchScout(context, goalPhrase, startUrl, { roundIdx = 0, beamSlot = 0, recordHandle = null } = {}) {
  let page;
  try {
    page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    if (recordHandle) recordHandle.handle = await attachScoutScreencast(context, page, roundIdx, beamSlot);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => document.body && document.body.children.length > 0, { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    // Try Cmd+K then Ctrl+K
    await page.keyboard.press('Meta+K').catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+K').catch(() => {});
    await page.waitForTimeout(500);

    const sels = [
      'input[type="search"]',
      'input[role="combobox"][aria-label*="earch" i]',
      'input[placeholder*="earch" i]',
      '[role="dialog"] input[type="text"]',
      '[role="dialog"] input',
    ];
    let input = null;
    for (const s of sels) {
      input = await page.locator(s).first().elementHandle({ timeout: 500 }).catch(() => null);
      if (input) {
        const box = await input.boundingBox().catch(() => null);
        if (box && box.width > 4) break;
        input = null;
      }
    }
    if (!input) {
      // Fall back to a visible "search" button
      const btn = await page.getByRole('button', { name: /search/i }).first().elementHandle({ timeout: 500 }).catch(() => null);
      if (btn) {
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
        for (const s of sels) {
          input = await page.locator(s).first().elementHandle({ timeout: 500 }).catch(() => null);
          if (input) {
            const box = await input.boundingBox().catch(() => null);
            if (box && box.width > 4) break;
            input = null;
          }
        }
      }
    }
    if (!input) {
      log(`[search-scout] no search input found on ${startUrl}`);
      return null;
    }
    await input.click({ timeout: 2000 }).catch(() => {});
    await input.type(goalPhrase, { delay: 30 }).catch(() => {});
    await page.waitForTimeout(1000);

    const resultSels = [
      '[role="dialog"] a',
      '[role="listbox"] [role="option"] a',
      '[role="listbox"] a',
      '[role="dialog"] [role="option"]',
      '[role="listbox"] [role="option"]',
    ];
    let result = null;
    for (const s of resultSels) {
      result = await page.locator(s).first().elementHandle({ timeout: 500 }).catch(() => null);
      if (result) {
        const box = await result.boundingBox().catch(() => null);
        if (box && box.width > 4) break;
        result = null;
      }
    }
    if (!result) {
      log(`[search-scout] no result row visible for "${goalPhrase}"`);
      return null;
    }
    await result.click({ timeout: 3000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    log(`[search-scout] navigated to ${page.url()}`);
    return page;
  } catch (e) {
    log(`[search-scout] error: ${e.message}`);
    try { if (page) await page.close(); } catch {}
    return null;
  }
}

// ----------------------------------------------------------------------------
// Execute a single candidate in its own context. Returns a result object that
// the orchestrator uses to pick a winner.
// ----------------------------------------------------------------------------
async function executeCandidate({
  candidate,         // {action: {id|scroll, ...}, score}
  context,           // playwright BrowserContext (fresh)
  startUrl,          // URL the context should already be on (we'll navigate)
  scrollYStart,      // scroll position to restore before acting
  prevClickables,    // clickables list at the parent state (so ids line up)
  beamSlot,          // index in this round, used to name screenshots
  roundIdx,          // round number
  recordHandle = null, // v21: {handle: ScreencastHandle} mutated by attach
}) {
  const slotTag = `r${roundIdx}_s${beamSlot}`;
  const beforePath = join(OUT_DIR, 'beam-screenshots', `${slotTag}_before.png`);
  const afterPath  = join(OUT_DIR, 'beam-screenshots', `${slotTag}_after.png`);
  let page;
  try {
    page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    if (recordHandle) recordHandle.handle = await attachScoutScreencast(context, page, roundIdx, beamSlot);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => document.body && document.body.children.length > 0, { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (scrollYStart > 0) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollYStart).catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: beforePath }).catch(() => {});

    const action = candidate.action;
    let kind, description, urlBefore, scrollYBefore;
    urlBefore = page.url();
    scrollYBefore = await page.evaluate(() => window.scrollY).catch(() => 0);

    if (action.scroll === 'down' || action.scroll === 'up') {
      kind = 'scroll';
      const px = Math.max(60, Math.min(3000, Number(action.px) || 600));
      const dy = action.scroll === 'down' ? px : -px;
      const SCROLL_STEP_PX = 300;
      const stepCount = Math.max(1, Math.ceil(px / SCROLL_STEP_PX));
      const dyStep = dy / stepCount;
      for (let s = 0; s < stepCount; s++) {
        await page.evaluate((d) => window.scrollBy(0, d), dyStep);
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(200);
      description = action.description || `Scroll ${action.scroll}`;
    } else {
      kind = 'click';
      const id = Number(action.id);
      if (!Number.isInteger(id) || id < 0 || id >= prevClickables.length) {
        await page.screenshot({ path: afterPath }).catch(() => {});
        return { ok: false, reason: `invalid id ${action.id}`, candidate, page, kind: 'click', beforePath, afterPath, urlBefore, scrollYBefore, urlAfter: urlBefore, scrollYAfter: scrollYBefore, description: action.description || 'click invalid' };
      }
      await scrollAndMark(page, id);
      await page.waitForTimeout(400);
      const liveRect = await remeasureMarked(page);
      if (!liveRect || liveRect.w < 1) {
        await page.screenshot({ path: afterPath }).catch(() => {});
        return { ok: false, reason: `could not remeasure id=${id}`, candidate, page, kind: 'click', beforePath, afterPath, urlBefore, scrollYBefore, urlAfter: urlBefore, scrollYAfter: scrollYBefore, description: action.description || 'click unmeasurable' };
      }
      const clickX = liveRect.x + liveRect.w / 2;
      const clickY = liveRect.y + liveRect.h / 2;
      description = action.description || `Click target id=${id}`;
      await page.mouse.click(clickX, clickY).catch(() => {});
      const t0 = Date.now();
      let urlChanged = false;
      while (Date.now() - t0 < 6000) {
        await page.waitForTimeout(250);
        if (page.url() !== urlBefore) { urlChanged = true; break; }
      }
      if (urlChanged) {
        await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
      }
      await page.waitForTimeout(1200);
    }

    const urlAfter = page.url();
    const scrollYAfter = await page.evaluate(() => window.scrollY).catch(() => 0);
    await page.screenshot({ path: afterPath }).catch(() => {});

    return {
      ok: true,
      candidate,
      page,
      kind,
      description,
      beforePath,
      afterPath,
      urlBefore,
      urlAfter,
      scrollYBefore,
      scrollYAfter,
    };
  } catch (e) {
    try { if (page) await page.screenshot({ path: afterPath }); } catch {}
    return { ok: false, reason: e.message, candidate, page, kind: 'unknown', beforePath, afterPath, urlBefore: startUrl, urlAfter: startUrl, scrollYBefore: scrollYStart, scrollYAfter: scrollYStart, description: candidate.action?.description || 'failed' };
  }
}

// ============================================================================
// Two parallel logs (kept from v13):
//   filtered[]  — the steps we'll actually render (only good ones).
//   attempted[] — everything tried, including the wrong attempts.
// Plus exploration[] (BEAM=1 only) — per-round all-K traces.
// ============================================================================
const filtered = [];
const attempted = [];
const exploration = [];
const history = [];

let blacklist = [];
let blacklistUrl = '';

log(`Launching Chromium...`);
log(`Mode: ${BEAM ? `BEAM=1 (K=${BEAM_K})` : 'BEAM=0 (single-tab)'}`);
const SANDBOX_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const FULL_CHROME = '/tmp/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const CDP_PORT = 9300 + Math.floor(Math.random() * 400);

log(`Spawning Chromium on CDP port ${CDP_PORT}...`);
const chromeProc = spawn(FULL_CHROME, [
  `--remote-debugging-port=${CDP_PORT}`,
  '--remote-debugging-address=127.0.0.1',
  `--proxy-server=${SANDBOX_PROXY}`,
  '--proxy-bypass-list=localhost,127.0.0.1,::1,10.200.0.1',
  '--ignore-certificate-errors',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--enable-features=NetworkServiceInProcess',
  '--disable-features=NetworkService,Translate',
  '--headless=new',
  '--ozone-platform=headless',
  '--use-angle=swiftshader-webgl',
  '--enable-unsafe-swiftshader',
  '--disable-background-networking',
  '--no-first-run',
  '--no-default-browser-check',
  '--use-mock-keychain',
  '--password-store=basic',
  '--window-size=1440,900',
  `--user-data-dir=/tmp/explainer-chrome-profile-${Date.now()}`,
  'about:blank',
], {
  detached: false,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    LD_LIBRARY_PATH: '/tmp/chrome-libs/extracted/usr/lib/aarch64-linux-gnu:/tmp/chrome-libs/extracted/usr/lib:/tmp/chrome-libs/extracted/lib/aarch64-linux-gnu',
    FONTCONFIG_PATH: '/tmp/chrome-libs/extracted/etc/fonts',
    FONTCONFIG_FILE: '/tmp/chrome-libs/extracted/etc/fonts/fonts.conf',
    XDG_DATA_DIRS: '/tmp/chrome-libs/extracted/usr/share:/usr/local/share:/usr/share',
  },
});
chromeProc.stderr.on('data', (b) => {
  const s = b.toString();
  if (s.includes('ERROR') || s.includes('FATAL')) log(`[chrome] ${s.trim().slice(0, 200)}`);
});

let cdpReady = false;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if (r.ok) { cdpReady = true; break; }
  } catch {}
}
if (!cdpReady) {
  log(`Chromium failed to come up on port ${CDP_PORT} within 15s`);
  chromeProc.kill('SIGKILL');
  process.exit(1);
}
log(`Chromium ready on CDP port ${CDP_PORT}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 90_000 });

// "Lead" context — the active beam winner's context. We never close this until
// we're explicitly replacing it with a winning beam slot's context.
let leadContext = browser.contexts()[0];
let leadPage = leadContext.pages().length ? leadContext.pages()[0] : await leadContext.newPage();
await leadPage.setViewportSize({ width: 1440, height: 900 });

// CDP screencast on the lead page (observer-only — doesn't affect logic).
let cdp = await leadContext.newCDPSession(leadPage);
let frameCounter = 0;
cdp.on('Page.screencastFrame', async (frame) => {
  frameCounter++;
  try {
    const buf = Buffer.from(frame.data, 'base64');
    writeFileSync(join(OBS_DIR, 'latest.jpg'), buf);
    await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
  } catch (e) {}
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 1440, maxHeight: 900, everyNthFrame: 2 });
log(`CDP screencast started (writing observe/latest.jpg)`);

log(`Goal: ${GOAL}`);
log(`Start: ${START_URL}`);
log(`Max steps (incl. backtracks): ${MAX_STEPS}`);
await leadPage.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await leadPage.waitForFunction(() => document.body && document.body.children.length > 0, { timeout: 5000 }).catch(() => {});
await leadPage.waitForTimeout(2500);

// Per-state attempted-actions stack (BEAM=0) / rejected-descriptions stack (BEAM=1).
const attemptedByState = new Map();
const stateKey = (url, scrollY) => `${url}|${Math.round(scrollY / 200) * 200}`;

let attemptIndex = 0;
let filteredIndex = 0;

// ============================================================================
// MAIN LOOP — branches on BEAM flag.
// ============================================================================
const startWallMs = Date.now();

if (!BEAM) {
  // ------------------------------------------------------------------------
  // BEAM=0: legacy single-tab loop (verbatim from v13).
  // ------------------------------------------------------------------------
  const page = leadPage;
  for (let stepLoop = 0; stepLoop < MAX_STEPS; stepLoop++) {
    const url = page.url();
    const title = await page.title();
    const clickables = await gatherClickables(page);
    const pageText = await gatherPageText(page);
    const scrollMetrics = await page.evaluate(() => ({
      scrollY: window.scrollY,
      fullPageHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));

    if (url !== blacklistUrl) {
      blacklist = [];
      blacklistUrl = url;
    }

    const sk = stateKey(url, scrollMetrics.scrollY);
    const attemptedHere = attemptedByState.get(sk) || [];

    log(`step-loop ${stepLoop} (attempt #${attemptIndex}, kept ${filteredIndex}): ${url} (${clickables.length} clickables, scrollY=${scrollMetrics.scrollY}/${scrollMetrics.fullPageHeight}, ${attemptedHere.length} attempted here)`);

    const stateBefore = { url, scrollY: scrollMetrics.scrollY };

    let decisionRes;
    try {
      decisionRes = await pickNextAction({
        goal: GOAL, url, title, pageText, clickables, history, blacklist,
        scrollY: scrollMetrics.scrollY,
        fullPageHeight: scrollMetrics.fullPageHeight,
        viewportHeight: scrollMetrics.viewportHeight,
        attemptedActions: attemptedHere,
      });
    } catch (e) {
      log(`step-loop ${stepLoop}: nemotron failed: ${e.message}`);
      break;
    }
    const { decision } = decisionRes;
    log(`step-loop ${stepLoop}: decision = ${JSON.stringify(decision)}`);

    if (decision.done) {
      const checkPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
      await page.screenshot({ path: checkPath });
      let judge;
      try {
        judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: checkPath });
      } catch (e) {
        log(`step-loop ${stepLoop}: nemotron-omni judge failed: ${e.message}`);
        judge = { at_destination: true, on_right_track: true, reasoning: 'judge-fail; accepting Nemotron-Super done' };
      }
      log(`[nemotron-omni] done-check: ${JSON.stringify(judge)}`);
      if (judge.at_destination) {
        const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
        copyFileSync(checkPath, finalPath);
        const rec = {
          step: filteredIndex, kind: 'done', url, title,
          screenshot: finalPath, reasoning: decision.reasoning, judge,
        };
        filtered.push(rec);
        attempted.push({ ...rec, attempt: attemptIndex, accepted: true });
        filteredIndex++;
        attemptIndex++;
        break;
      } else {
        log(`step-loop ${stepLoop}: Nemotron-Omni DISAGREES with done — continuing.`);
        attempted.push({
          attempt: attemptIndex, accepted: false, kind: 'done', url, title,
          reasoning: decision.reasoning, judge,
        });
        attemptedHere.push(`done (model thought it finished; judge: ${judge.reasoning})`);
        attemptedByState.set(sk, attemptedHere);
        attemptIndex++;
        continue;
      }
    }

    if (decision.scroll === 'down' || decision.scroll === 'up') {
      const px = Math.max(60, Math.min(3000, Number(decision.px) || 600));
      const dy = decision.scroll === 'down' ? px : -px;

      const beforePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_before.png`);
      await page.screenshot({ path: beforePath });
      const scrollYBefore = scrollMetrics.scrollY;

      const SCROLL_STEP_PX = 300;
      const stepCount = Math.max(1, Math.ceil(px / SCROLL_STEP_PX));
      const dyStep = dy / stepCount;
      const scrollFrames = [];
      const firstScrollPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_scroll_${scrollYBefore}.png`);
      try {
        await page.screenshot({ path: firstScrollPath });
        scrollFrames.push({ y: scrollYBefore, path: firstScrollPath });
      } catch (e) { log(`attempt ${attemptIndex}: pre-scroll capture failed: ${e.message}`); }

      log(`attempt ${attemptIndex}: stepped-scroll ${decision.scroll} by ${px}px in ${stepCount} step(s) (from y=${scrollYBefore})`);
      try {
        for (let s = 0; s < stepCount; s++) {
          await page.evaluate((d) => window.scrollBy(0, d), dyStep);
          await page.waitForTimeout(180);
          const yNow = await page.evaluate(() => window.scrollY);
          const stepPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_scroll_${yNow}.png`);
          try {
            await page.screenshot({ path: stepPath });
            scrollFrames.push({ y: yNow, path: stepPath });
          } catch (e) { log(`attempt ${attemptIndex}: scroll-step ${s} capture failed: ${e.message}`); }
        }
        await page.waitForTimeout(200);
      } catch (e) {
        log(`attempt ${attemptIndex}: stepped-scroll failed: ${e.message}`);
        attemptIndex++;
        continue;
      }

      const scrollYAfter = await page.evaluate(() => window.scrollY);
      const afterPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
      await page.screenshot({ path: afterPath });

      const fullPagePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_fullpage.png`);
      try { await page.screenshot({ path: fullPagePath, fullPage: true }); }
      catch (e) { log(`attempt ${attemptIndex}: fullpage failed: ${e.message}`); }

      let judge;
      try {
        judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: afterPath });
      } catch (e) {
        log(`attempt ${attemptIndex}: nemotron-omni judge failed: ${e.message} — defaulting to on-track`);
        judge = { at_destination: false, on_right_track: true, reasoning: 'judge-fail; defaulted to on-track' };
      }
      log(`[nemotron-omni] judge: ${JSON.stringify(judge)}`);

      const description = decision.description || `Scroll ${decision.scroll}`;
      const baseRec = {
        kind: 'scroll', url, title,
        direction: decision.scroll, pixels: px,
        scrollYBefore, scrollYAfter,
        viewportHeight: scrollMetrics.viewportHeight,
        fullPageHeight: scrollMetrics.fullPageHeight,
        description, reasoning: decision.reasoning, judge, scrollFrames,
      };

      if (judge.on_right_track || judge.at_destination) {
        const kBefore = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_before.png`);
        const kAfter  = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_after.png`);
        const kFull   = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_fullpage.png`);
        copyFileSync(beforePath, kBefore);
        copyFileSync(afterPath, kAfter);
        if (existsSync(fullPagePath)) copyFileSync(fullPagePath, kFull);
        const keptScrollFrames = [];
        for (const sf of scrollFrames) {
          const filteredScrollPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_scroll_${sf.y}.png`);
          try {
            if (existsSync(sf.path)) {
              copyFileSync(sf.path, filteredScrollPath);
              keptScrollFrames.push({ y: sf.y, path: filteredScrollPath });
            }
          } catch (e) { log(`failed to copy scroll-frame y=${sf.y}: ${e.message}`); }
        }
        const rec = {
          ...baseRec,
          step: filteredIndex,
          screenshotBefore: kBefore,
          screenshotAfter: kAfter,
          screenshotFullPage: kFull,
          scrollFrames: keptScrollFrames,
        };
        filtered.push(rec);
        history.push(description);
        attempted.push({ ...rec, attempt: attemptIndex, accepted: true });
        filteredIndex++;
        attemptIndex++;

        if (judge.at_destination) {
          log(`[nemotron-omni] at_destination true after scroll — stopping with success.`);
          const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
          copyFileSync(afterPath, finalPath);
          filtered.push({
            step: filteredIndex, kind: 'done', url, title,
            screenshot: finalPath, reasoning: 'Nemotron-Omni: at_destination after scroll',
            judge,
          });
          filteredIndex++;
          break;
        }
        continue;
      } else {
        log(`[nemotron-omni] off-track → rolling back to ${stateBefore.url} @ y=${stateBefore.scrollY}`);
        attempted.push({
          ...baseRec, attempt: attemptIndex, accepted: false,
          screenshotBefore: beforePath, screenshotAfter: afterPath,
          screenshotFullPage: existsSync(fullPagePath) ? fullPagePath : null,
        });
        try {
          if (page.url() !== stateBefore.url) {
            await page.goto(stateBefore.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
            await page.waitForFunction(() => document.body && document.body.children.length > 0, { timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(1500);
          }
          await page.evaluate((y) => window.scrollTo(0, y), stateBefore.scrollY);
          await page.waitForTimeout(400);
        } catch (e) {
          log(`rollback failed: ${e.message}`);
        }
        attemptedHere.push(`${description} → ${judge.reasoning}`);
        attemptedByState.set(sk, attemptedHere);
        attemptIndex++;
        continue;
      }
    }

    // DRAG branch (BEAM=0, v23) — canvas drawing via mouse-down + step move + mouse-up.
    if (decision.drag && Array.isArray(decision.drag.from) && Array.isArray(decision.drag.to)) {
      const from = decision.drag.from.map(Number);
      const to = decision.drag.to.map(Number);
      const beforePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_before.png`);
      await page.screenshot({ path: beforePath });

      log(`attempt ${attemptIndex}: drag from (${from[0]},${from[1]}) to (${to[0]},${to[1]})`);
      try {
        await page.mouse.move(from[0], from[1]);
        await page.mouse.down();
        await page.waitForTimeout(50);
        for (let t = 0.1; t <= 1.0; t += 0.1) {
          const x = from[0] + (to[0] - from[0]) * t;
          const y = from[1] + (to[1] - from[1]) * t;
          await page.mouse.move(x, y);
          await page.waitForTimeout(30);
        }
        await page.mouse.up();
        await page.waitForTimeout(800);
      } catch (e) {
        log(`attempt ${attemptIndex}: drag failed: ${e.message}`);
        attemptIndex++;
        continue;
      }

      const afterPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
      await page.screenshot({ path: afterPath });

      let judge;
      try {
        judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: afterPath });
      } catch (e) {
        log(`attempt ${attemptIndex}: drag judge failed: ${e.message} — defaulting to on-track`);
        judge = { at_destination: false, on_right_track: true, reasoning: 'judge-fail; defaulted to on-track' };
      }
      log(`[nemotron-omni] drag-judge: ${JSON.stringify(judge)}`);

      const description = decision.description || `Drag (${from[0]},${from[1]}) -> (${to[0]},${to[1]})`;
      const baseRec = {
        kind: 'drag', url, title,
        from: { x: from[0], y: from[1] },
        to: { x: to[0], y: to[1] },
        description, reasoning: decision.reasoning, judge,
      };

      if (judge.on_right_track || judge.at_destination) {
        const kBefore = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_before.png`);
        const kAfter  = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_after.png`);
        copyFileSync(beforePath, kBefore);
        copyFileSync(afterPath, kAfter);
        const rec = {
          ...baseRec,
          step: filteredIndex,
          screenshotBefore: kBefore,
          screenshotAfter: kAfter,
        };
        filtered.push(rec);
        history.push(description);
        attempted.push({ ...rec, attempt: attemptIndex, accepted: true });
        filteredIndex++;
        attemptIndex++;

        if (judge.at_destination) {
          log(`[nemotron-omni] at_destination true after drag — stopping with success.`);
          const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
          copyFileSync(afterPath, finalPath);
          filtered.push({
            step: filteredIndex, kind: 'done', url, title,
            screenshot: finalPath, reasoning: 'Nemotron-Omni: at_destination after drag',
            judge,
          });
          filteredIndex++;
          break;
        }
        continue;
      } else {
        log(`[nemotron-omni] off-track after drag → recording rejection`);
        attempted.push({
          ...baseRec, attempt: attemptIndex, accepted: false,
          screenshotBefore: beforePath, screenshotAfter: afterPath,
        });
        attemptedHere.push(`${description} → ${judge.reasoning}`);
        attemptedByState.set(sk, attemptedHere);
        attemptIndex++;
        continue;
      }
    }

    // FREEDRAW branch (BEAM=0, v26) — freeform polyline draw on a canvas.
    // Accepts an array of [x, y] points. Traces them with mouse-down -> stepped
    // move -> mouse-up. Used for curves / logos / signatures that primitive
    // rect/ellipse/diamond can't express (e.g. NVIDIA eye almond shape).
    if (Array.isArray(decision.freedraw) && decision.freedraw.length >= 2) {
      const rawPoints = decision.freedraw;
      // Normalize + validate: every entry must be a [number, number] pair.
      const points = [];
      for (const p of rawPoints) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = Number(p[0]);
        const y = Number(p[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push([x, y]);
      }
      if (points.length < 2) {
        log(`attempt ${attemptIndex}: freedraw rejected — only ${points.length} valid points after parse`);
        attemptIndex++;
        continue;
      }

      const beforePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_before.png`);
      await page.screenshot({ path: beforePath });

      log(`attempt ${attemptIndex}: freedraw ${points.length}-point polyline starting at (${points[0][0]},${points[0][1]})`);
      try {
        const [x0, y0] = points[0];
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        await page.waitForTimeout(30);
        for (let i = 1; i < points.length; i++) {
          const [x, y] = points[i];
          await page.mouse.move(x, y, { steps: 3 });
          await page.waitForTimeout(20);
        }
        await page.mouse.up();
        await page.waitForTimeout(800);
      } catch (e) {
        log(`attempt ${attemptIndex}: freedraw failed: ${e.message}`);
        attemptIndex++;
        continue;
      }

      const afterPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
      await page.screenshot({ path: afterPath });

      let judge;
      try {
        judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: afterPath });
      } catch (e) {
        log(`attempt ${attemptIndex}: freedraw judge failed: ${e.message} — defaulting to on-track`);
        judge = { at_destination: false, on_right_track: true, reasoning: 'judge-fail; defaulted to on-track' };
      }
      log(`[nemotron-omni] freedraw-judge: ${JSON.stringify(judge)}`);

      const description = decision.description || `Freedraw ${points.length}-point polyline`;
      const baseRec = {
        kind: 'freedraw', url, title,
        points,
        description, reasoning: decision.reasoning, judge,
      };

      // Auto-keep freedraw the same way drag/keyboard/clickAt/type are auto-kept:
      // a partial stroke or an off-canvas stroke can be hard to read in the
      // after-shot but is still a valid step toward the drawing goal.
      if (judge.on_right_track || judge.at_destination) {
        const kBefore = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_before.png`);
        const kAfter  = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_after.png`);
        copyFileSync(beforePath, kBefore);
        copyFileSync(afterPath, kAfter);
        const rec = {
          ...baseRec,
          step: filteredIndex,
          screenshotBefore: kBefore,
          screenshotAfter: kAfter,
        };
        filtered.push(rec);
        history.push(description);
        attempted.push({ ...rec, attempt: attemptIndex, accepted: true });
        filteredIndex++;
        attemptIndex++;

        if (judge.at_destination) {
          log(`[nemotron-omni] at_destination true after freedraw — stopping with success.`);
          const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
          copyFileSync(afterPath, finalPath);
          filtered.push({
            step: filteredIndex, kind: 'done', url, title,
            screenshot: finalPath, reasoning: 'Nemotron-Omni: at_destination after freedraw',
            judge,
          });
          filteredIndex++;
          break;
        }
        continue;
      } else {
        log(`[nemotron-omni] off-track after freedraw → recording rejection`);
        attempted.push({
          ...baseRec, attempt: attemptIndex, accepted: false,
          screenshotBefore: beforePath, screenshotAfter: afterPath,
        });
        attemptedHere.push(`${description} → ${judge.reasoning}`);
        attemptedByState.set(sk, attemptedHere);
        attemptIndex++;
        continue;
      }
    }

    // KEYBOARD branch (BEAM=0, v23) — single key or chord (e.g. "R", "Escape", "Meta+K").
    if (typeof decision.keyboard === 'string' && decision.keyboard.length) {
      const key = decision.keyboard;
      const beforePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_before.png`);
      await page.screenshot({ path: beforePath });

      log(`attempt ${attemptIndex}: keyboard press "${key}"`);
      try {
        await page.keyboard.press(key);
        await page.waitForTimeout(600);
      } catch (e) {
        log(`attempt ${attemptIndex}: keyboard failed: ${e.message}`);
        attemptIndex++;
        continue;
      }

      const afterPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
      await page.screenshot({ path: afterPath });

      let judge;
      try {
        judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: afterPath });
      } catch (e) {
        log(`attempt ${attemptIndex}: keyboard judge failed: ${e.message} — defaulting to on-track`);
        judge = { at_destination: false, on_right_track: true, reasoning: 'judge-fail; defaulted to on-track' };
      }
      log(`[nemotron-omni] keyboard-judge: ${JSON.stringify(judge)}`);

      const description = decision.description || `Press ${key}`;
      const baseRec = {
        kind: 'keyboard', url, title,
        key, description, reasoning: decision.reasoning, judge,
      };

      if (judge.on_right_track || judge.at_destination) {
        const kBefore = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_before.png`);
        const kAfter  = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_after.png`);
        copyFileSync(beforePath, kBefore);
        copyFileSync(afterPath, kAfter);
        const rec = {
          ...baseRec,
          step: filteredIndex,
          screenshotBefore: kBefore,
          screenshotAfter: kAfter,
        };
        filtered.push(rec);
        history.push(description);
        attempted.push({ ...rec, attempt: attemptIndex, accepted: true });
        filteredIndex++;
        attemptIndex++;

        if (judge.at_destination) {
          log(`[nemotron-omni] at_destination true after keyboard — stopping with success.`);
          const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
          copyFileSync(afterPath, finalPath);
          filtered.push({
            step: filteredIndex, kind: 'done', url, title,
            screenshot: finalPath, reasoning: 'Nemotron-Omni: at_destination after keyboard',
            judge,
          });
          filteredIndex++;
          break;
        }
        continue;
      } else {
        log(`[nemotron-omni] off-track after keyboard → recording rejection`);
        attempted.push({
          ...baseRec, attempt: attemptIndex, accepted: false,
          screenshotBefore: beforePath, screenshotAfter: afterPath,
        });
        attemptedHere.push(`${description} → ${judge.reasoning}`);
        attemptedByState.set(sk, attemptedHere);
        attemptIndex++;
        continue;
      }
    }

    // CLICKAT branch (BEAM=0, v24) — raw canvas-coordinate click. Used for
    // placing text-tool cursors on a canvas, clicking color swatches that
    // don't show up as labelled clickable ids, etc.
    if (Array.isArray(decision.clickAt) && decision.clickAt.length === 2) {
      const x = Number(decision.clickAt[0]);
      const y = Number(decision.clickAt[1]);
      const beforePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_before.png`);
      await page.screenshot({ path: beforePath });

      log(`attempt ${attemptIndex}: clickAt (${x}, ${y})`);
      try {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(500);
      } catch (e) {
        log(`attempt ${attemptIndex}: clickAt failed: ${e.message}`);
        attemptIndex++;
        continue;
      }

      const afterPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
      await page.screenshot({ path: afterPath });

      let judge;
      try {
        judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: afterPath });
      } catch (e) {
        log(`attempt ${attemptIndex}: clickAt judge failed: ${e.message} — defaulting to on-track`);
        judge = { at_destination: false, on_right_track: true, reasoning: 'judge-fail; defaulted to on-track' };
      }
      log(`[nemotron-omni] clickAt-judge: ${JSON.stringify(judge)}`);

      const description = decision.description || `clickAt (${x}, ${y})`;
      const baseRec = {
        kind: 'clickAt', url, title,
        position: [x, y], description, reasoning: decision.reasoning, judge,
      };

      // Auto-keep clickAt the same way keyboard is auto-kept: placing a text
      // caret often isn't visually obvious in the after-shot. If on_right_track
      // (the canvas is still reachable) we accept it.
      if (judge.on_right_track || judge.at_destination) {
        const kBefore = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_before.png`);
        const kAfter  = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_after.png`);
        copyFileSync(beforePath, kBefore);
        copyFileSync(afterPath, kAfter);
        const rec = {
          ...baseRec,
          step: filteredIndex,
          screenshotBefore: kBefore,
          screenshotAfter: kAfter,
        };
        filtered.push(rec);
        history.push(description);
        attempted.push({ ...rec, attempt: attemptIndex, accepted: true });
        filteredIndex++;
        attemptIndex++;

        if (judge.at_destination) {
          log(`[nemotron-omni] at_destination true after clickAt — stopping with success.`);
          const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
          copyFileSync(afterPath, finalPath);
          filtered.push({
            step: filteredIndex, kind: 'done', url, title,
            screenshot: finalPath, reasoning: 'Nemotron-Omni: at_destination after clickAt',
            judge,
          });
          filteredIndex++;
          break;
        }
        continue;
      } else {
        log(`[nemotron-omni] off-track after clickAt → recording rejection`);
        attempted.push({
          ...baseRec, attempt: attemptIndex, accepted: false,
          screenshotBefore: beforePath, screenshotAfter: afterPath,
        });
        attemptedHere.push(`${description} → ${judge.reasoning}`);
        attemptedByState.set(sk, attemptedHere);
        attemptIndex++;
        continue;
      }
    }

    // TYPE branch (BEAM=0, v24) — type text into whatever has focus. Used
    // after selecting the text tool and clickAt'ing the canvas, or after
    // focusing a search/input field.
    if (typeof decision.type === 'string' && decision.type.length) {
      const text = decision.type;
      const beforePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_before.png`);
      await page.screenshot({ path: beforePath });

      log(`attempt ${attemptIndex}: type ${JSON.stringify(text)}`);
      try {
        await page.keyboard.type(text);
        await page.waitForTimeout(600);
      } catch (e) {
        log(`attempt ${attemptIndex}: type failed: ${e.message}`);
        attemptIndex++;
        continue;
      }

      const afterPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
      await page.screenshot({ path: afterPath });

      let judge;
      try {
        judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: afterPath });
      } catch (e) {
        log(`attempt ${attemptIndex}: type judge failed: ${e.message} — defaulting to on-track`);
        judge = { at_destination: false, on_right_track: true, reasoning: 'judge-fail; defaulted to on-track' };
      }
      log(`[nemotron-omni] type-judge: ${JSON.stringify(judge)}`);

      const description = decision.description || `Type "${text}"`;
      const baseRec = {
        kind: 'type', url, title,
        text, description, reasoning: decision.reasoning, judge,
      };

      // Auto-keep typing actions same as keyboard: typed text might not be
      // obvious from the after-shot until the model commits the text element.
      if (judge.on_right_track || judge.at_destination) {
        const kBefore = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_before.png`);
        const kAfter  = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_after.png`);
        copyFileSync(beforePath, kBefore);
        copyFileSync(afterPath, kAfter);
        const rec = {
          ...baseRec,
          step: filteredIndex,
          screenshotBefore: kBefore,
          screenshotAfter: kAfter,
        };
        filtered.push(rec);
        history.push(description);
        attempted.push({ ...rec, attempt: attemptIndex, accepted: true });
        filteredIndex++;
        attemptIndex++;

        if (judge.at_destination) {
          log(`[nemotron-omni] at_destination true after type — stopping with success.`);
          const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
          copyFileSync(afterPath, finalPath);
          filtered.push({
            step: filteredIndex, kind: 'done', url, title,
            screenshot: finalPath, reasoning: 'Nemotron-Omni: at_destination after type',
            judge,
          });
          filteredIndex++;
          break;
        }
        continue;
      } else {
        log(`[nemotron-omni] off-track after type → recording rejection`);
        attempted.push({
          ...baseRec, attempt: attemptIndex, accepted: false,
          screenshotBefore: beforePath, screenshotAfter: afterPath,
        });
        attemptedHere.push(`${description} → ${judge.reasoning}`);
        attemptedByState.set(sk, attemptedHere);
        attemptIndex++;
        continue;
      }
    }

    // CLICK branch (BEAM=0)
    const id = Number(decision.id);
    if (!Number.isInteger(id) || id < 0 || id >= clickables.length) {
      log(`step-loop ${stepLoop}: invalid id ${decision.id}; stopping`);
      break;
    }
    const target = clickables[id];

    await scrollAndMark(page, id);
    await page.waitForTimeout(500);
    const liveRect = await remeasureMarked(page);
    if (!liveRect || liveRect.w < 1) {
      log(`attempt ${attemptIndex}: could not remeasure id=${id}; banning and retrying`);
      blacklist.push(id);
      continue;
    }

    const beforePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_before.png`);
    await page.screenshot({ path: beforePath });

    const scrollYBeforeClick = await page.evaluate(() => window.scrollY);

    const clickX = liveRect.x + liveRect.w / 2;
    const clickY = liveRect.y + liveRect.h / 2;

    let urlChanged = false;
    let textChanged = false;
    let newUrlAfterClick = url;
    try {
      log(`attempt ${attemptIndex}: clicking (${Math.round(clickX)}, ${Math.round(clickY)}) — "${target.text || target.aria}"`);
      await page.mouse.click(clickX, clickY);
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        await page.waitForTimeout(250);
        const nowUrl = page.url();
        if (nowUrl !== url) { urlChanged = true; newUrlAfterClick = nowUrl; break; }
        const nowText = await gatherPageText(page).catch(() => '');
        if (nowText.length > 100 && Math.abs(nowText.length - pageText.length) > 80) {
          textChanged = true;
          break;
        }
      }
      if (urlChanged) {
        await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1500);
        newUrlAfterClick = page.url();
      } else {
        await page.waitForTimeout(800);
      }
    } catch (e) {
      log(`attempt ${attemptIndex}: click failed: ${e.message}`);
      attemptIndex++;
      continue;
    }

    const afterPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
    await page.screenshot({ path: afterPath });

    const clickFullPagePath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_fullpage.png`);
    try { await page.screenshot({ path: clickFullPagePath, fullPage: true }); }
    catch (e) { log(`attempt ${attemptIndex}: click fullpage failed: ${e.message}`); }

    let onlyFragmentChanged = false;
    if (urlChanged) {
      try {
        const oldUrlObj = new URL(url);
        const newUrlObj = new URL(newUrlAfterClick);
        onlyFragmentChanged =
          oldUrlObj.pathname === newUrlObj.pathname &&
          oldUrlObj.hash !== newUrlObj.hash;
      } catch (e) {}
    }

    if (onlyFragmentChanged) {
      const scrollAfter = await page.evaluate(() => window.scrollY);
      const scrolledMeaningfully = Math.abs(scrollAfter - scrollYBeforeClick) > 40;

      if (!scrolledMeaningfully) {
        log(`attempt ${attemptIndex}: HASH-ANCHOR NO-OP — fragment changed (${url} -> ${newUrlAfterClick}) but scrollY ${scrollYBeforeClick}->${scrollAfter} (no movement). Banning id=${id} locally.`);
        blacklist.push(id);
        const description = decision.description || `Click ${target.text || target.aria || target.tag}`;
        attempted.push({
          attempt: attemptIndex, accepted: false, kind: 'click', url, title,
          target: { tag: target.tag, text: target.text, aria: target.aria, href: target.href },
          description, reasoning: decision.reasoning,
          noop: true, hashAnchorNoOp: true,
          landedUrl: newUrlAfterClick,
          screenshotBefore: beforePath, screenshotAfter: afterPath,
        });
        attemptedHere.push(`Clicking ${description} only changed the URL fragment — did not navigate to a new page. Pick a different link.`);
        attemptedByState.set(sk, attemptedHere);
        try {
          if (page.url() !== stateBefore.url) {
            await page.goto(stateBefore.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
            await page.waitForFunction(() => document.body && document.body.children.length > 0, { timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(1500);
          }
          await page.evaluate((y) => window.scrollTo(0, y), stateBefore.scrollY);
          await page.waitForTimeout(400);
        } catch (e) {
          log(`hash-anchor rollback failed: ${e.message}`);
        }
        attemptIndex++;
        continue;
      } else {
        log(`attempt ${attemptIndex}: TOC anchor click — fragment changed AND viewport scrolled ${scrollYBeforeClick}->${scrollAfter} (Δ=${scrollAfter - scrollYBeforeClick}px). Treating as valid navigation.`);
      }
    }

    if (!urlChanged && !textChanged) {
      log(`attempt ${attemptIndex}: NO-OP click. Banning id=${id} locally.`);
      blacklist.push(id);
      attempted.push({
        attempt: attemptIndex, accepted: false, kind: 'click', url, title,
        target: { tag: target.tag, text: target.text, aria: target.aria, href: target.href },
        description: decision.description || `Click ${target.text || target.aria || target.tag}`,
        reasoning: decision.reasoning,
        noop: true,
        screenshotBefore: beforePath, screenshotAfter: afterPath,
      });
      attemptIndex++;
      continue;
    }

    let judge;
    try {
      judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: afterPath });
    } catch (e) {
      log(`attempt ${attemptIndex}: nemotron-omni judge failed: ${e.message} — defaulting to on-track`);
      judge = { at_destination: false, on_right_track: true, reasoning: 'judge-fail; defaulted to on-track' };
    }
    log(`[nemotron-omni] judge: ${JSON.stringify(judge)}`);

    const description = decision.description || `Click ${target.text || target.aria || target.tag}`;
    const baseRec = {
      kind: 'click', url, title,
      target: { tag: target.tag, text: target.text, aria: target.aria, href: target.href },
      click: { x: clickX, y: clickY, rect: liveRect },
      description, reasoning: decision.reasoning,
      changeKind: urlChanged ? 'url' : 'text',
      judge,
    };

    if (judge.on_right_track || judge.at_destination) {
      const kBefore = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_before.png`);
      const kAfter  = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_after.png`);
      const kFull   = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_fullpage.png`);
      copyFileSync(beforePath, kBefore);
      copyFileSync(afterPath, kAfter);
      let savedFullPage = null;
      if (existsSync(clickFullPagePath)) {
        copyFileSync(clickFullPagePath, kFull);
        savedFullPage = kFull;
      }
      const rec = {
        ...baseRec,
        step: filteredIndex,
        screenshotBefore: kBefore,
        screenshotAfter: kAfter,
        screenshotFullPage: savedFullPage,
      };
      filtered.push(rec);
      history.push(description);
      attempted.push({ ...rec, attempt: attemptIndex, accepted: true });
      filteredIndex++;
      attemptIndex++;

      if (judge.at_destination) {
        log(`[nemotron-omni] at_destination true after click — stopping with success.`);
        const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
        copyFileSync(afterPath, finalPath);
        filtered.push({
          step: filteredIndex, kind: 'done', url: page.url(), title: await page.title(),
          screenshot: finalPath, reasoning: 'Nemotron-Omni: at_destination after click',
          judge,
        });
        filteredIndex++;
        break;
      }
      continue;
    } else {
      const landedUrl = page.url();
      log(`[nemotron-omni] off-track → rolling back to ${stateBefore.url} @ y=${stateBefore.scrollY}`);
      attempted.push({
        ...baseRec, attempt: attemptIndex, accepted: false,
        screenshotBefore: beforePath, screenshotAfter: afterPath,
      });
      try {
        await page.goto(stateBefore.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await page.waitForFunction(() => document.body && document.body.children.length > 0, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await page.evaluate((y) => window.scrollTo(0, y), stateBefore.scrollY);
        await page.waitForTimeout(400);
      } catch (e) {
        log(`rollback failed: ${e.message}`);
      }
      attemptedHere.push(`${description} → landed on ${landedUrl} — judge: ${judge.reasoning}`);
      attemptedByState.set(sk, attemptedHere);
      attemptIndex++;
      continue;
    }
  }
} else {
  // ------------------------------------------------------------------------
  // BEAM=1: multi-tab beam search.
  //
  // Per round:
  //   1. Snapshot lead state (url, scrollY, clickables, text).
  //   2. Super 120B returns top-(K-1) candidates (slot 0 is the search scout).
  //   3. Open K fresh contexts, launch K candidates in parallel.
  //   4. Snapshot all K after-shots, judge in parallel.
  //   5. Pick winner:
  //        - First at_destination=true wins terminally.
  //        - Else highest-on-track (ties broken by Super's score).
  //        - All off-track -> rollback, blacklist these descriptions, retry.
  //   6. Replace lead context with winner's context; close losers.
  // ------------------------------------------------------------------------
  let roundIdx = 0;
  while (roundIdx < MAX_STEPS) {
    const leadUrl = leadPage.url();
    const leadTitle = await leadPage.title();
    const leadClickables = await gatherClickables(leadPage);
    const leadText = await gatherPageText(leadPage);
    const leadScroll = await leadPage.evaluate(() => ({
      scrollY: window.scrollY,
      fullPageHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));

    const sk = stateKey(leadUrl, leadScroll.scrollY);
    const rejectedHere = attemptedByState.get(sk) || [];

    log(`beam-round ${roundIdx} (kept ${filteredIndex}): ${leadUrl} (${leadClickables.length} clickables, scrollY=${leadScroll.scrollY}/${leadScroll.fullPageHeight}, ${rejectedHere.length} rejected here)`);

    // 2. Pick top (K-1) Super-120B candidates (slot 0 is the search scout).
    let topK;
    try {
      topK = await pickTopKCandidates({
        goal: GOAL, url: leadUrl, title: leadTitle, pageText: leadText,
        clickables: leadClickables, history,
        scrollY: leadScroll.scrollY,
        fullPageHeight: leadScroll.fullPageHeight,
        viewportHeight: leadScroll.viewportHeight,
        rejectedDescriptions: rejectedHere,
        K: BEAM_K - 1,
      });
    } catch (e) {
      log(`beam-round ${roundIdx}: top-K planner failed: ${e.message}; stopping`);
      break;
    }
    if (topK.done) {
      const checkPath = join(OUT_DIR, 'attempted-screenshots', `attempt_${attemptIndex}_after.png`);
      await leadPage.screenshot({ path: checkPath });
      let judge;
      try {
        judge = await callNemotronOmniJudge({ goal: GOAL, screenshotPath: checkPath });
      } catch (e) {
        judge = { at_destination: true, on_right_track: true, reasoning: 'judge-fail; accepting done' };
      }
      log(`[beam] done-check: ${JSON.stringify(judge)}`);
      if (judge.at_destination) {
        const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
        copyFileSync(checkPath, finalPath);
        filtered.push({
          step: filteredIndex, kind: 'done', url: leadUrl, title: leadTitle,
          screenshot: finalPath, reasoning: topK.reasoning, judge,
        });
        filteredIndex++;
        attemptIndex++;
        break;
      }
      // Otherwise treat as no-op for this round and continue.
      rejectedHere.push(`model declared done but judge disagreed: ${judge.reasoning}`);
      attemptedByState.set(sk, rejectedHere);
      roundIdx++;
      continue;
    }
    const superCandidates = topK.candidates || [];
    log(`beam-round ${roundIdx}: super proposed ${superCandidates.length} candidates`);

    // 3. Build the K-tab plan. Slot 0 = search scout. Slots 1..K-1 = top Super candidates.
    // Each "beam slot" gets its own context.
    const slots = [];
    // Slot 0: search-scout placeholder.
    slots.push({
      slot: 0,
      kind: 'search-scout',
      description: `Try site search for "${GOAL.slice(0, 70)}"`,
      score: 0.85, // optimistic prior — search is high-value when it works
      candidate: null, // resolved at execution time
    });
    for (let i = 0; i < superCandidates.length && slots.length < BEAM_K; i++) {
      slots.push({
        slot: slots.length,
        kind: 'super-candidate',
        candidate: superCandidates[i],
        score: superCandidates[i].score,
        description: superCandidates[i].action?.description || 'super candidate',
      });
    }
    // If Super returned too few (e.g. K-1=3, returned 2), pad with the highest-scoring duplicate.
    while (slots.length < BEAM_K && superCandidates.length) {
      const c = superCandidates[(slots.length - 1) % superCandidates.length];
      slots.push({
        slot: slots.length,
        kind: 'super-candidate',
        candidate: c,
        score: c.score * 0.5,
        description: c.action?.description || 'duplicate candidate',
      });
    }

    // 4. Execute K slots in parallel — each in its own fresh context.
    // Stagger context creation 75ms apart to avoid sandbox pthread_create cap
    // when Chromium's zygote spawns 14+ renderer processes simultaneously.
    const newContexts = [];
    for (let _i = 0; _i < slots.length; _i++) {
      newContexts.push(await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true }));
      if (_i < slots.length - 1) await new Promise(r => setTimeout(r, 75));
    }
    // v21: one record-handle box per slot, mutated by attachScoutScreencast inside the executors.
    const recordHandles = slots.map(() => ({ handle: null }));
    const execStartMs = Date.now();
    // Stagger scout dispatch 75ms apart — newPage()/navigation in each branch
    // also contributes to the simultaneous-spawn process-cap thunder.
    const _slotPromises = [];
    for (let _si = 0; _si < slots.length; _si++) {
      const slot = slots[_si];
      const i = _si;
      _slotPromises.push((async () => {
      const ctx = newContexts[i];
      const recBox = recordHandles[i];
      if (slot.kind === 'search-scout') {
        const beforePath = join(OUT_DIR, 'beam-screenshots', `r${roundIdx}_s0_before.png`);
        const afterPath  = join(OUT_DIR, 'beam-screenshots', `r${roundIdx}_s0_after.png`);
        const scoutPage = await trySearchScout(ctx, GOAL, leadUrl, { roundIdx, beamSlot: 0, recordHandle: recBox });
        if (scoutPage) {
          try { await scoutPage.screenshot({ path: afterPath }); } catch {}
          return {
            ok: true,
            kind: 'search-scout',
            page: scoutPage,
            context: ctx,
            description: slot.description,
            score: slot.score,
            beforePath, afterPath,
            urlBefore: leadUrl,
            urlAfter: scoutPage.url(),
            scrollYBefore: 0,
            scrollYAfter: await scoutPage.evaluate(() => window.scrollY).catch(() => 0),
            candidate: null,
          };
        }
        // Scout failed — fall back to executing the highest-ranked Super candidate
        // (clone of slot 1's candidate). Marker: kind='scout-fallback'.
        const fallbackCandidate = superCandidates[0];
        if (!fallbackCandidate) {
          return { ok: false, kind: 'search-scout', reason: 'no scout, no fallback', context: ctx, page: null, beforePath, afterPath, urlBefore: leadUrl, urlAfter: leadUrl, scrollYBefore: 0, scrollYAfter: 0, candidate: null, description: slot.description, score: slot.score };
        }
        const res = await executeCandidate({
          candidate: fallbackCandidate, context: ctx,
          startUrl: leadUrl, scrollYStart: leadScroll.scrollY,
          prevClickables: leadClickables, beamSlot: 0, roundIdx,
          recordHandle: recBox,
        });
        return { ...res, kind: 'scout-fallback', context: ctx, score: slot.score, description: `(scout fallback) ${fallbackCandidate.action?.description || ''}` };
      }
      // Super candidate
      const res = await executeCandidate({
        candidate: slot.candidate, context: ctx,
        startUrl: leadUrl, scrollYStart: leadScroll.scrollY,
        prevClickables: leadClickables, beamSlot: i, roundIdx,
        recordHandle: recBox,
      });
      return { ...res, kind: slot.kind, context: ctx, score: slot.score, description: slot.description };
      })());
      if (_si < slots.length - 1) await new Promise(r => setTimeout(r, 75));
    }
    const slotResults = await Promise.all(_slotPromises);
    const execMs = Date.now() - execStartMs;
    log(`beam-round ${roundIdx}: executed ${slotResults.length} slots in ${execMs}ms`);

    // 5. Judge all K in parallel.
    const judges = await Promise.all(slotResults.map(async (r) => {
      if (!r.ok) {
        return { at_destination: false, on_right_track: false, reasoning: `execute failed: ${r.reason || 'unknown'}` };
      }
      if (!existsSync(r.afterPath)) {
        return { at_destination: false, on_right_track: false, reasoning: 'no after screenshot' };
      }
      try {
        return await callNemotronOmniJudge({ goal: GOAL, screenshotPath: r.afterPath });
      } catch (e) {
        return { at_destination: false, on_right_track: false, reasoning: `judge error: ${e.message}` };
      }
    }));
    slotResults.forEach((r, i) => {
      r.judge = judges[i];
      log(`beam-round ${roundIdx} slot ${i} [${r.kind}] ${r.urlAfter || '?'} ot=${judges[i].on_right_track} at=${judges[i].at_destination} | ${judges[i].reasoning?.slice(0, 120) || ''}`);
    });

    // Record exploration log entry for this round (all K branches).
    exploration.push({
      round: roundIdx,
      leadUrl, leadScrollY: leadScroll.scrollY, leadTitle,
      branches: slotResults.map((r, i) => ({
        slot: i,
        kind: r.kind,
        description: r.description,
        score: r.score,
        ok: r.ok,
        reason: r.reason || null,
        urlBefore: r.urlBefore, urlAfter: r.urlAfter,
        scrollYBefore: r.scrollYBefore, scrollYAfter: r.scrollYAfter,
        beforePath: r.beforePath, afterPath: r.afterPath,
        judge: r.judge,
        candidate: r.candidate || null,
      })),
    });

    // 6. Pick winner.
    let winnerIdx = -1;
    // First check at_destination.
    for (let i = 0; i < slotResults.length; i++) {
      if (slotResults[i].ok && judges[i].at_destination) {
        winnerIdx = i;
        break;
      }
    }
    if (winnerIdx < 0) {
      // Pick highest-scoring on-track slot.
      let bestScore = -1;
      for (let i = 0; i < slotResults.length; i++) {
        if (!slotResults[i].ok) continue;
        if (!judges[i].on_right_track) continue;
        const s = slotResults[i].score ?? 0;
        if (s > bestScore) { bestScore = s; winnerIdx = i; }
      }
    }

    if (winnerIdx < 0) {
      // All off-track. Rollback, record rejections, retry.
      log(`beam-round ${roundIdx}: all K off-track — rolling back`);
      for (const r of slotResults) {
        const descTag = r.description || r.candidate?.action?.description || r.kind;
        const reason = r.judge?.reasoning || r.reason || 'off-track';
        rejectedHere.push(`${descTag} → ${reason}`);
        attempted.push({
          attempt: attemptIndex++,
          accepted: false,
          kind: r.kind,
          url: r.urlBefore,
          urlAfter: r.urlAfter,
          description: descTag,
          judge: r.judge,
          screenshotBefore: r.beforePath,
          screenshotAfter: r.afterPath,
        });
      }
      attemptedByState.set(sk, rejectedHere);
      // v21: stop all screencasts before closing contexts.
      await Promise.all(recordHandles.map(async (rb) => { try { if (rb.handle) await rb.handle.stop(); } catch {} }));
      // Close all the loser contexts.
      await Promise.all(newContexts.map(async (c) => { try { await c.close(); } catch {} }));
      roundIdx++;
      continue;
    }

    // We have a winner. Promote it to lead.
    const winner = slotResults[winnerIdx];
    const winnerJudge = judges[winnerIdx];
    log(`beam-round ${roundIdx}: WINNER slot ${winnerIdx} [${winner.kind}] -> ${winner.urlAfter}`);

    // Persist winner's screenshots into the filtered slot.
    const kBefore = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_before.png`);
    const kAfter  = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_after.png`);
    try { if (existsSync(winner.beforePath)) copyFileSync(winner.beforePath, kBefore); } catch {}
    try { if (existsSync(winner.afterPath))  copyFileSync(winner.afterPath,  kAfter);  } catch {}

    const winnerDescription = winner.description || winner.candidate?.action?.description || `Slot ${winnerIdx} action`;
    const filteredRec = {
      step: filteredIndex,
      kind: winner.kind === 'search-scout' ? 'search' : (winner.candidate?.action?.scroll ? 'scroll' : 'click'),
      url: winner.urlBefore,
      urlAfter: winner.urlAfter,
      title: leadTitle,
      description: winnerDescription,
      reasoning: winner.candidate?.action?.reasoning || `winning beam slot ${winnerIdx}`,
      score: winner.score,
      judge: winnerJudge,
      screenshotBefore: kBefore,
      screenshotAfter: kAfter,
      beamSlot: winnerIdx,
      beamKind: winner.kind,
    };
    // Preserve click coords if available (used by the renderer for highlight rings)
    if (winner.candidate?.action && Number.isInteger(Number(winner.candidate.action.id))) {
      const id = Number(winner.candidate.action.id);
      const target = leadClickables[id];
      if (target) {
        filteredRec.target = { tag: target.tag, text: target.text, aria: target.aria, href: target.href };
        filteredRec.click = {
          x: target.rect.x + target.rect.w / 2,
          y: target.rect.y + target.rect.h / 2,
          rect: target.rect,
        };
      }
    }
    filtered.push(filteredRec);
    history.push(winnerDescription);
    attempted.push({ ...filteredRec, attempt: attemptIndex++, accepted: true });
    filteredIndex++;

    // Promote winner's context: close lead + all other slots.
    const winnerContext = newContexts[winnerIdx];
    const winnerPage = winner.page;
    try { await cdp.send('Page.stopScreencast').catch(() => {}); } catch {}
    // v21: give the winner a destination beat (extra 2.5s of recording) before stopping its screencast.
    // For losers, stop immediately.
    if (winnerJudge.at_destination) {
      try { await winnerPage.waitForTimeout(2500); } catch {}
    }
    await Promise.all(recordHandles.map(async (rb, i) => {
      if (!rb.handle) return;
      try { await rb.handle.stop(); } catch {}
    }));
    // Promote winner FIRST so re-attach can't race context teardown.
    const priorLeadContext = leadContext;
    const isDefaultContext = priorLeadContext === browser.contexts()[0];
    leadContext = winnerContext;
    leadPage = winnerPage;
    // Re-attach screencast to the new lead BEFORE tearing down anything.
    try {
      cdp = await leadContext.newCDPSession(leadPage);
      cdp.on('Page.screencastFrame', async (frame) => {
        frameCounter++;
        try {
          const buf = Buffer.from(frame.data, 'base64');
          writeFileSync(join(OBS_DIR, 'latest.jpg'), buf);
          await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
        } catch {}
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 1440, maxHeight: 900, everyNthFrame: 2 });
    } catch (e) {
      log(`could not re-attach screencast to winner: ${e.message}`);
    }
    // Safe to tear down old lead. Close pages (not the default context itself),
    // because closing the default context of a connectOverCDP browser also closes
    // the browser-level CDP transport on which the new `cdp` session depends.
    if (isDefaultContext) {
      for (const p of priorLeadContext.pages()) { try { await p.close(); } catch {} }
    } else {
      try { await priorLeadContext.close(); } catch (e) { log(`could not close prior lead context: ${e.message}`); }
    }
    for (let i = 0; i < newContexts.length; i++) {
      if (i === winnerIdx) continue;
      try { await newContexts[i].close(); } catch (e) { log(`could not close loser ctx ${i}: ${e.message}`); }
    }

    if (winnerJudge.at_destination) {
      log(`[beam] at_destination true — stopping with success.`);
      const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
      try { copyFileSync(winner.afterPath, finalPath); } catch {}
      filtered.push({
        step: filteredIndex, kind: 'done', url: leadPage.url(), title: await leadPage.title().catch(() => leadTitle),
        screenshot: finalPath, reasoning: 'Nemotron-Omni: at_destination after beam round',
        judge: winnerJudge,
      });
      filteredIndex++;
      break;
    }
    roundIdx++;
  }
}

// ============================================================================
// Cleanup + emit logs.
// ============================================================================
try { await cdp.send('Page.stopScreencast').catch(() => {}); } catch {}

// Synthetic terminal "done" if loop exited without one.
if (filtered.length && filtered[filtered.length - 1].kind !== 'done') {
  const last = filtered[filtered.length - 1];
  const finalPath = join(OUT_DIR, 'screenshots', `step_${filteredIndex}_final.png`);
  if (last.screenshotAfter && existsSync(last.screenshotAfter)) {
    copyFileSync(last.screenshotAfter, finalPath);
  } else {
    try { await leadPage.screenshot({ path: finalPath }); } catch {}
  }
  filtered.push({
    step: filteredIndex,
    kind: 'done',
    url: last.url || (await leadPage.url().catch(() => START_URL)),
    title: last.title || '',
    screenshot: finalPath,
    reasoning: 'max_steps reached — synthetic done',
  });
  filteredIndex++;
}

const wallMs = Date.now() - startWallMs;


// ----------------------------------------------------------------------------
// v25 post-loop scene-timing enrichment.
//
// Walk every kept action and tag it with scene_weight + min_hold_seconds. The
// performer (replay-60fps.js) uses these to set per-scene wall-clock holds.
// ----------------------------------------------------------------------------
{
  const goalKw = deriveGoalKeyword(GOAL);
  log(`[timing] goalKeyword="${goalKw}" — enriching ${filtered.length} actions`);
  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const timing = computeSceneTiming(entry, goalKw);
    entry.scene_weight = timing.scene_weight;
    entry.min_hold_seconds = timing.min_hold_seconds;
    log(`[timing] step ${i} kind=${entry.kind} weight=${timing.scene_weight} hold=${timing.min_hold_seconds}s (at_dest=${entry.judge?.at_destination ?? 'n/a'})`);
  }
}

writeFileSync(join(OUT_DIR, 'action-log.json'), JSON.stringify({
  goal: GOAL,
  startUrl: START_URL,
  viewport: { width: 1440, height: 900 },
  mode: BEAM ? 'beam' : 'single',
  beamK: BEAM ? BEAM_K : 1,
  actions: filtered,
}, null, 2));

writeFileSync(join(OUT_DIR, 'attempted-log.json'), JSON.stringify({
  goal: GOAL,
  startUrl: START_URL,
  viewport: { width: 1440, height: 900 },
  mode: BEAM ? 'beam' : 'single',
  totalAttempts: attemptIndex,
  totalKept: filteredIndex,
  judgeCalls: judgeCallCount,
  superCalls: superCallCount,
  wallMs,
  judgeModel: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  attempts: attempted,
}, null, 2));

if (BEAM) {
  writeFileSync(join(OUT_DIR, 'exploration-log.json'), JSON.stringify({
    goal: GOAL,
    startUrl: START_URL,
    mode: 'beam',
    K: BEAM_K,
    rounds: exploration.length,
    judgeCalls: judgeCallCount,
    superCalls: superCallCount,
    wallMs,
    rounds_detail: exploration,
  }, null, 2));
}

log(`Done. filtered=${filteredIndex}, attempted=${attemptIndex}, super-calls=${superCallCount}, judge-calls=${judgeCallCount}, cdp-frames=${frameCounter}, wall=${wallMs}ms.`);
await browser.close().catch(() => {});
chromeProc.kill('SIGKILL');
