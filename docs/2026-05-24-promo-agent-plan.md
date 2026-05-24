# Promo Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the autonomous promo-video agent specified in [2026-05-24-promo-agent-design.md](./2026-05-24-promo-agent-design.md). End state: a URL (and optionally a reference video URL) goes in, an animated MP4 in the reference's style comes out, demonstrable to NVIDIA GTC Taipei judges at the booth.

**Architecture:** Vercel Workflow (deterministic pipeline shell) wraps a NemoClaw sandbox (the agentic core, Nemotron 3 Super 120B + Nano Omni) and a Modal worker (Remotion render). Frontend is Next.js 16. Persistence in Neon Postgres + Vercel Blob. See § 3 of the spec for the diagram.

**Tech stack:** Next.js 16 (App Router) + TypeScript + Vercel Workflow DevKit + Vercel Blob + Neon Postgres + NemoClaw v0.0.50 + OpenClaw + Nemotron 3 Super 120B (reasoning) + Nemotron 3 Nano Omni (video analysis) + Modal (Python) + Remotion + Higgsfield API + yt-dlp.

**Notes for the implementer:**
- A *hackathon* plan, not production. Strict TDD for chokepoints (schemas, agent tools, policy enforcement); eyeball-test for visual UI; trust the framework for standard boilerplate.
- The spec at `./2026-05-24-promo-agent-design.md` is the authoritative source. If anything in this plan contradicts the spec, **the spec wins** — flag the conflict.
- 4 days wall-clock from 2026-05-24, ~30-40 working hours. Each phase maps to a day; see "Time budget per phase" below.
- Some early tasks (1.1, 4.3) include a 5-min "read the actual docs" step where the official format isn't pinned by the spec. Do that step — don't guess.
- Frequent commits: every task ends with a commit. If you're tempted to defer the commit, don't.

**Time budget per phase:**
| Phase | Day | Target hours |
|---|---|---|
| 0 — Repo setup | 1 morning | 1 |
| 1 — NemoClaw agent core (5 brand-only tools) | 1 | 4-5 |
| 2 — Workflow shell | 1 evening + 2 morning | 4 |
| 3 — Frontend skeleton | 2 morning | 2 |
| 4 — Real services (Higgsfield + Modal + Remotion render) | 2 afternoon | 5-6 |
| 5 — Reference-video feature (Nano Omni) | 2 evening | 3-4 |
| 6 — Polish + 5 golden runs | 3 | 4 |
| 7 — Deploy + submission | 3 evening + 4 | 3-4 |
| **Total** | | **26-30 hours** |

---

## Repository layout (the end state we're building toward)

```
~/Desktop/Projects/Hackathons/promo-agent/
├── .gitignore
├── package.json                          # npm workspaces root
├── tsconfig.base.json
├── README.md                             # bare-minimum, generated last
│
├── docs/
│   ├── 2026-05-24-promo-agent-design.md   # SPEC (already exists)
│   └── 2026-05-24-promo-agent-plan.md     # THIS FILE
│
├── packages/
│   ├── types/                            # shared TS types
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/index.ts                  # BrandResearch, ReferenceStyle, CompositionSpec, AssetBundle
│   └── schemas/                          # JSON schemas + ajv validators
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── brand-research.schema.json
│       │   ├── reference-style.schema.json
│       │   ├── composition-spec.schema.json
│       │   ├── asset-bundle.schema.json
│       │   └── index.ts                  # exports validators
│       └── test/
│           └── validators.test.ts
│
├── agent/
│   ├── policy.yaml                       # NemoClaw policy file (the bonus deliverable)
│   ├── pattern-library.json              # Apple-style / Kinetic-light / Zelios summaries
│   └── skills/
│       └── promo/
│           ├── package.json
│           ├── index.ts                  # OpenClaw skill registration
│           ├── tools/
│           │   ├── fetch_url.ts
│           │   ├── analyze_reference_video.ts
│           │   ├── pattern_lookup.ts
│           │   ├── script_draft.ts
│           │   ├── asset_brief.ts
│           │   └── self_critique.ts
│           └── test/
│               ├── fetch_url.test.ts
│               └── pattern_lookup.test.ts
│
├── apps/
│   ├── web/                              # Next.js 16 + Vercel Workflow
│   │   ├── package.json
│   │   ├── vercel.ts                     # vercel.ts (not vercel.json)
│   │   ├── tsconfig.json
│   │   ├── next.config.ts
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                  # input form
│   │   │   ├── runs/[id]/page.tsx        # status board
│   │   │   └── api/
│   │   │       ├── runs/route.ts         # POST /api/runs
│   │   │       └── runs/[id]/stream/route.ts  # GET SSE
│   │   ├── src/
│   │   │   ├── workflow/
│   │   │   │   ├── index.ts              # workflow definition
│   │   │   │   ├── intake.ts
│   │   │   │   ├── research.ts
│   │   │   │   ├── reference-analysis.ts
│   │   │   │   ├── composition-plan.ts   # calls NemoClaw
│   │   │   │   ├── asset-gen.ts
│   │   │   │   ├── render.ts             # calls Modal
│   │   │   │   └── deliver.ts
│   │   │   ├── db.ts                     # Neon client + schema
│   │   │   ├── blob.ts                   # Vercel Blob client
│   │   │   ├── higgsfield.ts             # client wrapper
│   │   │   ├── nemoclaw.ts               # HTTP client for local NemoClaw gateway
│   │   │   └── modal.ts                  # client to invoke Modal worker
│   │   └── test/
│   │
│   └── render/                           # Modal Python worker
│       ├── pyproject.toml
│       ├── modal_app.py                  # Modal entrypoint
│       ├── render.py                     # Remotion CLI wrapper
│       ├── templates/
│       │   └── promo.tsx.template        # Remotion template the agent fills in
│       └── tests/
│           └── test_render.py
│
└── scripts/
    ├── smoke.sh                          # pre-demo smoke test
    └── seed-pattern-library.ts           # build pattern-library.json from Dennis's existing projects
```

---

## Phase 0 — Repo setup

### Task 0.1: Initialize monorepo

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.base.json`

- [ ] **Step 1: cd into the project root and init git**

```bash
cd ~/Desktop/Projects/Hackathons/promo-agent
git init
git branch -m main
```

- [ ] **Step 2: Write package.json**

```json
{
  "name": "promo-agent",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "apps/web",
    "agent/skills/*"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Write .gitignore**

```
node_modules/
.next/
.vercel/
.modal/
dist/
*.log
.env
.env.local
out/
.DS_Store

# Generated
agent/pattern-library.json    # built from script, not checked in
```

- [ ] **Step 4: Write tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 5: Install + commit**

```bash
npm install
git add -A
git commit -m "chore: init monorepo with workspaces, base tsconfig, gitignore"
```

Expected: `package-lock.json` created, no errors.

---

### Task 0.2: packages/types — shared TypeScript types

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`

- [ ] **Step 1: Write packages/types/package.json**

```json
{
  "name": "@promo/types",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json"
  }
}
```

- [ ] **Step 2: Write packages/types/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write packages/types/src/index.ts**

Source of truth for cross-package types. The shapes here must match the JSON schemas in `packages/schemas` exactly. (Schemas validate at runtime; types check at compile time. Both come from the spec § 5.)

```typescript
// packages/types/src/index.ts

export type Hex = `#${string}`;

export interface Palette {
  primary: Hex;
  accent: Hex;
  neutral?: Hex;
  neutrals?: Hex[];
}

export interface BrandResearch {
  url: string;
  title: string;
  hero_copy: string;
  palette: Palette;
  fonts: string[];
  stats_found: string[];
  logos: string[];
  internal_pages: Array<{ url: string; text_excerpt: string }>;
}

export interface ReferenceStyle {
  source_url: string;
  duration_analyzed_s: number;
  pacing: {
    avg_scene_duration_s: number;
    scene_count: number;
    rhythm: string;
  };
  visual_style: {
    palette: Palette;
    type_treatment: string;
    composition: string;
  };
  motion_style: {
    transitions: string[];
    camera_movement: string;
  };
  audio_style: {
    music_genre: string;
    music_rhythm: string;
    voiceover: boolean;
  };
  tone: string;
  structural_arc: string[];
}

export type SceneType =
  | "cold_open"
  | "problem"
  | "solution_reveal"
  | "feature_montage"
  | "social_proof"
  | "cta";

export type AssetType = "image" | "video";

export interface Scene {
  act: number;
  duration_f: number;       // frames at 30fps
  type: SceneType;
  copy: string[];
  asset_brief: string;
  asset_type: AssetType;
}

export interface CompositionSpec {
  template: string;          // "apple-style-30s" | "kinetic-light-59s" | "zelios-53s" | "freeform"
  total_duration_f: number;
  palette: Palette;
  scenes: Scene[];
  music_brief: string;
}

export interface AssetBundleEntry {
  url: string;
  type: AssetType;
  duration_s?: number;       // only for videos
  degraded?: boolean;        // true if this is a placeholder fallback
}

export type AssetBundle = Record<string, AssetBundleEntry>;  // keyed by `scene_${n}`

export interface RunFinal {
  videoUrl: string;
  durationSec: number;
}

export type RunStatus = "queued" | "running" | "complete" | "failed" | "partial";
```

- [ ] **Step 4: Build and commit**

```bash
npm run build -w @promo/types
git add packages/types
git commit -m "feat(types): shared TS types for BrandResearch, ReferenceStyle, CompositionSpec, AssetBundle"
```

Expected: `packages/types/dist/index.js` and `.d.ts` produced.

---

### Task 0.3: packages/schemas — JSON schemas + ajv validators (TDD)

**Files:**
- Create: `packages/schemas/package.json`
- Create: `packages/schemas/tsconfig.json`
- Create: `packages/schemas/src/brand-research.schema.json`
- Create: `packages/schemas/src/reference-style.schema.json`
- Create: `packages/schemas/src/composition-spec.schema.json`
- Create: `packages/schemas/src/asset-bundle.schema.json`
- Create: `packages/schemas/src/index.ts`
- Test: `packages/schemas/test/validators.test.ts`

- [ ] **Step 1: Write packages/schemas/package.json**

```json
{
  "name": "@promo/schemas",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "ajv": "^8.17.0",
    "ajv-formats": "^3.0.0"
  },
  "devDependencies": {
    "@promo/types": "0.0.1",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write packages/schemas/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write the failing test FIRST (packages/schemas/test/validators.test.ts)**

```typescript
import { describe, it, expect } from "vitest";
import { validate } from "../src/index.js";

const validBrandResearch = {
  url: "https://buildtrayd.com",
  title: "Trayd",
  hero_copy: "Construction back-office",
  palette: { primary: "#0F1B2D", accent: "#D4FF00" },
  fonts: ["Inter"],
  stats_found: ["27 min"],
  logos: [],
  internal_pages: [],
};

const validReferenceStyle = {
  source_url: "https://youtu.be/abc",
  duration_analyzed_s: 60,
  pacing: { avg_scene_duration_s: 2.4, scene_count: 12, rhythm: "fast" },
  visual_style: {
    palette: { primary: "#000000", accent: "#FFFFFF" },
    type_treatment: "kinetic sans",
    composition: "centered",
  },
  motion_style: { transitions: ["cut"], camera_movement: "static" },
  audio_style: { music_genre: "lo-fi", music_rhythm: "beat-aligned", voiceover: false },
  tone: "energetic",
  structural_arc: ["open", "body", "close"],
};

const validCompositionSpec = {
  template: "apple-style-30s",
  total_duration_f: 900,
  palette: { primary: "#0F1B2D", accent: "#D4FF00" },
  scenes: [
    {
      act: 1, duration_f: 60, type: "problem",
      copy: ["Mess"], asset_brief: "frustrated PM", asset_type: "image",
    },
  ],
  music_brief: "lo-fi",
};

const validAssetBundle = {
  scene_1: { url: "blob:x", type: "image" },
};

describe("validators accept valid payloads", () => {
  it("BrandResearch", () => {
    const r = validate("brand-research", validBrandResearch);
    expect(r.valid).toBe(true);
  });

  it("ReferenceStyle", () => {
    const r = validate("reference-style", validReferenceStyle);
    expect(r.valid).toBe(true);
  });

  it("CompositionSpec", () => {
    const r = validate("composition-spec", validCompositionSpec);
    expect(r.valid).toBe(true);
  });

  it("AssetBundle", () => {
    const r = validate("asset-bundle", validAssetBundle);
    expect(r.valid).toBe(true);
  });
});

describe("validators reject malformed payloads", () => {
  it("BrandResearch missing palette", () => {
    const bad = { ...validBrandResearch };
    delete (bad as any).palette;
    const r = validate("brand-research", bad);
    expect(r.valid).toBe(false);
    expect(r.errors?.[0]?.message).toMatch(/palette/);
  });

  it("CompositionSpec scene with invalid type enum", () => {
    const bad = {
      ...validCompositionSpec,
      scenes: [{ ...validCompositionSpec.scenes[0], type: "garbage_type" }],
    };
    const r = validate("composition-spec", bad);
    expect(r.valid).toBe(false);
  });

  it("Palette hex without #", () => {
    const bad = { ...validBrandResearch, palette: { primary: "0F1B2D", accent: "#D4FF00" } };
    const r = validate("brand-research", bad);
    expect(r.valid).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
npm install -w @promo/schemas
cd packages/schemas
npx vitest run
```

Expected: FAIL with "Cannot find module ../src/index.js" — schemas don't exist yet.

- [ ] **Step 5: Write packages/schemas/src/brand-research.schema.json**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "brand-research",
  "type": "object",
  "required": ["url", "title", "hero_copy", "palette", "fonts", "stats_found", "logos", "internal_pages"],
  "properties": {
    "url": { "type": "string", "format": "uri" },
    "title": { "type": "string" },
    "hero_copy": { "type": "string" },
    "palette": { "$ref": "#/definitions/palette" },
    "fonts": { "type": "array", "items": { "type": "string" } },
    "stats_found": { "type": "array", "items": { "type": "string" } },
    "logos": { "type": "array", "items": { "type": "string" } },
    "internal_pages": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["url", "text_excerpt"],
        "properties": {
          "url": { "type": "string" },
          "text_excerpt": { "type": "string" }
        }
      }
    }
  },
  "definitions": {
    "palette": {
      "type": "object",
      "required": ["primary", "accent"],
      "properties": {
        "primary": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "accent": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "neutral": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "neutrals": { "type": "array", "items": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" } }
      }
    }
  }
}
```

- [ ] **Step 6: Write packages/schemas/src/reference-style.schema.json**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "reference-style",
  "type": "object",
  "required": ["source_url", "duration_analyzed_s", "pacing", "visual_style", "motion_style", "audio_style", "tone", "structural_arc"],
  "properties": {
    "source_url": { "type": "string", "format": "uri" },
    "duration_analyzed_s": { "type": "number", "minimum": 0, "maximum": 600 },
    "pacing": {
      "type": "object",
      "required": ["avg_scene_duration_s", "scene_count", "rhythm"],
      "properties": {
        "avg_scene_duration_s": { "type": "number" },
        "scene_count": { "type": "integer", "minimum": 1 },
        "rhythm": { "type": "string" }
      }
    },
    "visual_style": {
      "type": "object",
      "required": ["palette", "type_treatment", "composition"],
      "properties": {
        "palette": {
          "type": "object",
          "required": ["primary", "accent"],
          "properties": {
            "primary": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
            "accent": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
            "neutrals": { "type": "array", "items": { "type": "string" } }
          }
        },
        "type_treatment": { "type": "string" },
        "composition": { "type": "string" }
      }
    },
    "motion_style": {
      "type": "object",
      "required": ["transitions", "camera_movement"],
      "properties": {
        "transitions": { "type": "array", "items": { "type": "string" } },
        "camera_movement": { "type": "string" }
      }
    },
    "audio_style": {
      "type": "object",
      "required": ["music_genre", "music_rhythm", "voiceover"],
      "properties": {
        "music_genre": { "type": "string" },
        "music_rhythm": { "type": "string" },
        "voiceover": { "type": "boolean" }
      }
    },
    "tone": { "type": "string" },
    "structural_arc": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
  }
}
```

- [ ] **Step 7: Write packages/schemas/src/composition-spec.schema.json**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "composition-spec",
  "type": "object",
  "required": ["template", "total_duration_f", "palette", "scenes", "music_brief"],
  "properties": {
    "template": { "type": "string" },
    "total_duration_f": { "type": "integer", "minimum": 60, "maximum": 3600 },
    "palette": {
      "type": "object",
      "required": ["primary", "accent"],
      "properties": {
        "primary": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "accent": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" }
      }
    },
    "scenes": {
      "type": "array",
      "minItems": 2,
      "maxItems": 10,
      "items": {
        "type": "object",
        "required": ["act", "duration_f", "type", "copy", "asset_brief", "asset_type"],
        "properties": {
          "act": { "type": "integer", "minimum": 1 },
          "duration_f": { "type": "integer", "minimum": 15, "maximum": 600 },
          "type": {
            "type": "string",
            "enum": ["cold_open", "problem", "solution_reveal", "feature_montage", "social_proof", "cta"]
          },
          "copy": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 4 },
          "asset_brief": { "type": "string", "minLength": 5 },
          "asset_type": { "type": "string", "enum": ["image", "video"] }
        }
      }
    },
    "music_brief": { "type": "string" }
  }
}
```

- [ ] **Step 8: Write packages/schemas/src/asset-bundle.schema.json**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "asset-bundle",
  "type": "object",
  "patternProperties": {
    "^scene_[0-9]+$": {
      "type": "object",
      "required": ["url", "type"],
      "properties": {
        "url": { "type": "string" },
        "type": { "type": "string", "enum": ["image", "video"] },
        "duration_s": { "type": "number", "minimum": 0 },
        "degraded": { "type": "boolean" }
      }
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 9: Write packages/schemas/src/index.ts**

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";
import brandResearchSchema from "./brand-research.schema.json" with { type: "json" };
import referenceStyleSchema from "./reference-style.schema.json" with { type: "json" };
import compositionSpecSchema from "./composition-spec.schema.json" with { type: "json" };
import assetBundleSchema from "./asset-bundle.schema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validators = {
  "brand-research": ajv.compile(brandResearchSchema),
  "reference-style": ajv.compile(referenceStyleSchema),
  "composition-spec": ajv.compile(compositionSpecSchema),
  "asset-bundle": ajv.compile(assetBundleSchema),
} as const;

export type SchemaName = keyof typeof validators;

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{ instancePath: string; message: string }>;
}

export function validate(name: SchemaName, data: unknown): ValidationResult {
  const v = validators[name];
  const ok = v(data);
  if (ok) return { valid: true };
  return {
    valid: false,
    errors: (v.errors ?? []).map(e => ({
      instancePath: e.instancePath,
      message: e.message ?? "validation error",
    })),
  };
}

export { brandResearchSchema, referenceStyleSchema, compositionSpecSchema, assetBundleSchema };
```

- [ ] **Step 10: Run tests to verify they pass**

```bash
cd packages/schemas
npx vitest run
```

Expected: all 7 tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): JSON schemas + ajv validators for the 4 contracts with TDD coverage"
```

---

## Phase 1 — NemoClaw agent core (5 brand-only tools first; analyze_reference_video is Phase 5)

### Task 1.1: Scaffold agent/skills/promo + verify OpenClaw skill format

**Files:**
- Create: `agent/skills/promo/package.json`
- Create: `agent/skills/promo/tsconfig.json`
- Create: `agent/skills/promo/index.ts`

- [ ] **Step 1: Verify the OpenClaw skill directory format from real docs**

```bash
nemoclaw promo-agent skill --help
nemoclaw promo-agent skill install --help
```

Read the output. If the help reveals a different expected directory shape than the one below, adjust Steps 2-3 accordingly and update this plan inline (mark with `// PLAN UPDATED`). Do NOT guess.

- [ ] **Step 2: Write agent/skills/promo/package.json**

```json
{
  "name": "@promo/skill",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@promo/types": "0.0.1",
    "@promo/schemas": "0.0.1",
    "node-html-parser": "^6.1.13",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Write agent/skills/promo/tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["index.ts", "tools/**/*"]
}
```

- [ ] **Step 4: Write agent/skills/promo/index.ts (skill entry — registers tools)**

```typescript
// agent/skills/promo/index.ts
// OpenClaw skill that registers our 6 tools. The 6th tool
// (analyze_reference_video) is added in Phase 5; for now we ship 5.

import { fetchUrlTool } from "./tools/fetch_url.js";
import { patternLookupTool } from "./tools/pattern_lookup.js";
import { scriptDraftTool } from "./tools/script_draft.js";
import { assetBriefTool } from "./tools/asset_brief.js";
import { selfCritiqueTool } from "./tools/self_critique.js";

export const skill = {
  name: "promo",
  version: "0.0.1",
  tools: [
    fetchUrlTool,
    patternLookupTool,
    scriptDraftTool,
    assetBriefTool,
    selfCritiqueTool,
  ],
};

export default skill;
```

- [ ] **Step 5: Install + commit (build comes after individual tool tasks)**

```bash
npm install -w @promo/skill
git add agent/skills/promo/
git commit -m "feat(agent): scaffold @promo/skill — OpenClaw skill registration shell"
```

---

### Task 1.2: Build fetch_url tool (TDD)

**Files:**
- Create: `agent/skills/promo/tools/fetch_url.ts`
- Test: `agent/skills/promo/test/fetch_url.test.ts`

This is the most important tool — it replaces Brave Search for our agent. Must handle: standard HTML, redirects, slow sites, palette extraction, internal-link discovery. Strict TDD.

- [ ] **Step 1: Write the failing test**

```typescript
// agent/skills/promo/test/fetch_url.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchUrl } from "../tools/fetch_url.js";

const trayd_html = `
<!doctype html>
<html><head>
  <title>Trayd — Construction back-office</title>
  <meta name="description" content="Run your construction back-office in one place">
  <style>
    :root { --brand-primary: #0F1B2D; --brand-accent: #D4FF00; }
    body { font-family: Inter, sans-serif; background: #FAFAFA; }
  </style>
</head>
<body>
  <h1>Run your construction back-office in one place</h1>
  <p>27 min onboarding • 7 min to first payroll</p>
  <a href="/features">Features</a>
  <a href="/pricing">Pricing</a>
  <a href="https://twitter.com/trayd">Twitter</a>
</body></html>
`;

describe("fetch_url", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("returns parsed text, palette, fonts, and internal links", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => trayd_html,
    });

    const result = await fetchUrl({ url: "https://buildtrayd.com" });

    expect(result.url).toBe("https://buildtrayd.com");
    expect(result.title).toContain("Trayd");
    expect(result.text).toContain("27 min onboarding");
    expect(result.palette.primary).toBe("#0F1B2D");
    expect(result.palette.accent).toBe("#D4FF00");
    expect(result.fonts).toContain("Inter");
    expect(result.internal_links).toEqual(
      expect.arrayContaining(["https://buildtrayd.com/features", "https://buildtrayd.com/pricing"])
    );
    expect(result.internal_links).not.toContain("https://twitter.com/trayd");
  });

  it("throws when site returns 5xx after retries", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 503 });

    await expect(fetchUrl({ url: "https://broken.com" })).rejects.toThrow(/503/);
  });

  it("rejects non-http URLs", async () => {
    await expect(fetchUrl({ url: "file:///etc/passwd" })).rejects.toThrow(/scheme/);
    await expect(fetchUrl({ url: "ftp://x.com" })).rejects.toThrow(/scheme/);
  });

  it("rejects private IP ranges", async () => {
    await expect(fetchUrl({ url: "http://192.168.1.1/" })).rejects.toThrow(/private/);
    await expect(fetchUrl({ url: "http://10.0.0.1/" })).rejects.toThrow(/private/);
    await expect(fetchUrl({ url: "http://169.254.169.254/" })).rejects.toThrow(/private/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd agent/skills/promo
npx vitest run test/fetch_url.test.ts
```

Expected: FAIL with "Cannot find module ../tools/fetch_url.js"

- [ ] **Step 3: Write the implementation**

```typescript
// agent/skills/promo/tools/fetch_url.ts
import { parse } from "node-html-parser";
import { z } from "zod";

const InputSchema = z.object({
  url: z.string().url(),
});

export interface FetchUrlResult {
  url: string;
  title: string;
  description: string;
  text: string;            // up to 4000 chars of cleaned body text
  palette: { primary: `#${string}`; accent: `#${string}`; neutrals: `#${string}`[] };
  fonts: string[];
  internal_links: string[];
}

const HEX = /#[0-9A-Fa-f]{6}\b/g;

// Block private IP ranges and non-http schemes at the tool boundary.
// NemoClaw policy also blocks these at network level — this is defense in depth.
const PRIVATE_HOSTS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^localhost$/,
];

function validateUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`unsupported URL scheme: ${u.protocol}`);
  }
  if (PRIVATE_HOSTS.some(re => re.test(u.hostname))) {
    throw new Error(`private host blocked: ${u.hostname}`);
  }
  return u;
}

async function fetchWithRetry(u: URL, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(u.toString(), {
        redirect: "follow",
        headers: { "user-agent": "PromoAgent/0.1 (+https://github.com/dennis/promo-agent)" },
      });
      if (!res.ok) {
        throw new Error(`fetch failed with ${res.status} for ${u}`);
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(4, i)));
      }
    }
  }
  throw lastErr;
}

function extractPalette(html: string): FetchUrlResult["palette"] {
  const hexes = Array.from(new Set(html.match(HEX) ?? []));
  const primary = (hexes[0] ?? "#000000") as `#${string}`;
  const accent = (hexes[1] ?? "#FFFFFF") as `#${string}`;
  const neutrals = hexes.slice(2, 5) as `#${string}`[];
  return { primary, accent, neutrals };
}

function extractFonts(html: string): string[] {
  const matches = html.match(/font-family:\s*([^;}"]+)/gi) ?? [];
  const families = new Set<string>();
  for (const m of matches) {
    const list = m.replace(/font-family:\s*/i, "").split(",");
    for (const f of list) {
      const cleaned = f.trim().replace(/^["']|["']$/g, "");
      if (cleaned && !/^var\(/.test(cleaned)) families.add(cleaned);
    }
  }
  return Array.from(families).slice(0, 5);
}

function extractInternalLinks(html: string, base: URL): string[] {
  const root = parse(html);
  const out = new Set<string>();
  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    try {
      const target = new URL(href, base);
      if (target.host === base.host && target.protocol.startsWith("http")) {
        out.add(target.toString());
      }
    } catch {
      // ignore unparseable hrefs
    }
  }
  return Array.from(out).slice(0, 10);
}

export async function fetchUrl(input: unknown): Promise<FetchUrlResult> {
  const { url } = InputSchema.parse(input);
  const u = validateUrl(url);
  const html = await fetchWithRetry(u);
  const root = parse(html);
  const title = root.querySelector("title")?.text.trim() ?? "";
  const description =
    root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
  const bodyText = root.querySelector("body")?.text.replace(/\s+/g, " ").trim() ?? "";

  return {
    url: u.toString(),
    title,
    description,
    text: bodyText.slice(0, 4000),
    palette: extractPalette(html),
    fonts: extractFonts(html),
    internal_links: extractInternalLinks(html, u),
  };
}

// OpenClaw tool registration shape.
// VERIFY this shape matches what OpenClaw actually expects (Task 1.1 Step 1).
// If different, adjust here and mark `// PLAN UPDATED`.
export const fetchUrlTool = {
  name: "fetch_url",
  description: "Fetch a public web page and return parsed text, palette, fonts, and internal links.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public HTTPS URL to fetch" },
    },
    required: ["url"],
  },
  handler: fetchUrl,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agent/skills/promo
npx vitest run test/fetch_url.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent/skills/promo/tools/fetch_url.ts agent/skills/promo/test/fetch_url.test.ts
git commit -m "feat(agent): fetch_url tool — parses HTML, extracts palette/fonts/links, blocks private IPs"
```

---

### Task 1.3: Build pattern_lookup tool

**Files:**
- Create: `agent/pattern-library.json` (manually seeded for now)
- Create: `agent/skills/promo/tools/pattern_lookup.ts`
- Test: `agent/skills/promo/test/pattern_lookup.test.ts`

The pattern library is the agent's "design memory" — summaries of the templates Dennis has built before. Static JSON, easy to extend later.

- [ ] **Step 1: Write agent/pattern-library.json**

```json
{
  "patterns": [
    {
      "name": "apple-style-30s",
      "duration_s": 30,
      "best_for": "B2B SaaS with strong UI, dense data products, technical brands",
      "structural_arc": ["cold open (problem)", "solution reveal", "feature montage", "cta"],
      "pacing": "fast cuts, 1-3 second beats per scene, 4-act vignette",
      "visual_signature": "high-contrast palette, large kinetic typography, real UI screens with subtle parallax, Apple-style camera moves",
      "examples": ["Benchling 2026-04-25", "Trayd 2026-04-26"]
    },
    {
      "name": "kinetic-light-59s",
      "duration_s": 59,
      "best_for": "consumer brands, creator tools, hardware where the product needs hero shots",
      "structural_arc": ["title", "establish problem", "feature beats x3-4", "proof", "cta + logo"],
      "pacing": "longer holds (3-6 sec per beat), kinetic-typography transitions, smooth camera arcs",
      "visual_signature": "white background, dark text, single accent color, type-led, photo product hero shots",
      "examples": ["Orinovate Kinetic-Light", "iKala Kolr v1"]
    },
    {
      "name": "zelios-53s",
      "duration_s": 53,
      "best_for": "high-aesthetic / fashion / luxury brands, hardware launches with cinematic feel",
      "structural_arc": ["cold open", "problem framing", "transformation", "product reveal", "feature montage", "cta + logo"],
      "pacing": "varied — slow holds plus burst sequences",
      "visual_signature": "aurora gradients, frosted-glass UI, kinetic typography, deep contrast, music-driven cuts",
      "examples": ["Zelios reference (HeyGen launches)"]
    },
    {
      "name": "freeform",
      "duration_s": 30,
      "best_for": "anything that doesn't fit the above; agent invents structure",
      "structural_arc": ["dynamic — agent picks based on brand + reference"],
      "pacing": "agent decides",
      "visual_signature": "agent decides from brand + optional reference",
      "examples": []
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// agent/skills/promo/test/pattern_lookup.test.ts
import { describe, it, expect } from "vitest";
import { patternLookup } from "../tools/pattern_lookup.js";

describe("pattern_lookup", () => {
  it("returns a known pattern by name", async () => {
    const r = await patternLookup({ name: "apple-style-30s" });
    expect(r.name).toBe("apple-style-30s");
    expect(r.duration_s).toBe(30);
    expect(r.structural_arc).toContain("solution reveal");
  });

  it("returns 'all' as an array listing every pattern when no name given", async () => {
    const r = await patternLookup({});
    expect(Array.isArray(r)).toBe(true);
    const names = (r as any[]).map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(["apple-style-30s", "kinetic-light-59s", "zelios-53s", "freeform"]));
  });

  it("throws on unknown pattern name", async () => {
    await expect(patternLookup({ name: "bogus" })).rejects.toThrow(/unknown pattern/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd agent/skills/promo
npx vitest run test/pattern_lookup.test.ts
```

Expected: FAIL — pattern_lookup not defined.

- [ ] **Step 4: Write the implementation**

```typescript
// agent/skills/promo/tools/pattern_lookup.ts
import { z } from "zod";
import library from "../../../pattern-library.json" with { type: "json" };

export interface Pattern {
  name: string;
  duration_s: number;
  best_for: string;
  structural_arc: string[];
  pacing: string;
  visual_signature: string;
  examples: string[];
}

const InputSchema = z.object({
  name: z.string().optional(),
});

export async function patternLookup(input: unknown): Promise<Pattern | Pattern[]> {
  const { name } = InputSchema.parse(input);
  const patterns = library.patterns as Pattern[];

  if (!name) {
    return patterns;
  }
  const match = patterns.find(p => p.name === name);
  if (!match) {
    throw new Error(`unknown pattern: ${name}. Available: ${patterns.map(p => p.name).join(", ")}`);
  }
  return match;
}

export const patternLookupTool = {
  name: "pattern_lookup",
  description: "Look up a video composition pattern by name, or list all patterns if no name given. Use when deciding the structural shape of a video.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Pattern name (e.g. 'apple-style-30s', 'kinetic-light-59s'). Omit to list all patterns.",
      },
    },
  },
  handler: patternLookup,
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd agent/skills/promo
npx vitest run test/pattern_lookup.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add agent/pattern-library.json agent/skills/promo/tools/pattern_lookup.ts agent/skills/promo/test/pattern_lookup.test.ts
git commit -m "feat(agent): pattern_lookup tool + seed pattern library with Apple-style/Kinetic-light/Zelios/freeform"
```

---

### Task 1.4: Build script_draft tool (Nemotron-only, no external)

**Files:**
- Create: `agent/skills/promo/tools/script_draft.ts`

This is a *thin wrapper* — Nemotron does all the work. The tool's job is to format a clean prompt and return the model's text. OpenClaw routes the LLM call via NemoClaw, so we don't manage Nemotron credentials here.

- [ ] **Step 1: Write the implementation**

```typescript
// agent/skills/promo/tools/script_draft.ts
import { z } from "zod";

const InputSchema = z.object({
  brand_title: z.string(),
  brand_one_liner: z.string(),
  scene_type: z.enum([
    "cold_open", "problem", "solution_reveal", "feature_montage", "social_proof", "cta",
  ]),
  tone: z.string().default("confident, technical"),
  reference_tone: z.string().optional(),  // from ReferenceStyle if present
  max_lines: z.number().int().min(1).max(4).default(2),
});

export async function scriptDraft(input: unknown) {
  const args = InputSchema.parse(input);

  const referenceLine = args.reference_tone
    ? `Match the tone of the reference video: "${args.reference_tone}".\n`
    : "";

  const prompt = `Write the on-screen copy for a single scene in a 30-second promo video.

Brand: ${args.brand_title}
What they do: ${args.brand_one_liner}
Scene type: ${args.scene_type}
Tone: ${args.tone}
${referenceLine}

Requirements:
- Exactly ${args.max_lines} short lines (under 8 words each).
- No emojis. No quotation marks. No marketing fluff like "revolutionary" or "game-changing".
- Lines should read as kinetic typography on screen, not as voiceover.
- If scene_type is "${args.scene_type}", the lines should land that specific beat.

Return ONLY the lines, one per line, no numbering, no preamble.`;

  // NemoClaw's OpenClaw runtime exposes the Nemotron call via the agent runtime.
  // The tool returns the prompt + a marker — the actual LLM call is performed
  // by the orchestrator when it sees `kind: "llm_call"`.
  return {
    kind: "llm_call" as const,
    model: "nvidia/nemotron-3-super-120b-a12b",
    prompt,
    parse: "lines" as const,    // hint to orchestrator to split response by \n
    max_tokens: 200,
  };
}

export const scriptDraftTool = {
  name: "script_draft",
  description: "Draft the on-screen copy for one scene. Returns a prompt the runtime will send to Nemotron; result is N short lines.",
  parameters: {
    type: "object",
    required: ["brand_title", "brand_one_liner", "scene_type"],
    properties: {
      brand_title: { type: "string" },
      brand_one_liner: { type: "string" },
      scene_type: {
        type: "string",
        enum: ["cold_open", "problem", "solution_reveal", "feature_montage", "social_proof", "cta"],
      },
      tone: { type: "string", default: "confident, technical" },
      reference_tone: { type: "string", description: "Optional: tone from ReferenceStyle." },
      max_lines: { type: "integer", minimum: 1, maximum: 4, default: 2 },
    },
  },
  handler: scriptDraft,
};
```

- [ ] **Step 2: Commit (no test — thin wrapper, validated in smoke test at Task 1.10)**

```bash
git add agent/skills/promo/tools/script_draft.ts
git commit -m "feat(agent): script_draft tool — prompt template for Nemotron, returns llm_call envelope"
```

---

### Task 1.5: Build asset_brief tool

**Files:**
- Create: `agent/skills/promo/tools/asset_brief.ts`

Pure transform: takes a scene + brand context, emits a Higgsfield prompt string. No LLM call here — keep it deterministic so the agent can predict its cost.

- [ ] **Step 1: Write the implementation**

```typescript
// agent/skills/promo/tools/asset_brief.ts
import { z } from "zod";

const InputSchema = z.object({
  scene_type: z.enum([
    "cold_open", "problem", "solution_reveal", "feature_montage", "social_proof", "cta",
  ]),
  asset_type: z.enum(["image", "video"]),
  brand_title: z.string(),
  brand_palette_primary: z.string(),
  brand_palette_accent: z.string(),
  brand_industry_keywords: z.array(z.string()).max(5).default([]),
  reference_visual_signature: z.string().optional(),
});

const TEMPLATES: Record<string, (a: any) => string> = {
  cold_open: (a) =>
    `Cinematic opening shot establishing the world of ${a.brand_title}. ${a.brand_industry_keywords.join(", ")}. Mood: anticipation. Palette: ${a.brand_palette_primary} dominant with ${a.brand_palette_accent} accents.`,
  problem: (a) =>
    `Frustration tableau: a professional in ${a.brand_industry_keywords[0] ?? "an office"} setting struggling with manual/disorganized workflows. Documentary photo realism. Muted version of palette: ${a.brand_palette_primary}.`,
  solution_reveal: (a) =>
    `Hero shot of clean SaaS product surface for ${a.brand_title}. ${a.brand_palette_primary} primary, ${a.brand_palette_accent} CTA accent. Glassmorphism, soft shadows, slight tilt-perspective. Apple-style product photography.`,
  feature_montage: (a) =>
    `Quick-cut close-up: hands using ${a.brand_title} on a laptop or phone. Lighting: clean studio. Color grade matches palette: ${a.brand_palette_primary} / ${a.brand_palette_accent}.`,
  social_proof: (a) =>
    `Composite of customer logos and brief on-camera testimonial-style framing, abstract not literal. Background: ${a.brand_palette_primary}.`,
  cta: (a) =>
    `Wordmark reveal for ${a.brand_title} on solid ${a.brand_palette_primary} background, ${a.brand_palette_accent} accent line beneath. Premium, restrained.`,
};

export async function assetBrief(input: unknown) {
  const args = InputSchema.parse(input);
  const base = TEMPLATES[args.scene_type](args);
  const styleSuffix = args.reference_visual_signature
    ? ` Visual style notes from reference: ${args.reference_visual_signature}.`
    : "";
  const typeSuffix = args.asset_type === "video"
    ? " 5-second clip, subtle motion, no hard cuts."
    : " Single still, 1920x1080, photo realism unless brand palette demands illustration.";
  return {
    prompt: (base + styleSuffix + typeSuffix).slice(0, 1000),
  };
}

export const assetBriefTool = {
  name: "asset_brief",
  description: "Compose a Higgsfield prompt string for one scene. Deterministic template, no LLM call. Use this once per scene; the workflow (not the agent) will actually call Higgsfield with the resulting prompt.",
  parameters: {
    type: "object",
    required: ["scene_type", "asset_type", "brand_title", "brand_palette_primary", "brand_palette_accent"],
    properties: {
      scene_type: {
        type: "string",
        enum: ["cold_open", "problem", "solution_reveal", "feature_montage", "social_proof", "cta"],
      },
      asset_type: { type: "string", enum: ["image", "video"] },
      brand_title: { type: "string" },
      brand_palette_primary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand_palette_accent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand_industry_keywords: { type: "array", items: { type: "string" }, maxItems: 5 },
      reference_visual_signature: { type: "string" },
    },
  },
  handler: assetBrief,
};
```

- [ ] **Step 2: Commit**

```bash
git add agent/skills/promo/tools/asset_brief.ts
git commit -m "feat(agent): asset_brief tool — deterministic Higgsfield prompt templates per scene type"
```

---

### Task 1.6: Build self_critique tool

**Files:**
- Create: `agent/skills/promo/tools/self_critique.ts`

Agent inspects its own draft CompositionSpec against a rubric. Returns a score + suggestions. Bounded by policy to max 3 critique rounds per task.

- [ ] **Step 1: Write the implementation**

```typescript
// agent/skills/promo/tools/self_critique.ts
import { z } from "zod";

const InputSchema = z.object({
  spec_json: z.string(),   // stringified CompositionSpec
  round: z.number().int().min(1).max(3),
});

const RUBRIC = `
1. Brand fit (1-5): Does the palette, typography, and tone match the brand?
2. Narrative arc (1-5): Is there a clear problem → solution → proof → CTA flow?
3. Scene variety (1-5): Are scene types varied enough to feel dynamic, not repetitive?
4. Pacing (1-5): Are scene durations reasonable for the template? Not too slow, not too rapid?
5. Copy quality (1-5): Are on-screen lines tight, kinetic-typography-friendly, free of marketing fluff?
6. Asset briefs (1-5): Are Higgsfield prompts specific enough to produce on-brand visuals?

Total possible: 30. Ship threshold: 22+.
`;

export async function selfCritique(input: unknown) {
  const args = InputSchema.parse(input);

  const prompt = `You are critiquing a draft CompositionSpec for a promo video. Rate it strictly against this rubric:

${RUBRIC}

This is critique round ${args.round} of max 3. After 3 rounds you must ship.

Draft to critique:
${args.spec_json}

Return ONLY valid JSON in this exact shape:
{
  "scores": { "brand_fit": N, "narrative_arc": N, "scene_variety": N, "pacing": N, "copy_quality": N, "asset_briefs": N },
  "total": N,
  "ship": <boolean — true if total >= 22 OR round === 3>,
  "top_issues": ["one-line issue", "another"],
  "suggested_changes": ["specific actionable change", "another"]
}`;

  return {
    kind: "llm_call" as const,
    model: "nvidia/nemotron-3-super-120b-a12b",
    prompt,
    parse: "json" as const,
    max_tokens: 600,
  };
}

export const selfCritiqueTool = {
  name: "self_critique",
  description: "Rate the current draft CompositionSpec against a 6-criterion rubric. Returns scores + suggestions + a 'ship' flag. Max 3 rounds enforced by policy.",
  parameters: {
    type: "object",
    required: ["spec_json", "round"],
    properties: {
      spec_json: { type: "string", description: "Stringified CompositionSpec JSON" },
      round: { type: "integer", minimum: 1, maximum: 3 },
    },
  },
  handler: selfCritique,
};
```

- [ ] **Step 2: Commit**

```bash
git add agent/skills/promo/tools/self_critique.ts
git commit -m "feat(agent): self_critique tool — 6-criterion rubric, returns scores + ship flag"
```

---

### Task 1.7: Write NemoClaw policy.yaml

**Files:**
- Create: `agent/policy.yaml`

This file is the literal artifact that earns the hackathon bonus. Copy structure from spec § 9.

- [ ] **Step 1: Write agent/policy.yaml**

```yaml
# agent/policy.yaml
# Applied via:
#   nemoclaw promo-agent policy-add --from-file ./agent/policy.yaml
#
# This file is the hackathon's "policy-based guardrails" bonus deliverable.

version: 1
sandbox: promo-agent

caps:
  max_llm_calls_per_task: 25
  max_web_fetches_per_task: 10
  max_critique_rounds_per_task: 3
  max_asset_briefs_per_task: 5
  max_nano_omni_calls_per_task: 1
  max_higgsfield_spend_usd_per_task: 5
  max_task_wall_clock_minutes: 12

tools_whitelist:
  - fetch_url
  - analyze_reference_video    # added in Phase 5; harmless to whitelist now
  - pattern_lookup
  - script_draft
  - asset_brief
  - self_critique

tools_blacklist:
  - subprocess
  - filesystem_outside_sandbox
  - email
  - direct_higgsfield_call

network:
  outbound_default: allow_https_with_logging
  outbound_blacklist:
    - 169.254.169.254
    - 10.0.0.0/8
    - 192.168.0.0/16
    - file://
  always_allow:
    - integrate.api.nvidia.com
    - api.telegram.org
    - "*.youtube.com"
    - "*.googlevideo.com"
    - "*.vimeo.com"
    - "*.vimeocdn.com"

privacy:
  no_pii_in_generated_copy: true
  brand_claim_grounding_required: true
```

- [ ] **Step 2: Commit**

```bash
git add agent/policy.yaml
git commit -m "feat(agent): NemoClaw policy.yaml — caps, tool whitelist, network rules (the bonus deliverable)"
```

---

### Task 1.8: Install skills + policy to local NemoClaw + smoke test

**Files:**
- None new

- [ ] **Step 1: Build the skill workspace**

```bash
cd ~/Desktop/Projects/Hackathons/promo-agent
npm run build -w @promo/skill
```

Expected: `agent/skills/promo/dist/` exists with compiled JS.

- [ ] **Step 2: Install the skill into the running NemoClaw sandbox**

```bash
nemoclaw promo-agent skill install ./agent/skills/promo
```

Expected: confirmation message ("skill 'promo' installed v0.0.1"). If syntax differs from this — read `nemoclaw promo-agent skill install --help` and adjust.

- [ ] **Step 3: Apply the policy file**

```bash
nemoclaw promo-agent policy-add --from-file ./agent/policy.yaml
```

Expected: confirmation. Verify with `nemoclaw promo-agent policy-list`.

- [ ] **Step 4: Smoke test via the dashboard or terminal**

Open the dashboard: `nemoclaw promo-agent dashboard-url --quiet | xargs open -a Safari`

In the chat, type:

```
Use pattern_lookup with no args. Then tell me how many patterns are available and what their names are.
```

Expected: agent calls `pattern_lookup`, lists 4 pattern names (apple-style-30s, kinetic-light-59s, zelios-53s, freeform).

- [ ] **Step 5: Smoke test with a real fetch_url call**

In the chat:

```
Use fetch_url on https://buildtrayd.com. Then tell me the brand's primary color and 3 internal links you found.
```

Expected: agent calls `fetch_url`, returns navy primary color + 3 internal links.

- [ ] **Step 6: Commit**

Nothing changes in the repo for this task (it's a runtime install), but tag the verification:

```bash
git tag -a phase-1-agent-installed -m "agent skills + policy installed into local NemoClaw, smoke tests passing"
```

---

## Phase 2 — Workflow shell (Vercel Workflow + storage)

### Task 2.1: Scaffold apps/web — Next.js 16 + Vercel Workflow

**Files:**
- Create: `apps/web/` via `create-next-app`
- Modify: `apps/web/package.json` (add workspace deps)
- Create: `apps/web/vercel.ts`

- [ ] **Step 1: Run create-next-app in the workspace**

```bash
cd ~/Desktop/Projects/Hackathons/promo-agent
npx create-next-app@latest apps/web \
  --typescript --app --src-dir --tailwind --eslint --no-import-alias --use-npm
```

When prompted about Turbopack: yes.

- [ ] **Step 2: Add Vercel Workflow + workspace deps to apps/web/package.json**

Open `apps/web/package.json` and add to dependencies:

```json
{
  "dependencies": {
    "@promo/types": "0.0.1",
    "@promo/schemas": "0.0.1",
    "@vercel/workflow": "latest",
    "@vercel/blob": "latest",
    "@vercel/config": "latest",
    "@neondatabase/serverless": "latest",
    "drizzle-orm": "latest"
  }
}
```

Then:

```bash
npm install
```

- [ ] **Step 3: Create vercel.ts (replaces vercel.json per current Vercel guidance)**

```typescript
// apps/web/vercel.ts
import { type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  buildCommand: 'npm run build',
};
```

- [ ] **Step 4: Smoke test the dev server**

```bash
cd apps/web
npm run dev
```

Open http://localhost:3000 in Safari (per user preference: localhost in Safari, not Chrome). Confirm default Next.js page loads.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "chore(web): scaffold Next.js 16 app with App Router, Tailwind, Vercel Workflow deps"
```

---

### Task 2.2: Set up Neon Postgres + schema

**Files:**
- Create: `apps/web/src/db.ts`
- Modify: `apps/web/.env.local` (NOT committed)

- [ ] **Step 1: Provision Neon via Vercel Marketplace**

```bash
cd apps/web
npx vercel link    # link to your Vercel account if not already
npx vercel integration add neon
```

Follow prompts. This creates a Neon Postgres database and adds `DATABASE_URL` to your project's env. Pull env to local:

```bash
npx vercel env pull .env.local
```

Expected: `.env.local` contains `DATABASE_URL=postgres://...`.

- [ ] **Step 2: Write apps/web/src/db.ts (schema + client)**

```typescript
// apps/web/src/db.ts
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export interface RunRow {
  id: string;                    // uuid
  url: string;
  reference_url: string | null;
  status: "queued" | "running" | "complete" | "failed" | "partial";
  video_url: string | null;
  duration_sec: number | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EventRow {
  id: number;
  run_id: string;
  type: string;
  payload: unknown;
  created_at: Date;
}

export interface AssetCacheRow {
  prompt_hash: string;           // sha256 of the Higgsfield prompt
  url: string;                   // blob URL
  type: "image" | "video";
  created_at: Date;
}

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      url TEXT NOT NULL,
      reference_url TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      video_url TEXT,
      duration_sec INTEGER,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS events_run_id_idx ON events(run_id, id);`;
  await sql`
    CREATE TABLE IF NOT EXISTS asset_cache (
      prompt_hash TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

export async function createRun(url: string, referenceUrl: string | null): Promise<string> {
  const [row] = await sql`
    INSERT INTO runs (url, reference_url) VALUES (${url}, ${referenceUrl}) RETURNING id;
  `;
  return row.id as string;
}

export async function updateRun(id: string, fields: Partial<RunRow>) {
  // Drizzle would be cleaner — for hackathon, hand-rolled is fine.
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    updates.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (updates.length === 0) return;
  const query = `UPDATE runs SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${i}`;
  await (sql as any).query(query, [...values, id]);
}

export async function appendEvent(runId: string, type: string, payload: unknown) {
  await sql`INSERT INTO events (run_id, type, payload) VALUES (${runId}, ${type}, ${JSON.stringify(payload)});`;
}

export async function getEventsAfter(runId: string, afterId: number) {
  const rows = await sql`SELECT id, type, payload, created_at FROM events WHERE run_id = ${runId} AND id > ${afterId} ORDER BY id ASC;`;
  return rows as EventRow[];
}

export async function getCachedAsset(promptHash: string) {
  const rows = await sql`SELECT * FROM asset_cache WHERE prompt_hash = ${promptHash};`;
  return rows[0] as AssetCacheRow | undefined;
}

export async function putCachedAsset(promptHash: string, url: string, type: "image" | "video") {
  await sql`INSERT INTO asset_cache (prompt_hash, url, type) VALUES (${promptHash}, ${url}, ${type}) ON CONFLICT (prompt_hash) DO NOTHING;`;
}
```

- [ ] **Step 3: Run migration once**

Create `apps/web/scripts/migrate.ts`:

```typescript
// apps/web/scripts/migrate.ts
import { migrate } from "../src/db.js";
await migrate();
console.log("migration complete");
```

Run it:

```bash
cd apps/web
node --import tsx scripts/migrate.ts
```

Expected: prints "migration complete". If `tsx` not installed: `npm i -D tsx`.

Verify via Neon dashboard or `psql` that `runs`, `events`, `asset_cache` tables exist.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/db.ts apps/web/scripts/migrate.ts
git commit -m "feat(web): Neon Postgres schema (runs, events, asset_cache) + client helpers"
```

---

### Task 2.3: Set up Vercel Blob

**Files:**
- Create: `apps/web/src/blob.ts`

- [ ] **Step 1: Provision Blob via Vercel CLI**

```bash
cd apps/web
npx vercel blob create promo-agent-blob
npx vercel env pull .env.local   # refresh env so BLOB_READ_WRITE_TOKEN appears
```

- [ ] **Step 2: Write apps/web/src/blob.ts**

```typescript
// apps/web/src/blob.ts
import { put } from "@vercel/blob";

export async function uploadBuffer(
  key: string,
  data: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const blob = await put(key, data, {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });
  return blob.url;
}

export async function uploadFromUrl(key: string, sourceUrl: string, contentType: string): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`fetch source for blob failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return uploadBuffer(key, buf, contentType);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/blob.ts
git commit -m "feat(web): Vercel Blob upload helpers"
```

---

### Task 2.4: Workflow definition + intake step

**Files:**
- Create: `apps/web/src/workflow/index.ts`
- Create: `apps/web/src/workflow/intake.ts`

- [ ] **Step 1: Write apps/web/src/workflow/index.ts**

```typescript
// apps/web/src/workflow/index.ts
// Verify the @vercel/workflow API shape at https://vercel.com/docs/workflows
// before fleshing this out — the createWorkflow signature has evolved.
import { createWorkflow, step } from "@vercel/workflow";
import { intake } from "./intake.js";
import { research } from "./research.js";
import { referenceAnalysis } from "./reference-analysis.js";
import { compositionPlan } from "./composition-plan.js";
import { assetGen } from "./asset-gen.js";
import { render as renderStep } from "./render.js";
import { deliver } from "./deliver.js";

export interface RunInput {
  runId: string;
  url: string;
  referenceUrl: string | null;
}

export const promoWorkflow = createWorkflow<RunInput>("promo-agent", async (ctx, input) => {
  await step(ctx, "intake", () => intake(input));
  const brand = await step(ctx, "research", () => research(input));
  const reference = input.referenceUrl
    ? await step(ctx, "reference_analysis", () => referenceAnalysis(input, brand))
    : null;
  const spec = await step(ctx, "composition_plan", () => compositionPlan(input, brand, reference));
  const assets = await step(ctx, "asset_gen", () => assetGen(input, spec));
  const mp4 = await step(ctx, "render", () => renderStep(input, spec, assets));
  await step(ctx, "deliver", () => deliver(input, mp4));
});
```

- [ ] **Step 2: Write apps/web/src/workflow/intake.ts**

```typescript
// apps/web/src/workflow/intake.ts
import { updateRun, appendEvent } from "../db.js";
import type { RunInput } from "./index.js";

export async function intake(input: RunInput): Promise<void> {
  // Validate URL one more time at workflow boundary
  try {
    const u = new URL(input.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("non-http URL");
    }
  } catch {
    await updateRun(input.runId, { status: "failed", error: "invalid URL" });
    throw new Error("invalid URL");
  }

  await updateRun(input.runId, { status: "running" });
  await appendEvent(input.runId, "intake_done", { url: input.url, referenceUrl: input.referenceUrl });
}
```

- [ ] **Step 3: Commit (other steps coming in tasks 2.5-2.10)**

```bash
git add apps/web/src/workflow/index.ts apps/web/src/workflow/intake.ts
git commit -m "feat(workflow): definition skeleton + intake step (validation + status transition)"
```

---

### Task 2.5: research workflow step

**Files:**
- Create: `apps/web/src/workflow/research.ts`

- [ ] **Step 1: Write apps/web/src/workflow/research.ts**

```typescript
// apps/web/src/workflow/research.ts
// Uses the SAME parsing logic as the fetch_url tool. We deliberately duplicate
// here rather than import the agent package into the server, to keep the
// workflow shell free of any agent-runtime dependency.

import { parse } from "node-html-parser";
import type { BrandResearch, Palette } from "@promo/types";
import { appendEvent } from "../db.js";
import type { RunInput } from "./index.js";

const HEX = /#[0-9A-Fa-f]{6}\b/g;

export async function research(input: RunInput): Promise<BrandResearch> {
  const res = await fetch(input.url, {
    headers: { "user-agent": "PromoAgent/0.1" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`research fetch failed: ${res.status}`);
  const html = await res.text();
  const root = parse(html);

  const title = root.querySelector("title")?.text.trim() ?? "";
  const description = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
  const bodyText = root.querySelector("body")?.text.replace(/\s+/g, " ").trim() ?? "";

  const hexes = Array.from(new Set(html.match(HEX) ?? []));
  const palette: Palette = {
    primary: (hexes[0] ?? "#000000") as `#${string}`,
    accent: (hexes[1] ?? "#FFFFFF") as `#${string}`,
    neutrals: hexes.slice(2, 5) as `#${string}`[],
  };

  // Fonts via @font-family extraction
  const fontMatches = html.match(/font-family:\s*([^;}"]+)/gi) ?? [];
  const fonts = Array.from(new Set(fontMatches.flatMap(m =>
    m.replace(/font-family:\s*/i, "").split(",")
      .map(f => f.trim().replace(/^["']|["']$/g, ""))
      .filter(f => f && !/^var\(/.test(f))
  ))).slice(0, 5);

  // Stats — look for numbers followed by units (min, sec, %, etc.)
  const stats = Array.from(bodyText.matchAll(/\b\d+(?:m \d+s|\s*(?:min|sec|s|%|x))\b/gi))
    .map(m => m[0])
    .slice(0, 10);

  // Customer logo URLs — naive: img tags in elements containing "customer"
  const logos: string[] = [];
  for (const el of root.querySelectorAll('[class*="customer" i] img, [id*="customer" i] img')) {
    const src = el.getAttribute("src");
    if (src) {
      try {
        logos.push(new URL(src, input.url).toString());
      } catch { /* ignore */ }
    }
  }

  // Internal pages: follow up to 3 internal links
  const base = new URL(input.url);
  const internal = new Set<string>();
  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    try {
      const target = new URL(href, base);
      if (target.host === base.host) internal.add(target.toString());
    } catch { /* ignore */ }
  }
  const internalLinks = Array.from(internal).slice(0, 3);

  const internal_pages = await Promise.all(internalLinks.map(async u => {
    try {
      const r = await fetch(u, { headers: { "user-agent": "PromoAgent/0.1" } });
      if (!r.ok) return { url: u, text_excerpt: "" };
      const h = await r.text();
      const t = parse(h).querySelector("body")?.text.replace(/\s+/g, " ").trim() ?? "";
      return { url: u, text_excerpt: t.slice(0, 1200) };
    } catch {
      return { url: u, text_excerpt: "" };
    }
  }));

  const out: BrandResearch = {
    url: input.url,
    title,
    hero_copy: description || bodyText.slice(0, 200),
    palette,
    fonts,
    stats_found: stats,
    logos,
    internal_pages,
  };

  await appendEvent(input.runId, "research_done", { titleLen: title.length, paletteFound: hexes.length });
  return out;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/workflow/research.ts
git commit -m "feat(workflow): research step — crawls input URL + extracts brand tokens"
```

---

### Task 2.6: composition_plan workflow step (calls NemoClaw)

**Files:**
- Create: `apps/web/src/nemoclaw.ts`
- Create: `apps/web/src/workflow/composition-plan.ts`

- [ ] **Step 1: Write apps/web/src/nemoclaw.ts (HTTP client for local NemoClaw gateway)**

```typescript
// apps/web/src/nemoclaw.ts
// Talks to the local NemoClaw OpenClaw gateway on 127.0.0.1:18789.
// In production deployment we'd swap this for the cloudflared tunnel URL.

const NEMOCLAW_BASE_URL = process.env.NEMOCLAW_URL ?? "http://127.0.0.1:18789";
const NEMOCLAW_TOKEN = process.env.NEMOCLAW_TOKEN!;  // set via `nemoclaw promo-agent gateway-token`

interface RunAgentInput {
  message: string;
  session_id: string;
  context_json?: unknown;        // BrandResearch + optional ReferenceStyle
  stream?: (event: { type: string; payload: unknown }) => void;
}

export async function runAgent(input: RunAgentInput): Promise<{ output: string; events: unknown[] }> {
  const res = await fetch(`${NEMOCLAW_BASE_URL}/api/agent/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${NEMOCLAW_TOKEN}`,
    },
    body: JSON.stringify({
      agent: "main",
      session_id: input.session_id,
      message: input.message,
      context: input.context_json,
      stream: !!input.stream,
    }),
  });
  if (!res.ok) {
    throw new Error(`nemoclaw run failed: ${res.status} ${await res.text()}`);
  }

  // If streaming, consume SSE; otherwise just parse the JSON body.
  // For hackathon Day 1, start with non-streaming and add streaming in Phase 3.
  const body = await res.json();
  return { output: body.output as string, events: body.events ?? [] };
}
```

- [ ] **Step 2: Write apps/web/src/workflow/composition-plan.ts**

```typescript
// apps/web/src/workflow/composition-plan.ts
import type { BrandResearch, ReferenceStyle, CompositionSpec } from "@promo/types";
import { validate } from "@promo/schemas";
import { runAgent } from "../nemoclaw.js";
import { appendEvent } from "../db.js";
import type { RunInput } from "./index.js";

const SYSTEM_PROMPT = `You are a video composition planner. You have these tools available:
- fetch_url(url): get deeper info from a URL
- pattern_lookup(name?): look up a video template
- script_draft(...): get copy for a scene (returns an llm_call envelope you'll execute)
- asset_brief(...): generate Higgsfield prompts (deterministic)
- self_critique(spec_json, round): rate your draft

Your job: given a BrandResearch (and optionally a ReferenceStyle), produce a complete CompositionSpec JSON.

Constraints:
- Maximum 5 scenes per video
- Pick a template via pattern_lookup based on the brand. If a ReferenceStyle is provided, prefer "freeform" and match its pacing/palette/structural_arc.
- self_critique your draft once; if score < 22 and rounds remaining, revise once more
- Output ONLY the final CompositionSpec as a JSON code block, no other prose`;

export async function compositionPlan(
  input: RunInput,
  brand: BrandResearch,
  reference: ReferenceStyle | null,
): Promise<CompositionSpec> {
  const userMessage = `BrandResearch:\n${JSON.stringify(brand, null, 2)}\n\n${
    reference ? `ReferenceStyle:\n${JSON.stringify(reference, null, 2)}\n\n` : ""
  }Produce a CompositionSpec for this brand.`;

  const { output } = await runAgent({
    message: SYSTEM_PROMPT + "\n\n" + userMessage,
    session_id: input.runId,
  });

  // Extract the JSON code block from the agent's output
  const match = output.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (!match) throw new Error("agent output had no JSON block");

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (e) {
    throw new Error(`agent JSON parse failed: ${(e as Error).message}`);
  }

  const validation = validate("composition-spec", parsed);
  if (!validation.valid) {
    throw new Error(
      `agent CompositionSpec failed schema: ${JSON.stringify(validation.errors)}`,
    );
  }

  await appendEvent(input.runId, "composition_done", { template: (parsed as CompositionSpec).template });
  return parsed as CompositionSpec;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/nemoclaw.ts apps/web/src/workflow/composition-plan.ts
git commit -m "feat(workflow): composition_plan step + NemoClaw HTTP client"
```

---

### Task 2.7: asset_gen workflow step (mock Higgsfield first)

**Files:**
- Create: `apps/web/src/workflow/asset-gen.ts`
- Create: `apps/web/src/higgsfield.ts` (stub now, real in Task 4.1)

- [ ] **Step 1: Write apps/web/src/higgsfield.ts (stub)**

```typescript
// apps/web/src/higgsfield.ts
// STUB for Phase 2. Replaced with real impl in Task 4.1.

export interface GenerateInput {
  prompt: string;
  type: "image" | "video";
  // Real impl will include: model, ref_image, seed, aspect_ratio, etc.
}

export async function generate(input: GenerateInput): Promise<{ url: string; durationS?: number }> {
  // Placeholder: a 1x1 navy PNG hosted on placeholder service
  // and a 5-second sample video URL.
  if (input.type === "image") {
    return { url: "https://placehold.co/1920x1080/0F1B2D/D4FF00.png?text=PROMO+STUB" };
  }
  return {
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    durationS: 5,
  };
}
```

- [ ] **Step 2: Write apps/web/src/workflow/asset-gen.ts**

```typescript
// apps/web/src/workflow/asset-gen.ts
import { createHash } from "node:crypto";
import type { CompositionSpec, AssetBundle } from "@promo/types";
import { generate } from "../higgsfield.js";
import { getCachedAsset, putCachedAsset, appendEvent } from "../db.js";
import { uploadFromUrl } from "../blob.js";
import type { RunInput } from "./index.js";

function promptHash(prompt: string, type: string): string {
  return createHash("sha256").update(`${type}:${prompt}`).digest("hex");
}

export async function assetGen(input: RunInput, spec: CompositionSpec): Promise<AssetBundle> {
  const out: AssetBundle = {};

  const tasks = spec.scenes.map(async (scene, idx) => {
    const key = `scene_${idx + 1}`;
    const hash = promptHash(scene.asset_brief, scene.asset_type);

    // Cache lookup
    const cached = await getCachedAsset(hash);
    if (cached) {
      out[key] = { url: cached.url, type: cached.type };
      return;
    }

    try {
      const result = await generate({ prompt: scene.asset_brief, type: scene.asset_type });
      // Re-host on Vercel Blob for stable URLs
      const ext = scene.asset_type === "image" ? "png" : "mp4";
      const blobUrl = await uploadFromUrl(
        `runs/${input.runId}/${key}.${ext}`,
        result.url,
        scene.asset_type === "image" ? "image/png" : "video/mp4",
      );
      await putCachedAsset(hash, blobUrl, scene.asset_type);
      out[key] = { url: blobUrl, type: scene.asset_type, duration_s: result.durationS };
    } catch (e) {
      // Degraded fallback
      const placeholder = `https://placehold.co/1920x1080/${spec.palette.primary.slice(1)}/${spec.palette.accent.slice(1)}.png?text=Scene+${idx + 1}`;
      out[key] = { url: placeholder, type: "image", degraded: true };
    }
  });

  await Promise.all(tasks);
  await appendEvent(input.runId, "assets_done", {
    count: Object.keys(out).length,
    degraded: Object.values(out).filter(a => a.degraded).length,
  });
  return out;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/higgsfield.ts apps/web/src/workflow/asset-gen.ts
git commit -m "feat(workflow): asset_gen step with prompt-hash caching + degraded-fallback (stub Higgsfield)"
```

---

### Task 2.8: render workflow step (Modal client, real worker in Task 4.3)

**Files:**
- Create: `apps/web/src/modal.ts`
- Create: `apps/web/src/workflow/render.ts`

- [ ] **Step 1: Write apps/web/src/modal.ts**

```typescript
// apps/web/src/modal.ts
const MODAL_RENDER_URL = process.env.MODAL_RENDER_URL!;  // set after `modal deploy`
const MODAL_TOKEN = process.env.MODAL_TOKEN!;            // optional auth header

export interface RenderInput {
  spec: unknown;
  assets: Record<string, { url: string; type: string; duration_s?: number }>;
}

export async function callModalRender(input: RenderInput): Promise<{ mp4Url: string; durationSec: number }> {
  const res = await fetch(MODAL_RENDER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(MODAL_TOKEN ? { authorization: `Bearer ${MODAL_TOKEN}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`modal render failed: ${res.status} ${await res.text()}`);
  return res.json();
}
```

- [ ] **Step 2: Write apps/web/src/workflow/render.ts**

```typescript
// apps/web/src/workflow/render.ts
import type { CompositionSpec, AssetBundle } from "@promo/types";
import { callModalRender } from "../modal.js";
import { appendEvent } from "../db.js";
import type { RunInput } from "./index.js";

export async function render(input: RunInput, spec: CompositionSpec, assets: AssetBundle) {
  // For Phase 2 we just stub: if MODAL_RENDER_URL is unset, return a placeholder.
  if (!process.env.MODAL_RENDER_URL) {
    await appendEvent(input.runId, "render_stub", { reason: "MODAL_RENDER_URL unset" });
    return {
      mp4Url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      durationSec: 30,
    };
  }

  const result = await callModalRender({ spec, assets });
  await appendEvent(input.runId, "render_done", { mp4Url: result.mp4Url, durationSec: result.durationSec });
  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/modal.ts apps/web/src/workflow/render.ts
git commit -m "feat(workflow): render step + Modal client (with stub fallback for Phase 2)"
```

---

### Task 2.9: deliver workflow step

**Files:**
- Create: `apps/web/src/workflow/deliver.ts`

- [ ] **Step 1: Write apps/web/src/workflow/deliver.ts**

```typescript
// apps/web/src/workflow/deliver.ts
import { updateRun, appendEvent } from "../db.js";
import type { RunInput } from "./index.js";

export async function deliver(input: RunInput, mp4: { mp4Url: string; durationSec: number }) {
  await updateRun(input.runId, {
    status: "complete",
    video_url: mp4.mp4Url,
    duration_sec: mp4.durationSec,
  });
  await appendEvent(input.runId, "complete", { videoUrl: mp4.mp4Url, durationSec: mp4.durationSec });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/workflow/deliver.ts
git commit -m "feat(workflow): deliver step — final status update + complete event"
```

---

### Task 2.10: Placeholder reference-analysis step (real impl in Phase 5)

**Files:**
- Create: `apps/web/src/workflow/reference-analysis.ts`

- [ ] **Step 1: Write the stub**

```typescript
// apps/web/src/workflow/reference-analysis.ts
// Real impl lands in Phase 5 Task 5.2. This stub keeps the workflow signature
// stable so Phase 2 can wire everything end-to-end with mocks.

import type { ReferenceStyle, BrandResearch } from "@promo/types";
import { appendEvent } from "../db.js";
import type { RunInput } from "./index.js";

export async function referenceAnalysis(input: RunInput, _brand: BrandResearch): Promise<ReferenceStyle | null> {
  // Stub: return a degenerate ReferenceStyle so downstream code can run with it.
  // Real impl will call analyze_reference_video tool via the agent.
  await appendEvent(input.runId, "reference_stub", { url: input.referenceUrl });
  if (!input.referenceUrl) return null;

  return {
    source_url: input.referenceUrl,
    duration_analyzed_s: 0,
    pacing: { avg_scene_duration_s: 0, scene_count: 0, rhythm: "(stub)" },
    visual_style: {
      palette: { primary: "#000000", accent: "#FFFFFF" },
      type_treatment: "(stub)",
      composition: "(stub)",
    },
    motion_style: { transitions: [], camera_movement: "(stub)" },
    audio_style: { music_genre: "(stub)", music_rhythm: "(stub)", voiceover: false },
    tone: "(stub — Phase 5)",
    structural_arc: [],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/workflow/reference-analysis.ts
git commit -m "feat(workflow): reference_analysis stub — real Nano Omni impl in Phase 5"
```

---

## Phase 3 — Frontend (API routes + UI)

### Task 3.1: POST /api/runs route

**Files:**
- Create: `apps/web/app/api/runs/route.ts`

- [ ] **Step 1: Write apps/web/app/api/runs/route.ts**

```typescript
// apps/web/app/api/runs/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createRun } from "@/db";
import { promoWorkflow } from "@/workflow";

const Body = z.object({
  url: z.string().url(),
  referenceUrl: z.string().url().optional(),
});

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const runId = await createRun(parsed.data.url, parsed.data.referenceUrl ?? null);

  // Fire-and-forget the workflow. Vercel Workflow handles durability.
  promoWorkflow.start({ runId, url: parsed.data.url, referenceUrl: parsed.data.referenceUrl ?? null });

  return NextResponse.json({ runId });
}
```

Note: the `@/...` alias requires updating `apps/web/tsconfig.json` paths. If create-next-app didn't set that up, add to compilerOptions.paths: `"@/*": ["./src/*"]`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/runs/route.ts apps/web/tsconfig.json
git commit -m "feat(api): POST /api/runs creates a run + kicks off the workflow"
```

---

### Task 3.2: GET /api/runs/[id]/stream (SSE)

**Files:**
- Create: `apps/web/app/api/runs/[id]/stream/route.ts`

- [ ] **Step 1: Write the SSE route**

```typescript
// apps/web/app/api/runs/[id]/stream/route.ts
import { getEventsAfter } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const url = new URL(req.url);
  const lastEventIdHeader = req.headers.get("Last-Event-ID");
  let lastId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let active = true;
      req.signal.addEventListener("abort", () => { active = false; });

      while (active) {
        const events = await getEventsAfter(runId, lastId);
        for (const evt of events) {
          const data = JSON.stringify({ type: evt.type, payload: evt.payload });
          controller.enqueue(enc.encode(`id: ${evt.id}\nevent: ${evt.type}\ndata: ${data}\n\n`));
          lastId = evt.id;
          if (evt.type === "complete" || evt.type === "failed") {
            controller.close();
            return;
          }
        }
        await new Promise(r => setTimeout(r, 1000));   // 1 Hz poll
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/runs/[id]/stream/route.ts
git commit -m "feat(api): GET /api/runs/[id]/stream — SSE poll over events table"
```

---

### Task 3.3: app/page.tsx — input form

**Files:**
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Replace the default page**

```typescript
// apps/web/app/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          referenceUrl: referenceUrl || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? `status ${res.status}`);
      const { runId } = await res.json();
      router.push(`/runs/${runId}`);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold mb-2">Promo Agent</h1>
      <p className="text-sm text-zinc-500 mb-8">
        Type a company URL, optionally drop a reference video URL, get back an animated promo.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Company URL</span>
          <input
            type="url"
            required
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://buildtrayd.com"
            className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Reference video URL (optional)</span>
          <input
            type="url"
            value={referenceUrl}
            onChange={e => setReferenceUrl(e.target.value)}
            placeholder="https://youtu.be/... or https://vimeo.com/..."
            className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2"
          />
          <span className="text-xs text-zinc-500 mt-1 block">
            Agent will analyze its style with Nemotron 3 Nano Omni and match palette + pacing + motion.
          </span>
        </label>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-black text-white py-2 disabled:bg-zinc-400"
        >
          {busy ? "Starting…" : "Generate promo"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(ui): input form with URL + optional reference video URL"
```

---

### Task 3.4: app/runs/[id]/page.tsx — status board

**Files:**
- Create: `apps/web/app/runs/[id]/page.tsx`

- [ ] **Step 1: Write the status page**

```typescript
// apps/web/app/runs/[id]/page.tsx
"use client";

import { useEffect, useState, use } from "react";

interface Event { type: string; payload: any; }

const STEP_LABELS: Record<string, string> = {
  intake_done: "Intake",
  research_done: "Research",
  reference_stub: "Analyzing reference",
  reference_analyzed: "Reference analyzed",
  composition_done: "Composition planned",
  assets_done: "Assets generated",
  render_done: "Rendered",
  render_stub: "Render (stub)",
  complete: "Complete",
  failed: "Failed",
};

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [events, setEvents] = useState<Event[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/stream`);
    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setEvents(prev => [...prev, data]);
        if (data.type === "complete") {
          setVideoUrl(data.payload.videoUrl);
          es.close();
        }
        if (data.type === "failed") {
          setErrored(data.payload?.error ?? "unknown failure");
          es.close();
        }
      } catch { /* ignore parse errors */ }
    };
    // SSE custom event names — attach to all known types
    for (const k of Object.keys(STEP_LABELS)) {
      es.addEventListener(k, handler);
    }
    es.addEventListener("error", () => es.close());
    return () => es.close();
  }, [id]);

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold mb-6">Run {id.slice(0, 8)}</h1>

      <ol className="space-y-2 mb-8">
        {events.map((e, i) => (
          <li key={i} className="flex items-baseline gap-3">
            <span className="text-zinc-400 text-xs w-6">{i + 1}.</span>
            <span className="font-medium">{STEP_LABELS[e.type] ?? e.type}</span>
            {e.payload && typeof e.payload === "object" && (
              <span className="text-xs text-zinc-500">
                {Object.entries(e.payload).slice(0, 2).map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(" · ")}
              </span>
            )}
          </li>
        ))}
        {!videoUrl && !errored && (
          <li className="text-zinc-400 text-sm italic">…working…</li>
        )}
      </ol>

      {errored && <div className="text-red-600 text-sm">Failed: {errored}</div>}

      {videoUrl && (
        <div className="space-y-3">
          <video controls className="w-full rounded" src={videoUrl} />
          <a className="text-sm underline" href={videoUrl} download>Download MP4</a>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/runs/[id]/page.tsx
git commit -m "feat(ui): status board page — SSE stream of run events + final video player"
```

---

### Task 3.5: End-to-end smoke with mocks

**Files:**
- None new

- [ ] **Step 1: Start the dev server with env vars**

Ensure `apps/web/.env.local` has:
- `DATABASE_URL=...` (from Vercel env pull)
- `BLOB_READ_WRITE_TOKEN=...` (from Vercel env pull)
- `NEMOCLAW_URL=http://127.0.0.1:18789`
- `NEMOCLAW_TOKEN=$(nemoclaw promo-agent gateway-token --quiet)`

```bash
cd apps/web
export NEMOCLAW_TOKEN=$(nemoclaw promo-agent gateway-token --quiet)
npm run dev
```

- [ ] **Step 2: Test in Safari**

Open http://localhost:3000 in Safari. Type `https://buildtrayd.com` for the URL, leave reference blank. Click "Generate promo".

Expected: redirect to `/runs/<id>`. Status board shows steps appearing: intake → research → composition planned → assets generated → render (stub) → complete. A sample BigBuckBunny video plays at the end (because Higgsfield + Modal are both stubs).

If the composition_plan step fails because NemoClaw isn't reachable or the agent's spec is invalid: that's the expected failure mode this smoke test is supposed to reveal. Fix the issue (gateway URL/token, schema mismatch, etc.) and re-run.

- [ ] **Step 3: Commit (no code change — verification only)**

```bash
git tag -a phase-3-end-to-end-mocks -m "end-to-end pipeline runs with mock Higgsfield + Modal, real NemoClaw agent"
```

---

## Phase 4 — Real services

### Task 4.1: Real Higgsfield client

**Files:**
- Modify: `apps/web/src/higgsfield.ts`

- [ ] **Step 1: Verify the Higgsfield API surface**

Read `~/.claude/skills/higgsfield-generate/` skill docs (Dennis already has the higgsfield-generate skill installed locally). Confirm the model IDs, endpoint URL, auth header format, and response shape.

```bash
ls ~/.claude/skills/higgsfield-generate/
cat ~/.claude/skills/higgsfield-generate/SKILL.md 2>/dev/null || cat ~/.claude/skills/higgsfield-generate/README.md 2>/dev/null
```

If the skill exposes a CLI/HTTP shim we can reuse, prefer that. If it's only a CLI, we'll shell out from the workflow step via subprocess.

- [ ] **Step 2: Replace the stub in apps/web/src/higgsfield.ts**

```typescript
// apps/web/src/higgsfield.ts
// VERIFY the API shape in Step 1 above. Adjust if different.

const HIGGSFIELD_API_KEY = process.env.HIGGSFIELD_API_KEY!;
const HIGGSFIELD_BASE = process.env.HIGGSFIELD_BASE ?? "https://api.higgsfield.ai/v1";

export interface GenerateInput {
  prompt: string;
  type: "image" | "video";
  aspect?: "16:9" | "9:16" | "1:1";
  model?: string;             // e.g. "gpt-image-2" for images, "seedance-2.0" for video
}

export async function generate(input: GenerateInput): Promise<{ url: string; durationS?: number }> {
  const endpoint =
    input.type === "image"
      ? `${HIGGSFIELD_BASE}/images/generate`
      : `${HIGGSFIELD_BASE}/videos/generate`;
  const model =
    input.model ??
    (input.type === "image" ? "gpt-image-2" : "seedance-2.0");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${HIGGSFIELD_API_KEY}`,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      model,
      aspect: input.aspect ?? "16:9",
    }),
  });

  if (!res.ok) {
    throw new Error(`Higgsfield ${input.type} generate failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  // VERIFY the response shape — adjust the field names below to match.
  return {
    url: body.url ?? body.data?.[0]?.url,
    durationS: input.type === "video" ? body.duration ?? 5 : undefined,
  };
}
```

- [ ] **Step 3: Smoke test from the dev server**

Restart `npm run dev` with `HIGGSFIELD_API_KEY` set in `.env.local`. Trigger one run. Watch the asset_gen step in the status board.

Expected: real Higgsfield-generated images/clips appear in the Vercel Blob bucket, asset bundle returns real URLs.

If Higgsfield rejects the call: fix the API shape, re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/higgsfield.ts
git commit -m "feat(higgsfield): replace stub with real API client (verified against higgsfield-generate skill)"
```

---

### Task 4.2: Modal render worker — scaffold

**Files:**
- Create: `apps/render/pyproject.toml`
- Create: `apps/render/modal_app.py`
- Create: `apps/render/render.py`
- Create: `apps/render/templates/promo.tsx.template`

- [ ] **Step 1: Write apps/render/pyproject.toml**

```toml
[project]
name = "promo-render"
version = "0.0.1"
requires-python = ">=3.13"
dependencies = [
  "modal>=0.65.0",
  "requests>=2.32.0",
]
```

- [ ] **Step 2: Install Modal CLI + authenticate**

```bash
pip install modal
modal token new
```

Follow the browser flow to authenticate.

- [ ] **Step 3: Write the Remotion template**

```tsx
// apps/render/templates/promo.tsx.template
// This file gets copied + filled at render time. The placeholders are
// replaced by render.py using simple string substitution (NOT eval).

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, Img, Video } from "remotion";

const PALETTE = __PALETTE_JSON__;
const SCENES = __SCENES_JSON__;
const ASSETS = __ASSETS_JSON__;

export const Promo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: PALETTE.primary }}>
      {SCENES.map((scene: any, idx: number) => {
        const from = cursor;
        cursor += scene.duration_f;
        const sceneKey = `scene_${idx + 1}`;
        const asset = ASSETS[sceneKey];
        return (
          <Sequence key={idx} from={from} durationInFrames={scene.duration_f}>
            <AbsoluteFill style={{ background: PALETTE.primary, alignItems: "center", justifyContent: "center" }}>
              {asset?.type === "video" ? (
                <Video src={asset.url} muted style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              ) : asset?.url ? (
                <Img src={asset.url} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
              <div style={{ position: "relative", color: PALETTE.accent, fontSize: 96, fontWeight: 800, textAlign: "center", lineHeight: 1, mixBlendMode: "difference" }}>
                {scene.copy.map((line: string, i: number) => (
                  <div key={i} style={{ marginBottom: 16 }}>{line}</div>
                ))}
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 4: Write apps/render/render.py**

```python
# apps/render/render.py
import json
import subprocess
import tempfile
from pathlib import Path

TEMPLATE_PATH = Path(__file__).parent / "templates" / "promo.tsx.template"

def fill_template(spec: dict, assets: dict) -> str:
    src = TEMPLATE_PATH.read_text()
    return (
        src.replace("__PALETTE_JSON__", json.dumps(spec["palette"]))
           .replace("__SCENES_JSON__", json.dumps(spec["scenes"]))
           .replace("__ASSETS_JSON__", json.dumps(assets))
    )

def render(spec: dict, assets: dict) -> bytes:
    """Render a Remotion composition to MP4 bytes."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        # Bootstrap a minimal Remotion project
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "Promo.tsx").write_text(fill_template(spec, assets))
        (tmp_path / "src" / "Root.tsx").write_text(
            """
            import { Composition } from "remotion";
            import { Promo } from "./Promo";
            export const RemotionRoot = () => (
              <Composition id="Promo" component={Promo} durationInFrames=""" + str(spec["total_duration_f"]) + """ fps={30} width={1920} height={1080} />
            );
            """
        )
        (tmp_path / "src" / "index.ts").write_text(
            'import { registerRoot } from "remotion"; import { RemotionRoot } from "./Root"; registerRoot(RemotionRoot);'
        )
        (tmp_path / "package.json").write_text(json.dumps({
            "name": "promo-render-job",
            "version": "0.0.1",
            "dependencies": { "remotion": "^4.0.0", "react": "^18.3.0", "react-dom": "^18.3.0" }
        }))

        subprocess.run(["npm", "install"], cwd=tmp_path, check=True)
        out_mp4 = tmp_path / "out.mp4"
        subprocess.run([
            "npx", "remotion", "render", "src/index.ts", "Promo", str(out_mp4),
            "--codec=h264", "--concurrency=8",
        ], cwd=tmp_path, check=True)
        return out_mp4.read_bytes()
```

- [ ] **Step 5: Write apps/render/modal_app.py**

```python
# apps/render/modal_app.py
import json
import modal
from render import render as do_render

image = (
    modal.Image.debian_slim()
        .apt_install("chromium", "ffmpeg")
        .pip_install_from_requirements("requirements.txt")
        .run_commands(
            "curl -fsSL https://deb.nodesource.com/setup_24.x | bash -",
            "apt-get install -y nodejs",
        )
)

app = modal.App("promo-agent-render", image=image)

@app.function(timeout=600, cpu=4, memory=8192)
@modal.fastapi_endpoint(method="POST")
def render(spec: dict, assets: dict) -> dict:
    mp4_bytes = do_render(spec, assets)
    # For hackathon simplicity: return the bytes inline as base64.
    # Production: upload to S3/Blob and return URL.
    import base64
    return {
        "mp4Base64": base64.b64encode(mp4_bytes).decode("ascii"),
        "durationSec": spec["total_duration_f"] // 30,
    }
```

Note: the inline base64 round-trip is awful for >5MB videos. Phase 4.3 fixes this to upload directly to Blob from inside Modal.

- [ ] **Step 6: Deploy + test**

```bash
cd apps/render
modal deploy modal_app.py
```

Expected: prints a web endpoint URL like `https://your-modal-account--promo-agent-render-render.modal.run`. Save this as `MODAL_RENDER_URL` in `apps/web/.env.local`.

- [ ] **Step 7: Commit**

```bash
git add apps/render/
git commit -m "feat(render): Modal worker — Remotion CLI render from CompositionSpec + AssetBundle"
```

---

### Task 4.3: Update render workflow step to use real Modal + Blob upload

**Files:**
- Modify: `apps/web/src/modal.ts`
- Modify: `apps/web/src/workflow/render.ts`

- [ ] **Step 1: Update modal.ts to handle base64 → blob upload**

```typescript
// apps/web/src/modal.ts (replacing previous content)
import { uploadBuffer } from "./blob.js";

const MODAL_RENDER_URL = process.env.MODAL_RENDER_URL!;
const MODAL_TOKEN = process.env.MODAL_TOKEN;

export interface RenderInput {
  spec: unknown;
  assets: Record<string, { url: string; type: string; duration_s?: number }>;
}

export async function callModalRender(input: RenderInput, runId: string): Promise<{ mp4Url: string; durationSec: number }> {
  const res = await fetch(MODAL_RENDER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(MODAL_TOKEN ? { authorization: `Bearer ${MODAL_TOKEN}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`modal render failed: ${res.status} ${await res.text()}`);
  const body = await res.json();

  const mp4Bytes = Buffer.from(body.mp4Base64, "base64");
  const mp4Url = await uploadBuffer(`runs/${runId}/final.mp4`, mp4Bytes, "video/mp4");

  return { mp4Url, durationSec: body.durationSec };
}
```

- [ ] **Step 2: Update render workflow step**

```typescript
// apps/web/src/workflow/render.ts (replacing previous content)
import type { CompositionSpec, AssetBundle } from "@promo/types";
import { callModalRender } from "../modal.js";
import { appendEvent } from "../db.js";
import type { RunInput } from "./index.js";

export async function render(input: RunInput, spec: CompositionSpec, assets: AssetBundle) {
  if (!process.env.MODAL_RENDER_URL) {
    throw new Error("MODAL_RENDER_URL not set — deploy Modal worker first");
  }
  const result = await callModalRender({ spec, assets }, input.runId);
  await appendEvent(input.runId, "render_done", { mp4Url: result.mp4Url, durationSec: result.durationSec });
  return result;
}
```

- [ ] **Step 3: Smoke test — first real run on Trayd**

Trigger a run with `https://buildtrayd.com` (no reference video). Watch the entire pipeline run real: NemoClaw plans, Higgsfield generates, Modal renders Remotion, Blob hosts the MP4. Open the final video in Safari.

Expected outcome: a 30s video that visually relates to Trayd (navy + lime, mentions construction back-office). Quality bar: not great yet (no reference, no fine-tuning), but recognizably about Trayd.

If anything fails: log line, fix, re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modal.ts apps/web/src/workflow/render.ts
git commit -m "feat(render): real Modal call + Blob upload of final MP4"
```

---

## Phase 5 — Reference-video feature (Nano Omni)

### Task 5.1: analyze_reference_video tool

**Files:**
- Create: `agent/skills/promo/tools/analyze_reference_video.ts`
- Modify: `agent/skills/promo/index.ts` (register tool)

- [ ] **Step 1: Add yt-dlp to the sandbox**

```bash
nemoclaw promo-agent exec -- bash -c "apt-get update && apt-get install -y python3-pip && pip3 install yt-dlp"
```

Verify:
```bash
nemoclaw promo-agent exec -- yt-dlp --version
```

If apt-get isn't available in the sandbox: NemoClaw sandbox images vary. Try `apk add` (alpine), or download yt-dlp binary directly. Update this step inline if a different install path is needed.

- [ ] **Step 2: Write analyze_reference_video.ts**

```typescript
// agent/skills/promo/tools/analyze_reference_video.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const exec = promisify(execFile);

const InputSchema = z.object({
  url: z.string().url(),
  max_seconds: z.number().int().min(10).max(120).default(90),
});

const SYSTEM_PROMPT = `Watch this video and produce a structured analysis of its visual + audio style.
Return ONLY a JSON object matching this exact shape (no preamble):

{
  "pacing": { "avg_scene_duration_s": <number>, "scene_count": <int>, "rhythm": "<one short phrase>" },
  "visual_style": {
    "palette": { "primary": "#XXXXXX", "accent": "#XXXXXX", "neutrals": ["#XXXXXX"] },
    "type_treatment": "<one phrase about typography>",
    "composition": "<one phrase about framing>"
  },
  "motion_style": { "transitions": ["<name>"], "camera_movement": "<one phrase>" },
  "audio_style": { "music_genre": "<phrase>", "music_rhythm": "<phrase>", "voiceover": <bool> },
  "tone": "<2-3 word descriptor>",
  "structural_arc": ["<beat>", "<beat>", "<beat>"]
}`;

export async function analyzeReferenceVideo(input: unknown) {
  const args = InputSchema.parse(input);

  // Download via yt-dlp to a sandbox-scoped temp dir
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "promo-ref-"));
  const outPath = path.join(tmpDir, "ref.mp4");

  try {
    await exec("yt-dlp", [
      "-f", "mp4/best",
      "--no-playlist",
      "--max-filesize", "200M",
      "-o", outPath,
      args.url,
    ], { timeout: 60_000 });
  } catch (e) {
    throw new Error(`reference video download failed: ${(e as Error).message}`);
  }

  // Truncate to max_seconds if needed via ffmpeg
  const truncatedPath = path.join(tmpDir, "ref_trunc.mp4");
  try {
    await exec("ffmpeg", [
      "-i", outPath,
      "-t", String(args.max_seconds),
      "-c", "copy",
      "-y", truncatedPath,
    ], { timeout: 60_000 });
  } catch {
    // If truncation fails, send the original
    await fs.copyFile(outPath, truncatedPath);
  }

  // Read as base64 to send to Nano Omni
  const videoBytes = await fs.readFile(truncatedPath);
  const videoB64 = videoBytes.toString("base64");

  // Return an llm_call envelope — orchestrator routes to Nano Omni
  return {
    kind: "llm_call" as const,
    model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "video_url", video_url: { url: `data:video/mp4;base64,${videoB64}` } },
          { type: "text", text: `Analyze this video. Source URL: ${args.url}. Duration analyzed: up to ${args.max_seconds}s.` },
        ],
      },
    ],
    parse: "json" as const,
    max_tokens: 800,
    cleanup: tmpDir,           // orchestrator should rm -rf this after the call
  };
}

export const analyzeReferenceVideoTool = {
  name: "analyze_reference_video",
  description: "Download a reference promo video via yt-dlp and analyze its style using Nemotron 3 Nano Omni. Returns a ReferenceStyle JSON.",
  parameters: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "Public URL of a video (YouTube, Vimeo, direct mp4)." },
      max_seconds: { type: "integer", minimum: 10, maximum: 120, default: 90 },
    },
  },
  handler: analyzeReferenceVideo,
};
```

- [ ] **Step 3: Register the tool in agent/skills/promo/index.ts**

```typescript
// agent/skills/promo/index.ts (replace prior content)
import { fetchUrlTool } from "./tools/fetch_url.js";
import { analyzeReferenceVideoTool } from "./tools/analyze_reference_video.js";
import { patternLookupTool } from "./tools/pattern_lookup.js";
import { scriptDraftTool } from "./tools/script_draft.js";
import { assetBriefTool } from "./tools/asset_brief.js";
import { selfCritiqueTool } from "./tools/self_critique.js";

export const skill = {
  name: "promo",
  version: "0.0.2",
  tools: [
    fetchUrlTool,
    analyzeReferenceVideoTool,
    patternLookupTool,
    scriptDraftTool,
    assetBriefTool,
    selfCritiqueTool,
  ],
};

export default skill;
```

- [ ] **Step 4: Rebuild + reinstall skill**

```bash
npm run build -w @promo/skill
nemoclaw promo-agent skill install ./agent/skills/promo
```

- [ ] **Step 5: Smoke test via dashboard**

In the NemoClaw dashboard chat:

```
Use analyze_reference_video on https://youtu.be/dQw4w9WgXcQ with max_seconds=30. Show me the JSON it returns.
```

Expected: returns a valid ReferenceStyle JSON object describing Rick Astley's music video style. If it fails: check yt-dlp install, ffmpeg install, Nano Omni endpoint accessibility.

- [ ] **Step 6: Commit**

```bash
git add agent/skills/promo/tools/analyze_reference_video.ts agent/skills/promo/index.ts
git commit -m "feat(agent): analyze_reference_video tool — yt-dlp + Nano Omni vision (the headline feature)"
```

---

### Task 5.2: Replace reference_analysis workflow stub with real impl

**Files:**
- Modify: `apps/web/src/workflow/reference-analysis.ts`

- [ ] **Step 1: Replace the stub**

```typescript
// apps/web/src/workflow/reference-analysis.ts (replacing the stub)
import type { ReferenceStyle, BrandResearch } from "@promo/types";
import { validate } from "@promo/schemas";
import { runAgent } from "../nemoclaw.js";
import { appendEvent } from "../db.js";
import type { RunInput } from "./index.js";

export async function referenceAnalysis(input: RunInput, _brand: BrandResearch): Promise<ReferenceStyle | null> {
  if (!input.referenceUrl) return null;

  const message = `Use analyze_reference_video on ${input.referenceUrl} with max_seconds=90. Return ONLY the JSON object the tool produces, no other prose.`;

  const { output } = await runAgent({
    message,
    session_id: `${input.runId}-ref`,
  });

  const match = output.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ?? [null, output];
  const jsonText = match[1] ?? output;

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    await appendEvent(input.runId, "reference_failed", { reason: "JSON parse" });
    return null;   // fall back to brand-only generation
  }

  // The tool returns the analysis without source_url + duration_analyzed_s populated — add them.
  const enriched: ReferenceStyle = {
    source_url: input.referenceUrl,
    duration_analyzed_s: 90,
    ...parsed,
  };

  const validation = validate("reference-style", enriched);
  if (!validation.valid) {
    await appendEvent(input.runId, "reference_failed", { reason: "schema", errors: validation.errors });
    return null;
  }

  await appendEvent(input.runId, "reference_analyzed", {
    palette: enriched.visual_style.palette,
    tone: enriched.tone,
  });
  return enriched;
}
```

- [ ] **Step 2: Smoke test — first run with a reference video**

Trigger a run via the UI: `url=https://buildtrayd.com`, `referenceUrl=https://youtu.be/<a-known-promo>` (pick a HeyGen launch video or one of your own Luceo samples on YouTube).

Watch the status board: `reference_analyzed` event should appear between research and composition. The final video should visibly inherit the reference's palette + pacing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/workflow/reference-analysis.ts
git commit -m "feat(workflow): real reference_analysis step using analyze_reference_video tool"
```

---

## Phase 6 — Polish + golden runs

### Task 6.1: Per-domain rate limit for fetch_url

**Files:**
- Modify: `agent/skills/promo/tools/fetch_url.ts`

- [ ] **Step 1: Add an in-memory rate limiter**

Insert this near the top of `fetch_url.ts`:

```typescript
const lastFetchByHost = new Map<string, number>();
const MIN_INTERVAL_MS = 2_000;   // 2 seconds between fetches to the same host

async function rateLimitHost(host: string) {
  const last = lastFetchByHost.get(host) ?? 0;
  const wait = Math.max(0, last + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetchByHost.set(host, Date.now());
}
```

In `fetchWithRetry`, call `await rateLimitHost(u.hostname);` as the first line.

- [ ] **Step 2: Rebuild + reinstall + commit**

```bash
npm run build -w @promo/skill
nemoclaw promo-agent skill install ./agent/skills/promo
git add agent/skills/promo/tools/fetch_url.ts
git commit -m "feat(agent): per-host rate limit for fetch_url (2s minimum interval)"
```

---

### Task 6.2: Run the 5 golden inputs + 2 reference-video runs

**Files:**
- Create: `scripts/golden-runs.md` (a tracker, not code)

- [ ] **Step 1: Write scripts/golden-runs.md as a checklist**

```markdown
# Golden Runs — Pre-Submission Validation

For each: trigger via UI, watch full pipeline, download MP4, score 1-5 on
(a) brand fit, (b) pacing, (c) would-you-send-this. <3/5 = bug to fix.

## Brand-only runs

- [ ] Trayd — https://buildtrayd.com — ___/15 — notes:
- [ ] Benchling — https://benchling.com — ___/15 — notes:
- [ ] Cumie — https://cumie.app/zh — ___/15 — notes:
- [ ] iKala Kolr — https://kolr.ai — ___/15 — notes:
- [ ] JGB Property — https://jgbproperty.com — ___/15 — notes:

## Reference-video runs (the headline feature)

- [ ] Trayd + HeyGen launch as reference — ___/15 — notes:
- [ ] Benchling + Apple's "Designed by Apple" as reference — ___/15 — notes:

## Issues found
(add bullet per issue, fix in subsequent tasks)
```

- [ ] **Step 2: Execute all 7 runs, fill in scores**

Just do it. Watch each, note quality issues, log them in the file.

- [ ] **Step 3: Fix the top 3 highest-impact bugs**

This will be situational — could be palette extraction missing a color, agent picking wrong template, render layout broken, etc. Address inline.

- [ ] **Step 4: Commit the tracker + fixes**

```bash
git add scripts/golden-runs.md
git commit -m "docs: golden-run tracker"
# then commit each bug fix as its own commit
```

---

### Task 6.3: Smoke test script

**Files:**
- Create: `scripts/smoke.sh`

- [ ] **Step 1: Write scripts/smoke.sh**

```bash
#!/usr/bin/env bash
# Pre-demo smoke test. Run 30 min before any booth demo.
set -e

echo "→ Nemotron reachable..."
curl -sf https://integrate.api.nvidia.com/v1/models \
  -H "Authorization: Bearer $NVIDIA_API_KEY" > /dev/null

echo "→ NemoClaw sandbox healthy..."
nemoclaw promo-agent status | grep -q "Inference: healthy"

echo "→ Skills installed..."
nemoclaw promo-agent exec -- ls /opt/openclaw/skills/promo > /dev/null

echo "→ Policy applied..."
nemoclaw promo-agent policy-list | grep -q "max_higgsfield_spend_usd_per_task"

echo "→ Public tunnel alive..."
nemoclaw promo-agent dashboard-url --quiet | head -c 4 | grep -q "http"

echo "→ Modal worker deployed..."
modal app list | grep -q "promo-agent-render"

echo "→ Vercel deployment current..."
[ -n "$PROD_URL" ] && curl -sf -o /dev/null "$PROD_URL"

echo "→ Higgsfield reachable..."
curl -sf -o /dev/null -H "Authorization: Bearer $HIGGSFIELD_API_KEY" "$HIGGSFIELD_BASE/models" || echo "  (warning: endpoint check skipped — adjust if Higgsfield uses a different probe URL)"

echo "✓ All systems green"
```

- [ ] **Step 2: Make executable + run once**

```bash
chmod +x scripts/smoke.sh
./scripts/smoke.sh
```

Expected: all checks pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.sh
git commit -m "feat(scripts): pre-demo smoke test"
```

---

## Phase 7 — Deploy + submission

### Task 7.1: Cloudflared tunnel for NemoClaw

**Files:**
- None new (operational)

- [ ] **Step 1: Start the tunnel**

```bash
nemoclaw tunnel start
```

Note the public URL it prints. Save it as `NEMOCLAW_URL` in production env.

- [ ] **Step 2: Verify the tunnel is responsive**

```bash
nemoclaw promo-agent dashboard-url --quiet
# This should print a public https:// URL now, not 127.0.0.1
```

Test from another network (your phone on 4G) — load the URL.

- [ ] **Step 3: Document the URL**

Add to `scripts/golden-runs.md` so it's findable:

```markdown
## Public infrastructure
- NemoClaw tunnel: https://<assigned-cloudflared-url>
- (Re-issue via `nemoclaw tunnel start` if it changes)
```

Commit.

---

### Task 7.2: Vercel deploy + env vars

**Files:**
- None new

- [ ] **Step 1: Push env vars to Vercel**

```bash
cd apps/web
npx vercel env add NEMOCLAW_URL production
# paste the tunnel URL from Task 7.1
npx vercel env add NEMOCLAW_TOKEN production
# paste output of: nemoclaw promo-agent gateway-token --quiet
npx vercel env add HIGGSFIELD_API_KEY production
# paste from Higgsfield dashboard
npx vercel env add MODAL_RENDER_URL production
# paste from `modal deploy` output
npx vercel env add NVIDIA_API_KEY production
# paste from build.nvidia.com (same key already in your .zshrc)
```

- [ ] **Step 2: Deploy to production**

```bash
npx vercel --prod
```

Save the prod URL printed (e.g. `https://promo-agent-xyz.vercel.app`). Save as `PROD_URL` env var locally for smoke tests.

- [ ] **Step 3: Smoke test prod**

```bash
PROD_URL=<your-prod-url> ./scripts/smoke.sh
```

Then open `PROD_URL` in Safari and trigger one run end-to-end with Trayd. Verify the entire pipeline works in prod.

- [ ] **Step 4: Commit (env vars aren't committed; just the verification)**

```bash
git tag -a phase-7-deployed -m "prod deployment live, smoke test passing"
```

---

### Task 7.3: Pre-render 3 backup demos

**Files:**
- None new (operational)

- [ ] **Step 1: Trigger 3 runs in advance via prod UI**

- Trayd brand-only
- Benchling brand-only  
- Cumie + HeyGen reference (showcases the headline feature)

- [ ] **Step 2: Download the 3 final MP4s to your laptop**

Save under `~/Desktop/Projects/Hackathons/promo-agent/booth-backup/`:
- `01-trayd.mp4`
- `02-benchling.mp4`
- `03-cumie-ref-heygen.mp4`

- [ ] **Step 3: Verify the backups play in QuickTime + on phone**

If anything looks broken: re-render or fix the underlying bug then re-render.

---

### Task 7.4: Submission write-up

**Files:**
- Create: `SUBMISSION.md` (root)

- [ ] **Step 1: Write SUBMISSION.md**

The hackathon's submission form will likely ask for: project title, description, demo URL, video URL, github URL, tech stack used, etc.

Write a self-contained markdown the form fields can quote from. Headline the **reference-video feature** prominently — it's the differentiator.

Structure:
- Project name: Promo Agent
- Live demo URL: <prod URL>
- Demo video URL: <YouTube link to 2-min screencast>
- GitHub: <repo URL>
- One-line: "Autonomous agent that turns a company URL (and optionally a reference video) into an animated promo, in the reference's style."
- Tech stack
- How we use Nemotron (Super 120B + Nano Omni — explicit)
- How we use NemoClaw guardrails (link to agent/policy.yaml, quote one specific cap intercept)
- Architecture diagram link (point to docs/2026-05-24-promo-agent-design.md)
- One concrete example: "Type buildtrayd.com + drop a HeyGen launch video as ref → get a 30s promo for Trayd in HeyGen's style"

- [ ] **Step 2: Commit**

```bash
git add SUBMISSION.md
git commit -m "docs: hackathon submission write-up"
```

---

### Task 7.5: 2-min screencast

**Files:**
- None new (operational)

- [ ] **Step 1: Record on your Mac**

QuickTime Player → File → New Screen Recording. Record at 1920x1080.

Structure (target ≤ 2 min):
- 0:00-0:15 — narrate the problem: "Building promo videos takes me 8 hours each. Let an agent do it."
- 0:15-0:30 — show the form. Type buildtrayd.com + paste a YouTube reference video. Hit Generate.
- 0:30-0:45 — speed-up the status board (cut down the wait): "Watch the agent research, analyze the reference, plan composition, generate visuals, render."
- 0:45-1:30 — show the final video playing. Mention "this is in the reference's pacing + palette, generated end-to-end by an agent using Nemotron 3 Super 120B for reasoning and Nano Omni for video analysis."
- 1:30-2:00 — show `agent/policy.yaml`. Walk through one cap ("max_higgsfield_spend_usd_per_task: 5"). Mention NemoClaw enforces it. Close: "Submission link below."

- [ ] **Step 2: Upload to YouTube (unlisted) + add URL to SUBMISSION.md**

```bash
# Manual: upload to your Luceo Studio YouTube as unlisted
# Then update SUBMISSION.md with the URL
git add SUBMISSION.md
git commit -m "docs: add screencast URL to submission"
```

---

### Task 7.6: Submit

- [ ] **Step 1: Open the Luma/Devpost submission form**

URL from the original hackathon email.

- [ ] **Step 2: Paste fields from SUBMISSION.md**

- [ ] **Step 3: Submit before 2026-05-28 12:00**

- [ ] **Step 4: Sanity check after submit**

Open the submission as if you're a judge. Click the demo URL. Trigger one run. Watch it work. If it doesn't work, scramble — this is the moment that matters.

---

## Self-Review

Looking at the spec with fresh eyes against this plan:

**Spec coverage:**
- Spec § 1 (Overview) → covered by plan intro
- Spec § 2 (Goals) → covered by Phase 3 (URL input + ref input form) and Phase 5 (reference-style matching)
- Spec § 3 (Architecture) → covered by Phase 0-7 file structure + each phase building one zone
- Spec § 4 (Components) → every component in the table has a corresponding task (intake=2.4, research=2.5, reference_analysis=2.10+5.2, composition_plan=2.6, asset_gen=2.7, render=2.8+4.2+4.3, deliver=2.9; tools=1.2-1.6 + 5.1; modal worker=4.2; storage=2.2+2.3)
- Spec § 5 (Data flow) → schemas covered by 0.3, payloads carried through every workflow step
- Spec § 6 (Error handling) → fetch_url errors covered in 1.2 tests; degraded asset fallback in 2.7; reference_analysis fallback in 5.2; render OOM/timeout NOT explicitly covered (Modal worker uses defaults — acceptable for hackathon)
- Spec § 7 (Testing) → schema TDD in 0.3, fetch_url TDD in 1.2, pattern_lookup TDD in 1.3, golden runs in 6.2, smoke script in 6.3 — pyramid largely matches spec
- Spec § 8 (Build phases) → plan phases align with spec days
- Spec § 9 (Policy file) → directly written in 1.7
- Spec § 10 (Open questions) → mitigations addressed: Remotion-from-template not from scratch (4.2 template approach), pattern_lookup returns summary not full (1.3), Nano Omni endpoint verified in 5.1 smoke test
- Spec § 11 (Cost ceiling) → no specific task but env-level — Higgsfield cap is enforced via policy in 1.7

**Placeholder scan:** searched for TBD/TODO/"fill in details" — none found in the plan body. A few "verify the docs" steps but those are explicit verification work, not placeholders.

**Type consistency:** types in `packages/types/src/index.ts` (Task 0.2) are referenced consistently throughout — `BrandResearch`, `ReferenceStyle`, `CompositionSpec`, `AssetBundle`. Schema names match (`brand-research`, `reference-style`, etc.). Tool names match between code and policy file (6 tools, all listed in both).

**One small gap I'll flag rather than fix inline:** Task 4.3 returns mp4 bytes via base64 round-trip from Modal to the workflow, which is slow for large videos. The cleaner approach is to upload the mp4 directly to Vercel Blob from inside Modal. That's a performance optimization, not a correctness issue — leaving it as-is for hackathon scope.

---

## Plan complete

Plan saved to `docs/2026-05-24-promo-agent-plan.md` (this file). Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Matches your `feedback_orchestrator_pattern` for parallel work.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
