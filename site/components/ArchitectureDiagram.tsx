export function ArchitectureDiagram() {
  return (
    <div className="rounded-lg border border-nv-border bg-nv-surface p-8">
      <div className="text-xs uppercase tracking-wider text-nv-muted mb-6 font-mono">
        Architecture
      </div>
      <pre className="text-xs md:text-sm font-mono text-nv-text leading-relaxed overflow-x-auto whitespace-pre">
        {String.raw`
User (CLI or OpenClaw dashboard)
   │   "Make a promo for https://stripe.com"
   ▼
┌─────────────────────────────────────────────────────────┐
│  NemoClaw sandbox  (Docker, policy-gated)               │
│                                                         │
│   OpenClaw agent ── openclaw:core:exec                  │
│                         │                               │
│                         ▼                               │
│                    make_promo.sh                        │
│                         │                               │
│       ┌─────────────────┼─────────────────────┐         │
│       ▼                 ▼                     ▼         │
│  fetch_brand.py    Nemotron API       Remotion render   │
│   HTTPS GET        HTTPS POST          Chromium head-   │
│   brand domains    Nemotron 3 Super    less + ffmpeg    │
│                    120B (composition)                   │
│                                                         │
│   Output: /sandbox/out.mp4                              │
└─────────────────────────────────────────────────────────┘
            ▲
            │  policy.yaml  ── tools whitelist,
            │                  network allowlist,
            │                  binary scope
`}
      </pre>
    </div>
  );
}
