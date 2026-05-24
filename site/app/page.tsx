import { GalleryGrid } from "@/components/GalleryGrid";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { PolicySection } from "@/components/PolicySection";
import { SizzleReel } from "@/components/SizzleReel";
import { MetaPromo } from "@/components/MetaPromo";

const GITHUB_URL = "https://github.com/denniswanglabs/promo-agent";

export default function Home() {
  return (
    <main className="min-h-screen bg-nv-bg text-nv-text">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-nv-border">
        <div className="grid-bg absolute inset-0 opacity-30 pointer-events-none" />
        <div className="bg-grid-fade absolute inset-0 pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-6 pt-24 pb-32">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-nv-border bg-nv-surface text-xs text-nv-muted font-mono mb-8">
            <span className="w-2 h-2 rounded-full bg-nv-green animate-pulse" />
            NVIDIA GTC Taipei 2026 Hackathon
          </div>
          <h1 className="text-6xl md:text-7xl font-bold leading-[1.05] tracking-tight">
            URL <span className="text-nv-muted">→</span> animated promo
            <br />
            in <span className="text-nv-green">90 seconds</span>.
          </h1>
          <p className="mt-8 text-xl text-nv-muted max-w-2xl leading-relaxed">
            Autonomous agent that researches a brand, composes a five-scene
            kinetic-typography promo, and renders it to MP4. Powered by{" "}
            <span className="text-nv-text font-medium">
              Nemotron 3 Super 120B
            </span>{" "}
            running inside{" "}
            <span className="text-nv-text font-medium">NemoClaw</span> with
            policy-based guardrails. No human in the loop after the URL.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href={GITHUB_URL}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-nv-green text-black font-semibold hover:bg-nv-green/90 transition"
            >
              View on GitHub
              <span aria-hidden>→</span>
            </a>
            <a
              href="#gallery"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-nv-border bg-nv-surface text-nv-text hover:bg-nv-border transition"
            >
              See sample renders
            </a>
          </div>

          {/* Stats strip */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-px bg-nv-border rounded-lg overflow-hidden">
            <Stat label="end-to-end" value="~90s" />
            <Stat label="cost/render" value="$0" />
            <Stat label="scenes" value="5" />
            <Stat label="LLM calls" value="1" />
          </div>
        </div>
      </section>

      {/* Meta-promo — the agent's promo of itself */}
      <section className="border-b border-nv-border">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <MetaPromo />
        </div>
      </section>

      {/* How it works */}
      <section className="border-b border-nv-border">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <h2 className="text-3xl md:text-4xl font-bold mb-12">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-px bg-nv-border rounded-lg overflow-hidden">
            <Step
              n="01"
              title="Research"
              body="fetch_brand.py extracts palette, fonts, hero copy, customer quotes from the URL."
            />
            <Step
              n="02"
              title="Compose"
              body="Nemotron 3 Super 120B returns a strict-JSON CompositionSpec — 5 scenes, palette, music vibe."
            />
            <Step
              n="03"
              title="Render"
              body="Remotion renders 900 frames of kinetic typography with BGM. MP4 produced in the sandbox."
            />
          </div>
          <div className="mt-16">
            <ArchitectureDiagram />
          </div>
        </div>
      </section>

      {/* Sizzle reel */}
      <section className="border-b border-nv-border">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <SizzleReel />
        </div>
      </section>

      {/* Gallery */}
      <section id="gallery" className="border-b border-nv-border">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="flex items-baseline justify-between mb-12 gap-6 flex-wrap">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold">
                Real brands. One agent.
              </h2>
              <p className="mt-3 text-nv-muted max-w-xl">
                Every video below was generated end-to-end by the agent —
                fetched, composed, and rendered without human input. Click any
                tile to play.
              </p>
            </div>
            <span className="text-xs font-mono text-nv-muted">
              30s · 1920×1080 · 30fps
            </span>
          </div>
          <GalleryGrid />
        </div>
      </section>

      {/* Policy story */}
      <section className="border-b border-nv-border">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <PolicySection />
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-12 text-sm text-nv-muted flex flex-wrap items-center justify-between gap-4">
        <span>
          Built solo by{" "}
          <a
            href="https://github.com/denniswanglabs"
            className="text-nv-text hover:text-nv-green transition"
          >
            Dennis Wang
          </a>{" "}
          for Luceo Studio. Submitted to NVIDIA GTC Taipei 2026 Hackathon.
        </span>
        <a
          href={GITHUB_URL}
          className="font-mono hover:text-nv-green transition"
        >
          github.com/denniswanglabs/promo-agent
        </a>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-nv-surface px-6 py-5">
      <div className="text-3xl font-bold text-nv-green">{value}</div>
      <div className="text-xs uppercase tracking-wider text-nv-muted mt-1">
        {label}
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-nv-surface p-8">
      <div className="text-xs font-mono text-nv-green mb-3">{n}</div>
      <div className="text-xl font-semibold mb-2">{title}</div>
      <p className="text-sm text-nv-muted leading-relaxed">{body}</p>
    </div>
  );
}
