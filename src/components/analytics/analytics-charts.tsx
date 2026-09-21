import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import { formatNumber } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import {
  compositionChartsForGroup,
  labelForField,
  type CompositionChartDef,
} from "@/config/indicators";

const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

const tooltipStyle = {
  background: "var(--color-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "var(--color-fg)",
};

function valueFor(
  composition: Array<{ id: string; label: string; value: number }> | null | undefined,
  kpis: Array<{ id: string; value: number | null }> | null | undefined,
  fieldId: string,
): number {
  const fromComp = (composition ?? []).find((s) => s.id === fieldId);
  if (fromComp) return fromComp.value;
  const fromKpi = (kpis ?? []).find((k) => k.id === fieldId);
  return fromKpi?.value ?? 0;
}

function CompositionPieCard({
  def,
  slices,
}: {
  def: CompositionChartDef;
  slices: Array<{ id: string; label: string; value: number }>;
}) {
  const pieData = slices.filter((s) => s.value > 0);
  return (
    <article className="chart-card">
      <header>
        <h3>{def.title}</h3>
        {def.description ? <p>{def.description}</p> : null}
      </header>
      {pieData.length ? (
        <div className="chart-body">
          <ResponsiveContainer width="100%" height={148}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="label" innerRadius={36} outerRadius={60} paddingAngle={2}>
                {pieData.map((entry, index) => (
                  <Cell key={entry.id} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatNumber(Number(value))}
                contentStyle={tooltipStyle}
                itemStyle={{ color: "var(--color-fg)" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="swatch-list">
            {pieData.map((slice, index) => (
              <li key={slice.id}>
                <span className="swatch" style={{ background: SLICE_COLORS[index % SLICE_COLORS.length] }} />
                <span>{slice.label}</span>
                <strong className="tabular-nums">{formatNumber(slice.value)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="empty-note">No numeric values for this chart.</p>
      )}
    </article>
  );
}

function CompareBarCard({
  def,
  bars,
}: {
  def: CompositionChartDef;
  bars: Array<{ id: string; label: string; value: number }>;
}) {
  const data = bars.filter((b) => b.value > 0);
  return (
    <article className="chart-card">
      <header>
        <h3>{def.title}</h3>
        {def.description ? <p>{def.description}</p> : null}
      </header>
      {data.length ? (
        <div className="chart-body">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 12 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" width={88} tick={{ fill: "var(--color-muted)", fontSize: 11 }} />
              <Tooltip
                formatter={(value) => formatNumber(Number(value))}
                contentStyle={tooltipStyle}
                itemStyle={{ color: "var(--color-fg)" }}
              />
              <Bar dataKey="value" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="empty-note">No numeric values for this comparison.</p>
      )}
    </article>
  );
}

export function AnalyticsCharts() {
  const composition = useAppStore((s) => s.composition);
  const kpis = useAppStore((s) => s.kpis);
  const ranking = useAppStore((s) => s.ranking);
  const group = useAppStore((s) => s.analyticsGroup);

  const chartDefs = compositionChartsForGroup(group);
  const pieDefs = chartDefs.filter((d) => d.type !== "compare");
  const compareDefs = chartDefs.filter((d) => d.type === "compare");

  const barData = (ranking ?? []).slice(0, 8).map((row) => ({
    name: row.name.length > 12 ? `${row.name.slice(0, 12)}…` : row.name,
    full: row.name,
    value: row.value,
  }));

  const slicesFor = (def: CompositionChartDef) =>
    (def.fieldIds ?? []).map((id) => ({
      id,
      label: labelForField(id),
      value: valueFor(composition, kpis, id),
    }));

  return (
    <div className="chart-grid">
      {(pieDefs.length > 0 || !chartDefs.length) && (
        <div className="chart-row chart-row-pies">
          {pieDefs.map((def) => (
            <CompositionPieCard key={def.id} def={def} slices={slicesFor(def)} />
          ))}
          {!chartDefs.length ? (
            <article className="chart-card">
              <header>
                <h3>{group} composition</h3>
                <p>No charts configured for this group</p>
              </header>
            </article>
          ) : null}
        </div>
      )}

      <div className="chart-row chart-row-bars">
        {compareDefs.map((def) => (
          <CompareBarCard key={def.id} def={def} bars={slicesFor(def)} />
        ))}
        {barData.length > 0 ? (
          <article className="chart-card">
            <header>
              <h3>Top areas</h3>
            </header>
            <div className="chart-body">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                  <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                  <Tooltip
                    formatter={(value) => formatNumber(Number(value))}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ""}
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: "var(--color-fg)" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}
