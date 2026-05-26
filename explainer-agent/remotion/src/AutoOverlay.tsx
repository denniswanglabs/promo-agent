// AutoOverlay — generic, config-driven overlay composition.
//
// Reads remotion/public/auto-overlay-config.json (written by
// auto-overlay-config.js) and renders title card + step labels + sidebar
// callouts + click rings + teaching panel + outro on top of an arbitrary
// base video. Replaces the per-video hand-tuned comps (OverlayedV22 etc.)
// for the end-to-end pipeline.
//
// Design rules carried over from OverlayedV22:
//   - No emojis. SVG glyphs + numbered/lettered badges.
//   - No glitch typography (fade-out → snap-reveal only).
//   - Audio fade outlasts visual fade (FinalFade handles visual).
//   - 2560x1440 @ 60fps.

import React from "react";
import {
  AbsoluteFill,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ---------- Config schema ----------
type Rect = [number, number, number, number]; // x, y, w, h

type AutoOverlayConfig = {
  baseVideo: string;
  baseFrames: number;
  totalFrames: number;
  fps: number;
  extraFreezeFrames: number;
  viewport: { width: number; height: number };
  goal: string;
  title: { text: string; startSec: number; durationSec: number };
  stepLabels: { text: string; startSec: number; durationSec: number }[];
  sidebarCallouts: {
    rect: Rect;
    startSec: number;
    durationSec: number;
    labelText: string;
    urlChip: string;
    soft?: boolean;
  }[];
  clickRings: {
    x: number;
    y: number;
    size: number;
    startSec: number;
    durationSec: number;
  }[];
  cursorTrack?: { tSec: number; x: number; y: number }[];
  scrollIndicators?: {
    direction: "up" | "down" | string;
    startSec: number;
    durationSec: number;
    pixels?: number;
  }[];
  teachingPanel: {
    headline: string;
    url?: string;
    bullets: string[];
    startSec: number;
    durationSec: number;
    position: string;
    widthFrac: number;
  };
  outro: {
    stack: string[];
    tagline: string;
    startSec: number;
    durationSec: number;
  };
  fadeBridge?: { startSec: number; durationSec: number };
  cameraEvents?: {
    type: "zoomIn" | "hold" | "zoomOut" | string;
    startSec: number;
    durationSec: number;
    target?: { x: number; y: number };
    scale: number;
    easing?: string;
  }[];
};

// ---------- Load config ----------
// Default-fallback so the file failing to load doesn't crash the studio.
const DEFAULT_CFG: AutoOverlayConfig = {
  baseVideo: "/auto-base.mp4",
  baseFrames: 60,
  totalFrames: 120,
  fps: 60,
  extraFreezeFrames: 60,
  viewport: { width: 1440, height: 900 },
  goal: "",
  title: { text: "Auto Overlay", startSec: 0, durationSec: 3.0 },
  stepLabels: [],
  sidebarCallouts: [],
  clickRings: [],
  cursorTrack: [],
  scrollIndicators: [],
  teachingPanel: {
    headline: "",
    bullets: [],
    startSec: 0,
    durationSec: 0,
    position: "bottom-right",
    widthFrac: 0.58,
  },
  outro: { stack: [], tagline: "", startSec: 0, durationSec: 0 },
  fadeBridge: { startSec: 0, durationSec: 0 },
  cameraEvents: [],
};

let CFG: AutoOverlayConfig = DEFAULT_CFG;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loaded = require("../public/auto-overlay-config.json") as AutoOverlayConfig;
  if (loaded && loaded.baseVideo && loaded.totalFrames) {
    CFG = { ...DEFAULT_CFG, ...loaded };
  }
} catch (e) {
  // file absent — render default fallback
}

export const AUTO_OVERLAY_TOTAL_FRAMES = CFG.totalFrames;
export const AUTO_OVERLAY_FPS = CFG.fps;

const W = 2560;
const H = 1440;

// =====================
// Cinematic stage chrome (locked per spec 2026-05-26-cinematic-uv-crop-design.md)
// Phase 4 wires the Big Sur gradient + spec-locked inset/radius/shadow values.
// =====================
const STAGE_GRADIENT =
  "linear-gradient(180deg, #FD5C4C 0%, #EB4D5A 10%, #C5657D 22%, #3D3DA4 45%, #132D6B 70%, #0B1644 100%)";
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

// ---------- Style tokens ----------
const NAVY = "#1a3a5c";
const NAVY_DEEP = "#0f2338";
const NAVY_INK = "#0a1a2c";
const ACCENT = "#635bff"; // generic accent purple, swap-able later
const ACCENT_DEEP = "#4a3fff";
const NVIDIA_GREEN = "#76b900";
const LIME = "#84cc16";
const INK = "#ffffff";
const INK_DIM = "rgba(255,255,255,0.78)";
const FONT_STACK =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const FONT_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

// ---------- Time helpers ----------
const secToFrame = (sec: number) => Math.round(sec * CFG.fps);

// ===========================================================================
// 1. Title card
// ===========================================================================

const AutoTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startF = secToFrame(CFG.title.startSec);
  const endF = startF + secToFrame(CFG.title.durationSec);
  const local = frame - startF;
  const exitLocal = frame - (endF - 18);

  if (frame < startF - 2 || frame > endF + 2) return null;

  const cardSpring = spring({
    frame: local,
    fps,
    config: { damping: 14, stiffness: 110, mass: 0.7 },
    durationInFrames: 18,
  });
  const cardOpIn = interpolate(local, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitFade = interpolate(exitLocal, [0, 18], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitShift = interpolate(exitLocal, [0, 18], [0, -64], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(cardOpIn, exitFade);
  const cardScale = 0.92 + cardSpring * 0.08;

  // Try to color the LAST 2 words with accent (matches OverlayedV22 pattern)
  const parts = CFG.title.text.split(" ");
  const headWords = parts.slice(0, Math.max(1, parts.length - 2)).join(" ");
  const tailWords = parts.slice(Math.max(1, parts.length - 2)).join(" ");

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 70% at 50% 50%, rgba(15,35,56,0.55) 0%, rgba(15,35,56,0.25) 50%, rgba(15,35,56,0) 80%)",
          opacity: opacity * 0.85,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, calc(-50% + ${exitShift}px)) scale(${cardScale})`,
          opacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 32,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 28px",
            background: "rgba(255,255,255,0.08)",
            border: `1.5px solid ${LIME}`,
            borderRadius: 999,
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: LIME,
              boxShadow: `0 0 16px ${LIME}aa`,
            }}
          />
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "0.18em",
              color: INK,
              textTransform: "uppercase",
            }}
          >
            Agent demo
          </span>
        </div>

        <div
          style={{
            padding: "44px 72px",
            background: `linear-gradient(160deg, ${NAVY}f0, ${NAVY_DEEP}f8)`,
            border: "1.5px solid rgba(255,255,255,0.16)",
            borderRadius: 24,
            boxShadow:
              "0 32px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.10)",
            textAlign: "center",
            maxWidth: 1800,
          }}
        >
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: 88,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: INK,
            }}
          >
            {headWords}{" "}
            <span style={{ color: ACCENT }}>{tailWords}</span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// 2. Step labels (bottom-left badges)
// ===========================================================================

const StepLabels: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {CFG.stepLabels.map((spec, i) => {
        const start = secToFrame(spec.startSec);
        const end = start + secToFrame(spec.durationSec);
        const local = frame - start;
        const exitLocal = frame - (end - 12);

        if (frame < start - 2 || frame > end + 2) return null;

        const enterSpring = spring({
          frame: local,
          fps,
          config: { damping: 14, stiffness: 130, mass: 0.6 },
          durationInFrames: 14,
        });
        const opIn = interpolate(local, [0, 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opOut = interpolate(exitLocal, [0, 12], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opacity = Math.min(opIn, opOut);
        const slideX = interpolate(enterSpring, [0, 1], [-32, 0]);

        // Split "Step N of M: ..." into badge + label
        const m = spec.text.match(/^Step\s+(\d+)\s+of\s+\d+:\s*(.+)$/i);
        const num = m ? m[1] : `${i + 1}`;
        const label = m ? m[2] : spec.text;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 64,
              bottom: 64,
              transform: `translateX(${slideX}px)`,
              opacity,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              maxWidth: 1600,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "16px 28px 16px 18px",
                background: `linear-gradient(135deg, ${NAVY}ee, ${NAVY_DEEP}f5)`,
                border: `1.5px solid ${LIME}88`,
                borderRadius: 14,
                boxShadow:
                  "0 16px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)",
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: `linear-gradient(135deg, ${LIME}, ${NVIDIA_GREEN})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: FONT_MONO,
                  fontSize: 20,
                  fontWeight: 700,
                  color: NAVY_INK,
                  boxShadow: `0 0 14px ${LIME}66`,
                  flexShrink: 0,
                }}
              >
                {num}
              </div>
              <span
                style={{
                  fontFamily: FONT_STACK,
                  fontSize: 28,
                  fontWeight: 600,
                  color: INK,
                  letterSpacing: "-0.005em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 1500,
                }}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ===========================================================================
// 3. Sidebar callout (one per click target)
// ===========================================================================

const SidebarCalloutEl: React.FC<{
  spec: AutoOverlayConfig["sidebarCallouts"][number];
  idx: number;
}> = ({ spec, idx }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const start = secToFrame(spec.startSec);
  const end = start + secToFrame(spec.durationSec);
  const local = frame - start;
  const exitLocal = frame - (end - 10);

  if (frame < start - 4 || frame > end + 4) return null;

  const sIn = spring({
    frame: local,
    fps,
    config: { damping: 13, stiffness: 130, mass: 0.7 },
    durationInFrames: 16,
  });
  const opIn = interpolate(local, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opOut = interpolate(exitLocal, [0, 10], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(opIn, opOut);
  const shiftX = interpolate(sIn, [0, 1], [40, 0]);

  const [rx, ry, rw, rh] = spec.rect;
  const PAD = 8;
  const pulse = 0.5 + 0.5 * Math.sin((local / fps) * Math.PI * 2.5);
  const pulseScale = 1 + pulse * 0.015;

  // Decide which side of the rect the label panel goes. If rect is on the
  // left half, panel goes right; if rect is on the right half, panel goes
  // left.
  const rectCenterX = rx + rw / 2;
  const goRight = rectCenterX < W / 2;
  // Bottom-anchor instead if rect is in the bottom 30%
  const goAbove = ry > H * 0.65;

  const panelLeft = goRight ? rx + rw + PAD + 40 : rx - PAD - 700 - 40;
  const panelTop = goAbove ? ry - 220 : ry - 30;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: rx - PAD,
          top: ry - PAD,
          width: rw + PAD * 2,
          height: rh + PAD * 2,
          borderRadius: spec.soft ? 24 : 10,
          border: spec.soft
            ? `2px dashed ${ACCENT}`
            : `3px solid ${ACCENT}`,
          background: spec.soft
            ? "linear-gradient(135deg, rgba(99,91,255,0.06), rgba(74,63,255,0.03))"
            : "linear-gradient(135deg, rgba(99,91,255,0.10), rgba(74,63,255,0.06))",
          boxShadow: spec.soft
            ? `0 0 48px ${ACCENT}44`
            : `0 0 36px ${ACCENT}66, inset 0 0 24px rgba(99,91,255,0.10)`,
          opacity: opacity * (spec.soft ? 0.55 : 0.95),
          transform: `scale(${pulseScale})`,
          transformOrigin: `${rx + rw / 2}px ${ry + rh / 2}px`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: Math.max(40, panelLeft),
          top: Math.max(40, panelTop),
          opacity,
          transform: `translateX(${shiftX}px)`,
          display: "flex",
          alignItems: "center",
          gap: 24,
          flexDirection: goRight ? "row" : "row-reverse",
        }}
      >
        <svg width="120" height="80" viewBox="0 0 120 80" style={{ flexShrink: 0 }}>
          <defs>
            <filter id={`arrowGlowAuto${idx}`}>
              <feGaussianBlur stdDeviation="3" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {goRight ? (
            <>
              <path
                d="M 110 40 Q 80 35, 50 42 L 30 42"
                stroke={ACCENT}
                strokeWidth="6"
                fill="none"
                strokeLinecap="round"
                filter={`url(#arrowGlowAuto${idx})`}
              />
              <path
                d="M 30 42 L 48 28 M 30 42 L 48 56"
                stroke={ACCENT}
                strokeWidth="6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={`url(#arrowGlowAuto${idx})`}
              />
            </>
          ) : (
            <>
              <path
                d="M 10 40 Q 40 35, 70 42 L 90 42"
                stroke={ACCENT}
                strokeWidth="6"
                fill="none"
                strokeLinecap="round"
                filter={`url(#arrowGlowAuto${idx})`}
              />
              <path
                d="M 90 42 L 72 28 M 90 42 L 72 56"
                stroke={ACCENT}
                strokeWidth="6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={`url(#arrowGlowAuto${idx})`}
              />
            </>
          )}
        </svg>

        <div
          style={{
            padding: "20px 32px",
            background: `linear-gradient(135deg, ${NAVY}f2, ${NAVY_DEEP}fa)`,
            border: `1.5px solid ${ACCENT}aa`,
            borderRadius: 16,
            boxShadow:
              "0 20px 50px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.10)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxWidth: 700,
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "0.20em",
              color: ACCENT,
              textTransform: "uppercase",
            }}
          >
            Target found
          </div>
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: 32,
              fontWeight: 700,
              color: INK,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 640,
            }}
          >
            {spec.labelText}
          </div>
          {spec.urlChip && (
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 18,
                color: INK_DIM,
                letterSpacing: "0.02em",
                marginTop: 4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 640,
              }}
            >
              {spec.urlChip}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const AllSidebarCallouts: React.FC = () => (
  <>
    {CFG.sidebarCallouts.map((spec, i) => (
      <SidebarCalloutEl key={i} spec={spec} idx={i} />
    ))}
  </>
);

// ===========================================================================
// 4. Click ring
// ===========================================================================

const ClickRingEl: React.FC<{
  spec: AutoOverlayConfig["clickRings"][number];
}> = ({ spec }) => {
  const frame = useCurrentFrame();
  const center = secToFrame(spec.startSec);
  const local = frame - center;

  if (frame < center - 6 || frame > center + 36) return null;

  const ringScale = interpolate(local, [-6, 30], [0.2, 1.0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringOpacity = interpolate(local, [-6, 4, 30, 36], [0, 1, 0.55, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const flashScale = interpolate(local, [-6, 4], [0.5, 1.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const flashOpacity = interpolate(local, [-6, 0, 14], [0, 0.75, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ring2Scale = interpolate(local, [0, 28], [0.3, 0.75], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ring2Opacity = interpolate(local, [0, 6, 22], [0, 0.85, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const SIZE = spec.size;
  const FLASH = Math.round(SIZE * 0.7);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: spec.x,
          top: spec.y,
          width: FLASH,
          height: FLASH,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,255,255,0.92) 0%, rgba(99,91,255,0.55) 45%, transparent 75%)",
          transform: `translate(-50%, -50%) scale(${flashScale})`,
          opacity: flashOpacity,
          filter: "blur(8px)",
          mixBlendMode: "screen",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: spec.x,
          top: spec.y,
          width: SIZE,
          height: SIZE,
          borderRadius: "50%",
          border: `4px solid ${ACCENT}`,
          transform: `translate(-50%, -50%) scale(${ringScale})`,
          opacity: ringOpacity,
          boxShadow: `0 0 40px ${ACCENT}99, inset 0 0 30px ${ACCENT}55`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: spec.x,
          top: spec.y,
          width: SIZE * 0.55,
          height: SIZE * 0.55,
          borderRadius: "50%",
          border: `3px solid ${ACCENT_DEEP}`,
          transform: `translate(-50%, -50%) scale(${ring2Scale})`,
          opacity: ring2Opacity,
          boxShadow: `0 0 24px ${ACCENT_DEEP}99`,
        }}
      />
    </AbsoluteFill>
  );
};

const AllClickRings: React.FC = () => (
  <>
    {CFG.clickRings.map((spec, i) => (
      <ClickRingEl key={i} spec={spec} />
    ))}
  </>
);

// ===========================================================================
// 4b. Cursor (Fix #3): always visible; lerps between cursorTrack anchors
// ===========================================================================

const CursorSprite: React.FC<{ inFrame?: boolean }> = ({ inFrame = false }) => {
  const frame = useCurrentFrame();
  const track = CFG.cursorTrack || [];
  // Hide cursor during title (0..title.durationSec) and during outro
  const titleEndF = secToFrame(CFG.title.startSec + CFG.title.durationSec);
  const outroStartF = secToFrame(CFG.outro.startSec || 1e9);
  const fadeStartF = CFG.fadeBridge
    ? secToFrame(CFG.fadeBridge.startSec)
    : outroStartF;
  if (frame < titleEndF - 6) return null;
  if (frame >= Math.min(outroStartF, fadeStartF) - 4) return null;
  if (track.length === 0) return null;

  const tSec = frame / CFG.fps;

  // Find bracketing anchors
  let a = track[0];
  let b = track[track.length - 1];
  for (let i = 0; i < track.length - 1; i++) {
    if (track[i].tSec <= tSec && track[i + 1].tSec >= tSec) {
      a = track[i];
      b = track[i + 1];
      break;
    }
  }
  // Edge case: before first anchor
  if (tSec < track[0].tSec) {
    a = track[0];
    b = track[0];
  } else if (tSec > track[track.length - 1].tSec) {
    a = track[track.length - 1];
    b = track[track.length - 1];
  }

  const span = Math.max(0.001, b.tSec - a.tSec);
  const lerpT = Math.max(0, Math.min(1, (tSec - a.tSec) / span));
  // Smooth ease-in-out so motion doesn't feel linear/robotic
  const easedT = 0.5 - 0.5 * Math.cos(lerpT * Math.PI);
  let cx = a.x + (b.x - a.x) * easedT;
  let cy = a.y + (b.y - a.y) * easedT;

  // Gentle idle drift: 6px wobble at 0.4Hz so the cursor isn't pixel-frozen
  const wobbleX = Math.sin(tSec * 2.5) * 4;
  const wobbleY = Math.cos(tSec * 2.1) * 3;
  cx += wobbleX;
  cy += wobbleY;

  // Cursor is rendered inside FramedScreen at source coords. The parent
  // CameraZoom applies the whole-composition translate+scale transform, so
  // we no longer need to re-project the cursor here — the camera transform
  // moves the entire stage (wallpaper + framed screen + cursor) together.
  const renderLeft = cx - 8;
  const renderTop = cy - 4;

  // Fade in over first 6f after title ends
  const fadeIn = interpolate(frame, [titleEndF - 6, titleEndF + 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [Math.min(outroStartF, fadeStartF) - 18, Math.min(outroStartF, fadeStartF) - 4],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  // macOS-style arrow cursor in SVG (no emoji)
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg
        width="44"
        height="56"
        viewBox="0 0 44 56"
        style={{
          position: "absolute",
          left: renderLeft,
          top: renderTop,
          opacity,
          filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.55))",
        }}
      >
        <path
          d="M 4 2 L 4 38 L 14 30 L 20 46 L 26 44 L 20 28 L 32 28 Z"
          fill="#ffffff"
          stroke="#0a1a2c"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </AbsoluteFill>
  );
};

// ===========================================================================
// 4c. Scroll indicator (Fix #3): right-edge arrow badge during scroll actions
// ===========================================================================

const ScrollIndicators: React.FC = () => {
  const frame = useCurrentFrame();
  const inds = CFG.scrollIndicators || [];
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {inds.map((spec, i) => {
        const start = secToFrame(spec.startSec);
        const end = start + secToFrame(spec.durationSec);
        const local = frame - start;
        const exitLocal = frame - (end - 10);
        if (frame < start - 2 || frame > end + 2) return null;

        const opIn = interpolate(local, [0, 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opOut = interpolate(exitLocal, [0, 10], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opacity = Math.min(opIn, opOut);
        const isDown = (spec.direction || "down").toLowerCase().startsWith("d");
        // Three tick chevrons, staggered pulse to suggest motion
        const tickPulse = (k: number) =>
          0.4 +
          0.6 *
            Math.max(
              0,
              Math.sin((local / CFG.fps) * Math.PI * 4 - k * 0.6)
            );

        // Position near right edge, vertically centered, away from teaching panel
        const X_RIGHT = W - 140;
        const Y_CENTER = H * 0.42;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: X_RIGHT,
              top: Y_CENTER,
              opacity,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                padding: "10px 18px",
                background: `linear-gradient(135deg, ${NAVY}ee, ${NAVY_DEEP}f5)`,
                border: `1.5px solid ${LIME}88`,
                borderRadius: 10,
                boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
                fontFamily: FONT_MONO,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "0.20em",
                color: LIME,
                textTransform: "uppercase",
              }}
            >
              {isDown ? "Scroll down" : "Scroll up"}
            </div>
            {[0, 1, 2].map((k) => (
              <svg
                key={k}
                width="56"
                height="28"
                viewBox="0 0 56 28"
                style={{
                  opacity: tickPulse(k),
                  transform: isDown ? "rotate(0deg)" : "rotate(180deg)",
                  filter: `drop-shadow(0 0 6px ${LIME}aa)`,
                }}
              >
                <path
                  d="M 6 6 L 28 22 L 50 6"
                  stroke={LIME}
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ))}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ===========================================================================
// 4d. Fade bridge (Fix #4): black wedge between teaching panel and outro
// ===========================================================================

const FadeBridge: React.FC = () => {
  const frame = useCurrentFrame();
  const fb = CFG.fadeBridge;
  if (!fb || !fb.durationSec) return null;
  const start = secToFrame(fb.startSec);
  const end = start + secToFrame(fb.durationSec);
  if (frame < start - 2 || frame > end + 2) return null;
  const local = frame - start;
  const totalF = end - start;
  // Ramp 0->1 over first 40%, hold 100% for 20%, ramp 1->0 over last 40%
  const t = local / totalF;
  let blackOp: number;
  if (t < 0.4) {
    blackOp = t / 0.4;
  } else if (t < 0.6) {
    blackOp = 1;
  } else {
    blackOp = 1 - (t - 0.6) / 0.4;
  }
  blackOp = Math.max(0, Math.min(1, blackOp));
  return (
    <AbsoluteFill
      style={{ background: "#000", opacity: blackOp, pointerEvents: "none" }}
    />
  );
};

// ===========================================================================
// 5. Teaching panel
// ===========================================================================

const TeachingPanelEl: React.FC = () => {
  const frame = useCurrentFrame();
  const tp = CFG.teachingPanel;
  if (!tp || !tp.headline || !tp.durationSec) return null;

  const start = secToFrame(tp.startSec);
  const end = start + secToFrame(tp.durationSec);
  const local = frame - start;
  const exitLocal = frame - (end - 14);

  if (frame < start - 4 || frame > end + 4) return null;

  const sIn = spring({
    frame: local,
    fps: CFG.fps,
    config: { damping: 14, stiffness: 105, mass: 0.7 },
    durationInFrames: 20,
  });
  const opIn = interpolate(local, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opOut = interpolate(exitLocal, [0, 14], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(opIn, opOut);
  const cardScale = 0.94 + sIn * 0.06;
  const cardY = interpolate(sIn, [0, 1], [40, 0]);

  const PANEL_W = Math.round(W * (tp.widthFrac || 0.58));
  const MARGIN = 72;
  const PANEL_LEFT = W - PANEL_W - MARGIN;
  const PANEL_BOTTOM_MARGIN = 80;

  const bullets = tp.bullets || [];

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 55% 60% at 75% 85%, rgba(10,26,44,0.45) 0%, rgba(10,26,44,0.15) 50%, rgba(10,26,44,0) 80%)",
          opacity: opacity * 0.85,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: PANEL_LEFT,
          bottom: PANEL_BOTTOM_MARGIN,
          transform: `translateY(${cardY}px) scale(${cardScale})`,
          transformOrigin: "100% 100%",
          opacity,
          width: PANEL_W,
          padding: "36px 52px 40px",
          background: `linear-gradient(160deg, ${NAVY}e6, ${NAVY_DEEP}f0)`,
          border: "1.5px solid rgba(255,255,255,0.16)",
          borderRadius: 22,
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow:
            "0 40px 100px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 18px",
              background: `${ACCENT}22`,
              border: `1.5px solid ${ACCENT}`,
              borderRadius: 999,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <polyline
                points="20 6 9 17 4 12"
                stroke={ACCENT}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "0.20em",
                color: ACCENT,
                textTransform: "uppercase",
              }}
            >
              Target unlocked
            </span>
          </div>

          {tp.url && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 16px",
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8,
                maxWidth: PANEL_W - 380,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: ACCENT,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 18,
                  color: INK_DIM,
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {tp.url}
              </span>
            </div>
          )}
        </div>

        <div
          style={{
            fontFamily: FONT_STACK,
            fontSize: 60,
            fontWeight: 700,
            color: INK,
            letterSpacing: "-0.025em",
            lineHeight: 1.0,
            marginTop: 2,
          }}
        >
          {tp.headline}
        </div>

        <div
          style={{
            fontFamily: FONT_STACK,
            fontSize: 22,
            fontWeight: 400,
            color: INK_DIM,
            letterSpacing: "0.01em",
            marginTop: -4,
          }}
        >
          What this page teaches the agent
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 4,
          }}
        >
          {bullets.map((text, i) => {
            const stagger = 14 + i * 7;
            const bOp = interpolate(local, [stagger, stagger + 12], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const bX = interpolate(local, [stagger, stagger + 12], [-20, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 18,
                  opacity: bOp,
                  transform: `translateX(${bX}px)`,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 7,
                    background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    fontWeight: 700,
                    color: INK,
                    flexShrink: 0,
                    marginTop: 4,
                  }}
                >
                  {String.fromCharCode(65 + i)}
                </div>
                <span
                  style={{
                    fontFamily: FONT_STACK,
                    fontSize: 26,
                    fontWeight: 500,
                    color: INK,
                    letterSpacing: "-0.005em",
                    lineHeight: 1.25,
                  }}
                >
                  {text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// 6. Outro stack
// ===========================================================================

const OutroEl: React.FC = () => {
  const frame = useCurrentFrame();
  const o = CFG.outro;
  if (!o || !o.durationSec) return null;

  const start = secToFrame(o.startSec);
  const end = start + secToFrame(o.durationSec);
  const local = frame - start;
  const exitLocal = frame - (end - 18);

  if (frame < start - 4) return null;

  const sIn = spring({
    frame: local,
    fps: CFG.fps,
    config: { damping: 14, stiffness: 100, mass: 0.7 },
    durationInFrames: 22,
  });
  const opIn = interpolate(local, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opOut = interpolate(exitLocal, [0, 18], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(opIn, opOut);
  const cardY = interpolate(sIn, [0, 1], [50, 0]);
  const bgOp = interpolate(local, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 90% 90% at 50% 50%, #0a1a2c 0%, #050d18 60%, #000 100%)",
          opacity: bgOp * opacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(135deg, rgba(132,204,22,0.04) 0px, rgba(132,204,22,0.04) 2px, transparent 2px, transparent 80px)`,
          opacity: bgOp * opacity * 0.8,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, calc(-50% + ${cardY}px))`,
          opacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 32,
          width: 1900,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 26px",
            background: "rgba(132,204,22,0.10)",
            border: `1.5px solid ${LIME}`,
            borderRadius: 999,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: LIME,
              boxShadow: `0 0 12px ${LIME}`,
            }}
          />
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.22em",
              color: LIME,
              textTransform: "uppercase",
            }}
          >
            How it works
          </span>
        </div>

        <div
          style={{
            fontFamily: FONT_STACK,
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: "-0.035em",
            color: INK,
            textAlign: "center",
            lineHeight: 1.0,
          }}
        >
          Nemotron all the{" "}
          <span style={{ color: NVIDIA_GREEN }}>way down</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            width: "100%",
            marginTop: 6,
          }}
        >
          {(o.stack || []).map((row, i) => {
            const stagger = 18 + i * 6;
            const rOp = interpolate(local, [stagger, stagger + 14], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const rX = interpolate(local, [stagger, stagger + 14], [-30, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            // Split on em-dash or " — " for product/role split
            const m = row.split(/\s+—\s+/);
            const product = m[0];
            const role = m.length > 1 ? m.slice(1).join(" — ") : "";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 28,
                  padding: "20px 34px",
                  background: `linear-gradient(135deg, rgba(26,58,92,0.85), rgba(15,35,56,0.95))`,
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 14,
                  boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                  opacity: rOp,
                  transform: `translateX(${rX}px)`,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 10,
                    background: `linear-gradient(135deg, ${LIME}, ${NVIDIA_GREEN})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FONT_MONO,
                    fontSize: 28,
                    fontWeight: 700,
                    color: NAVY_INK,
                    flexShrink: 0,
                    boxShadow: `0 0 18px ${LIME}55`,
                  }}
                >
                  {i + 1}
                </div>

                <span
                  style={{
                    fontFamily: FONT_STACK,
                    fontSize: 34,
                    fontWeight: 700,
                    color: INK,
                    letterSpacing: "-0.01em",
                    minWidth: 600,
                  }}
                >
                  {product}
                </span>

                {role && (
                  <>
                    <div
                      style={{
                        width: 1,
                        height: 36,
                        background: "rgba(255,255,255,0.15)",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: FONT_STACK,
                        fontSize: 28,
                        fontWeight: 400,
                        color: INK_DIM,
                        letterSpacing: "0.005em",
                      }}
                    >
                      {role}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {o.tagline && (
          <div
            style={{
              marginTop: 8,
              fontFamily: FONT_STACK,
              fontSize: 28,
              fontWeight: 500,
              color: INK_DIM,
              letterSpacing: "0.01em",
              textAlign: "center",
            }}
          >
            {o.tagline}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// 7. Final fade
// ===========================================================================

const FinalFade: React.FC = () => {
  const frame = useCurrentFrame();
  const FADE_START = AUTO_OVERLAY_TOTAL_FRAMES - 24;
  const FADE_END = AUTO_OVERLAY_TOTAL_FRAMES - 6;
  if (frame < FADE_START) return null;
  const blackOp = interpolate(frame, [FADE_START, FADE_END], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: "#000",
        opacity: blackOp,
        pointerEvents: "none",
      }}
    />
  );
};

// ===========================================================================
// 8. Camera (whole-composition zoom) — replaces the prior UV-crop transform.
//    Math lives in computeCropState (below). The CameraZoom component
//    consumes it and applies a single translate+scale to the whole stage
//    (wallpaper + framed screen + cursor) so nothing gets cropped at zoom.
// ===========================================================================
//
// Reads CFG.cameraEvents (zoomIn → hold → zoomOut triples emitted by
// auto-overlay-config.js Phase 2 schema). Each event carries
// `targetCenter` in UV [0,1] source coords and `targetZoom`. CameraZoom maps
// the UV center to canvas-px (FRAME_INSET + center * INNER), then translates
// so that point lands at the canvas center under the scale factor.

const easeInOutCubic = (t: number) => {
  // standard formula: t<0.5 ? 4t^3 : 1 - ( -2t+2 )^3 / 2
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

// Cubic-bezier(0.2, 0.7, 0.3, 1) approximation as an ease-out cubic.
// Matches the spec's "ease-out, not spring" timing per reference-app teardown.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type CropState = {
  centerX: number; // UV [0,1] (pre-snap, pre-clamp)
  centerY: number;
  zoom: number;
};

const snapToEdge = (uv: number) => {
  if (uv < EDGE_SNAP) return 0;
  if (uv > 1 - EDGE_SNAP) return 1;
  return uv;
};

const NEUTRAL_CROP: CropState = { centerX: 0.5, centerY: 0.5, zoom: 1 };

// computeCropState walks CFG.cameraEvents and returns the UV center + zoom
// for the given second. zoomIn / zoomOut ramps use easeOutCubic per spec
// (cubic-bezier 0.2, 0.7, 0.3, 1). hold is constant. Inactive → NEUTRAL.
const computeCropState = (tSec: number): CropState => {
  const events = CFG.cameraEvents || [];
  if (!events.length) return NEUTRAL_CROP;
  for (let i = 0; i < events.length; i++) {
    const e: any = events[i];
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
// Order matters (spec): focus_uv → snap_to_edges → clamp(viewport_half, 1 - viewport_half).
// The video is sized SOURCE_W × SOURCE_H. After scaling by `zoom` (origin 0,0),
// pixel (cx*SOURCE_W, cy*SOURCE_H) sits at (cx*SOURCE_W*zoom, cy*SOURCE_H*zoom).
// We want it at (INNER_W/2, INNER_H/2), so translate by the difference.
const cropToTransform = (s: CropState) => {
  const viewportHalf = 0.5 / s.zoom;
  const snappedX = snapToEdge(s.centerX);
  const snappedY = snapToEdge(s.centerY);
  const cx = Math.max(viewportHalf, Math.min(1 - viewportHalf, snappedX));
  const cy = Math.max(viewportHalf, Math.min(1 - viewportHalf, snappedY));
  const tx = -(cx * SOURCE_W * s.zoom - INNER_W / 2);
  const ty = -(cy * SOURCE_H * s.zoom - INNER_H / 2);
  return { tx, ty, scale: s.zoom, snappedCenter: { x: cx, y: cy } };
};

// Stage paints the static gradient that frames the recording. Sits behind
// FramedScreen at the AbsoluteFill canvas level.
// Image-backed wallpaper: wallpaper.jpg in remotion/public/ at object-fit:cover.
// Fallback #0a0e1a color shows if the image is missing.
const Stage: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: "#0a0e1a" }}>
    <Img
      src={staticFile("wallpaper.jpg")}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
    {children}
  </AbsoluteFill>
);

// FramedScreen is the fixed inner rect with rounded corners + drop shadow.
// `overflow: hidden` clips child content to the rounded rect.
const FramedScreen: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
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

// VideoCrop now just renders the video at INNER_W × INNER_H with no internal
// transform. The CameraZoom parent applies the whole-composition translate+scale
// so nothing gets cropped at zoom (cursor and content stay visible).
const VideoCrop: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: INNER_W,
        height: INNER_H,
      }}
    >
      {children}
    </div>
  );
};

// CameraZoom wraps Stage + FramedScreen and applies a per-frame translate+scale
// to the whole composition so the wallpaper + framed window + screen video +
// cursor + callouts ALL move together. Nothing gets cropped — content and
// cursor stay visible at any zoom factor.
//
// Reads CFG.cameraEvents `targetCenter` (in source UV) and `targetZoom`.
// Maps the UV center to canvas-px center, then computes the translate that
// keeps the canvas center pinned to the zoom focus.
const CameraZoom: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const tSec = frame / CFG.fps;
  const s = computeCropState(tSec);
  const z = s.zoom;
  // Map UV source coords -> canvas px (the framed window sits at FRAME_INSET).
  const cx_canvas = FRAME_INSET_X + s.centerX * INNER_W;
  const cy_canvas = FRAME_INSET_Y + s.centerY * INNER_H;
  const tx = W / 2 - cx_canvas * z;
  const ty = H / 2 - cy_canvas * z;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: W,
        height: H,
        transformOrigin: "0 0",
        transform: `translate(${tx}px, ${ty}px) scale(${z})`,
        transition: "none",
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
};

// ===========================================================================
// Composition entry
// ===========================================================================

export const AutoOverlay: React.FC = () => {
  const baseFrames = CFG.baseFrames;
  const freezeFrames = Math.max(0, CFG.totalFrames - baseFrames);
  const baseSrc = staticFile(CFG.baseVideo.replace(/^\//, ""));

  // Source video fills the inner-rect (FramedScreen) at its native 2560×1440.
  // VideoCrop applies the per-frame UV-crop transform around it. CursorSprite
  // mounts inside FramedScreen with inFrame so its coords are reprojected
  // through the same transform.
  const videoStyle = {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: INNER_W,
    height: INNER_H,
    objectFit: "cover" as const,
  };

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* CameraZoom wraps Stage + FramedScreen so the wallpaper + framed
          window + video + cursor all translate+scale together. Nothing is
          cropped at zoom; cursor + content remain visible. */}
      <CameraZoom>
        <Stage />
        <FramedScreen>
          <VideoCrop>
            <Sequence from={0} durationInFrames={baseFrames}>
              <OffthreadVideo src={baseSrc} style={videoStyle} />
            </Sequence>
            {freezeFrames > 0 && (
              <Sequence from={baseFrames} durationInFrames={freezeFrames}>
                <Freeze frame={baseFrames - 1}>
                  <OffthreadVideo src={baseSrc} style={videoStyle} />
                </Freeze>
              </Sequence>
            )}
          </VideoCrop>
          {/* CursorSprite mount removed: recording (auto-base.mp4) already has
              the DOM cursor baked in from replay-60fps.js. Overlay cursor
              would visually double. Component definition kept for reuse. */}
        </FramedScreen>
      </CameraZoom>

      {/* Canvas-level overlays — OUTSIDE CameraZoom, stay pinned at the
          2560×1440 canvas root and do not zoom with the stage. */}
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
};
