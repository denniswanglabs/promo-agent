// v22: native 60fps recording via Chrome DevTools Protocol screencast piped
// to ffmpeg. Replaces Playwright's recordVideo (which caps near 25fps in
// headless) with Page.screencastFrame -> mjpeg pipe -> libx264 mp4.
//
// Derived from performer-v11/replay.js (v19/v20 logic kept verbatim) with
// these surgical changes:
//   - context.newContext() no longer requests recordVideo
//   - per-page CDP session started BEFORE first goto, frames piped to a
//     long-lived ffmpeg child process
//   - context.close() preceded by Page.stopScreencast + ffmpeg.stdin.end()
//   - output discovery reads the mp4 ffmpeg wrote, no webm fallback
//   - --log / --out CLI flags so caller can target a specific log + path
//
// POC reference: /tmp/fps-poc-1/cdp-with-nav.js (ffmpeg args copied verbatim).

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------- CLI flag parsing (minimal, no deps) ----------
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}
const LOG_PATH = path.resolve(
  arg('--log', path.join(__dirname, '..', 'v11-action-log.json'))
);
const OUT_PATH = arg('--out', null); // optional: copy/move final mp4 here

// Read action log
const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));

// Lock scroll rate at 800 px/s for predictable wall-clock pacing in headless
const SCROLL_PX_PER_SECOND = 800;

// v19 cursor pacing (NOT v20's 1.67x slowdown — spec calls for v19 defaults).
const CURSOR_MOVE_MS = 700;
const CURSOR_PARK_MS = 600;

// v19: native 2560x1440 at deviceScaleFactor=1 so CDP screencast frames are
// exactly the CSS viewport, no upscaling.
const CSS_W = 2560;
const CSS_H = 1440;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: CSS_W, height: CSS_H },
    deviceScaleFactor: 1,
    // NOTE: no recordVideo — CDP screencast handles capture.
  });

  // Install cursor on every page (runs before any other script)
  await context.addInitScript(() => {
    window.__installCursor = () => {
      if (document.getElementById('__perfCursor')) return;
      const c = document.createElement('div');
      c.id = '__perfCursor';
      c.innerHTML =
        '<svg width="28" height="28" viewBox="0 0 28 28" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">' +
        '<path d="M3 3 L3 21 L9 15 L13 27 L17 25 L13 14 L21 14 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>' +
        '</svg>';
      c.style.cssText =
        'display:none; ' +
        'position:fixed; top:0; left:0; width:28px; height:28px; pointer-events:none; ' +
        'z-index:2147483647; transition: transform 0ms linear; transform: translate(-50px, -50px);';
      document.documentElement.appendChild(c);
    };
    if (document.readyState !== 'loading') window.__installCursor();
    else document.addEventListener('DOMContentLoaded', window.__installCursor);
  });

  const page = await context.newPage();

  // ---------- CDP screencast -> ffmpeg ----------
  const recordingsDir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
  const internalOut = path.join(recordingsDir, `cdp-${Date.now()}.mp4`);
  const ffmpegLog = '/tmp/v22-ffmpeg.log';
  const ffmpegLogStream = fs.createWriteStream(ffmpegLog);

  // Args copied from /tmp/fps-poc-1/cdp-with-nav.js (the verified working POC).
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y',
      '-f', 'image2pipe',
      '-use_wallclock_as_timestamps', '1',
      '-vcodec', 'mjpeg',
      '-i', 'pipe:0',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-fps_mode', 'cfr',
      '-r', '60',
      '-movflags', '+faststart',
      internalOut,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  ffmpeg.stdout.pipe(ffmpegLogStream);
  ffmpeg.stderr.pipe(ffmpegLogStream);
  ffmpeg.stdin.on('error', (e) => {
    // Backpressure / broken pipe — log and continue. Don't throw.
    console.log('[performer] ffmpeg stdin error:', e.code || e.message);
  });

  let framesReceived = 0;
  let firstFrameAt = null;
  let lastFrameAt = null;

  const session = await context.newCDPSession(page);
  session.on('Page.screencastFrame', async ({ data, sessionId }) => {
    const now = Date.now();
    if (firstFrameAt === null) firstFrameAt = now;
    lastFrameAt = now;
    framesReceived++;
    try {
      ffmpeg.stdin.write(Buffer.from(data, 'base64'));
    } catch (_) {
      // backpressure — frame dropped, will be padded by ffmpeg cfr
    }
    try {
      await session.send('Page.screencastFrameAck', { sessionId });
    } catch (_) {
      // session likely torn down; ignore
    }
  });

  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    everyNthFrame: 1,
  });

  // Helper: dismiss NVIDIA / OneTrust cookie banner
  async function dismissCookieBanner(page) {
    const candidates = [
      'button:has-text("Accept All Cookies")',
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("Accept Cookies")',
      'button:has-text("I Accept")',
      'button:has-text("Allow all")',
      'button:has-text("Got it")',
      'button:has-text("I understand")',
      '#onetrust-accept-btn-handler',
      '#truste-consent-button',
      '#cookieyes-button-accept-all',
      '.cmpwelcomebtnyes',
      'button[aria-label*="Accept" i]',
      'button[aria-label*="accept" i]',
      '[role="button"]:has-text("Accept")',
      'button[aria-label*="Accept"]',
      'button[aria-label*="accept"]',
    ];
    let hit = null;
    for (const sel of candidates) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ timeout: 1500 });
          await page.waitForTimeout(400);
          hit = sel;
          break;
        }
      } catch (_) { /* try next */ }
    }
    const hidden = await page.evaluate(() => {
      const sels = [
        '#onetrust-banner-sdk',
        '#onetrust-consent-sdk',
        '#truste-consent-track',
        '[id*="cookie-banner"]',
        '[id*="cookie-consent"]',
        '[class*="cookie-banner"]',
      ];
      let count = 0;
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          el.style.display = 'none';
          count++;
        }
      }
      return count;
    });
    if (hit || hidden) {
      console.log('[performer] cookie banner: clicked=' + (hit || 'none') + ', hidden=' + hidden);
    }
    return hit;
  }

  // 1. Navigate to startUrl
  console.log('[performer] navigating to', log.startUrl);
  await page.goto(log.startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__installCursor && window.__installCursor());
  await dismissCookieBanner(page);

  async function moveCursor(x, y, ms = CURSOR_MOVE_MS, opts = {}) {
    const { wait = true } = opts;
    await page.evaluate(
      ([x, y, ms]) => {
        window.__installCursor && window.__installCursor();
        const c = document.getElementById('__perfCursor');
        if (!c) return;
        c.style.transition = 'transform ' + ms + 'ms cubic-bezier(0.22, 1, 0.36, 1)';
        c.style.transform = 'translate(' + (x - 4) + 'px, ' + (y - 2) + 'px)';
      },
      [x, y, ms]
    );
    const mouseP = page.mouse.move(x, y, { steps: Math.max(10, Math.floor(ms / 30)) });
    if (wait) {
      await mouseP;
      await page.waitForTimeout(ms);
    } else {
      mouseP.catch(() => {});
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  async function clickRipple(x, y) {
    await page.evaluate(
      ([x, y]) => {
        const id = '__ripple_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        const r = document.createElement('div');
        r.id = id;
        r.style.cssText =
          'display:none; ' +
          'position:fixed; left:' + (x - 24) + 'px; top:' + (y - 24) + 'px; ' +
          'width:48px; height:48px; border-radius:50%; border:2.5px solid #84cc16; ' +
          'pointer-events:none; z-index:2147483646; opacity:1;';
        const style = document.createElement('style');
        style.textContent =
          '@keyframes __rippleExpand_' + id + ' { from { opacity:1; transform:scale(0.6); } to { opacity:0; transform:scale(2.4); } }';
        document.head.appendChild(style);
        document.documentElement.appendChild(r);
        r.style.animation = '__rippleExpand_' + id + ' 650ms ease-out forwards';
        setTimeout(() => {
          r.remove();
          style.remove();
        }, 700);
      },
      [x, y]
    );
    await page.waitForTimeout(650);
  }

  async function smoothScrollTo(y, ms = 1200) {
    await page.evaluate(
      ([y, ms]) => {
        return new Promise((resolve) => {
          const startY = window.scrollY;
          const diff = y - startY;
          const start = performance.now();
          const interval = setInterval(() => {
            const elapsed = performance.now() - start;
            const t = Math.min(1, elapsed / ms);
            const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            window.scrollTo(0, startY + diff * eased);
            if (t >= 1) {
              clearInterval(interval);
              resolve();
            }
          }, 16);
        });
      },
      [y, ms]
    );
    await page.waitForTimeout(100);
  }

  const PARK_X = Math.round(CSS_W * 0.7);
  const PARK_Y = Math.round(CSS_H * 0.5);
  console.log('[performer] parking cursor at (' + PARK_X + ', ' + PARK_Y + ')');
  await moveCursor(PARK_X, PARK_Y, CURSOR_PARK_MS);
  await page.waitForTimeout(400);

  console.log('[performer] opening beat (800ms hold)');
  await page.waitForTimeout(800);

  // --------------------------------------------------------------------------
  // Content-aware scene-hold (Piece 2 of the agent-driven timing architecture).
  //
  // Each action in the log MAY carry min_hold_seconds (computed by the agent
  // from page word count + climactic detection). After the existing per-action
  // pacing logic completes (click + cursor + ripple + page settle, or scroll,
  // etc.), we top up the wait so the scene's wall-clock duration >= that
  // minimum. This is what lets the destination page hold long enough for the
  // teaching overlay to be readable, instead of being cut at ~0.13s like
  // v22-overlayed-v2's /map-payment-data flash.
  //
  // sceneStartMs is reset at the START of each action (just before any
  // cursor/click work). topUpToMinHold() is called at the END.
  // --------------------------------------------------------------------------
  let sceneStartMs = Date.now();
  const resetSceneStart = () => { sceneStartMs = Date.now(); };
  async function topUpToMinHold(action, kindLabel) {
    const minHoldSec = Number(action && action.min_hold_seconds);
    if (!Number.isFinite(minHoldSec) || minHoldSec <= 0) return;
    // Transient scenes (cursor moves between visible elements) keep their
    // existing fast pacing — only extend if a meaningful min_hold_seconds is
    // set. We still honor it if the agent decided to mark transient w/ >0s.
    const minHoldMs = Math.round(minHoldSec * 1000);
    const alreadyWaitedMs = Date.now() - sceneStartMs;
    const remainingMs = minHoldMs - alreadyWaitedMs;
    if (remainingMs > 0) {
      console.log('[performer] hold-topup', kindLabel, 'min=' + minHoldSec + 's already=' + alreadyWaitedMs + 'ms topping up ' + remainingMs + 'ms (weight=' + (action.scene_weight || 'n/a') + ')');
      await page.waitForTimeout(remainingMs);
    } else {
      console.log('[performer] hold-ok', kindLabel, 'min=' + minHoldSec + 's already=' + alreadyWaitedMs + 'ms (weight=' + (action.scene_weight || 'n/a') + ')');
    }
  }

  const resolvedClicks = [];
  const visitedUrls = [log.startUrl];
  let stepIdx = 0;
  for (const action of log.actions) {
    stepIdx++;
    // A new scene begins at the start of every action — reset the wall-clock
    // counter so the topUp computation reflects only THIS action's elapsed.
    resetSceneStart();
    if (action.kind === 'click' && action.click) {
      let cx = action.click.x;
      let cy = action.click.y;
      const href = action.target && action.target.href;
      const text = action.target && action.target.text;
      try {
        let loc = null;
        if (href) {
          loc = page.locator(`a[href="${href}"]`).first();
          if (!(await loc.count())) loc = null;
        }
        if (!loc && text) {
          const firstWords = String(text).split(/\s+/).slice(0, 3).join(' ');
          loc = page.getByRole('link', { name: new RegExp(firstWords, 'i') }).first();
          if (!(await loc.count())) loc = null;
        }
        if (loc) {
          await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          const box = await loc.boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            cx = Math.round(box.x + box.width / 2);
            cy = Math.round(box.y + box.height / 2);
            console.log('[performer] step', stepIdx, 'resolved by selector -> (' + cx + ', ' + cy + ')');
          }
        }
      } catch (e) {
        console.log('[performer] step', stepIdx, 'selector lookup failed: ' + e.message);
      }
      console.log('[performer] step', stepIdx, 'click', cx, cy);
      let resolvedBox = null;
      try {
        if (href) {
          const lb = await page.locator(`a[href="${href}"]`).first().boundingBox();
          if (lb) resolvedBox = lb;
        }
      } catch (_) {}
      resolvedClicks.push({
        step: stepIdx,
        x: cx,
        y: cy,
        box: resolvedBox,
        text: text || null,
        href: href || null,
      });
      await moveCursor(cx, cy, CURSOR_MOVE_MS);
      await clickRipple(cx, cy);
      await page.mouse.click(cx, cy);
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
      try { visitedUrls.push(page.url()); } catch (_) {}
      await page.evaluate(() => window.__installCursor && window.__installCursor());
      await dismissCookieBanner(page);
      await page.waitForTimeout(500);
      await topUpToMinHold(action, 'click step ' + stepIdx);
    } else if (action.kind === 'scroll') {
      const targetY = action.scrollYAfter || 0;
      const startY = action.scrollYBefore || 0;
      const distance = Math.abs(targetY - startY);
      const ms = Math.max(800, Math.round((distance * 1000) / SCROLL_PX_PER_SECOND));
      console.log('[performer] step', stepIdx, 'scroll', startY, '->', targetY, '(' + ms + 'ms)');
      const cursorTargetX = Math.round(PARK_X + (Math.random() - 0.5) * 120);
      const cursorTargetY = Math.round(PARK_Y + (Math.random() - 0.5) * 80);
      const cursorMovePromise = moveCursor(cursorTargetX, cursorTargetY, ms, { wait: false });
      const scrollPromise = smoothScrollTo(targetY, ms);
      await Promise.all([cursorMovePromise, scrollPromise]);
      await page.waitForTimeout(250);
      await topUpToMinHold(action, 'scroll step ' + stepIdx);
    } else if (action.kind === 'drag') {
      // v23: drag action — sandbox emits from/to as {x,y}. Sandbox viewport is
      // 1440x900; replay viewport is 2560x1440. Scale to keep coords aligned.
      const SX = 2560 / 1440; // ~1.7778
      const SY = 1440 / 900;  // 1.6
      const fromRaw = action.from || {};
      const toRaw = action.to || {};
      const fromX = Math.round((fromRaw.x ?? 0) * SX);
      const fromY = Math.round((fromRaw.y ?? 0) * SY);
      const toX = Math.round((toRaw.x ?? 0) * SX);
      const toY = Math.round((toRaw.y ?? 0) * SY);
      console.log('[performer] step', stepIdx, 'drag', fromX, fromY, '->', toX, toY);

      // Animate cursor SVG from current parked position to start point
      await moveCursor(fromX, fromY, CURSOR_MOVE_MS);
      await page.mouse.move(fromX, fromY);
      await page.mouse.down();
      await page.waitForTimeout(80);

      // Stepped drag — matches the sandbox's stepped move pattern and gives
      // a natural cursor-follow trail in the recording.
      const STEPS = 24;
      const STEP_MS = 30;
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const x = Math.round(fromX + (toX - fromX) * t);
        const y = Math.round(fromY + (toY - fromY) * t);
        await page.mouse.move(x, y);
        await page.evaluate(
          ([x, y, ms]) => {
            const c = document.getElementById('__perfCursor');
            if (!c) return;
            c.style.transition = 'transform ' + ms + 'ms linear';
            c.style.transform = 'translate(' + (x - 4) + 'px, ' + (y - 2) + 'px)';
          },
          [x, y, STEP_MS]
        );
        await page.waitForTimeout(STEP_MS);
      }
      await page.mouse.up();
      await page.waitForTimeout(600);
      await topUpToMinHold(action, 'drag step ' + stepIdx);
    } else if (action.kind === 'keyboard') {
      const key = action.key || '';
      console.log('[performer] step', stepIdx, 'keyboard press', JSON.stringify(key));
      // Brief visual beat so viewers register the key press
      await page.waitForTimeout(400);
      // Small on-screen key cue (chip) so the press reads in the recording
      await page.evaluate(
        ([key]) => {
          const id = '__keychip_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
          const chip = document.createElement('div');
          chip.id = id;
          chip.textContent = key;
          chip.style.cssText =
            'position:fixed; left:50%; bottom:120px; transform:translate(-50%, 0); ' +
            'min-width:64px; padding:18px 28px; border-radius:14px; ' +
            'background:rgba(20,20,24,0.92); color:#fff; ' +
            'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif; ' +
            'font-weight:700; font-size:42px; text-align:center; ' +
            'border:2px solid #84cc16; box-shadow:0 8px 24px rgba(0,0,0,0.4); ' +
            'pointer-events:none; z-index:2147483647; opacity:0; ' +
            'transition:opacity 200ms ease-out, transform 200ms ease-out;';
          document.documentElement.appendChild(chip);
          requestAnimationFrame(() => {
            chip.style.opacity = '1';
            chip.style.transform = 'translate(-50%, -8px)';
          });
          setTimeout(() => {
            chip.style.opacity = '0';
            chip.style.transform = 'translate(-50%, 0)';
            setTimeout(() => chip.remove(), 250);
          }, 700);
        },
        [key]
      );
      await page.waitForTimeout(250);
      try {
        await page.keyboard.press(key);
      } catch (e) {
        console.log('[performer] step', stepIdx, 'keyboard.press failed:', e.message);
      }
      await page.waitForTimeout(600);
      await topUpToMinHold(action, 'keyboard step ' + stepIdx);
    } else if (action.kind === 'type') {
      // v24: type text into whatever has focus.
      // Excalidraw quirk — pressing "t" only ARMS the text tool; the editor
      // doesn't open until you click on the canvas. Sandbox-side this worked
      // because the agent's screenshot/judge cycle inserted a long pause that
      // let one stray click-equivalent happen, but in the replay path the
      // pause is shorter and Excalidraw's hotkey listener swallows the next
      // letter as a tool switch (a=arrow, d=diamond, etc.). To make typing
      // reliable, if the previous action was a "t" or "8" keyboard press
      // (Excalidraw text-tool shortcut) we click on the canvas at upper-center
      // first to open the text editor before typing.
      const text = action.text || '';
      const prev = log.actions[stepIdx - 2]; // stepIdx is 1-based here
      const needsCanvasClick =
        prev && prev.kind === 'keyboard' &&
        typeof prev.key === 'string' &&
        ['t', 'T', '8'].includes(prev.key);
      if (needsCanvasClick) {
        const cx = Math.round(CSS_W * 0.45);
        const cy = Math.round(CSS_H * 0.42);
        console.log('[performer] step', stepIdx, 'pre-type canvas click to open text editor', cx, cy);
        await moveCursor(cx, cy, CURSOR_MOVE_MS);
        await clickRipple(cx, cy);
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(500);
      }
      console.log('[performer] step', stepIdx, 'type', JSON.stringify(text));
      await page.waitForTimeout(300);
      try {
        await page.keyboard.type(text, { delay: 80 });
      } catch (e) {
        console.log('[performer] step', stepIdx, 'keyboard.type failed:', e.message);
      }
      await page.waitForTimeout(500);
      await topUpToMinHold(action, 'type step ' + stepIdx);
    } else if (action.kind === 'clickAt') {
      // v24: raw canvas-coordinate click. Sandbox coords are 1440x900; replay
      // viewport is 2560x1440 — scale to match (same as drag).
      const SX = 2560 / 1440; // ~1.7778
      const SY = 1440 / 900;  // 1.6
      const pos = action.position || [0, 0];
      const x = Math.round((pos[0] ?? 0) * SX);
      const y = Math.round((pos[1] ?? 0) * SY);
      console.log('[performer] step', stepIdx, 'clickAt', x, y);
      await moveCursor(x, y, CURSOR_MOVE_MS);
      await clickRipple(x, y);
      await page.mouse.click(x, y);
      await page.waitForTimeout(400);
      await topUpToMinHold(action, 'clickAt step ' + stepIdx);
    } else if (action.kind === 'freedraw') {
      // v26: freeform polyline draw on a canvas. Sandbox emits action.points as
      // an array of [x, y] in the 1440x900 sandbox viewport. Scale to the
      // replay 2560x1440 viewport (same SX/SY as drag/clickAt).
      const SX = 2560 / 1440; // ~1.7778
      const SY = 1440 / 900;  // 1.6
      const rawPoints = Array.isArray(action.points) ? action.points : (Array.isArray(action.freedraw) ? action.freedraw : []);
      const scaled = [];
      for (const p of rawPoints) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = Number(p[0]);
        const y = Number(p[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        scaled.push([Math.round(x * SX), Math.round(y * SY)]);
      }
      if (scaled.length < 2) {
        console.log('[performer] step', stepIdx, 'freedraw skipped — only', scaled.length, 'valid scaled points');
      } else {
        const [x0, y0] = scaled[0];
        console.log('[performer] step', stepIdx, 'freedraw', scaled.length, 'points starting at', x0, y0);

        // Animate cursor SVG from parked position to first point
        await moveCursor(x0, y0, CURSOR_MOVE_MS);
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        await page.waitForTimeout(80);

        // Walk through the polyline, advancing both the real mouse and the
        // on-page cursor SVG so the freedraw stroke + the cursor trail land in
        // sync in the recording. Inter-point pause is small so a long polyline
        // doesn't blow past the min-hold budget.
        const STEP_MS = 40;
        for (let i = 1; i < scaled.length; i++) {
          const [x, y] = scaled[i];
          await page.mouse.move(x, y, { steps: 4 });
          await page.evaluate(
            ([x, y, ms]) => {
              const c = document.getElementById('__perfCursor');
              if (!c) return;
              c.style.transition = 'transform ' + ms + 'ms linear';
              c.style.transform = 'translate(' + (x - 4) + 'px, ' + (y - 2) + 'px)';
            },
            [x, y, STEP_MS]
          );
          await page.waitForTimeout(STEP_MS);
        }
        await page.mouse.up();
        await page.waitForTimeout(600);
      }
      await topUpToMinHold(action, 'freedraw step ' + stepIdx);
    } else if (action.kind === 'done') {
      console.log('[performer] step', stepIdx, 'done');
      await page.waitForTimeout(1500);
      await topUpToMinHold(action, 'done step ' + stepIdx);
    } else {
      console.log('[performer] step', stepIdx, 'unknown kind:', action.kind);
    }
  }

  console.log('[performer] tail beat (1000ms hold)');
  await page.waitForTimeout(1000);

  // ---------- Stop screencast + drain ffmpeg ----------
  console.log('[performer] stopping screencast...');
  try {
    await session.send('Page.stopScreencast');
  } catch (e) {
    console.log('[performer] stopScreencast failed (likely benign):', e.message);
  }
  // Give any in-flight frames a moment to flush before closing stdin
  await new Promise((r) => setTimeout(r, 250));
  ffmpeg.stdin.end();
  console.log('[performer] waiting for ffmpeg to close...');
  await new Promise((r) => ffmpeg.on('close', r));
  ffmpegLogStream.end();

  await context.close();
  await browser.close();

  const wall = lastFrameAt && firstFrameAt ? (lastFrameAt - firstFrameAt) / 1000 : 0;
  console.log('[performer] frames received:', framesReceived);
  console.log('[performer] wall-clock span:', wall.toFixed(3) + 's');
  if (wall > 0) {
    console.log('[performer] measured rx fps:', (framesReceived / wall).toFixed(2));
  }
  console.log('[performer] recorded:', internalOut);
  console.log('[performer] ffmpeg stderr log:', ffmpegLog);
  console.log('[performer] visited urls:', visitedUrls.join(' -> '));

  fs.writeFileSync(path.join(__dirname, '.last-recording-path'), path.resolve(internalOut));
  fs.writeFileSync(
    path.join(__dirname, '.last-coords.json'),
    JSON.stringify(
      { cssWidth: CSS_W, cssHeight: CSS_H, videoWidth: CSS_W, videoHeight: CSS_H, clicks: resolvedClicks, visitedUrls },
      null,
      2
    )
  );

  if (OUT_PATH) {
    const resolved = path.resolve(OUT_PATH.replace(/^~/, process.env.HOME || ''));
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.copyFileSync(internalOut, resolved);
    console.log('[performer] copied to:', resolved);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
