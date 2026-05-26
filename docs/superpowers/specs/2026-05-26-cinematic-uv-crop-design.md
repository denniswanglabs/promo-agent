# Cinematic UV-crop overlay — framed Stage with click-centered zoom

**Status:** Design — implementation plan to follow.

**Date:** 2026-05-26

## Motivation

The current Stripe cinematic (`~/Downloads/explainer-submission-v11-stripe-cinematic.mp4`, produced 2026-05-26 morning) has two visible problems:

1. Two cursors render simultaneously — a 28px DOM-injected one from `performer-v11/replay-60fps.js:55-72` and a 44px overlay one from `AutoOverlay.tsx:710-795`.
2. The video fills the full canvas with no framing, and our current `<CameraPan>` zooms toward a cluster centroid rather than centering on the click. The "cinematic screen recording" aesthetic that Screen Studio, Cap.so, and Tella ship requires both a framed canvas (matte around a rounded-corner inner rect) AND click-as-center math with edge-snap clamping.

This spec covers both fixes in one design pass since they share the same render pipeline.

## Architecture — 4-layer stack inside `<AutoOverlay>`

```
<AbsoluteFill>                          composition root, 2560×1440
  ├─ <Stage>                            static gradient background, fills canvas
  ├─ <FramedScreen>                     fixed inner rect; rounded corners + shadow + overflow:hidden
  │    ├─ <VideoCrop>                   replaces <CameraPan>; applies UV-crop transform to the video
  │    │    └─ <OffthreadVideo>         the actual recording, transformed per-frame
  │    └─ <CursorSprite>                overlay cursor, coords run through VideoCrop's transform
  └─ <TitleCard> / <Outro> / <Highlights>   existing overlay elements at canvas level, above FramedScreen
```

Stage, FramedScreen, and the overlay elements are all direct children of `<AbsoluteFill>` (siblings). Stage paints the background; FramedScreen sits on top of Stage; overlay elements (TitleCard, Outro, Highlights) sit on top of FramedScreen at the full canvas level (so they can extend over the matte if a design calls for it).

Headline change: `<CameraPan>` (today: translate+scale the whole video layer) is replaced by `<VideoCrop>` (samples a UV sub-rect of the source into the static FramedScreen inner rect). Stage and FramedScreen are immutable per-comp — they never move. Only `<VideoCrop>`'s transform varies frame-by-frame.

## UV-crop transform math

Adapted from Cap, `crates/rendering/src/zoom.rs:71-127`. In UV space [0, 1]:

```
viewport_half = 0.5 / zoom
focus_uv      = (clickX / sourceW, clickY / sourceH)
snapped       = snap_to_edges(focus_uv, EDGE_SNAP=0.075)
center        = clamp(snapped, viewport_half, 1.0 - viewport_half)
sub_rect      = { x: center.x - viewport_half, y: center.y - viewport_half,
                  w: 1.0 / zoom, h: 1.0 / zoom }
```

`snap_to_edges` pulls any `focus_uv` component within `EDGE_SNAP` of 0 or 1 to that edge before clamping, so clicks near a corner crop tight to the corner instead of pinning at the clamped center.

In Remotion this becomes a CSS transform on the `<OffthreadVideo>` element inside `<FramedScreen>`'s `overflow: hidden` clip:

```
translateX = -(center.x * sourceW * zoom - innerRectW / 2)
translateY = -(center.y * sourceH * zoom - innerRectH / 2)
scale      = zoom
transform-origin: 0 0
```

Same math, expressed as a hardware-accelerated CSS transform on the video element. `sourceW`/`sourceH` are the recording's native dimensions; `innerRectW`/`innerRectH` are the FramedScreen inner-rect dimensions (2048×1152 per the chrome spec below).

## Zoom timing

From empirical reference-app teardown, 2026-05-26: reference apps observe ease-out, not spring. Cap source uses spring but the rendered output reads as ease-out because Cap's spring is heavily damped (stiffness 200, damping 40, mass 2.25). We specify ease-out directly.

```
zoom_in:        500ms ease-out cubic-bezier(0.2, 0.7, 0.3, 1)
hold_at_peak:   max(500ms, click_duration_from_action_log)  // typically ~700ms
zoom_out:       400ms ease-out
target_zoom:    1.4× for lone clicks, 1.2× for cluster centroid
edge_snap:      0.075 (outer 7.5% pins instead of trying to center past the edge)
```

## Pixel chrome (locked)

```
Stage:
  background: linear-gradient(135deg, #0a0e1a 0%, #1e1b4b 100%)
              // dark navy → indigo; doesn't compete with screen content

FramedScreen:
  position: absolute
  inset: 144px 256px         // ~10% of each axis at 2560×1440 canvas
  border-radius: 40px
  overflow: hidden
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.35)
  // Inner rect: 2048×1152, 16:9 preserved

VideoCrop:
  width / height: 100% of parent
  transform: applied per-frame from cameraEvents
  transform-origin: 0 0
```

## Cursor de-dup (bundled into this spec)

Source-side suppression in `explainer-agent/performer-v11/replay-60fps.js`:

1. Base cursor div: add `display:none` to cssText at lines 65-67. AutoOverlay's overlay cursor remains as the only visible cursor (better quality: frame-accurate lerp, wobble, fade gates).
2. Base click ripple at lines 223-247: equivalent suppression (either `display:none` in the ripple element's style, or gate its appendChild behind an env flag injected via `addInitScript` args). AutoOverlay's click highlight stays.

## File changes (3 files)

1. **`explainer-agent/remotion/src/AutoOverlay.tsx`**
   - Add `<Stage>`, `<FramedScreen>`, `<VideoCrop>` components.
   - Remove `<CameraPan>` (current lines 1457-1527).
   - Re-mount `<CursorSprite>` (current line 1575) inside `<FramedScreen>` with coord transform via VideoCrop's matrix.
   - Re-mount `<OffthreadVideo>` inside `<VideoCrop>` (which is inside `<FramedScreen>`).

2. **`explainer-agent/auto-overlay-config.js`**
   - Extend `cameraEvents` schema: add `targetCenter: {x: 0-1, y: 0-1}` (UV space) and `targetZoom: number` per event.
   - Adjust click-event derivation to emit `targetCenter` from cluster-mean coords (cluster events) or the single click's coords (lone-click events).
   - Keep existing 3s/200px cluster heuristic and 60% camera-coverage budget cap.

3. **`explainer-agent/performer-v11/replay-60fps.js`**
   - Cursor suppression at lines 65-67 (cssText `display:none`).
   - Click-ripple suppression at lines 223-247.

## Testing / verification

- Re-render with action-log v11 (Stripe). Output → `~/Downloads/explainer-submission-v11-stripe-cinematic-v2.mp4`.
- Spot-check in Safari: matte visible on all sides at every zoom apex, click point at center, ONE cursor, no green ripple from the base.
- Render a 3-still contact sheet (rest / zoom apex / outro) → `~/Downloads/v11-stripe-cinematic-v2-stills.jpg` for fast aesthetic check before committing to full ~3min render.

## Out of scope (deferred to a follow-up if needed)

- Wikipedia POC re-render with the new pipeline.
- Pitch video reconstruction with the cinematic Stripe swap.
- BGM mux on the new cinematic.
- Stage gradient alternatives (Cap flat / SS aurora) — locked to navy→indigo.

## Open questions

None. Design is locked.

## References

- Cap source: github.com/CapSoftware/Cap, `crates/rendering/src/zoom.rs:71-127`
- Reference-app teardown: `/tmp/cinematic-reference-teardown.md` (this session)
- Cursor diagnosis: `/tmp/cinematic-analysis.md` + `/tmp/base-cursor-pipeline.md` (this session)
- Handoff context: `docs/superpowers/specs/2026-05-26-context-handoff-v3.md`
