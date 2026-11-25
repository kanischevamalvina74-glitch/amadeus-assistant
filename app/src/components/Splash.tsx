import { useEffect, useState } from "react";
import { playCue } from "../lib/sound";
import "./splash.css";

type Props = { brief?: boolean; onDone: () => void };

/** Заставка «Дирижёр»: точка, три орбиты, курсив и аккорд. Не дольше 1,5 с. */
export function Splash({ brief = false, onDone }: Props) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const total = brief ? 300 : 1400;
    const chord = window.setTimeout(() => playCue("answer"), brief ? 0 : 950);
    const fade = window.setTimeout(() => setLeaving(true), total - 160);
    const done = window.setTimeout(onDone, total);
    return () => {
      window.clearTimeout(chord);
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [brief, onDone]);

  return (
    <div
      className={`splash ${leaving ? "splash--leaving" : ""} ${brief ? "splash--brief" : ""}`}
      role="presentation"
      onClick={onDone}
    >
      <div className="splash__mark" aria-hidden="true">
        <span className="splash__dot" />
        <span className="splash__orbit splash__orbit--1" />
        <span className="splash__orbit splash__orbit--2" />
        <span className="splash__orbit splash__orbit--3" />
      </div>
      <div className="splash__word">Amadeus</div>
    </div>
  );
}
