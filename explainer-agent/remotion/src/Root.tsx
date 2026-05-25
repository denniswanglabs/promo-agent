import { Composition } from "remotion";
import { Explainer, INTRO_DURATION, STEP_DURATION, DONE_DURATION } from "./Explainer";
import actionLog from "../public/action-log.json";

const totalFrames =
  INTRO_DURATION +
  actionLog.actions.reduce((acc: number, a: any) => {
    return acc + (a.kind === "done" ? DONE_DURATION : STEP_DURATION);
  }, 0) +
  30; // tail padding

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Explainer"
    component={Explainer}
    durationInFrames={totalFrames}
    fps={30}
    width={1920}
    height={1080}
  />
);
