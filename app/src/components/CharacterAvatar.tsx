import { useId, type ButtonHTMLAttributes, type CSSProperties } from "react";
import type { HudState } from "./primitives";
import "./avatar.css";

const LABEL: Record<HudState, string> = {
  idle: "Готов",
  listening: "Слушаю",
  thinking: "Думаю",
  speaking: "Говорю",
  error: "Ошибка",
  muted: "Микрофон выключен",
};

export interface CharacterAvatarProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  state?: HudState;
  size?: number;
  dim?: boolean;
  wake?: boolean;
  tipAlign?: "center" | "left" | "right";
}

/**
 * Аватар-персонаж: оригинальная голова-андроид, не копия чужих моделей.
 * Состояния читаются по цвету, глазам, антенне и рту.
 */
export function CharacterAvatar({
  state = "idle",
  size = 72,
  dim = false,
  wake = false,
  tipAlign = "center",
  className = "",
  ...props
}: CharacterAvatarProps) {
  const gradId = useId();

  return (
    <button
      type="button"
      className={`mini avatar ${className}`}
      data-state={state}
      data-dim={dim || undefined}
      data-wake={wake || undefined}
      data-align={tipAlign}
      style={{ "--mini-size": `${size}px` } as CSSProperties}
      aria-label={`Amadeus: ${LABEL[state]}. Открыть окно`}
      {...props}
    >
      <svg viewBox="0 0 120 120" className="avatar__svg" aria-hidden="true">
        <defs>
          <radialGradient id={`${gradId}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="var(--mini-tone)" stopOpacity=".28" />
            <stop offset="100%" stopColor="var(--mini-tone)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle className="avatar__halo" cx="60" cy="58" r="38" fill={`url(#${gradId}-halo)`} />

        <g className="avatar__body">
          <path
            className="avatar__shoulders"
            d="M29 104 Q33 84 48 80 L72 80 Q87 84 91 104 Z"
          />
          <rect className="avatar__neck" x="54" y="72" width="12" height="10" rx="4" />
          <rect className="avatar__head" x="37" y="30" width="46" height="46" rx="17" />
          <rect className="avatar__visor" x="43" y="43" width="34" height="16" rx="8" />
          <g className="avatar__eyes">
            <circle cx="53.5" cy="51" r="2.4" />
            <circle cx="66.5" cy="51" r="2.4" />
          </g>
          <g className="avatar__mouth">
            <rect x="54" y="62" width="2" height="5" rx="1" />
            <rect x="59" y="60.5" width="2" height="8" rx="1" />
            <rect x="64" y="62" width="2" height="5" rx="1" />
          </g>
          <circle className="avatar__ear" cx="35" cy="52" r="4" />
          <circle className="avatar__ear" cx="85" cy="52" r="4" />
          <line className="avatar__antenna" x1="60" y1="30" x2="60" y2="22" />
          <circle className="avatar__antenna-dot" cx="60" cy="20" r="2.4" />
          <circle className="avatar__core" cx="60" cy="90" r="3.2" />
        </g>

        <g className="avatar__listen">
          <path d="M28 46 a42 42 0 0 0 0 26" />
          <path d="M92 46 a42 42 0 0 1 0 26" />
        </g>

        <g className="avatar__orbit">
          <circle cx="60" cy="16" r="1.8" />
          <circle cx="98" cy="60" r="1.4" />
          <circle cx="26" cy="70" r="1.2" />
        </g>

        <g className="avatar__muted">
          <line x1="40" y1="92" x2="80" y2="28" />
        </g>
      </svg>
      <span className="mini__alert" aria-hidden="true">
        !
      </span>
      <span className="mini__tip" aria-hidden="true">
        {LABEL[state]}
      </span>
    </button>
  );
}
