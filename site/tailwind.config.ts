import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nv: {
          green: "#76b900",
          bg: "#0a0a0a",
          surface: "#111111",
          border: "#1f1f1f",
          text: "#fafafa",
          muted: "#9ca3af",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(ellipse at top, rgba(118,185,0,0.12) 0%, transparent 60%)",
      },
    },
  },
  plugins: [],
};

export default config;
