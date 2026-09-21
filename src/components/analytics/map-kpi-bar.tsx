import { useMemo } from "react";
import { formatNumber } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

const INCIDENT_KPI_CARDS = [
  {
    id: "Total_Incidents",
    label: "Total Incidents",
    icon: "exclamation-mark-triangle",
    insight: "All recorded incidents",
    tone: "red",
  },
  {
    id: "Total_Death",
    label: "Killed",
    icon: "user-minus",
    insight: "Fatalities",
    tone: "rose",
  },
  {
    id: "Total_Injured",
    label: "Injured",
    icon: "user-plus",
    insight: "Persons with non-fatal harm",
    tone: "yellow",
  },
];

/**
 * KPI cards above the map — fixed Incident set, independent of the analytics
 * window indicator group (Demography, Socio-Economic, etc.).
 */
export function MapKpiBar() {
  const kpis = useAppStore((s) => s.mapIncidentKpis);
  const loading = useAppStore((s) => s.analyticsLoading);

  const cards = useMemo(() => {
    const list = kpis ?? [];
    return INCIDENT_KPI_CARDS.map((meta) => {
      const match = list.find(
        (k) => k.id === meta.id || k.id.toLowerCase() === meta.id.toLowerCase(),
      );
      return {
        ...meta,
        value: match?.value ?? null,
      };
    });
  }, [kpis]);

  return (
    <div className="map-kpi-bar">
      <div className="map-kpi-scroll">
        {cards.map((card) => (
          <article
            key={card.id}
            className={`map-kpi-card map-kpi-card--${card.tone}`}
          >
            <div className="map-kpi-card-head">
              <span className="map-kpi-card-icon" aria-hidden>
                <calcite-icon icon={card.icon} scale="s" />
              </span>
              <p className="map-kpi-card-label">{card.label}</p>
            </div>
            <strong className="map-kpi-card-value tabular-nums">
              {loading && card.value == null ? "…" : formatNumber(card.value)}
            </strong>
            <p className="map-kpi-card-insight">{card.insight}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
