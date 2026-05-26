# Cinematic UV-Crop Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current centroid-scaling `<CameraPan>` with a framed, UV-cropped cinematic stage that (a) shows a static matte around a rounded-corner inner rect, (b) zooms by sampling a sub-rect of the source video centered on the actual click coordinates with edge-snap clamping, and (c) suppresses the source-side cursor and click ripple so only the overlay cursor renders.

**Architecture:** Three-file change inside `explainer-agent/`. `replay-60fps.js` gets two small source-side suppressions (cursor + ripple). `auto-overlay-config.js` extends the `cameraEvents` schema with `targetCenter` (UV space) and `targetZoom` so the renderer doesn't have to redo the cluster/lone-click classification. `AutoOverlay.tsx` swaps `<CameraPan>` for a `<Stage>` + `<FramedScreen>` + `<VideoCrop>` stack that paints the gradient matte and applies the UV-crop transform (translate + scale, transform-origin 0 0) to the `<OffthreadVideo>` element. Cursor remounts inside `<FramedScreen>` and gets its coordinates run through the same transform so it tracks the zoomed video.

**Tech Stack:** Remotion (React-based renderer, 2560×1440 / 60fps), Playwright + CDP (`replay-60fps.js` performer), Node ES modules (`auto-overlay-config.js`), `ffmpeg`/`ffprobe` for verification.

**Spec source of truth:** `docs/superpowers/specs/2026-05-26-cinematic-uv-crop-design.md` at commit `76a737b`.

**Possible follow-up (do not block on):** A parallel openscreen.net teardown subagent may recommend a gradient upgrade. If a `docs/superpowers/specs/2026-05-26-stage-gradient-upgrade.md` lands before Phase 4 executes, patch the gradient values in Phase 4 Step 2; otherwise ship the navy→indigo gradient locked in the spec.

---

## File Structure

Three files change. No new files.

- **`explainer-agent/performer-v11/replay-60fps.js`** — source-side suppression of the DOM-injected cursor and click ripple. Two surgical CSS edits, no logic changes.
- **`explainer-agent/auto-overlay-config.js`** — extend `cameraEvents` emission to include UV-space `targetCenter` and explicit `targetZoom`. Existing cluster heuristic and 60% budget cap unchanged.
- **`explainer-agent/remotion/src/AutoOverlay.tsx`** — remove `<CameraPan>`, add `<Stage>` + `<FramedScreen>` + `<VideoCrop>` components, remount `<OffthreadVideo>` inside `<VideoCrop>`, remount `<CursorSprite>` inside `<FramedScreen>` with coord-transform that mirrors `<VideoCrop>`'s matrix.

No tests exist in this project (it's a hackathon with end-to-end render verification). Each phase has a **render or run-script verification step** in place of unit tests. The end-to-end verification is Phase 6.

---

## Phase 1: Source-side cursor + click-ripple suppression

**Why first:** Smallest change, zero risk of breaking the renderer. Independent of every other phase — even before any Remotion changes land, the next replay will produce a video without the 28px DOM cursor and without the green ripple. Required for any cinematic to look right because two cursors render simultaneously today.

**Files:**
- Modify: `explainer-agent/performer-v11/replay-60fps.js:65-67` (cursor `cssText`)
- Modify: `explainer-agent/performer-v11/replay-60fps.js:230-232` (ripple `cssText`)

### Steps

- [ ] **Step 1.1: Suppress the DOM-injected cursor**

In `explainer-agent/performer-v11/replay-60fps.js`, the cursor `cssText` at lines 65-67 currently reads:

```js
      c.style.cssText =
        'position:fixed; top:0; left:0; width:28px; height:28px; pointer-events:none; ' +
        'z-index:2147483647; transition: transform 0ms linear; transform: translate(-50px, -50px);';
```

Change to add `display:none;` at the front:

```js
      c.style.cssText =
        'display:none; ' +
        'position:fixed; top:0; left:0; width:28px; height:28px; pointer-events:none; ' +
        'z-index:2147483647; transition: transform 0ms linear; transform: translate(-50px, -50px);';
```

Rationale: keeping the element in the DOM (just hidden) means all downstream `getElementById('__perfCursor')` calls in `moveCursor`, the drag loop, and the freedraw loop still succeed and set `transform` — but the element never paints. No behavioural change other than visual suppression.

- [ ] **Step 1.2: Suppress the green click ripple**

In `explainer-agent/performer-v11/replay-60fps.js`, the ripple `cssText` at lines 230-232 currently reads:

```js
        r.style.cssText =
          'position:fixed; left:' + (x - 24) + 'px; top:' + (y - 24) + 'px; ' +
          'width:48px; height:48px; border-radius:50%; border:2.5px solid #84cc16; ' +
          'pointer-events:none; z-index:2147483646; opacity:1;';
```

Change to prepend `display:none;`:

```js
        r.style.cssText =
          'display:none; ' +
          'position:fixed; left:' + (x - 24) + 'px; top:' + (y - 24) + 'px; ' +
          'width:48px; height:48px; border-radius:50%; border:2.5px solid #84cc16; ' +
          'pointer-events:none; z-index:2147483646; opacity:1;';
```

The 650ms `setTimeout` that removes the element still fires (so we don't leak nodes), and the 650ms `page.waitForTimeout(650)` after `clickRipple()` is preserved — keeping cursor pacing identical. Only the visible ring is removed.

- [ ] **Step 1.3: Verify by re-running the performer against the v11 action log**

Run:

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent
node performer-v11/replay-60fps.js \
  --log v11-action-log.json \
  --out /tmp/v11-phase1-base.mp4
```

Expected: command exits 0, `/tmp/v11-phase1-base.mp4` exists, log shows `[performer] visited urls: ...` line.

- [ ] **Step 1.4: Spot-check the recording with ffmpeg frame extraction**

Pull three frames — one from the opening beat, one mid-clip during a click, one near the end:

```bash
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 /tmp/v11-phase1-base.mp4
# capture duration as $DUR, then:
mkdir -p /tmp/v11-phase1-stills
ffmpeg -y -ss 2 -i /tmp/v11-phase1-base.mp4 -vframes 1 /tmp/v11-phase1-stills/early.png
ffmpeg -y -ss 8 -i /tmp/v11-phase1-base.mp4 -vframes 1 /tmp/v11-phase1-stills/mid.png
ffmpeg -y -sseof -2 -i /tmp/v11-phase1-base.mp4 -vframes 1 /tmp/v11-phase1-stills/late.png
```

Open all three in Safari (`open -a Safari /tmp/v11-phase1-stills/early.png /tmp/v11-phase1-stills/mid.png /tmp/v11-phase1-stills/late.png`).

**Success criterion:** Zero 28px white SVG cursors visible in any of the three frames. Zero green outline ripples visible at click moments (you may need to scrub more frames around known click timestamps in the action log — `jq '.actions[] | select(.kind == "click")' v11-action-log.json` shows which steps to look at).

**If it fails:** If the cursor still appears, check `getElementById('__perfCursor')` in the moveCursor branch — verify the `display:none` is on `cssText` (which overwrites all inline styles) and not on a later `setProperty` call. If the ripple still appears, search the file for other `border:2.5px solid #84cc16` instances (there shouldn't be any) or any other `appendChild` that draws a ring.

- [ ] **Step 1.5: Commit**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent
git add explainer-agent/performer-v11/replay-60fps.js
git commit -m "feat: suppress source-side cursor and click ripple in replay-60fps

Both elements remain in the DOM (so downstream getElementById calls in
moveCursor/drag/freedraw still work) but never paint. AutoOverlay's
overlay cursor + click ring become the single visual source."
```

---

## Phase 2: Schema extension — `targetCenter` + `targetZoom` in `cameraEvents`

**Why now:** The Remotion renderer in Phase 3 needs UV-space coordinates and the explicit zoom for the new transform math. Doing this in the config emitter (which already knows whether an event is a cluster vs lone click) is cheaper than re-deriving in the renderer. This phase is also independently testable — re-run the config script and inspect the JSON.

**Files:**
- Modify: `explainer-agent/auto-overlay-config.js:465-499` (the `pushTriple` function, which is where cluster/lone scale + CSS-px target get baked into the camera event)

### Steps

- [ ] **Step 2.1: Extend `pushTriple` to emit UV-space target and zoom**

Locate `pushTriple` in `explainer-agent/auto-overlay-config.js` at lines 465-499. The current function takes `targetCssX` / `targetCssY` (CSS-px in recorded viewport) and emits events with `target: {x: ax, y: ay}` in 2560×1440 video pixels.

Change the function to also emit `targetCenter` in UV space `[0, 1]` and an explicit `targetZoom` matching the spec's `1.4×` / `1.2×` / `1.15×`. The recorded-viewport dimensions are available via the outer-scope `log.viewport` (already used in the scroll-run block at lines 555-559).

Replace lines 465-499 with:

```js
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
```

`target` (video-pixel) is preserved alongside `targetCenter` so the schema is backward-compatible — the existing `<CameraPan>` keeps working until Phase 3 removes it. `scale` is also preserved alongside `targetZoom` for the same reason.

- [ ] **Step 2.2: Verify by regenerating the config JSON for the v11 stripe run**

Find the existing auto-overlay config invocation. The render script at `explainer-agent/render-auto-overlay.sh` is the canonical caller — look at it to confirm the args, then run the config step directly:

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent
node auto-overlay-config.js \
  --action-log v11-action-log.json \
  --base-video remotion/public/auto-base.mp4 \
  --goal "$(jq -r '.goal // "Navigate Stripe docs"' v11-action-log.json)" \
  --out /tmp/v11-phase2-config.json
```

If `--goal` doesn't exist in the log, pass any short string — it doesn't matter for this verification.

- [ ] **Step 2.3: Inspect the emitted config**

```bash
jq '.cameraEvents[0:3]' /tmp/v11-phase2-config.json
```

**Success criterion:** Each event has `targetCenter: {x: <0-1>, y: <0-1>}` and `targetZoom: <number>`. For a cluster event `targetZoom` should be `1.4`, for a lone click `1.12`, for a scroll run `1.15`. The legacy `target: {x: <video-px>, y: <video-px>}` and `scale` fields must still be present.

**If it fails:** If `targetCenter` is missing, you didn't save the file. If `targetCenter` values are outside `[0, 1]`, the clamp `Math.max(0, Math.min(1, ...))` is missing. If the legacy fields are gone, you accidentally removed `target` / `scale` — restore them.

- [ ] **Step 2.4: Confirm existing pipeline still renders (backward compat sanity check)**

The renderer's `<CameraPan>` reads `target` and `scale` (not `targetCenter`/`targetZoom`), so the existing render should still work unchanged. Skip this if Phase 1 already proved the source-side change is fine — Phase 3 is the next render gate anyway. Otherwise:

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent/remotion
cp /tmp/v11-phase2-config.json public/auto-overlay-config.json
# Trigger a 1-frame render to prove the renderer still parses the config:
npx remotion render src/index.tsx AutoOverlay /tmp/v11-phase2-1frame.png \
  --frame=300 --concurrency=8
```

**Success criterion:** Single PNG produced at `/tmp/v11-phase2-1frame.png`, no errors about `target` being undefined.

**If it fails:** Re-read your `pushTriple` change — you probably removed `target` or `scale`.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent
git add explainer-agent/auto-overlay-config.js
git commit -m "feat: emit UV-space targetCenter and targetZoom in cameraEvents

Preserves legacy target (video-px) and scale fields so CameraPan keeps
working; new fields feed the upcoming VideoCrop transform which does
edge-snap clamping in UV space."
```

---

## Phase 3: AutoOverlay.tsx structural changes — Stage / FramedScreen / VideoCrop

**Why now:** Phase 2 emits the data the new components need. This phase is the single largest change and the biggest risk surface — it removes `<CameraPan>` and rebuilds the video layer from scratch. Sub-divided into small steps with a 1-frame render gate between mounting and removing the old code.

**Files:**
- Modify: `explainer-agent/remotion/src/AutoOverlay.tsx:1441-1527` (replace `CameraPan` block with new components — keep `easeInOutCubic` helper, drop `computeCameraState` and `CameraPan`)
- Modify: `explainer-agent/remotion/src/AutoOverlay.tsx:1533-1587` (composition entry — restructure the JSX tree)
- Modify: `explainer-agent/remotion/src/AutoOverlay.tsx:710-795` (`CursorSprite` — add an optional `transform` prop)

### Steps

- [ ] **Step 3.1: Add chrome constants and pixel-chrome dimensions**

Near the top of `AutoOverlay.tsx` (find an existing constants block — there's `W` and `H` from the comp config; add right after them), insert:

```ts
// =====================
// Cinematic stage chrome (locked per spec 2026-05-26-cinematic-uv-crop-design.md)
// =====================
const STAGE_GRADIENT = "linear-gradient(135deg, #0a0e1a 0%, #1e1b4b 100%)";
const FRAME_INSET_X = 256;   // px on each side, ~10% of 2560
const FRAME_INSET_Y = 144;   // px on each side, ~10% of 1440
const FRAME_RADIUS = 40;
const FRAME_SHADOW = "0 0 40px rgba(0, 0, 0, 0.35)";
const INNER_W = W - FRAME_INSET_X * 2; // 2048
const INNER_H = H - FRAME_INSET_Y * 2; // 1152
const EDGE_SNAP = 0.075;
// Source recording dimensions match the render canvas (the performer
// records at 2560×1440 per CSS_W/CSS_H in replay-60fps.js).
const SOURCE_W = W;
const SOURCE_H = H;
```

- [ ] **Step 3.2: Add the UV-crop transform helper**

Below the constants block (or near the existing `easeInOutCubic` helper at line 1457), add:

```ts
// Cubic-bezier(0.2, 0.7, 0.3, 1) approximation as an ease-out cubic.
// Matches the spec's "ease-out, not spring" timing per reference-app teardown.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type CropState = {
  centerX: number; // UV [0,1] after edge-snap + clamp
  centerY: number;
  zoom: number;
};

const snapToEdge = (uv: number) => {
  if (uv < EDGE_SNAP) return 0;
  if (uv > 1 - EDGE_SNAP) return 1;
  return uv;
};

const NEUTRAL_CROP: CropState = { centerX: 0.5, centerY: 0.5, zoom: 1 };

// Phase 5 owns the timing curves; Phase 3 just needs a working
// computeCropState so the render verifies end-to-end. We replicate the
// existing CameraPan timing (zoomIn → hold → zoomOut, easeInOutCubic on
// the ramps) but using the new UV-space targetCenter.
const computeCropState = (tSec: number): CropState => {
  const events = CFG.cameraEvents || [];
  if (!events.length) return NEUTRAL_CROP;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const eEnd = e.startSec + e.durationSec;
    if (tSec < e.startSec || tSec >= eEnd) continue;
    const local = (tSec - e.startSec) / Math.max(0.001, e.durationSec);
    const tc = e.targetCenter || { x: 0.5, y: 0.5 };
    const tz = e.targetZoom ?? e.scale ?? 1;
    if (e.type === "hold") {
      return { centerX: tc.x, centerY: tc.y, zoom: tz };
    }
    if (e.type === "zoomIn") {
      const eased = easeOutCubic(Math.max(0, Math.min(1, local)));
      const zoom = 1 + (tz - 1) * eased;
      const cx = 0.5 + (tc.x - 0.5) * eased;
      const cy = 0.5 + (tc.y - 0.5) * eased;
      return { centerX: cx, centerY: cy, zoom };
    }
    if (e.type === "zoomOut") {
      const eased = easeOutCubic(Math.max(0, Math.min(1, local)));
      const zoom = tz + (1 - tz) * eased;
      const cx = tc.x + (0.5 - tc.x) * eased;
      const cy = tc.y + (0.5 - tc.y) * eased;
      return { centerX: cx, centerY: cy, zoom };
    }
  }
  return NEUTRAL_CROP;
};

// Convert raw crop state into a CSS transform on the OffthreadVideo element.
// The video is sized INNER_W × INNER_H (it fills FramedScreen). Translate to
// keep the snapped-and-clamped center at the center of FramedScreen.
const cropToTransform = (s: CropState) => {
  const viewportHalf = 0.5 / s.zoom;
  const snappedX = snapToEdge(s.centerX);
  const snappedY = snapToEdge(s.centerY);
  const cx = Math.max(viewportHalf, Math.min(1 - viewportHalf, snappedX));
  const cy = Math.max(viewportHalf, Math.min(1 - viewportHalf, snappedY));
  // After scaling the video by `zoom` (origin 0,0), pixel (cx*SOURCE_W, cy*SOURCE_H)
  // sits at (cx*SOURCE_W*zoom, cy*SOURCE_H*zoom). We want it at (INNER_W/2, INNER_H/2),
  // so translate by the difference.
  const tx = -(cx * SOURCE_W * s.zoom - INNER_W / 2);
  const ty = -(cy * SOURCE_H * s.zoom - INNER_H / 2);
  return { tx, ty, scale: s.zoom, snappedCenter: { x: cx, y: cy } };
};
```

- [ ] **Step 3.3: Add the `<Stage>` and `<FramedScreen>` components**

Add these as siblings of `CameraPan` (the file's component layout) — put them right above the existing `const CameraPan: React.FC<...>` declaration (around line 1505):

```tsx
const Stage: React.FC = () => (
  <AbsoluteFill style={{ background: STAGE_GRADIENT }} />
);

const FramedScreen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      top: FRAME_INSET_Y,
      left: FRAME_INSET_X,
      width: INNER_W,
      height: INNER_H,
      borderRadius: FRAME_RADIUS,
      overflow: "hidden",
      boxShadow: FRAME_SHADOW,
      // Ensure the rounded corners actually clip child transforms.
      isolation: "isolate",
    }}
  >
    {children}
  </div>
);

// VideoCrop applies the per-frame transform from computeCropState.
// transform-origin: 0 0 (top-left) per spec — matches the math in cropToTransform.
const VideoCrop: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const tSec = frame / CFG.fps;
  const { tx, ty, scale } = cropToTransform(computeCropState(tSec));
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: INNER_W,
        height: INNER_H,
        transformOrigin: "0 0",
        transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        transition: "none",
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
};
```

- [ ] **Step 3.4: Make `<CursorSprite>` accept an optional transform**

In `AutoOverlay.tsx:710-795`, the existing `CursorSprite` computes cursor coords in canvas space (`cx`, `cy` are in 2560×1440 pixels). When mounted inside `<FramedScreen>` it needs to be re-projected through the same crop transform so the cursor visually tracks the zoomed video.

Change the function signature and add the projection. Find lines 710-795 (`const CursorSprite: React.FC = () => { ... }`) and modify:

(a) Change the signature to accept an `inFrame` prop:

```tsx
const CursorSprite: React.FC<{ inFrame?: boolean }> = ({ inFrame = false }) => {
```

(b) After the existing `cx += wobbleX; cy += wobbleY;` lines (~line 754-755), insert the projection:

```ts
  // If we're mounted inside FramedScreen, re-project the canvas-space coords
  // through the same UV crop transform that VideoCrop applies to the video,
  // so cursor tracks zoomed targets pixel-accurately.
  let renderLeft = cx - 8;
  let renderTop = cy - 4;
  if (inFrame) {
    const crop = cropToTransform(computeCropState(tSec));
    // The video element is sized INNER_W × INNER_H and rendered at native
    // SOURCE_W × SOURCE_H via objectFit:cover. cx,cy live in SOURCE pixels,
    // so first map source-px → inner-rect-px (identity since SOURCE_W=INNER_W
    // for the video, but the OUTER canvas is 2560×1440 and FramedScreen
    // starts at FRAME_INSET_X/Y). The cursor's CFG.cursorTrack coords are in
    // the 2560×1440 canvas. Convert canvas → UV → apply crop transform.
    const uvCX = cx / SOURCE_W;
    const uvCY = cy / SOURCE_H;
    // Position in inner-rect after the same transform the video gets:
    const innerX = uvCX * SOURCE_W * crop.scale + crop.tx;
    const innerY = uvCY * SOURCE_H * crop.scale + crop.ty;
    renderLeft = innerX - 8;
    renderTop = innerY - 4;
  }
```

(c) Update the `<svg>` style at lines 778-783 to use `renderLeft` / `renderTop`:

```tsx
        style={{
          position: "absolute",
          left: renderLeft,
          top: renderTop,
          opacity,
          filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.55))",
        }}
```

(d) The wrapping `<AbsoluteFill>` at line 772 needs to change when `inFrame` is true — inside `<FramedScreen>` we don't want AbsoluteFill (which fills the canvas) clobbering the matte; we want to fill just the inner rect. Replace the wrapping `<AbsoluteFill style={{ pointerEvents: "none" }}>` with a conditional:

```tsx
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    inFrame ? (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: INNER_W,
          height: INNER_H,
          pointerEvents: "none",
        }}
      >
        {children}
      </div>
    ) : (
      <AbsoluteFill style={{ pointerEvents: "none" }}>{children}</AbsoluteFill>
    );
  return (
    <Wrapper>
      <svg ... > ... </svg>
    </Wrapper>
  );
```

Keep the existing `<svg>` body unchanged.

- [ ] **Step 3.5: Restructure the composition entry**

In `AutoOverlay.tsx:1533-1587`, the composition root currently is:

```tsx
return (
  <AbsoluteFill style={{ background: "#000" }}>
    <Sequence from={0} durationInFrames={baseFrames}>
      <CameraPan>
        <OffthreadVideo src={baseSrc} style={{ ... }} />
      </CameraPan>
    </Sequence>
    {freezeFrames > 0 && (
      <Sequence from={baseFrames} durationInFrames={freezeFrames}>
        <CameraPan>
          <Freeze frame={baseFrames - 1}>
            <OffthreadVideo src={baseSrc} style={{ ... }} />
          </Freeze>
        </CameraPan>
      </Sequence>
    )}
    <CursorSprite />
    <ScrollIndicators />
    ...
  </AbsoluteFill>
);
```

Replace with:

```tsx
return (
  <AbsoluteFill style={{ background: "#000" }}>
    <Stage />
    <FramedScreen>
      <Sequence from={0} durationInFrames={baseFrames}>
        <VideoCrop>
          <OffthreadVideo
            src={baseSrc}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: SOURCE_W,
              height: SOURCE_H,
              objectFit: "cover",
            }}
          />
        </VideoCrop>
      </Sequence>
      {freezeFrames > 0 && (
        <Sequence from={baseFrames} durationInFrames={freezeFrames}>
          <VideoCrop>
            <Freeze frame={baseFrames - 1}>
              <OffthreadVideo
                src={baseSrc}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: SOURCE_W,
                  height: SOURCE_H,
                  objectFit: "cover",
                }}
              />
            </Freeze>
          </VideoCrop>
        </Sequence>
      )}
      <CursorSprite inFrame />
    </FramedScreen>
    <ScrollIndicators />
    <AllSidebarCallouts />
    <AllClickRings />
    <TeachingPanelEl />
    <StepLabels />
    <FadeBridge />
    <OutroEl />
    <AutoTitle />
    <FinalFade />
  </AbsoluteFill>
);
```

Key changes:
- `<Stage />` sibling paints the gradient.
- `<FramedScreen>` wraps both video sequences AND the cursor (cursor needs to clip to the rounded inner rect, same as the video).
- `<CameraPan>` replaced by `<VideoCrop>` (the same children structure).
- Overlay elements (`ScrollIndicators`, callouts, click rings, teaching panel, step labels, fade bridge, outro, title, final fade) stay at canvas root — they can extend over the matte if the design ever needs it, per spec line 28.

- [ ] **Step 3.6: Remove the dead `<CameraPan>` and `computeCameraState`**

Delete lines 1457-1527 (`easeInOutCubic` stays; `computeCameraState`, `CamState`, `NEUTRAL`, and `CameraPan` go). Leave the section-header comment but update it:

```ts
// ===========================================================================
// 8. Camera (cinematic UV crop) — replaces the centroid-scaling CameraPan.
//    Math lives in computeCropState + cropToTransform above.
// ===========================================================================
```

If `easeInOutCubic` is unused after this deletion, leave it — it's tiny and may be needed by another component. Run the next step to find out.

- [ ] **Step 3.7: 1-frame render verification**

Use a config from Phase 2 (still good):

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent/remotion
cp /tmp/v11-phase2-config.json public/auto-overlay-config.json
npx remotion render src/index.tsx AutoOverlay /tmp/v11-phase3-1frame.png \
  --frame=300 --concurrency=8
```

**Success criterion:** Single PNG at `/tmp/v11-phase3-1frame.png`. Open in Safari (`open -a Safari /tmp/v11-phase3-1frame.png`).
- Dark navy→indigo gradient visible on all four sides (~144px top/bottom, ~256px left/right).
- Rounded-corner inner rect shows the recording.
- Soft shadow visible around the rect.
- No double cursor.

**If it fails:**
- Compile error referring to `cropToTransform`/`computeCropState`/etc.: re-check Step 3.2 lives in the file (it has to be defined before `VideoCrop` uses it).
- Black frame: `Stage` is being painted ON TOP of `FramedScreen` because of sibling order or zIndex. AbsoluteFill in Remotion stacks in source order; `<Stage />` must be FIRST among siblings.
- Matte invisible (video fills canvas): `<FramedScreen>` not applied; check that `OffthreadVideo` is inside `<VideoCrop>` which is inside `<FramedScreen>`, not at the root.
- Video clipped at wrong size: `width`/`height` on `<OffthreadVideo>` should be `SOURCE_W` / `SOURCE_H` (NOT `INNER_W` / `INNER_H`); the scaling happens via `<VideoCrop>`'s transform.
- Cursor wrong place: re-check Step 3.4 — the projection math takes canvas-px in and outputs inner-rect-px.

- [ ] **Step 3.8: Commit**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent
git add explainer-agent/remotion/src/AutoOverlay.tsx
git commit -m "feat: replace CameraPan with Stage + FramedScreen + VideoCrop

UV-crop transform samples a sub-rect of the source video into a fixed
inner rect, per cinematic-uv-crop design spec. CursorSprite now accepts
inFrame prop and re-projects coords through VideoCrop's matrix so it
tracks the zoomed video."
```

---

## Phase 4: Pixel chrome wiring (gradient, inset, radius, shadow)

**Why now:** Phase 3 already wired the constants per spec. This phase exists as a separate gate so a parallel openscreen.net teardown subagent (see plan header) can land a gradient revision here without rewriting Phase 3. If no revision arrives, this is mostly a visual-tuning verification pass.

**Files:**
- Modify (maybe): `explainer-agent/remotion/src/AutoOverlay.tsx` — constants block from Step 3.1

### Steps

- [ ] **Step 4.1: Check for a gradient-upgrade spec**

```bash
ls /Users/dennis/Desktop/Projects/Hackathons/promo-agent/docs/superpowers/specs/ | grep -i gradient
```

If the listing is empty, skip to Step 4.3.

- [ ] **Step 4.2: Apply the gradient upgrade (only if a spec landed)**

Read the new spec. It will name explicit color stops. Update `STAGE_GRADIENT` (constants block in `AutoOverlay.tsx` from Phase 3 Step 3.1) to match. If the spec also revises `FRAME_RADIUS`, `FRAME_SHADOW`, or insets, update those too — they're all in the same constants block.

- [ ] **Step 4.3: Spot-render at three different zoom states to verify chrome consistency**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent/remotion
# rest state (no zoom):
npx remotion render src/index.tsx AutoOverlay /tmp/v11-phase4-rest.png \
  --frame=90 --concurrency=8
# zoom apex — pick a frame inside a hold event. Find one with:
#   jq '.cameraEvents[] | select(.type=="hold") | .startSec' /tmp/v11-phase2-config.json
# (multiply by 60 fps and round). For Stripe v11 this is usually around frame 600-900.
npx remotion render src/index.tsx AutoOverlay /tmp/v11-phase4-apex.png \
  --frame=720 --concurrency=8
# outro:
npx remotion render src/index.tsx AutoOverlay /tmp/v11-phase4-outro.png \
  --frame=$(($(jq '.totalFrames' /tmp/v11-phase2-config.json) - 120)) --concurrency=8
```

Open all three: `open -a Safari /tmp/v11-phase4-rest.png /tmp/v11-phase4-apex.png /tmp/v11-phase4-outro.png`.

**Success criterion:** All three frames show the same matte width on all sides; the inner rect's rounded corners and shadow are visible (not clipped) at every zoom state; the gradient direction (135° = top-left to bottom-right) is consistent. At zoom apex, the click target (or cluster centroid) is centered in the inner rect, NOT off-screen or against the rect's edge unless the spec's edge-snap kicked in.

**If it fails:**
- Matte width inconsistent: an overlay element (callouts, teaching panel, etc.) is rendering ON TOP of the matte. Inspect each overlay's `style.left` / `style.top` — if any exceed `INNER_W` + `FRAME_INSET_X` it's overflowing.
- Inner rect corners look hard/sharp: `border-radius: 40px` not landing. Check `<FramedScreen>` style — `overflow: hidden` and `borderRadius: FRAME_RADIUS` must both be set.
- Click target NOT centered at zoom apex: `targetCenter` not being read in `computeCropState`. Add `console.log` to verify (this needs a Remotion Studio session — `npx remotion studio` — since stdout doesn't show in render mode).

- [ ] **Step 4.4: Commit (only if Step 4.2 changed anything)**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent
git add explainer-agent/remotion/src/AutoOverlay.tsx
git commit -m "tune: apply gradient/chrome upgrade per <spec name>"
```

If no spec landed and no values changed, skip the commit.

---

## Phase 5: Zoom timing — 500ms ease-out / 700ms hold / 400ms ease-out

**Why now:** Phase 3 wired up `computeCropState` with the OLD durations (1.0s zoomIn / hold-from-config / 0.8s zoomOut) just to get something working. The spec mandates 500ms / max(500ms, clickDuration) / 400ms with ease-out (not ease-in-out). The config's `durationSec` per event has to match — and that lives in `auto-overlay-config.js`.

**Files:**
- Modify: `explainer-agent/auto-overlay-config.js:467-468` (the `ZOOM_IN_DUR` / `ZOOM_OUT_DUR` constants inside `pushTriple`)
- Modify: `explainer-agent/auto-overlay-config.js:511-531` (the `holdSec` computation for clusters + lone clicks)
- Modify: `explainer-agent/remotion/src/AutoOverlay.tsx` (the `computeCropState` zoomIn/zoomOut branches — change `easeOutCubic` is already correct from Phase 3 Step 3.2; if the spec says 1.4× / 1.2× and the config now emits both, the renderer is already correct)

### Steps

- [ ] **Step 5.1: Update zoom durations in `pushTriple`**

In `explainer-agent/auto-overlay-config.js`, find lines 467-468:

```js
  const ZOOM_IN_DUR = 1.0;
  const ZOOM_OUT_DUR = 0.8;
```

Change to:

```js
  const ZOOM_IN_DUR = 0.5;  // 500ms ease-out per spec
  const ZOOM_OUT_DUR = 0.4; // 400ms ease-out per spec
```

Also change line 471 from `startSec = Math.max(0, anchorTSec - 0.9)` to `startSec = Math.max(0, anchorTSec - 0.4)` so the camera still commits BEFORE the click moment but matches the shorter 500ms ramp.

- [ ] **Step 5.2: Update hold durations for clusters and lone clicks**

In `explainer-agent/auto-overlay-config.js`, find the cluster emission at lines 511-520:

```js
  if (isCluster) {
    const holdSec = Math.max(1.5, Math.min(4.0, lastT - firstT + tilNext - 0.8));
    pushTriple({
      targetCssX: cx,
      targetCssY: cy,
      anchorTSec: firstT,
      scale: 1.4,
      holdSec,
      priority: 1, // cluster — keep first
    });
```

Change `holdSec` to clamp `[0.7, 1.5]` (spec says hold ~700ms, with click-duration drift as the upper end):

```js
  if (isCluster) {
    const holdSec = Math.max(0.7, Math.min(1.5, lastT - firstT + tilNext - 0.4));
    pushTriple({
      targetCssX: cx,
      targetCssY: cy,
      anchorTSec: firstT,
      scale: 1.4,
      holdSec,
      priority: 1, // cluster — keep first
    });
```

For lone clicks at lines 521-531:

```js
  } else {
    // Lone click — subtle emphasis
    pushTriple({
      targetCssX: cx,
      targetCssY: cy,
      anchorTSec: firstT,
      scale: 1.12,
      holdSec: Math.max(1.0, Math.min(2.0, tilNext - 0.8)),
      priority: 3, // lone click — first to drop
    });
  }
```

Update to use the spec's `1.2×` zoom (was `1.12×`) and the 700ms hold floor:

```js
  } else {
    // Lone click — subtle emphasis (1.2× per spec)
    pushTriple({
      targetCssX: cx,
      targetCssY: cy,
      anchorTSec: firstT,
      scale: 1.2,
      holdSec: Math.max(0.7, Math.min(1.2, tilNext - 0.4)),
      priority: 3, // lone click — first to drop
    });
  }
```

- [ ] **Step 5.3: Verify edge-snap clamp is wired correctly**

The `snapToEdge` helper from Phase 3 Step 3.2 pulls UV components within `EDGE_SNAP=0.075` of 0 or 1 to the edge. Sanity-check by reading `cropToTransform` and confirming `snapToEdge` is called BEFORE the `Math.max/Math.min` clamp — order matters per spec:

```
focus_uv → snap_to_edges → clamp(viewport_half, 1 - viewport_half)
```

Open `AutoOverlay.tsx` and locate `cropToTransform`. Confirm the order matches:

```ts
const snappedX = snapToEdge(s.centerX);
const snappedY = snapToEdge(s.centerY);
const cx = Math.max(viewportHalf, Math.min(1 - viewportHalf, snappedX));
const cy = Math.max(viewportHalf, Math.min(1 - viewportHalf, snappedY));
```

If `snapToEdge` is called AFTER the clamp, swap the order.

- [ ] **Step 5.4: Regenerate config and render a click-moment frame**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent
node auto-overlay-config.js \
  --action-log v11-action-log.json \
  --base-video remotion/public/auto-base.mp4 \
  --goal "Navigate Stripe docs" \
  --out remotion/public/auto-overlay-config.json
# Inspect a zoomIn event:
jq '.cameraEvents[] | select(.type=="zoomIn") | {startSec, durationSec, targetZoom, targetCenter}' remotion/public/auto-overlay-config.json | head -20
```

**Success criterion:** Each `zoomIn` event has `durationSec: 0.5`, each `zoomOut` (run the same jq with `select(.type=="zoomOut")`) has `durationSec: 0.4`, each `hold` has `durationSec` between 0.7 and 1.5. `targetZoom` is `1.4` for clusters, `1.2` for lone clicks, `1.15` for scrolls.

Render the apex frame and a mid-zoom-in frame:

```bash
cd remotion
# Find a zoomIn event and pick a frame 0.25s into it (15 frames @ 60fps):
ZOOM_IN_START=$(jq '.cameraEvents[] | select(.type=="zoomIn") | .startSec' public/auto-overlay-config.json | head -1)
MID_FRAME=$(python3 -c "print(int(($ZOOM_IN_START + 0.25) * 60))")
npx remotion render src/index.tsx AutoOverlay /tmp/v11-phase5-mid-zoom.png \
  --frame=$MID_FRAME --concurrency=8
# Apex frame (mid-hold):
HOLD_START=$(jq '.cameraEvents[] | select(.type=="hold") | .startSec' public/auto-overlay-config.json | head -1)
HOLD_DUR=$(jq '.cameraEvents[] | select(.type=="hold") | .durationSec' public/auto-overlay-config.json | head -1)
APEX_FRAME=$(python3 -c "print(int(($HOLD_START + $HOLD_DUR / 2) * 60))")
npx remotion render src/index.tsx AutoOverlay /tmp/v11-phase5-apex.png \
  --frame=$APEX_FRAME --concurrency=8
```

Open both: `open -a Safari /tmp/v11-phase5-mid-zoom.png /tmp/v11-phase5-apex.png`.

**Success criterion:** Mid-zoom frame shows a partially-zoomed video (~halfway between 1.0× and target zoom). Apex frame shows the click target visually centered in the inner rect.

**If it fails:**
- `targetZoom` values wrong: re-check `pushTriple` from Phase 2 Step 2.1 — `scale` param should map to `targetZoom`.
- Apex not centered on click: spec edge-snap logic might be over-aggressive. Verify the click UV is between `EDGE_SNAP=0.075` and `1 - EDGE_SNAP=0.925`; if not, the snap pinned to the edge intentionally.

- [ ] **Step 5.5: Commit**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent
git add explainer-agent/auto-overlay-config.js
git commit -m "tune: cinematic zoom timing per spec (500/700/400ms, 1.4×/1.2×)

Replaces 1.0s/hold/0.8s easeInOutCubic with 500ms ease-out / 700ms+
hold / 400ms ease-out, and bumps lone-click zoom from 1.12× → 1.2×
to match reference-app teardown."
```

---

## Phase 6: End-to-end render + contact-sheet verification + full render

**Why last:** Validates the entire pipeline produces the cinematic the spec describes. Phases 1-5 each had narrow verification gates; this is the integration test.

**Files:**
- No code changes. Verification artifacts written to `/tmp/` and final output to `~/Downloads/`.

### Steps

- [ ] **Step 6.1: Regenerate the base recording with Phase 1 changes**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent
node performer-v11/replay-60fps.js \
  --log v11-action-log.json \
  --out remotion/public/auto-base.mp4
```

**Success criterion:** Base mp4 written. `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 remotion/public/auto-base.mp4` returns a positive number around 30-60 (Stripe v11 typical).

- [ ] **Step 6.2: Regenerate the overlay config with Phase 2 + Phase 5 changes**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent
node auto-overlay-config.js \
  --action-log v11-action-log.json \
  --base-video remotion/public/auto-base.mp4 \
  --goal "Navigate Stripe docs" \
  --out remotion/public/auto-overlay-config.json
```

**Success criterion:** Log shows `cameraEvents=<N>` where N > 0. `jq '.cameraEvents[0]' remotion/public/auto-overlay-config.json` shows both `targetCenter` and `targetZoom`.

- [ ] **Step 6.3: Render a 3-frame contact sheet for fast aesthetic check**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent/remotion
TOTAL=$(jq '.totalFrames' public/auto-overlay-config.json)
HOLD_START=$(jq '.cameraEvents[] | select(.type=="hold") | .startSec' public/auto-overlay-config.json | head -1)
APEX_FRAME=$(python3 -c "print(int($HOLD_START * 60 + 30))")
# Rest (early), apex (mid-hold), outro (near end):
npx remotion render src/index.tsx AutoOverlay /tmp/v11-cinematic-v2-rest.png \
  --frame=120 --concurrency=8
npx remotion render src/index.tsx AutoOverlay /tmp/v11-cinematic-v2-apex.png \
  --frame=$APEX_FRAME --concurrency=8
npx remotion render src/index.tsx AutoOverlay /tmp/v11-cinematic-v2-outro.png \
  --frame=$(($TOTAL - 120)) --concurrency=8
# Tile into a single contact sheet:
ffmpeg -y \
  -i /tmp/v11-cinematic-v2-rest.png \
  -i /tmp/v11-cinematic-v2-apex.png \
  -i /tmp/v11-cinematic-v2-outro.png \
  -filter_complex "[0:v][1:v][2:v]hstack=inputs=3,scale=3840:720" \
  /Users/dennis/Downloads/v11-stripe-cinematic-v2-stills.jpg
open -a Safari /Users/dennis/Downloads/v11-stripe-cinematic-v2-stills.jpg
```

**Success criterion (all three frames):**
- Dark navy→indigo matte visible on all four sides, ~144px top/bottom, ~256px left/right.
- Rounded-corner inner rect with soft shadow.
- Apex frame: ONE cursor, click target visually centered, no green ripple.
- Outro frame: still framed, outro overlay legible on top of the matte/inner rect.

**If it fails:** Note which frame is wrong and which phase introduced the regression. Common: matte missing on apex → Stage z-order broken (Phase 3); cursor still doubled → Phase 1 didn't ship (run `git log --oneline -5` to confirm); click off-center → Phase 2 schema missing.

- [ ] **Step 6.4: Full render to mp4**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent/explainer-agent/remotion
npx remotion render src/index.tsx AutoOverlay \
  /Users/dennis/Downloads/explainer-submission-v11-stripe-cinematic-v2.mp4 \
  --concurrency=8
```

**Success criterion:** mp4 written, `ffprobe` reports the same duration as `totalFrames / 60`. File size is in the 20-80MB range for a 30-50s clip (sanity check that compression worked).

**If it fails:** Render errors usually point at undefined symbols in `AutoOverlay.tsx` — fix and re-run. If render hangs, kill it (Ctrl+C), drop `--concurrency` to 4, and retry — Dennis's machine handles 8 but a parallel subagent may be eating cores.

- [ ] **Step 6.5: Spot-play in Safari**

```bash
open -a Safari /Users/dennis/Downloads/explainer-submission-v11-stripe-cinematic-v2.mp4
```

Scrub through manually. Look for the spec's verification checklist (spec line 117-119):
- Matte visible on all sides at every zoom apex.
- Click point at center of inner rect during zooms.
- ONE cursor (no source-side cursor doubling).
- No green ripple from the base recording.

**If any fail:** Note which scene + timestamp, identify the failing phase, fix, re-render. No need to redo earlier phases that already verified.

- [ ] **Step 6.6: Commit the regenerated configs as artifacts**

```bash
cd /Users/dennis/Desktop/Projects/Hackathons/promo-agent
git add explainer-agent/remotion/public/auto-overlay-config.json \
        explainer-agent/remotion/public/auto-base.mp4
git commit -m "artifact: regenerate v11 stripe cinematic base + config

Output at ~/Downloads/explainer-submission-v11-stripe-cinematic-v2.mp4."
```

If `auto-base.mp4` is gitignored, skip it. The config json is the primary artifact.

---

## Phase ordering rationale

- **Phase 1 ships independently.** Even if Phases 2-6 hit a blocker, removing the double cursor + green ripple from the source recording is value on its own (better-looking base video for any downstream cinematic).
- **Phases 2-5 are sequential** within `auto-overlay-config.js` and `AutoOverlay.tsx`. Phase 3 needs Phase 2's schema; Phase 5 tunes values that Phases 2-3 wired up.
- **Phase 6 is the integration test.** No code changes — it just runs the pipeline end-to-end and verifies against the spec's checklist.

If time pressure forces a cut: ship Phase 1 + Phase 3 (with Phase 5's timing values inlined into Phase 3 Step 3.1 constants directly, skipping the separate Phase 5 commit). Phase 4 is optional. Phase 2 is required for Phase 3 to function.

## Open questions

None. Spec is locked. The only "maybe" is the gradient-upgrade follow-up from the parallel openscreen.net teardown — Phase 4 absorbs it cleanly if it lands, ships the spec-default navy→indigo if it doesn't.

## References

- Spec: `docs/superpowers/specs/2026-05-26-cinematic-uv-crop-design.md` @ `76a737b`
- Existing renderer: `explainer-agent/remotion/src/AutoOverlay.tsx`
- Existing config: `explainer-agent/auto-overlay-config.js`
- Existing performer: `explainer-agent/performer-v11/replay-60fps.js`
