import { useEffect, useId, useRef, useState } from "react";
import {
  CHART_PALETTES,
  CHOROPLETH_RAMPS,
  COLOR_SCHEMES,
  type ColorScheme,
  rgbCss,
} from "@/config/symbology-schemes";

type Props = {
  value: string;
  onChange: (scheme: string) => void;
  mode?: "chart" | "boundary";
};

function rampFor(scheme: ColorScheme, mode: "chart" | "boundary") {
  if (mode === "chart") {
    return (CHART_PALETTES[scheme] ?? CHART_PALETTES.Auto).slice(0, 5);
  }
  return CHOROPLETH_RAMPS[scheme] ?? CHOROPLETH_RAMPS.Auto;
}

function Ramp({ colors }: { colors: [number, number, number][] }) {
  return (
    <span className="color-scheme-ramp" aria-hidden>
      {colors.map((rgb, i) => (
        <span
          key={i}
          className="color-scheme-swatch"
          style={{ background: rgbCss(rgb) }}
        />
      ))}
    </span>
  );
}

export function ColorSchemePicker({ value, onChange, mode = "boundary" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const active = (COLOR_SCHEMES.includes(value as ColorScheme) ? value : "Auto") as ColorScheme;
  const activeColors = rampFor(active, mode);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <section className="color-scheme-field" ref={rootRef}>
      <div className="section-head">
        <h2>Color scheme</h2>
      </div>
      <div className="color-scheme-dropdown">
        <button
          type="button"
          className="color-scheme-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          <Ramp colors={activeColors} />
          <span className="color-scheme-name">{active}</span>
          <calcite-icon icon={open ? "chevron-up" : "chevron-down"} scale="s" />
        </button>

        {open ? (
          <ul className="color-scheme-menu" role="listbox" id={listId} aria-label="Color scheme">
            {COLOR_SCHEMES.map((scheme) => {
              const selected = scheme === active;
              return (
                <li key={scheme}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? "color-scheme-option is-active" : "color-scheme-option"}
                    onClick={() => {
                      onChange(scheme);
                      setOpen(false);
                    }}
                  >
                    <Ramp colors={rampFor(scheme, mode)} />
                    <span className="color-scheme-name">{scheme}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
