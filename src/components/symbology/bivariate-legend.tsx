import { rgbCss, type RGB } from "@/config/symbology-schemes";

function formatBreak(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}K`;
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function BivariateLegend({
  xLabel,
  yLabel,
  palette,
  breaksX,
  breaksY,
}: {
  xLabel: string;
  yLabel: string;
  palette: Record<string, RGB>;
  breaksX?: number[];
  breaksY?: number[];
}) {
  // breaks* = [min, q33, q66, max] when provided
  const axisHint = (breaks: number[] | undefined, side: "low" | "high") => {
    if (!breaks || breaks.length < 4) return side === "low" ? "Low" : "High";
    if (side === "low") return `Low (≤ ${formatBreak(breaks[1]!)})`;
    return `High (> ${formatBreak(breaks[2]!)})`;
  };
  const midHint = (breaks: number[] | undefined) => {
    if (!breaks || breaks.length < 4) return "Med";
    return `${formatBreak(breaks[1]!)} – ${formatBreak(breaks[2]!)}`;
  };

  return (
    <div className="bivar-legend">
      <p className="legend-kicker">Bivariate colors</p>
      <div className="bivar-plot">
        <span className="bivar-ylab">{yLabel}</span>
        <div className="bivar-stack">
          <span className="bivar-end">{axisHint(breaksY, "high")}</span>
          <div className="bivar-grid" role="img" aria-label={`${xLabel} by ${yLabel} 3 by 3 color matrix`}>
            {[3, 2, 1].map((y) =>
              [1, 2, 3].map((x) => {
                const rgb = palette[`${x}_${y}`] ?? [200, 200, 200];
                const xRange =
                  x === 1
                    ? breaksX && breaksX.length >= 4
                      ? `≤ ${formatBreak(breaksX[1]!)}`
                      : "Low"
                    : x === 2
                      ? breaksX && breaksX.length >= 4
                        ? `${formatBreak(breaksX[1]!)} – ${formatBreak(breaksX[2]!)}`
                        : "Medium"
                      : breaksX && breaksX.length >= 4
                        ? `> ${formatBreak(breaksX[2]!)}`
                        : "High";
                const yRange =
                  y === 1
                    ? breaksY && breaksY.length >= 4
                      ? `≤ ${formatBreak(breaksY[1]!)}`
                      : "Low"
                    : y === 2
                      ? breaksY && breaksY.length >= 4
                        ? `${formatBreak(breaksY[1]!)} – ${formatBreak(breaksY[2]!)}`
                        : "Medium"
                      : breaksY && breaksY.length >= 4
                        ? `> ${formatBreak(breaksY[2]!)}`
                        : "High";
                return (
                  <span
                    key={`${x}_${y}`}
                    style={{ background: rgbCss(rgb) }}
                    title={`${xLabel} ${xRange} / ${yLabel} ${yRange}`}
                  />
                );
              }),
            )}
          </div>
          <span className="bivar-end">{axisHint(breaksY, "low")}</span>
        </div>
      </div>
      <div className="bivar-x">
        <span>{axisHint(breaksX, "low")}</span>
        <span className="bivar-xlab">{xLabel}</span>
        <span>{axisHint(breaksX, "high")}</span>
      </div>
      {breaksX && breaksX.length >= 4 && breaksY && breaksY.length >= 4 ? (
        <ul className="class-list" style={{ marginTop: 8 }}>
          <li>
            <span className="swatch" style={{ background: "transparent" }} />
            <span>
              {xLabel}: Low ≤ {formatBreak(breaksX[1]!)}, Med {midHint(breaksX)}, High &gt;{" "}
              {formatBreak(breaksX[2]!)}
            </span>
          </li>
          <li>
            <span className="swatch" style={{ background: "transparent" }} />
            <span>
              {yLabel}: Low ≤ {formatBreak(breaksY[1]!)}, Med {midHint(breaksY)}, High &gt;{" "}
              {formatBreak(breaksY[2]!)}
            </span>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
