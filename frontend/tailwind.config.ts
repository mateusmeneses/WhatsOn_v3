import type { Config } from "tailwindcss";

/** Token de cor em variável CSS que também aceita modificador de opacidade (bg-primary/40). */
const token = (name: string): string => {
  const fn = ({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined || opacityValue === "1"
      ? `var(${name})`
      : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`;
  // O Tailwind aceita função aqui, mas o tipo do tema só declara string.
  return fn as unknown as string;
};

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: token("--color-primary"), soft: token("--color-primary-soft") },
        sidebar: token("--color-sidebar"),
        background: token("--color-background"),
        surface: token("--color-surface"),
        border: token("--color-border"),
        ink: { DEFAULT: token("--color-ink"), muted: token("--color-ink-muted") },
        success: token("--color-success"),
        warning: token("--color-warning"),
        danger: token("--color-danger"),
        // Cores do logo WhatsOn
        brand: { blue: "#0a6ad6", navy: "#0a3f9a", green: "#0e9f45", night: "#06142e" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      boxShadow: {
        card: "0 1px 2px rgba(15, 29, 54, 0.04), 0 1px 3px rgba(15, 29, 54, 0.06)",
        lift: "0 4px 14px -4px rgba(10, 63, 154, 0.18), 0 2px 4px rgba(15, 29, 54, 0.05)",
        pop: "0 12px 32px -8px rgba(6, 20, 46, 0.28), 0 2px 6px rgba(6, 20, 46, 0.08)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(14, 159, 69, 0.55)" },
          "70%": { boxShadow: "0 0 0 6px rgba(14, 159, 69, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(14, 159, 69, 0)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(40px, -30px) scale(1.08)" },
          "66%": { transform: "translate(-30px, 25px) scale(0.95)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-6px)" },
          "40%, 80%": { transform: "translateX(6px)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        float: "float 6s ease-in-out infinite",
        drift: "drift 18s ease-in-out infinite",
        shake: "shake 0.4s ease-in-out",
        "pulse-ring": "pulse-ring 2s ease-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
