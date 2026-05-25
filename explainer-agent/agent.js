// agent.js — explainer-video agent loop (demo)
//
// Drives a public web app via Playwright. At each step, ships the visible
// clickable elements to Nemotron 3 Super 120B (via NVIDIA NIM) and asks for
// the single next click toward the goal. Captures before/after screenshots
// and the click position so a downstream Remotion composition can render a
// polished walkthrough.
//
// Usage:
//   source ~/.zshrc && node agent.js
//
// Env overrides:
//   GOAL='...'  START_URL='https://...'  HEADED=1  MAX_STEPS=8

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GOAL      = process.env.GOAL      || 'Find the installation command for the Button component';
const START_URL = process.env.START_URL || 'https://ui.shadcn.com';
const MAX_STEPS = Number(process.env.MAX_STEPS || 6);
const HEADED    = process.env.HEADED !== '0';
const OUT_DIR   = './run';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

if (!NVIDIA_API_KEY) {
  console.error('NVIDIA_API_KEY not set. Run: source ~/.zshrc');
  process.exit(1);
}

mkdirSync(join(OUT_DIR, 'screenshots'), { recursive: true });

const NEMOTRON_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/llama-3.1-nemotron-70b-instruct',
];

async function callNemotron(messages) {
  let lastErr;
  for (const model of NEMOTRON_MODELS) {
    try {
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${NVIDIA_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: 800,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        lastErr = new Error(`HTTP ${res.status} from ${model}: ${body.slice(0, 300)}`);
        continue;
      }
      const data = await res.json();
      const msg = data.choices?.[0]?.message ?? {};
      return {
        model,
        text: (msg.content ?? '').trim(),
        reasoning: (msg.reasoning_content ?? '').trim(),
        finish: data.choices?.[0]?.finish_reason,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function parseJsonLoose(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  throw new Error(`Could not parse JSON. Raw response:\n${raw}`);
}

async function pickNextAction({ goal, url, title, pageText, clickables, history }) {
  const listing = clickables.map((c, i) =>
    `[${i}] <${c.tag}> "${(c.text || c.aria || '(no text)').slice(0, 70)}"${c.href ? ` href=${c.href.slice(0, 60)}` : ''}`
  ).join('\n');
  const hist = history.length
    ? history.map((h, i) => `  ${i + 1}. ${h}`).join('\n')
    : '  (none yet)';

  const messages = [
    {
      role: 'system',
      content:
`You drive a web browser to demonstrate a UI task end-to-end.
Reply with valid JSON ONLY — no prose, no markdown fences.
Pick the SINGLE best next click. Prefer specific elements over generic navigation.
If the goal is already visible / satisfied on the current page, reply with {"done": true, "reasoning": "..."}.
If no listed element is right, reply with {"done": true, "reasoning": "stuck: <why>"}.`,
    },
    {
      role: 'user',
      content:
`Goal: ${goal}
URL: ${url}
Page title: ${title}
Visible text snippet (first 600 chars): ${pageText.slice(0, 600)}

Actions taken so far:
${hist}

Clickable elements visible on screen:
${listing}

Reply with ONE of:
  {"id": <number>, "description": "Click ...", "reasoning": "..."}
  {"done": true, "reasoning": "..."}`,
    },
  ];

  const { model, text, reasoning, finish } = await callNemotron(messages);
  if (!text && finish === 'length') {
    throw new Error(`Nemotron hit max_tokens before finishing the answer. Reasoning trace: ${reasoning.slice(0, 200)}...`);
  }
  // Print the reasoning trace so the human watching can see HOW the
  // agent picked the click, not just the final answer.
  if (reasoning) {
    const wrapped = reasoning.slice(0, 400).replace(/\n+/g, ' ').trim();
    console.log(`    thinking: ${wrapped}${reasoning.length > 400 ? '...' : ''}`);
  }
  return { decision: parseJsonLoose(text), model, raw: text, reasoning };
}

async function gatherClickables(page) {
  return await page.evaluate(() => {
    const sel = 'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';
    const all = Array.from(document.querySelectorAll(sel));
    const seen = new Set();
    const out = [];
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width < 4 || rect.height < 4) continue;
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight + 800) continue;
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const aria = el.getAttribute('aria-label') || '';
      const key = `${el.tagName}|${text}|${aria}|${Math.round(rect.x)},${Math.round(rect.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 120),
        aria,
        href: el.getAttribute('href') || '',
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      });
      if (out.length >= 40) break;
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

async function scrollAndRemeasure(page, idx) {
  // Scroll the target into the middle of the viewport, then return its
  // (x, y, w, h) in viewport coordinates. Returns null if not found.
  return await page.evaluate((i) => {
    const sel = 'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';
    const all = Array.from(document.querySelectorAll(sel));
    const visible = [];
    const seen = new Set();
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width < 4 || rect.height < 4) continue;
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight + 800) continue;
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const aria = el.getAttribute('aria-label') || '';
      const key = `${el.tagName}|${text}|${aria}|${Math.round(rect.x)},${Math.round(rect.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      visible.push(el);
      if (visible.length >= 40) break;
    }
    const target = visible[i];
    if (!target) return null;
    target.setAttribute('data-explainer-target', '1');
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return null; // we re-measure after the scroll settles
  }, idx);
}

async function remeasureMarked(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('[data-explainer-target="1"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function clearMark(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-explainer-target="1"]');
    if (el) el.removeAttribute('data-explainer-target');
  });
}

const actions = [];
const history = [];

console.log(`Launching browser (headed=${HEADED})...`);
const browser = await chromium.launch({ headless: !HEADED, slowMo: 500 });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
});
const page = await context.newPage();

console.log(`Goal: ${GOAL}`);
console.log(`Start: ${START_URL}`);
await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(1200);

for (let step = 0; step < MAX_STEPS; step++) {
  const url = page.url();
  const title = await page.title();
  const clickables = await gatherClickables(page);
  const pageText = await gatherPageText(page);

  console.log(`\n[step ${step}] ${url}`);
  console.log(`  ${clickables.length} clickables, ${pageText.length} chars of text`);

  let decisionRes;
  try {
    decisionRes = await pickNextAction({ goal: GOAL, url, title, pageText, clickables, history });
  } catch (e) {
    console.error(`  Nemotron failed: ${e.message}`);
    break;
  }
  const { decision, model } = decisionRes;
  console.log(`  [${model}] decision:`, JSON.stringify(decision));

  if (decision.done) {
    // capture a final screenshot
    const finalPath = join(OUT_DIR, 'screenshots', `step_${step}_final.png`);
    await page.screenshot({ path: finalPath, fullPage: false });
    actions.push({
      step, kind: 'done', url, title,
      screenshot: finalPath,
      reasoning: decision.reasoning,
      model,
    });
    break;
  }

  const id = Number(decision.id);
  if (!Number.isInteger(id) || id < 0 || id >= clickables.length) {
    console.error(`  invalid id ${decision.id}; stopping`);
    break;
  }
  const target = clickables[id];

  // Scroll the target to viewport center, then re-measure (the original
  // coords from gatherClickables may be off-screen).
  await scrollAndRemeasure(page, id);
  await page.waitForTimeout(400);
  const liveRect = await remeasureMarked(page);
  if (!liveRect || liveRect.w < 1) {
    console.error(`  could not remeasure target id=${id}; stopping`);
    await clearMark(page);
    break;
  }

  // Screenshot BEFORE the click (this is the still the cursor will fly into)
  const beforePath = join(OUT_DIR, 'screenshots', `step_${step}_before.png`);
  await page.screenshot({ path: beforePath, fullPage: false });

  const clickX = liveRect.x + liveRect.w / 2;
  const clickY = liveRect.y + liveRect.h / 2;

  await clearMark(page);

  try {
    await page.mouse.click(clickX, clickY);
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
    // Pause longer so a human watching has time to see the page change
    await page.waitForTimeout(2500);
  } catch (e) {
    console.error(`  click failed: ${e.message}`);
    break;
  }

  const afterPath = join(OUT_DIR, 'screenshots', `step_${step}_after.png`);
  await page.screenshot({ path: afterPath, fullPage: false });

  const rec = {
    step, kind: 'click', url, title,
    target: { tag: target.tag, text: target.text, aria: target.aria, href: target.href },
    click: { x: clickX, y: clickY, rect: liveRect },
    description: decision.description || `Click ${target.text || target.aria || target.tag}`,
    reasoning: decision.reasoning,
    screenshotBefore: beforePath,
    screenshotAfter: afterPath,
    model,
  };
  actions.push(rec);
  history.push(rec.description);
}

writeFileSync(join(OUT_DIR, 'action-log.json'), JSON.stringify({
  goal: GOAL,
  startUrl: START_URL,
  viewport: { width: 1440, height: 900 },
  actions,
}, null, 2));

console.log(`\nDone. ${actions.length} actions saved to ${OUT_DIR}/action-log.json`);
await browser.close();
