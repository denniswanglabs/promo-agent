import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
} from "remotion";
import actionLogRaw from "../public/action-log.json";

export const INTRO_DURATION = 60;
export const STEP_DURATION  = 120;
export const DONE_DURATION  = 90;

const ACCENT = "#84cc16";
const BG     = "#0a0a0a";
const SCREEN_W = 1440;
const SCREEN_H = 900;
const OFFSET_X = (1920 - SCREEN_W) / 2;
const OFFSET_Y = 60;

const actionLog = actionLogRaw as any;

const stripRun = (p: string) =>
  p.replace(/^\.?\/?run\//, "").replace(/^run\//, "");

type CursorPathEntry = {
  start: { x: number; y: number } | null;
  end:   { x: number; y: number };
};

const computeCursorPath = (actions: any[]): CursorPathEntry[] => {
  let prev: { x: number; y: number } | null = null;
  const out: CursorPathEntry[] = [];
  for (const a of actions) {
    if (a.kind === "click") {
      const end = { x: a.click.x, y: a.click.y };
      out.push({ start: prev, end });
      prev = end;
    } else {
      out.push({ start: prev, end: prev ?? { x: SCREEN_W / 2, y: SCREEN_H / 2 } });
    }
  }
  return out;
};

const cursorPath = computeCursorPath(actionLog.actions);

export const Explainer: React.FC = () => {
  let cursor = INTRO_DURATION;
  const segs: React.ReactNode[] = [];

  segs.push(
    <Sequence key="intro" from={0} durationInFrames={INTRO_DURATION}>
      <Intro goal={actionLog.goal} />
    </Sequence>
  );

  actionLog.actions.forEach((action: any, i: number) => {
    const duration = action.kind === "done" ? DONE_DURATION : STEP_DURATION;
    const path = cursorPath[i];
    segs.push(
      <Sequence key={i} from={cursor} durationInFrames={duration}>
        {action.kind === "click"
          ? <ClickStep action={action} index={i} cursor={path} />
          : <DoneStep action={action} cursor={path} />}
      </Sequence>
    );
    cursor += duration;
  });

  return <AbsoluteFill style={{ backgroundColor: BG }}>{segs}</AbsoluteFill>;
};

const Intro: React.FC<{ goal: string }> = ({ goal }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 12, 48, 60], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });
  const eyebrowY = interpolate(
    spring({ frame, fps, config: { damping: 18, mass: 0.8 } }),
    [0, 1],
    [20, 0]
  );
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        color: "white",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 28,
        padding: 96,
        opacity,
        fontFamily: "Inter, -apple-system, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 26,
          color: ACCENT,
          textTransform: "uppercase",
          letterSpacing: 6,
          fontWeight: 600,
          transform: `translateY(${eyebrowY}px)`,
        }}
      >
        Explainer Agent · Feasibility Demo
      </div>
      <div
        style={{
          fontSize: 72,
          fontWeight: 600,
          textAlign: "center",
          maxWidth: 1500,
          lineHeight: 1.1,
          letterSpacing: -1.5,
        }}
      >
        {goal}
      </div>
      <div
        style={{
          fontSize: 22,
          color: "rgba(255,255,255,0.55)",
          marginTop: 12,
        }}
      >
        Nemotron 3 Super 120B · driving Chromium · {actionLog.startUrl.replace(/^https?:\/\//, "")}
      </div>
    </AbsoluteFill>
  );
};

const Cursor: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <svg
    viewBox="0 0 24 24"
    style={{
      position: "absolute",
      left: x - 6,
      top: y - 4,
      width: 40,
      height: 40,
      pointerEvents: "none",
      filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.5))",
    }}
  >
    <path
      d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86 2.95 6.55c.1.21.36.31.58.21l1.85-.85c.21-.1.31-.36.21-.58l-2.94-6.55h6.36c.45 0 .67-.54.35-.85L6.31 2.92c-.31-.31-.81-.09-.81.29z"
      fill="white"
      stroke="black"
      strokeWidth="1.2"
    />
  </svg>
);

const ClickStep: React.FC<{ action: any; index: number; cursor: CursorPathEntry }> = ({
  action,
  index,
  cursor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const isFirstClick = cursor.start === null;

  // First step does a brief screen fade-in. Subsequent steps show the
  // screenshot immediately so the cursor's continuity isn't broken by an
  // empty frame.
  const screenOpacity = isFirstClick
    ? interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" })
    : 1;

  // Cursor animation. First step: cursor enters off-screen at frame 18.
  // Subsequent steps: cursor begins at the previous click position at
  // frame 0 and animates from there.
  const cursorProg = isFirstClick
    ? spring({
        frame: frame - 18,
        fps,
        config: { damping: 22, mass: 0.9, stiffness: 90 },
      })
    : spring({
        frame,
        fps,
        config: { damping: 22, mass: 0.9, stiffness: 90 },
      });

  const ringScale = interpolate(frame, [60, 84], [0.4, 2.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringOpacity = interpolate(frame, [60, 84], [0.95, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const captionOpacity = interpolate(frame, [72, 92], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const captionY = interpolate(frame, [72, 92], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const afterOpacity = interpolate(frame, [100, 118], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorTargetX = OFFSET_X + cursor.end.x;
  const cursorTargetY = OFFSET_Y + cursor.end.y;

  let cursorStartX: number;
  let cursorStartY: number;
  if (isFirstClick) {
    // Enter from off-screen bottom-right of the laptop chrome
    cursorStartX = OFFSET_X + SCREEN_W + 40;
    cursorStartY = OFFSET_Y + SCREEN_H - 40;
  } else {
    cursorStartX = OFFSET_X + cursor.start!.x;
    cursorStartY = OFFSET_Y + cursor.start!.y;
  }

  const cursorX = interpolate(cursorProg, [0, 1], [cursorStartX, cursorTargetX]);
  const cursorY = interpolate(cursorProg, [0, 1], [cursorStartY, cursorTargetY]);

  const before = stripRun(action.screenshotBefore);
  const after  = stripRun(action.screenshotAfter);

  const targetLabel =
    (action.target && (action.target.text || action.target.aria)) || "element";

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Img
        src={staticFile(before)}
        style={{
          position: "absolute",
          left: OFFSET_X,
          top: OFFSET_Y,
          width: SCREEN_W,
          height: SCREEN_H,
          opacity: screenOpacity,
          borderRadius: 14,
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)",
          objectFit: "cover",
        }}
      />
      <Img
        src={staticFile(after)}
        style={{
          position: "absolute",
          left: OFFSET_X,
          top: OFFSET_Y,
          width: SCREEN_W,
          height: SCREEN_H,
          opacity: afterOpacity,
          borderRadius: 14,
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)",
          objectFit: "cover",
        }}
      />

      <svg
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          pointerEvents: "none",
        }}
      >
        <circle
          cx={cursorTargetX}
          cy={cursorTargetY}
          r={30 * ringScale}
          fill="none"
          stroke={ACCENT}
          strokeWidth={5}
          opacity={ringOpacity}
        />
      </svg>

      <Cursor x={cursorX} y={cursorY} />

      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 80,
          right: 80,
          opacity: captionOpacity,
          transform: `translateY(${captionY}px)`,
          background: "rgba(20, 20, 20, 0.86)",
          backdropFilter: "blur(14px)",
          border: `1px solid ${ACCENT}45`,
          borderRadius: 18,
          padding: "28px 36px",
          display: "flex",
          alignItems: "center",
          gap: 28,
          fontFamily: "Inter, -apple-system, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            background: ACCENT,
            color: BG,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 34,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {index + 1}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: "white", fontSize: 38, fontWeight: 600, lineHeight: 1.15 }}>
            Click <span style={{ color: ACCENT }}>“{targetLabel}”</span>
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: 22,
              lineHeight: 1.3,
              maxWidth: 1400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {action.description}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const DoneStep: React.FC<{ action: any; cursor: CursorPathEntry }> = ({ action, cursor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // No screenshot fade — visual continuity from the previous step
  const badgeScale = spring({
    frame: frame - 20,
    fps,
    config: { damping: 11, mass: 0.7 },
  });
  const screenshot = stripRun(action.screenshot);

  // Cursor stays at last click position; gently fades out after the badge appears
  const cursorOpacity = interpolate(frame, [40, 65], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorPos = cursor.end;

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Img
        src={staticFile(screenshot)}
        style={{
          position: "absolute",
          left: OFFSET_X,
          top: OFFSET_Y,
          width: SCREEN_W,
          height: SCREEN_H,
          borderRadius: 14,
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)",
          objectFit: "cover",
        }}
      />
      <div style={{ opacity: cursorOpacity }}>
        <Cursor x={OFFSET_X + cursorPos.x} y={OFFSET_Y + cursorPos.y} />
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: "50%",
          transform: `translateX(-50%) scale(${badgeScale})`,
          background: ACCENT,
          color: BG,
          padding: "22px 48px",
          borderRadius: 100,
          fontSize: 40,
          fontWeight: 800,
          fontFamily: "Inter, -apple-system, system-ui, sans-serif",
          letterSpacing: -0.5,
          boxShadow: "0 12px 32px rgba(132, 204, 22, 0.35)",
        }}
      >
        Goal reached
      </div>
    </AbsoluteFill>
  );
};
