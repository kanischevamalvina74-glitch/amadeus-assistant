import type { Config } from "tailwindcss";

/**
 * Tailwind-маппинг дизайн-токенов (HUD).
 * Компоненты используют смысловые классы: bg-surface-2, text-muted, border-input.
 * Сырые hex в разметке не использовать.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: {
          DEFAULT: "var(--color-surface)",
          2: "var(--color-surface-2)",
          3: "var(--color-surface-3)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          input: "var(--color-border-input)",
        },
        text: {
          DEFAULT: "var(--color-text)",
          muted: "var(--color-text-muted)",
          faint: "var(--color-text-faint)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          strong: "var(--color-accent-strong)",
          dim: "var(--color-accent-dim)",
        },
        "on-accent": "var(--color-on-accent)",
        danger: {
          DEFAULT: "var(--color-danger)",
          strong: "var(--color-danger-strong)",
        },
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        "hud-grid": "var(--color-hud-grid)",
        "hud-ring": "var(--color-hud-ring)",
        "hud-amber": "var(--color-hud-amber)",
        focus: "var(--color-focus)",
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      fontSize: {
        xs: ["var(--text-xs-size)", { lineHeight: "var(--text-xs-line)", fontWeight: "var(--text-xs-weight)" }],
        sm: ["var(--text-sm-size)", { lineHeight: "var(--text-sm-line)", fontWeight: "var(--text-sm-weight)" }],
        base: ["var(--text-base-size)", { lineHeight: "var(--text-base-line)", fontWeight: "var(--text-base-weight)" }],
        lg: ["var(--text-lg-size)", { lineHeight: "var(--text-lg-line)", fontWeight: "var(--text-lg-weight)" }],
        xl: ["var(--text-xl-size)", { lineHeight: "var(--text-xl-line)", fontWeight: "var(--text-xl-weight)" }],
        "2xl": ["var(--text-2xl-size)", { lineHeight: "var(--text-2xl-line)", fontWeight: "var(--text-2xl-weight)" }],
        display: ["var(--text-display-size)", { lineHeight: "var(--text-display-line)", fontWeight: "var(--text-display-weight)" }],
      },
      letterSpacing: {
        label: "var(--tracking-label)",
        title: "var(--tracking-title)",
        tight: "var(--tracking-tight)",
      },
      spacing: {
        0: "var(--space-0)",
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        8: "var(--space-8)",
        10: "var(--space-10)",
        12: "var(--space-12)",
        16: "var(--space-16)",
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
        glow: "var(--shadow-glow)",
        "glow-amber": "var(--shadow-glow-amber)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
        hud: "var(--motion-hud)",
      },
      transitionTimingFunction: {
        app: "var(--ease)",
        hud: "var(--ease-hud)",
      },
      maxWidth: {
        content: "var(--layout-content-max)",
      },
      width: {
        rail: "var(--layout-rail)",
        sidebar: "var(--layout-sidebar)",
        panel: "var(--layout-panel)",
      },
      height: {
        header: "var(--layout-header)",
        status: "var(--layout-status)",
        hud: "var(--layout-hud)",
      },
      screens: {
        sm: "640px",
        md: "900px",
        lg: "1200px",
        xl: "1480px",
      },
    },
  },
  plugins: [],
};

export default config;
