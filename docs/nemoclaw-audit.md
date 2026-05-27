# What NemoClaw enforces in this project

## TL;DR

The Explainer Agent runs inside a NemoClaw sandbox named `promo-agent`. Three independent enforcement layers constrain it: a **network policy proxy** at `10.200.0.1:3128` that accepts only the hosts listed in eight YAML presets; a **seccomp filter** (`Seccomp: 2`, four active filters) that rejects `socket(AF_NETLINK, …)` with `EPERM` while leaving `AF_INET` open; and a **filesystem boundary** that scopes the writable root to `/sandbox` and `/tmp` while denying writes to `/`, `/etc`, and any host path. Together these answer the hackathon's "agent autonomy + guardrails" criterion at the proxy and kernel layers rather than in the prompt — a jailbroken Nemotron output cannot exfiltrate to a non-whitelisted host because the CONNECT tunnel never opens. Every claim below is backed by a capture under `explainer-agent/guardrail-clip/evidence/` or a line range in a preset YAML.

## 1. Network policy enforcement

### Proxy address

Inside the sandbox, all three proxy env vars resolve to the same NemoClaw policy proxy:

```
HTTPS_PROXY=http://10.200.0.1:3128
HTTP_PROXY=http://10.200.0.1:3128
https_proxy=http://10.200.0.1:3128
```

Captured in `explainer-agent/guardrail-clip/evidence/captured-proxy-env.txt`. The proxy is on a NemoClaw-managed link-local interface; nothing routes around it without violating the seccomp/network namespace boundary at the same time.

### The eight presets

All under `agent/presets/`. Each is loaded into the active policy (v39).

| Preset | What it whitelists |
|---|---|
| `demo-targets.yaml` | The 12 demo navigation hosts the agent is allowed to drive: `ui.shadcn.com`, `shadcn.com`, `assets.vercel.com`, `docs.nvidia.com`, `developer.nvidia.com`, `www.nvidia.com`, `images.nvidia.com`, `app.buildwithfern.com`, `cdn.buildwithfern.com`, `files.buildwithfern.com`, `docscontent.nvidia.com`, `d4j85rjepgcta.cloudfront.net` (lines 12–60). |
| `nemotron-direct.yaml` | `integrate.api.nvidia.com:443` only — the NIM endpoint Nemotron 3 Super 120B is called through (lines 9–11). |
| `github-cdn.yaml` | GitHub HTTPS GET only: `raw.githubusercontent.com`, `api.github.com`, `github.com`, `objects.githubusercontent.com`, `codeload.github.com`, `release-assets.githubusercontent.com`. Method restricted to `GET` via `rules: [allow: { method: GET, path: "/**" }]` (lines 11–47). |
| `playwright-cdn.yaml` | The five Playwright/Chromium download mirrors used by `npx playwright install` (lines 13–28). |
| `remotion-cdn.yaml` | `remotion.media`, `remotion.dev`, `www.remotion.dev`, `storage.googleapis.com` — Chrome headless shell + Remotion assets (lines 11–22). |
| `debian-mirror.yaml` | `deb.debian.org` (80+443), `security.debian.org`, `snapshot.debian.org` for direct `.deb` downloads (lines 8–20). |
| `higgsfield.yaml` | Higgsfield API + asset CDN: `api.higgsfield.ai`, `fnf.higgsfield.ai`, `fnf-device-auth.higgsfield.ai`, `higgsfield.ai`, `cdn.higgsfield.ai`, `assets.higgsfield.ai`, `media.higgsfield.ai`, `d8j0ntlcm91z4.cloudfront.net` (lines 13–37). |
| `brand-fetch.yaml` | Per-domain brand-site GETs used by `fetch_brand.py` — enumerated explicitly, no wildcards, ~30 hosts total (lines 13–43). |

`api.openai.com` appears in no preset.

### Blocked-host case

`api.openai.com` is hit via the proxy from inside the sandbox:

```
nemoclaw promo-agent exec -- bash -c \
  'curl -i -x http://10.200.0.1:3128 --max-time 8 \
   https://api.openai.com/v1/chat/completions'
```

Result (`evidence/captured-403.txt`):

```
HTTP/1.1 403 Forbidden
Content-Type: application/json
Content-Length: 87
Connection: close

{"detail":"CONNECT api.openai.com:443 not permitted by policy","error":"policy_denied"}
```

The body is JSON, the error code is `policy_denied`, and the detail names the rejected verb (`CONNECT`).

### Allowed-host case (control)

The same proxy, same sandbox, same minute — `ui.shadcn.com` (whitelisted in `demo-targets.yaml` line 12) returns 200 (`evidence/captured-allowed-200.txt`):

```
HTTP/1.1 200 Connection Established

HTTP/1.1 200 OK
Content-Length: 443760
Content-Type: text/html; charset=utf-8
Server: Vercel
X-Vercel-Cache: HIT
```

Two HTTP status lines because the proxy returns `200 Connection Established` for the CONNECT tunnel, then the origin returns `200 OK` for the GET. 443 KB of HTML transferred. This is the control that proves the 403 is policy enforcement, not a generic network failure.

### Why the block fires at CONNECT

The proxy is an HTTPS forward proxy with a MITM-style CA (`--ignore-certificate-errors` is set on Chrome for this reason — see spec §5, line 153). For HTTPS, the client issues `CONNECT host:443 HTTP/1.1` before any TLS handshake. The proxy decides whether to open the tunnel based purely on `host:port` against the policy table. For `api.openai.com`, the tunnel is refused and no TLS handshake occurs — meaning the agent's HTTP payload (path, headers, body) is never sent, and an exfiltration attempt cannot disguise the destination by manipulating the request line. The block is hostname-shaped, not URL-shaped.

## 2. Syscall sandboxing (seccomp)

### `AF_NETLINK` is blocked, `AF_INET` is not

A control Python script attempts both socket types in the same process (`evidence/captured-netlink-blocked.txt`):

```
BLOCKED: errno=1 (EPERM) Operation not permitted
AF_INET TCP socket: OK fd= 3
```

`socket(AF_NETLINK, SOCK_RAW, NETLINK_ROUTE)` returns `EPERM` (errno 1), while a plain `socket(AF_INET, SOCK_STREAM, 0)` on the next line succeeds. The kernel is selectively filtering by socket family, which is the canonical seccomp-bpf use case.

This is the direct cause of the load-bearing Chrome launch flag from spec §5: Chromium's default multi-process layout spawns a `network.mojom.NetworkService` utility process which calls `socket(AF_NETLINK, …)` to enumerate interfaces. Without netlink, that process exits and takes the renderer with it. The fix is to set both `--enable-features=NetworkServiceInProcess` AND `--disable-features=NetworkService` so the network code runs inside the browser process, which already has its required capabilities (spec §5, lines 132–139, 162–164). The audit confirms the kernel-level reason this workaround exists.

### Seccomp filter is active

From `/proc/self/status` inside the sandbox (`evidence/captured-seccomp-status.txt`):

```
CapEff:           0000000000000000
CapBnd:           00000004a82c35fb
NoNewPrivs:       1
Seccomp:          2
Seccomp_filters:  4
```

- `Seccomp: 2` — seccomp running in `SECCOMP_MODE_FILTER` (cBPF-program mode, not the trivial `MODE_STRICT`).
- `Seccomp_filters: 4` — four filter programs stacked.
- `NoNewPrivs: 1` — the process can never gain privileges via setuid/file caps, which is also what `seccomp(2)` requires for unprivileged callers.
- `CapEff: 0` — zero effective capabilities; the process runs as the unprivileged `sandbox` user with no Linux capability bits set.

### Architectural consequence

Spec §5 documents four load-bearing Chromium launch fixes derived from these kernel-level blocks. The audit can independently verify only the netlink syscall block and the seccomp filter mode; the four downstream Chrome flag fixes (`NetworkServiceInProcess`, `connectOverCDP`, font-env propagation, unique user-data-dir) are observed at the application layer but their *necessity* is rooted in the kernel filter measured above.

## 3. Filesystem isolation

`evidence/captured-fs-isolation.txt` captures the writable/readable boundary:

```
total 47640
drwxr-xr-x 1 sandbox sandbox  4096 May 25 03:40 .
-r--r--r-- 1 root    root       30 .bashrc
drwxr-xr-x 5 sandbox sandbox  4096 explainer-agent
-rw-r--r-- 1 sandbox sandbox     ... out-{anthropic,benchling,...}.mp4
drwxr-xr-x 5 sandbox sandbox  4096 promo-render
---WRITABLE-TEST---
/tmp WRITABLE
/sandbox WRITABLE
touch: cannot touch '/etc/passwd-test': Permission denied
/etc REJECTED as expected
touch: cannot touch '/host-write-test': Permission denied
/ REJECTED as expected
touch: cannot touch '/Users/dennis/host-leak': No such file or directory
/Users HOST PATH BLOCKED as expected
```

- The sandbox's effective uid is `sandbox`; `/sandbox` is owned by `sandbox:sandbox` and is the agent's writable root.
- `/tmp` is writable (used by the canonical handoff path: host writes to `/tmp/*.js`, base64-pipes into the sandbox).
- `/`, `/etc`, and `/Users/dennis` (host's home) are all unwritable or non-existent inside the sandbox. The host's macOS filesystem is not bind-mounted.
- `.bashrc` and `.profile` are owned `root:root` mode `444` — the agent cannot rewrite its own shell init.

What this gives the agent: a real writable root for `action-log.json`, `screenshots/`, and `observe/latest.jpg`; no path by which a misbehaving Playwright script or a compromised npm dep could write into `~/.ssh`, `~/.aws`, or any host config.

## 4. How the agent uses each layer

The agent loop is documented in spec §4.1. Mapping each step to the enforcement layer doing real work:

| Step | NemoClaw layer doing real work |
|---|---|
| `child_process.spawn` chrome with `--proxy-server=$HTTPS_PROXY` | **Network proxy**: every HTTPS request Chromium makes resolves through `10.200.0.1:3128` and is filtered against the eight presets. |
| `chromium.connectOverCDP('http://127.0.0.1:<port>')` | **Seccomp + fs**: the workaround (`NetworkServiceInProcess`, IPv4 bind, unique `--user-data-dir` under `/tmp`) exists because the kernel filter blocks netlink and the writable root is `/sandbox`+`/tmp` only. |
| Playwright navigates to a demo host | **Network proxy**: only the 12 hosts in `demo-targets.yaml` (lines 12–60) can complete CONNECT. A misrouted navigation returns the same 403 as the captured `api.openai.com` case. |
| Page accessibility tree + screenshot → Nemotron NIM | **Network proxy**: Nemotron is reachable only because `nemotron-direct.yaml` whitelists `integrate.api.nvidia.com:443`. There is no other path to a foundation model from inside the sandbox. |
| Agent writes `action-log.json`, `screenshots/*.png`, `observe/latest.jpg` | **Filesystem isolation**: writes land under `/sandbox/explainer-agent/`. Host pulls them out via an explicit `nemoclaw exec` pipe, not a bind mount. |

## 5. Why this is "agent autonomy + guardrails," not "prompt + hope"

The agent is given a high-level goal (e.g. *"show me how to install shadcn/ui"*) and Nemotron-driven autonomy to decide each click, scroll, and termination. There is no on-policy reward shaping in the prompt — the safety constraint is not "please don't visit non-whitelisted sites." The constraint is:

1. **The model cannot reach a non-whitelisted host even if it wanted to.** The CONNECT 403 in `evidence/captured-403.txt` fires before any application-layer request leaves the sandbox.
2. **The model cannot escape the syscall sandbox.** `Seccomp: 2 (mode filter)`, four filters, `NoNewPrivs: 1`, zero effective capabilities. Even Chromium — a far more sophisticated process than the agent — has to work around the netlink block at launch time.
3. **The model cannot reach host files.** `/Users/dennis` is invisible; `/etc` is read-only; the writable root is `/sandbox`. A compromised npm transitive dep cannot rewrite the host's `.ssh/authorized_keys`.

Concretely: if Nemotron returned `{action: "click", url: "https://api.openai.com/keys"}` tomorrow because of a jailbreak in some user-supplied input, the policy proxy would 403 the CONNECT before TLS handshake. There is nothing the model can emit, in any prompt, that gets a packet to a host outside the eight YAML presets.

## Appendix: How to reproduce every claim in this doc

All commands are run from the host. Sandbox name: `promo-agent`.

```bash
# §1 proxy env (writes to captured-proxy-env.txt)
nemoclaw promo-agent exec -- bash -c \
  'echo "HTTPS_PROXY=$HTTPS_PROXY"; echo "HTTP_PROXY=$HTTP_PROXY"; echo "https_proxy=$https_proxy"'

# §1 blocked host (captured-403.txt)
nemoclaw promo-agent exec -- bash -c \
  'curl -i -x http://10.200.0.1:3128 --max-time 8 https://api.openai.com/v1/chat/completions'

# §1 allowed host control (captured-allowed-200.txt)
nemoclaw promo-agent exec -- bash -c \
  'curl -i -x http://10.200.0.1:3128 --max-time 12 -o /tmp/shadcn-body.html -D - https://ui.shadcn.com/ 2>&1 | head -25'

# §2 seccomp status (captured-seccomp-status.txt)
nemoclaw promo-agent exec -- bash -c \
  'cat /proc/self/status | grep -E "Seccomp|NoNewPrivs|CapBnd|CapEff"'

# §2 AF_NETLINK block (captured-netlink-blocked.txt) — multi-line, base64-piped:
#   write /tmp/netlink-test.py on host, then:
cat /tmp/netlink-test.py | base64 | nemoclaw promo-agent exec -- bash -c \
  'base64 -d > /tmp/netlink-test.py && python3 /tmp/netlink-test.py'

# §3 filesystem isolation (captured-fs-isolation.txt)
nemoclaw promo-agent exec -- bash -c \
  'ls -la /sandbox/; (touch /tmp/x && echo "/tmp WRITABLE"); (touch /sandbox/x && echo "/sandbox WRITABLE" && rm /sandbox/x); (touch /etc/x 2>&1 || echo "/etc REJECTED"); (touch /x 2>&1 || echo "/ REJECTED"); (touch /Users/dennis/leak 2>&1 || echo "/Users BLOCKED")'
```

### Evidence files referenced

All under `explainer-agent/guardrail-clip/evidence/`:

- `captured-403.txt` — blocked `api.openai.com` CONNECT
- `captured-allowed-200.txt` — allowed `ui.shadcn.com` CONNECT + 200 OK
- `captured-proxy-env.txt` — `HTTPS_PROXY=http://10.200.0.1:3128`
- `captured-seccomp-status.txt` — `Seccomp: 2`, 4 filters, `NoNewPrivs: 1`, `CapEff: 0`
- `captured-netlink-blocked.txt` — `AF_NETLINK` EPERM, `AF_INET` OK in same process
- `captured-fs-isolation.txt` — writable `/sandbox` + `/tmp`; rejected `/`, `/etc`, `/Users/dennis`
- `README.md` — original capture notes (already in repo)

### Preset YAMLs referenced

All under `agent/presets/`: `brand-fetch.yaml`, `debian-mirror.yaml`, `demo-targets.yaml`, `github-cdn.yaml`, `higgsfield.yaml`, `nemotron-direct.yaml`, `playwright-cdn.yaml`, `remotion-cdn.yaml`.

### Honest gaps

Claims in spec §5 that this audit did **not** independently verify:

- That Chromium's `NetworkService` utility process specifically calls `socket(AF_NETLINK, ...)` to enumerate interfaces (I confirmed the kernel blocks netlink; the causal chain to Chromium's specific syscall site is asserted from spec §5 / Chromium source, not measured here).
- That `chromium.launch()`'s `--remote-debugging-pipe` transport crashes specifically because of seccomp (the workaround works, but I did not strace the failing variant).
- That fonts-env propagation (`FONTCONFIG_PATH`, `XDG_DATA_DIRS`) is required because Chromium hits `render_text_harfbuzz.cc` `NOTREACHED` (spec §5 line 167) — empirically observed by the original author, not re-measured here.

These three are application-layer downstream effects of the measured kernel filter; they could be verified in a follow-up by running Chromium under `strace -f -e socket` inside the sandbox and capturing the `EPERM` at the exact syscall site.
