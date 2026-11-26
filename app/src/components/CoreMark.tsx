import { useEffect, useState } from "react";
import type { HudState } from "./primitives";
import "./core-mark.css";

/**
 * Живой логотип Amadeus: белое ядро и две орбиты (бирюзовая и латунная).
 * Состояние меняет движение орбит, громкость голоса (0..1) раздувает ядро.
 */
type Props = {
  state?: HudState;
  size?: number;
  level?: number;
  className?: string;
};

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** Пользователь просит меньше движения: ядро не раздувается от голоса. */
function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(REDUCE_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.(REDUCE_QUERY);
    if (!query) return;
    const update = () => setReduce(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduce;
}

export function CoreMark({ state = "idle", size = 150, level = 0, className = "" }: Props) {
  const reduceMotion = useReducedMotion();
  const voice = reduceMotion ? 0 : Math.max(0, Math.min(1, level));
  const coreScale = 1 + voice * 0.7;
  return (
    <svg
      className={`core-mark core-mark--${state} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      data-state={state}
    >
      <defs>
        <radialGradient id="core-mark-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="core-mark__glow" cx="16" cy="16" r="9" fill="url(#core-mark-glow)" />
      <g className="core-mark__orbit core-mark__orbit--a">
        <ellipse cx="16" cy="16" rx="13" ry="6" transform="rotate(-30 16 16)" />
      </g>
      <g className="core-mark__orbit core-mark__orbit--b">
        <ellipse cx="16" cy="16" rx="13" ry="6" transform="rotate(30 16 16)" />
      </g>
      <circle className="core-mark__core" cx="16" cy="16" r="3" style={{ transform: `scale(${coreScale})` }} />
    </svg>
  );
}
