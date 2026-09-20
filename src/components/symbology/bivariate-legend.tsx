import { rgbCss, type RGB } from "@/config/symbology-schemes";

export function BivariateLegend({
  xLabel,
  yLabel,
  palette,
}: {
  xLabel: string;
  yLabel: string;
  palette: Record<string, RGB>;
}) {
  return (
    <div className="bivar-legend">
      <p className="legend-kicker">Bivariate colors</p>
      <div className="bivar-plot">
        <span className="bivar-ylab">{yLabel}</span>
        <div className="bivar-stack">
          <span className="bivar-end">High</span>
          <div className="bivar-grid" role="img" aria-label={`${xLabel} by ${yLabel} 3 by 3 color matrix`}>
            {[3, 2, 1].map((y) =>
              [1, 2, 3].map((x) => {
                const rgb = palette[`${x}_${y}`] ?? [200, 200, 200];
                return (
                  <span
                    key={`${x}_${y}`}
                    style={{ background: rgbCss(rgb) }}
                    title={`${xLabel} ${["Low", "Medium", "High"][x - 1]} / ${yLabel} ${["Low", "Medium", "High"][y - 1]}`}
                  />
                );
              }),
            )}
          </div>
          <span className="bivar-end">Low</span>
        </div>
      </div>
      <div className="bivar-x">
        <span>Low</span>
        <span className="bivar-xlab">{xLabel}</span>
        <span>High</span>
      </div>
    </div>
  );
}
