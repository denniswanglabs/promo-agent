"use client";
import { useEffect, useRef, useState } from "react";

type Brand = {
  slug: string;
  name: string;
  url: string;
  category: "dev-ai" | "outreach";
};

const BRANDS: Brand[] = [
  { slug: "stripe", name: "Stripe", url: "stripe.com", category: "dev-ai" },
  { slug: "linear", name: "Linear", url: "linear.app", category: "dev-ai" },
  { slug: "vercel", name: "Vercel", url: "vercel.com", category: "dev-ai" },
  {
    slug: "anthropic",
    name: "Anthropic",
    url: "anthropic.com",
    category: "dev-ai",
  },
  { slug: "openai", name: "OpenAI", url: "openai.com", category: "dev-ai" },
  { slug: "cursor", name: "Cursor", url: "cursor.com", category: "dev-ai" },
  {
    slug: "benchling",
    name: "Benchling",
    url: "benchling.com",
    category: "outreach",
  },
  {
    slug: "trayd",
    name: "Trayd",
    url: "buildtrayd.com",
    category: "outreach",
  },
  { slug: "kolr", name: "Kolr", url: "kolr.ai", category: "outreach" },
];

export function GalleryGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {BRANDS.map((b) => (
        <Tile key={b.slug} brand={b} />
      ))}
    </div>
  );
}

function Tile({ brand }: { brand: Brand }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (hovered) {
      v.play().catch(() => undefined);
      setHasPlayed(true);
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [hovered]);

  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-nv-border bg-nv-surface aspect-video cursor-pointer transition hover:border-nv-green/60"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        const v = ref.current;
        if (!v) return;
        v.currentTime = 0;
        v.play().catch(() => undefined);
        setHasPlayed(true);
      }}
    >
      <video
        ref={ref}
        src={`/gallery/${brand.slug}.mp4`}
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div
        className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent transition-opacity ${hovered ? "opacity-30" : "opacity-100"}`}
      />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div className="text-lg font-semibold">{brand.name}</div>
        <div className="text-xs font-mono text-nv-muted">{brand.url}</div>
      </div>
      {!hasPlayed && (
        <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/70 backdrop-blur text-[10px] font-mono uppercase tracking-wider text-nv-green border border-nv-green/30">
          <span className="w-1.5 h-1.5 rounded-full bg-nv-green" />
          hover to play
        </div>
      )}
    </div>
  );
}
