import { Composition } from "remotion";
import { Explainer, INTRO_DURATION, STEP_DURATION, DONE_DURATION } from "./Explainer";
import { SmoothExplainer, SMOOTH_TOTAL_FRAMES } from "./SmoothExplainer";
import { NativeExplainer, NATIVE_TOTAL_FRAMES } from "./NativeExplainer";
import { HybridExplainer, HYBRID_TOTAL_FRAMES } from "./HybridExplainer";
import { OverlayedExplainer, OVERLAYED_TOTAL_FRAMES } from "./OverlayedExplainer";
import { OverlayedExplainerV17, OVERLAYED_V17_TOTAL_FRAMES } from "./OverlayedExplainerV17";
import {
  OverlayedExplainerV17Stripe,
  OVERLAYED_V17_STRIPE_TOTAL_FRAMES,
} from "./OverlayedExplainerV17Stripe";
import { OverlayedV22, OVERLAYED_V22_TOTAL_FRAMES } from "./OverlayedV22";
import {
  OverlayedV22Minimal,
  OVERLAYED_V22_MINIMAL_TOTAL_FRAMES,
} from "./OverlayedV22Minimal";
import {
  ParallelScouts,
  PARALLEL_SCOUTS_TOTAL_FRAMES,
  PARALLEL_FPS,
} from "./ParallelScouts";
import {
  AutoOverlay,
  AUTO_OVERLAY_TOTAL_FRAMES,
  AUTO_OVERLAY_FPS,
} from "./AutoOverlay";
import { PitchFlow, PITCH_FLOW_TOTAL_FRAMES, PITCH_FLOW_FPS } from "./PitchFlow";
// ScreenshotSlideshow: rejected style per Dennis 2026-05-27. Its static
// require of public/screenshots-sandbox/action-log.json broke the Remotion
// bundle for every other composition (make-explainer.sh wipes that dir at
// the start of every run). Unregistered here so the Explainer comp renders.
// File preserved at src/ScreenshotSlideshow.tsx if ever needed back.
import actionLog from "../public/action-log.json";

const totalFrames =
  INTRO_DURATION +
  actionLog.actions.reduce((acc: number, a: any) => {
    return acc + (a.kind === "done" ? DONE_DURATION : STEP_DURATION);
  }, 0) +
  30; // tail padding

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Explainer"
      component={Explainer}
      durationInFrames={totalFrames}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="SmoothExplainer"
      component={SmoothExplainer}
      durationInFrames={SMOOTH_TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="NativeExplainer"
      component={NativeExplainer}
      durationInFrames={NATIVE_TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="HybridExplainer"
      component={HybridExplainer}
      durationInFrames={HYBRID_TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="OverlayedExplainer"
      component={OverlayedExplainer}
      durationInFrames={OVERLAYED_TOTAL_FRAMES}
      fps={60}
      width={2560}
      height={1440}
    />
    <Composition
      id="OverlayedExplainerV17"
      component={OverlayedExplainerV17}
      durationInFrames={OVERLAYED_V17_TOTAL_FRAMES}
      fps={60}
      width={2560}
      height={1440}
    />
    <Composition
      id="OverlayedExplainerV17Stripe"
      component={OverlayedExplainerV17Stripe}
      durationInFrames={OVERLAYED_V17_STRIPE_TOTAL_FRAMES}
      fps={60}
      width={2560}
      height={1440}
    />
    <Composition
      id="OverlayedV22"
      component={OverlayedV22}
      durationInFrames={OVERLAYED_V22_TOTAL_FRAMES}
      fps={60}
      width={2560}
      height={1440}
    />
    <Composition
      id="OverlayedV22Minimal"
      component={OverlayedV22Minimal}
      durationInFrames={OVERLAYED_V22_MINIMAL_TOTAL_FRAMES}
      fps={60}
      width={2560}
      height={1440}
    />
    <Composition
      id="ParallelScouts"
      component={ParallelScouts}
      durationInFrames={PARALLEL_SCOUTS_TOTAL_FRAMES}
      fps={PARALLEL_FPS}
      width={2560}
      height={1440}
    />
    <Composition
      id="AutoOverlay"
      component={AutoOverlay}
      durationInFrames={AUTO_OVERLAY_TOTAL_FRAMES}
      fps={AUTO_OVERLAY_FPS}
      width={2560}
      height={1440}
    />
    <Composition
      id="PitchFlow"
      component={PitchFlow}
      durationInFrames={PITCH_FLOW_TOTAL_FRAMES}
      fps={PITCH_FLOW_FPS}
      width={1920}
      height={1080}
    />
    {/* ScreenshotSlideshow composition unregistered 2026-05-27 — see import block above. */}
  </>
);
