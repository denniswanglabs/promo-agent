# Hackathon Submission — Drafts

Filled in once GitHub repo URL + YouTube URL are finalized.

---

## 團隊名稱 / Team Name
**Luceo Studio**

(Solo submission; Luceo Studio is Dennis's existing video studio brand. See [luceo-site.vercel.app](https://luceo-site.vercel.app).)

---

## 專案名稱 / Project Name
**Promo Agent**

---

## 專案描述 / Project Description

An autonomous agent that turns a company URL into a finished animated promo video in about 90 seconds. Powered by **Nemotron 3 Super 120B** running inside **NemoClaw**, the agent researches the brand, composes a five-scene `CompositionSpec`, and renders kinetic typography via Remotion — no human in the loop after the URL.

A declarative policy file (`agent/policy.yaml`) enforces tool scope, network allowlist, and resource caps via NemoClaw's policy engine. When the build first tried to reach Higgsfield's CDN, the sandbox proxy returned 403 until the host was added to the policy — proof the guardrails are runtime-enforced, not decorative.

---

## GitHub 儲存庫連結 / GitHub Repo

`https://github.com/denniswanglabs/promo-agent`

---

## Demo 影片連結 / Link to your Demo Video

`<filled in after upload — Luceo Studio YouTube, unlisted>`

---

## 請列出團隊成員的姓名與電子信箱

Dennis Wang — denniswanglabs@gmail.com (solo)

---

## 使用技術與工具 / Tools Used

- **Nemotron 3 Super 120B** (`nvidia/nemotron-3-super-120b-a12b`) via NVIDIA NIM at `build.nvidia.com` — composition planning + creative reasoning
- **NemoClaw v0.0.50** — secured agent runtime (the ⭐ bonus-criterion stack)
- **OpenClaw v2026.5.18** — agent framework running inside the NemoClaw sandbox
- **Remotion 4.x** — programmatic React-based video rendering
- **Chrome headless shell** (bundled with `@remotion/renderer`)
- **ffmpeg-static** — render encoding
- **Node 22.22**, **Python 3.13**, **jq**, **curl**
- **Docker Desktop** (Apple Silicon) — sandbox host
- **Chrome MCP** — used during development for autonomous-loop testing
- **GitHub** — public repo hosting

---

## 請說明專案中使用的任何 NVIDIA AI 生態系統資源

- **Nemotron 3 Super 120B** via the NVIDIA NIM endpoint at `https://integrate.api.nvidia.com/v1/chat/completions`. The model is the composition planner — given fetched brand data, it produces a strict JSON `CompositionSpec` that drives the entire downstream render. We use it at temperature 0.4 with a focused system prompt that grounds copy in fetched text and bans marketing fluff.
- **NemoClaw v0.0.50** — runs the agent inside an isolated OpenShell sandbox with policy enforcement, custom network presets, and skill installation. Provides the inference proxy that securely brokers Nemotron calls.
- **OpenClaw v2026.5.18** — the agent framework that runs inside NemoClaw. Loaded our `promo` skill (`agent/skills/promo/SKILL.md`) which directs the agent to call `openclaw:core:exec` exactly once per task.

---

## 您是否在專案中使用了 NemoClaw？

**Yes.**

---

## NemoClaw 使用體驗 / NemoClaw experience

NemoClaw was the secured runtime for the entire agent. Our experience:

**What worked:**
- The policy preset system (`nemoclaw promo-agent policy-add --from-file`) was the cleanest part. We shipped **6 custom presets** under `agent/presets/` — one each for Higgsfield, GitHub CDN, Remotion CDN, Debian package mirror, brand-site fetching, and direct NVIDIA Nemotron access. Each is a small, auditable YAML.
- Network policy enforcement is real. When `make_promo.sh` tried to curl `d8j0ntlcm91z4.cloudfront.net` for Higgsfield assets, the proxy returned **403 Forbidden** until we added the host to the policy. That's the bonus criterion working as advertised — not theoretical, runtime-enforced.
- `nemoclaw promo-agent skill install <dir>` made it easy to deploy SKILL.md + helper scripts into the sandbox. We shipped 3 skills (`promo`, `promo-research`, `render-promo`) using this flow.

**What we worked around:**
- The sandbox is locked down for the `sandbox` user (no sudo, no apt-install). Running Remotion's headless Chrome inside the sandbox needs `libnspr4.so` + `libnss3.so` which aren't in the base image. We solved this by **direct-downloading the .deb files from `deb.debian.org`**, extracting with `dpkg-deb -x` to a user-writable dir, and setting `LD_LIBRARY_PATH` before `npx remotion render`. The Debian mirror is whitelisted by our `debian-mirror.yaml` preset.
- Custom binary-path enforcement (`binaries: { path: <specific> }`) silently fails for spawned subprocesses. We learned to use `binaries: - { path: "/**" }` in all custom presets. Network-layer enforcement on the destination host is the real safety net.
- `nemoclaw exec` rejects multi-line shell args. All our scripts use single-line patterns or external files.

Overall NemoClaw was the right level of abstraction for the hackathon. The policy file is the most useful artifact — it makes the agent's surface area auditable in a way that ad-hoc Python guards couldn't match.
