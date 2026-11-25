import { useEffect, useRef } from "react";
import type { HudState } from "./primitives";

/**
 * Сфера из светящихся точек (сфера Фибоначчи), вращается и «дышит» по состоянию ядра.
 * Рисуется на canvas: ~1400 точек на большом размере, ~240 — в шапке.
 */

type Props = {
  state?: HudState;
  size?: number;
  /** Количество точек; по умолчанию зависит от размера. */
  points?: number;
  className?: string;
  label?: string;
};

const TONE_VAR: Record<string, string> = {
  idle: "--color-accent",
  listening: "--color-accent",
  thinking: "--color-brass",
  speaking: "--color-brass-bright",
  error: "--color-danger",
  muted: "--color-text-faint",
};

function parseColor(value: string): [number, number, number] {
  const v = value.trim();
  if (v.startsWith("#")) {
    const hex = v.length === 4 ? v.slice(1).split("").map((c) => c + c).join("") : v.slice(1, 7);
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = v.match(/(\d+(?:\.\d+)?)[^\d]+(\d+(?:\.\d+)?)[^\d]+(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [79, 216, 240];
}

export function ParticleSphere({ state = "idle", size = 248, points, className = "", label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = points ?? Math.round(Math.min(2400, Math.max(160, size * 6)));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const base: Array<[number, number, number]> = [];
    for (let i = 0; i < count; i += 1) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      base.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
    }

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const small = size < 64;
    let raf = 0;
    let last = performance.now();
    let angle = 0;
    let energy = 0;
    let tone: [number, number, number] = [79, 216, 240];
    let toneState = "";
    let light = false;

    const readTone = () => {
      const s = stateRef.current;
      const styles = getComputedStyle(canvas);
      light = document.documentElement.getAttribute("data-theme") === "light";
      tone = parseColor(styles.getPropertyValue(TONE_VAR[s] ?? "--color-accent") || "#4FD8F0");
      toneState = s;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      if (s !== toneState) readTone();

      const spin = s === "thinking" ? 1.6 : s === "speaking" ? 0.7 : s === "listening" ? 0.5 : s === "error" ? 0.05 : 0.22;
      const targetEnergy = s === "speaking" ? 1 : s === "thinking" ? 0.55 : s === "listening" ? 0.35 : 0.12;
      energy += (targetEnergy - energy) * Math.min(1, dt * 3);
      angle += (reduce ? 0 : spin) * dt;
      const t = now / 1000;

      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const R = size * (small ? 0.4 : 0.36);
      const tilt = 0.38;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const breath = reduce ? 0 : Math.sin(t * (s === "listening" ? 3.2 : 1.4)) * 0.025 * (0.6 + energy);
      const dot = small ? 0.7 : Math.max(0.75, size / 300);

      // мягкое свечение в центре
      if (!light) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
        g.addColorStop(0, `rgba(${tone[0]},${tone[1]},${tone[2]},${0.16 + energy * 0.12})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
      ctx.globalCompositeOperation = light ? "source-over" : "lighter";

      for (let i = 0; i < base.length; i += 1) {
        const [bx, by, bz] = base[i];
        let wobble = breath;
        if (!reduce && energy > 0.2) {
          wobble += Math.sin(by * 5 + t * 7) * Math.sin(bx * 4 - t * 5.3) * 0.07 * (energy - 0.2);
        }
        const k = 1 + wobble;
        // поворот вокруг Y, затем наклон вокруг X
        const x1 = bx * ca + bz * sa;
        const z1 = -bx * sa + bz * ca;
        const y2 = by * ct - z1 * st;
        const z2 = by * st + z1 * ct;
        const persp = 2.8 / (2.8 - z2 * k);
        const px = cx + x1 * k * R * persp;
        const py = cy + y2 * k * R * persp;
        const depth = (z2 + 1) / 2; // 0 — дальняя сторона, 1 — ближняя
        const alpha = light ? 0.18 + depth * 0.75 : 0.1 + depth * 0.9;
        const rad = dot * (0.55 + depth * 0.9);
        const w = depth * depth * (light ? 0 : 0.55);
        const r = Math.round(tone[0] + (255 - tone[0]) * w);
        const gg = Math.round(tone[1] + (255 - tone[1]) * w);
        const b = Math.round(tone[2] + (255 - tone[2]) * w);
        ctx.fillStyle = `rgba(${r},${gg},${b},${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      if (!document.hidden) raf = requestAnimationFrame(frame);
    };

    readTone();
    raf = requestAnimationFrame(frame);
    const onVisible = () => {
      if (!document.hidden) {
        last = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    };
    const themeObserver = new MutationObserver(() => readTone());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [size, points]);

  return (
    <canvas
      ref={canvasRef}
      className={`particle-sphere ${className}`}
      data-state={state}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
