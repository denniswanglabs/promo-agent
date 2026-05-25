#!/usr/bin/env python3
"""write_remotion_project.py — Generate a Remotion project from a CompositionSpec.

Modes:
  --mode=kinetic (default) — pure kinetic-typography, no assets needed
  --mode=asset             — image/video assets per scene (Higgsfield path)

Usage:
  write_remotion_project.py <spec.json> <project_dir> [--mode kinetic|asset]

Writes:
  <project_dir>/src/Promo.tsx       (or KineticPromo.tsx, both export `Promo`)
  <project_dir>/src/Root.tsx
  <project_dir>/src/index.ts
  <project_dir>/remotion.config.ts
  <project_dir>/tsconfig.json
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("spec_path", type=Path)
    p.add_argument("project_dir", type=Path)
    p.add_argument("--mode", choices=["kinetic", "asset"], default="kinetic")
    return p.parse_args()


KINETIC_TEMPLATE_NAME = "KineticPromo.tsx.template"


ASSET_TEMPLATE = """import {{ AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, Img, Video, staticFile }} from "remotion";

const SPEC = {spec_literal} as const;

const SCENE_FILE: Record<string, string> = {{}};
SPEC.scenes.forEach((s: any, i: number) => {{
  const ext = s.asset_type === "video" ? "mp4" : "png";
  SCENE_FILE[`scene_${{i + 1}}`] = `scene_${{i + 1}}.${{ext}}`;
}});

export const Promo: React.FC = () => {{
  const frame = useCurrentFrame();
  const {{ fps }} = useVideoConfig();
  let cursor = 0;
  return (
    <AbsoluteFill style={{{{ background: SPEC.palette.primary, fontFamily: "Inter, system-ui, sans-serif" }}}}>
      {{SPEC.scenes.map((scene: any, idx: number) => {{
        const from = cursor;
        cursor += scene.duration_f;
        const sceneKey = `scene_${{idx + 1}}`;
        const fileName = SCENE_FILE[sceneKey];
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
                position: "absolute", bottom: 80, left: 80, right: 80,
                color: "#fff", opacity: copyOpacity,
                fontWeight: 800, fontSize: 64, lineHeight: 1.05,
                textShadow: `0 2px 12px ${{SPEC.palette.primary}}`,
              }}}}>
                {{scene.copy.map((line: string, i: number) => (
                  <div key={{i}} style={{{{ marginBottom: 12 }}}}>{{line}}</div>
                ))}}
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      }})}}
    </AbsoluteFill>
  );
}};
"""


ROOT_TSX = """import {{ Composition }} from "remotion";
import {{ Promo }} from "./Promo";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Promo"
    component={{Promo}}
    durationInFrames={{{total_duration_f}}}
    fps={{30}}
    width={{1920}}
    height={{1080}}
  />
);
"""


INDEX_TS = """import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
"""


CONFIG_TS = """import { Config } from "@remotion/cli/config";

Config.setPublicDir("public");
Config.setVideoImageFormat("jpeg");
"""


TSCONFIG_JSON = """{
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


def render_kinetic(spec: dict, template_dir: Path) -> str:
    """Read the kinetic template, inject the spec, alias to `Promo` (so Root.tsx
    can `import { Promo } from "./Promo"` regardless of which mode wrote it)."""
    tpl_path = template_dir / KINETIC_TEMPLATE_NAME
    template = tpl_path.read_text()
    spec_literal = json.dumps(spec, indent=2)
    rendered = template.replace("__SPEC_JSON__", spec_literal)
    # Rename the export so we can add a `Promo` alias at the end.
    rendered = rendered.replace(
        "export const KineticPromo: React.FC = () =>",
        "const KineticPromoImpl: React.FC = () =>",
    )
    rendered += "\nexport const Promo = KineticPromoImpl;\n"
    return rendered


def render_asset(spec: dict) -> str:
    spec_literal = json.dumps(spec, indent=2)
    return ASSET_TEMPLATE.format(spec_literal=spec_literal)


def main():
    args = parse_args()
    spec = json.loads(args.spec_path.read_text())
    project_dir = args.project_dir
    src = project_dir / "src"
    src.mkdir(parents=True, exist_ok=True)

    template_dir = Path(__file__).parent / "templates"

    if args.mode == "kinetic":
        promo_tsx = render_kinetic(spec, template_dir)
    else:
        promo_tsx = render_asset(spec)

    (src / "Promo.tsx").write_text(promo_tsx)
    (src / "Root.tsx").write_text(ROOT_TSX.format(total_duration_f=spec["total_duration_f"]))
    (src / "index.ts").write_text(INDEX_TS)
    (project_dir / "remotion.config.ts").write_text(CONFIG_TS)
    (project_dir / "tsconfig.json").write_text(TSCONFIG_JSON)

    # Copy BGM tracks into Remotion public/audio/
    if args.mode == "kinetic":
        audio_src = template_dir / "audio"
        audio_dst = project_dir / "public" / "audio"
        audio_dst.mkdir(parents=True, exist_ok=True)
        if audio_src.exists():
            for f in audio_src.glob("*.mp3"):
                shutil.copy2(f, audio_dst / f.name)

    print(f"wrote {args.mode} Remotion project under {src}")


if __name__ == "__main__":
    main()
