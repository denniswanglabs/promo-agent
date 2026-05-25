#!/usr/bin/env python3
"""Write a minimal Remotion project from a CompositionSpec JSON.

Usage: write_remotion_project.py <spec.json> <project_dir>

Generates:
- <project_dir>/src/Promo.tsx       — the composition component
- <project_dir>/src/Root.tsx        — Remotion root with one Composition
- <project_dir>/src/index.ts        — Remotion entry
- <project_dir>/remotion.config.ts  — bundler config (publicDir = "public")
"""
import json
import sys
from pathlib import Path

spec_path = Path(sys.argv[1])
project_dir = Path(sys.argv[2])
src = project_dir / "src"
src.mkdir(parents=True, exist_ok=True)

spec = json.loads(spec_path.read_text())

# Pretty-print spec for embedding directly into Promo.tsx (constants, not props,
# so we don't need Remotion's defaultProps wiring).
spec_literal = json.dumps(spec, indent=2)

promo_tsx = f"""import {{ AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, Img, Video, staticFile }} from "remotion";

const SPEC = {spec_literal} as const;

const SCENE_FILE: Record<string, string> = {{}};
SPEC.scenes.forEach((s, i) => {{
  const ext = s.asset_type === "video" ? "mp4" : "png";
  SCENE_FILE[`scene_${{i + 1}}`] = `scene_${{i + 1}}.${{ext}}`;
}});

export const Promo: React.FC = () => {{
  const frame = useCurrentFrame();
  const {{ fps }} = useVideoConfig();

  let cursor = 0;
  return (
    <AbsoluteFill style={{{{ background: SPEC.palette.primary, fontFamily: "Inter, system-ui, sans-serif" }}}}>
      {{SPEC.scenes.map((scene, idx) => {{
        const from = cursor;
        cursor += scene.duration_f;
        const sceneKey = `scene_${{idx + 1}}`;
        const fileName = SCENE_FILE[sceneKey];
        // simple Ken-Burns: slight zoom over scene duration
        const localFrame = frame - from;
        const scale = interpolate(localFrame, [0, scene.duration_f], [1.0, 1.06], {{ extrapolateRight: "clamp" }});
        const copyOpacity = interpolate(localFrame, [0, 10, scene.duration_f - 15, scene.duration_f], [0, 1, 1, 0], {{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }});

        return (
          <Sequence key={{idx}} from={{from}} durationInFrames={{scene.duration_f}}>
            <AbsoluteFill style={{{{ overflow: "hidden" }}}}>
              <div style={{{{ position: "absolute", inset: 0, transform: `scale(${{scale}})` }}}}>
                {{scene.asset_type === "video" ? (
                  <Video src={{staticFile(fileName)}} muted style={{{{ width: "100%", height: "100%", objectFit: "cover" }}}} />
                ) : (
                  <Img src={{staticFile(fileName)}} style={{{{ width: "100%", height: "100%", objectFit: "cover" }}}} />
                )}}
              </div>
              <div style={{{{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 60%)" }}}} />
              <div style={{{{
                position: "absolute",
                bottom: 80,
                left: 80,
                right: 80,
                color: "#fff",
                opacity: copyOpacity,
                fontWeight: 800,
                fontSize: 64,
                lineHeight: 1.05,
                textShadow: `0 2px 12px ${{SPEC.palette.primary}}`,
              }}}}>
                {{scene.copy.map((line: string, i: number) => (
                  <div key={{i}} style={{{{ marginBottom: 12 }}}}>{{line}}</div>
                ))}}
              </div>
              <div style={{{{
                position: "absolute",
                top: 60,
                left: 80,
                color: SPEC.palette.accent,
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: 2,
                textTransform: "uppercase",
                opacity: copyOpacity,
              }}}}>
                Act {{scene.act}} · {{scene.type.replace(/_/g, " ")}}
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      }})}}
    </AbsoluteFill>
  );
}};
"""

root_tsx = f"""import {{ Composition }} from "remotion";
import {{ Promo }} from "./Promo";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Promo"
    component={{Promo}}
    durationInFrames={{{spec["total_duration_f"]}}}
    fps={{30}}
    width={{1920}}
    height={{1080}}
  />
);
"""

index_ts = """import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
"""

config_ts = """import { Config } from "@remotion/cli/config";

Config.setPublicDir("public");
Config.setVideoImageFormat("jpeg");
"""

tsconfig_json = """{
  "compilerOptions": {
    "target": "ES2018",
    "module": "ESNext",
    "moduleResolution": "node",
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "lib": ["DOM", "ES2018"]
  },
  "include": ["src/**/*"]
}
"""

(src / "Promo.tsx").write_text(promo_tsx)
(src / "Root.tsx").write_text(root_tsx)
(src / "index.ts").write_text(index_ts)
(project_dir / "remotion.config.ts").write_text(config_ts)
(project_dir / "tsconfig.json").write_text(tsconfig_json)

print(f"wrote Remotion project under {src}")
