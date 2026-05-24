"use client";
import { useRef, useState } from "react";

export function MetaPromo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  return (
    <div className="rounded-2xl border border-nv-green/40 bg-gradient-to-b from-nv-green/[0.06] to-transparent overflow-hidden">
      <div className="grid md:grid-cols-[5fr_4fr]">
        <div
          className="relative aspect-video bg-black cursor-pointer group order-2 md:order-1"
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            if (v.paused) {
              v.play().catch(() => undefined);
              setPlaying(true);
            } else {
              v.pause();
              setPlaying(false);
            }
          }}
        >
          <video
            ref={ref}
            src="/meta.mp4"
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover"
            onEnded={() => setPlaying(false)}
          />
          {!playing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 transition group-hover:bg-black/35">
              <div className="w-24 h-24 rounded-full bg-nv-green flex items-center justify-center shadow-2xl shadow-nv-green/40">
                <svg
                  viewBox="0 0 24 24"
                  fill="black"
                  className="w-10 h-10 ml-1"
                  aria-hidden
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          )}
        </div>
        <div className="p-8 md:p-10 flex flex-col justify-center gap-5 order-1 md:order-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-nv-green/40 bg-nv-green/10 text-xs text-nv-green font-mono w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-nv-green animate-pulse" />
            very meta
          </div>
          <h2 className="text-3xl md:text-4xl font-bold leading-tight">
            This page?
            <br />
            <span className="text-nv-green">The agent made it.</span>
          </h2>
          <p className="text-nv-muted leading-relaxed">
            We pointed the agent at{" "}
            <code className="text-nv-text font-mono text-sm bg-black/50 px-1.5 py-0.5 rounded">
              promo-agent-kappa.vercel.app
            </code>{" "}
            — the page you&apos;re reading right now — and it produced this
            promo of itself. Same pipeline as every other render: research →
            compose → animate → MP4. No special case.
          </p>
        </div>
      </div>
    </div>
  );
}
