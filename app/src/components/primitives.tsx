import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

/* Button ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className = "", children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`btn btn--${variant} btn--${size} ${loading ? "btn--loading" : ""} ${className}`}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {children}
    </button>
  );
});

/* IconButton -------------------------------------------------------------- */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "surface" | "danger";
  pressed?: boolean;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", variant = "ghost", pressed, className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={`icon-btn icon-btn--${size} icon-btn--${variant} ${className}`}
      {...props}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
});

/* Input / Textarea -------------------------------------------------------- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  inputSize?: "sm" | "md" | "lg";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, inputSize = "md", className = "", id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`input input--${inputSize} ${error ? "input--error" : ""} ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error && (
        <span className="field__error" id={`${inputId}-error`} role="alert">
          {error}
        </span>
      )}
      {!error && hint && (
        <span className="field__hint" id={`${inputId}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
});

/* Select ------------------------------------------------------------------ */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, options, className = "", id, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select ref={ref} id={selectId} className={`select ${className}`} aria-describedby={hint ? `${selectId}-hint` : undefined} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <span className="field__hint" id={`${selectId}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
});

/* Checkbox / Switch / Slider --------------------------------------------- */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className = "", ...props },
  ref,
) {
  return (
    <label className={`check ${className}`}>
      <input ref={ref} type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
});

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, className = "", ...props },
  ref,
) {
  return (
    <label className={`switch ${className}`}>
      <input ref={ref} type="checkbox" role="switch" {...props} />
      <span className="switch__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
});

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  valueText?: string;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { label, valueText, className = "", ...props },
  ref,
) {
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}</span>
      <input ref={ref} type="range" className="slider" aria-valuetext={valueText} {...props} />
    </label>
  );
});

/* Badge / Card ------------------------------------------------------------ */

export type BadgeVariant = "neutral" | "accent" | "success" | "danger" | "warning" | "pro";

export function Badge({ variant = "neutral", children }: { variant?: BadgeVariant; children: ReactNode }) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  title?: string;
}

export function Card({ interactive = false, title, className = "", children, ...props }: CardProps) {
  return (
    <div className={`card ${interactive ? "card--interactive" : ""} ${className}`} {...props}>
      {title && <h3 className="card__title">{title}</h3>}
      {children}
    </div>
  );
}

/* Modal ------------------------------------------------------------------- */

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "color-mix(in srgb, var(--color-bg) 72%, transparent)",
        backdropFilter: "blur(6px)",
        zIndex: 50,
      }}
    >
      <div className="modal-demo" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="modal-demo__title" id={titleId}>
          {title}
        </h2>
        {children}
        {footer && <div className="modal-demo__actions">{footer}</div>}
      </div>
    </div>
  );
}

/* Toast ------------------------------------------------------------------- */

export type ToastTone = "info" | "success" | "warning" | "danger";

export function Toast({ tone = "info", children }: { tone?: ToastTone; children: ReactNode }) {
  return (
    <div className={`toast ${tone === "danger" ? "toast--danger" : ""}`} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/* Tabs -------------------------------------------------------------------- */

export interface TabItem {
  id: string;
  label: string;
}

export function Tabs({ items, active, onChange }: { items: TabItem[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={item.id === active}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* Accordion --------------------------------------------------------------- */

export function Accordion({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="accordion">
      <button type="button" className="accordion__head" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((value) => !value)}>
        <span>{title}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="accordion__body" id={`${id}-body`} role="region">
          {children}
        </div>
      )}
    </div>
  );
}

/* SettingsRow ------------------------------------------------------------- */

export function SettingsRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row__title">{title}</div>
        {description && <div className="settings-row__desc">{description}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/* Message / Chip ---------------------------------------------------------- */

export function MessageBubble({ role, children, meta }: { role: "user" | "assistant"; children: ReactNode; meta?: string }) {
  return (
    <div className={`msg msg--${role}`}>
      {children}
      {meta && <div className="msg__meta">{meta}</div>}
    </div>
  );
}

export function AttachmentChip({ name, kind = "file", onRemove }: { name: string; kind?: "file" | "image" | "screenshot" | "audio"; onRemove?: () => void }) {
  return (
    <span className="chip">
      <span aria-hidden="true">{kind === "image" ? "▧" : kind === "audio" ? "◉" : "▤"}</span>
      <span className="chip__name">{name}</span>
      {onRemove && (
        <button type="button" className="icon-btn icon-btn--sm" aria-label={`Удалить ${name}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

/* HUD / Metric ------------------------------------------------------------ */

export type HudState = "idle" | "listening" | "thinking" | "speaking" | "error" | "muted";

const HUD_LABEL: Record<HudState, string> = {
  idle: "Готов",
  listening: "Слушаю",
  thinking: "Думаю",
  speaking: "Говорю",
  error: "Ошибка",
  muted: "Микрофон выключен",
};

/**
 * Ядро-реактор: контурная сфера, тики, дуги. Состояние меняет скорость и цвет,
 * но не размер — чтобы интерфейс не «прыгал».
 */
export function HUDCore({ state = "idle", size = 248 }: { state?: HudState; size?: number }) {
  const speed = state === "thinking" ? "1.6s" : state === "speaking" ? "3.2s" : state === "listening" ? "9s" : "46s";
  const tone =
    state === "error" ? "var(--color-danger)"
    : state === "muted" ? "var(--color-text-faint)"
    : "var(--reactor-line)";

  return (
    <div
      className="hud"
      data-state={state}
      style={
        {
          width: size,
          height: size,
          "--hud-spin": speed,
          "--hud-tone": tone,
        } as CSSProperties
      }
      role="img"
      aria-label={`Состояние: ${HUD_LABEL[state]}`}
    >
      <svg viewBox="0 0 240 240" className="hud__svg" aria-hidden="true">
        <defs>
          <radialGradient id="hud-core-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--reactor-core)" stopOpacity=".95" />
            <stop offset="38%" stopColor="var(--reactor-mid)" stopOpacity=".5" />
            <stop offset="72%" stopColor="var(--reactor-rim)" stopOpacity=".16" />
            <stop offset="100%" stopColor="var(--reactor-rim)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="120" cy="120" r="112" fill="none" stroke="var(--color-hud-ring)" strokeOpacity=".22" />
        <g className="hud__ticks" stroke="var(--color-hud-ring)" strokeWidth="1" opacity=".55">
          <g className="hud__spin hud__spin--slow">
            <circle cx="120" cy="120" r="108" fill="none" strokeDasharray="1 6.6" strokeLinecap="round" />
          </g>
          <g className="hud__spin hud__spin--rev">
            <circle cx="120" cy="120" r="100" fill="none" strokeDasharray="10 8" strokeOpacity=".8" />
          </g>
        </g>

        <g fill="none" strokeLinecap="round">
          <g className="hud__spin hud__spin--fast" opacity=".9">
            <path d="M120 28a92 92 0 0 1 65 27" stroke="var(--reactor-line)" strokeWidth="2" strokeOpacity=".85" />
          </g>
          <g className="hud__spin hud__spin--rev" opacity=".7">
            <path d="M120 44a76 76 0 0 0-54 22" stroke="var(--color-accent-strong)" strokeWidth="1.5" />
          </g>
          <g className="hud__spin hud__spin--slow" opacity=".55">
            <path d="M120 60a60 60 0 0 1 42 18" stroke="var(--color-hud-amber)" strokeWidth="1.5" />
          </g>
        </g>

        <g className="hud__spin hud__spin--slow" opacity=".8">
          <ellipse cx="120" cy="120" rx="58" ry="58" fill="none" stroke="var(--reactor-line)" strokeOpacity=".5" />
          <ellipse cx="120" cy="120" rx="58" ry="34" fill="none" stroke="var(--reactor-line)" strokeOpacity=".28" />
          <ellipse cx="120" cy="120" rx="58" ry="16" fill="none" stroke="var(--reactor-line)" strokeOpacity=".2" />
          <ellipse cx="120" cy="120" rx="34" ry="58" fill="none" stroke="var(--reactor-line)" strokeOpacity=".3" />
          <ellipse cx="120" cy="120" rx="16" ry="58" fill="none" stroke="var(--reactor-line)" strokeOpacity=".2" />
        </g>

        <circle className="hud__glow" cx="120" cy="120" r="58" fill="url(#hud-core-grad)" opacity=".55" />
        <circle className="hud__pulse" cx="120" cy="120" r="62" fill="none" stroke="var(--color-accent-strong)" strokeOpacity=".35" />
        <circle cx="120" cy="120" r="6" fill="var(--reactor-core)" />
      </svg>
      <span className="hud__label">{HUD_LABEL[state]}</span>
    </div>
  );
}

export interface MiniCoreProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  state?: HudState;
  /** 40 — в трее, 64 — по умолчанию, 88 — крупный режим. */
  size?: 40 | 64 | 88;
  /** Приглушить в покое (автоскрытие через 8 с). */
  dim?: boolean;
  /** Куда выравнивать подпись у края экрана. */
  tipAlign?: "center" | "left" | "right";
  /** Кодовое слово услышано: подпись видна без наведения. */
  wake?: boolean;
}

/**
 * Свёрнутый аватар ассистента: маленькое ядро поверх окон.
 * Состояние читается по цвету, скорости колец и волнам; клик разворачивает окно.
 */
export function MiniCore({
  state = "idle",
  size = 64,
  dim = false,
  tipAlign = "center",
  wake = false,
  className = "",
  ...props
}: MiniCoreProps) {
  const gradId = useId();

  return (
    <button
      type="button"
      className={`mini ${className}`}
      data-state={state}
      data-dim={dim || undefined}
      data-align={tipAlign}
      data-wake={wake || undefined}
      style={{ "--mini-size": `${size}px` } as CSSProperties}
      aria-label={`Ассистент: ${HUD_LABEL[state]}. Открыть окно`}
      {...props}
    >
      <svg viewBox="0 0 120 120" className="mini__svg" aria-hidden="true">
        <defs>
          <radialGradient id={`${gradId}-core`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--mini-tone)" stopOpacity=".9" />
            <stop offset="55%" stopColor="var(--mini-tone)" stopOpacity=".35" />
            <stop offset="100%" stopColor="var(--mini-tone)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="mini__spin mini__spin--slow" stroke="var(--color-hud-ring)" strokeWidth="1" opacity=".5">
          <circle cx="60" cy="60" r="55" fill="none" strokeDasharray="1 4.8" strokeLinecap="round" />
        </g>

        <g className="mini__spin mini__spin--rev" fill="none" strokeLinecap="round">
          <circle cx="60" cy="60" r="47" stroke="var(--mini-tone)" strokeOpacity=".3" strokeWidth="1" strokeDasharray="12 10" />
          <path d="M60 13a47 47 0 0 1 33 14" stroke="var(--mini-tone)" strokeWidth="1.6" strokeOpacity=".9" />
        </g>

        <g fill="none" stroke="var(--mini-tone)" strokeWidth=".9" opacity=".55">
          <circle cx="60" cy="60" r="30" strokeOpacity=".55" />
          <ellipse cx="60" cy="60" rx="30" ry="12" />
          <ellipse cx="60" cy="60" rx="12" ry="30" />
        </g>

        <circle className="mini__halo" cx="60" cy="60" r="27" fill={`url(#${gradId}-core)`} />
        <circle className="mini__core" cx="60" cy="60" r="17" fill={`url(#${gradId}-core)`} />
        <circle cx="60" cy="60" r="3.4" fill="var(--mini-tone)" />

        <g className="mini__muted" stroke="var(--color-text-faint)" strokeWidth="2" strokeLinecap="round">
          <line x1="43" y1="77" x2="77" y2="43" />
        </g>
      </svg>
      <span className="mini__alert" aria-hidden="true">
        !
      </span>
      <span className="mini__tip" aria-hidden="true">
        {HUD_LABEL[state]}
      </span>
    </button>
  );
}

/** Волна микрофона. heights — нормализованные 0..1, чтобы компонент не зависел от аудио. */
export function Waveform({ heights, active = true }: { heights?: number[]; active?: boolean }) {
  const bars = heights ?? Array.from({ length: 56 }, (_, i) => {
    const center = Math.abs(i - 28) / 28;
    return Math.max(0.12, (1 - center) * 0.9);
  });
  return (
    <div className={`waveform ${active ? "waveform--active" : ""}`} aria-hidden="true">
      {bars.map((h, i) => (
        <i key={i} style={{ height: `${Math.round(6 + h * 26)}px`, animationDelay: `${(i * 0.035).toFixed(2)}s` }} />
      ))}
    </div>
  );
}

export function Sparkline({ points, tone = "accent" }: { points: number[]; tone?: "accent" | "warning" }) {
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? 200 / (points.length - 1) : 0;
  const d = points
    .map((v, i) => `${i * step},${26 - (v / max) * 22}`)
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 200 26" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        fill="none"
        stroke={tone === "warning" ? "var(--color-hud-amber)" : "var(--color-accent)"}
        strokeWidth="1.5"
        points={d}
      />
    </svg>
  );
}

export function MetricCard({
  label, value, unit, percent, critical = false, history,
}: {
  label: string; value: string | number; unit?: string; percent?: number; critical?: boolean; history?: number[];
}) {
  return (
    <div className={`metric ${critical ? "metric--critical" : ""}`}>
      <div className="metric__label">{label}</div>
      <div className="metric__value">
        {value}
        {unit && <span className="metric__unit">{unit}</span>}
      </div>
      {history && <Sparkline points={history} tone={critical ? "warning" : "accent"} />}
      {typeof percent === "number" && (
        <div className="metric__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
          <div className="metric__fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

/* Empty / Spinner --------------------------------------------------------- */

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true" />
      <div className="empty__title">{title}</div>
      {description && <p className="empty__text">{description}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = "Загрузка" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} style={{ display: "inline-flex" }}>
      <span className="spinner" aria-hidden="true" />
    </span>
  );
}
