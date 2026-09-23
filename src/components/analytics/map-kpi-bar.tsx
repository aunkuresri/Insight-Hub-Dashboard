import { useMemo } from "react";
import { formatNumber } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

/**
 * Fixed Incident cards (excludes Total Incidents).
 * Icon names must exist in @esri/calcite-ui-icons (kebab-case).
 * tone drives a very light professional accent (ArcGIS Dashboard style).
 */
const INCIDENT_KPI_CARDS: Array<{
  id: string;
  label: string;
  icon: string;
  insight: string;
  /** Visual tone for icon + subtle card accent */
  tone: "red" | "green" | "blue" | "yellow";
}> = [
  {
    id: "Crime",
    label: "Crime",
    icon: "lock",
    insight: "Reported criminal incidents",
    tone: "red",
  },
  {
    id: "Judgmental",
    label: "Judgmental",
    icon: "hammer",
    insight: "Administrative or judicial actions",
    tone: "green",
  },
  {
    id: "Resilience",
    label: "Resilience",
    icon: "check-shield",
    insight: "Community response measures",
    tone: "blue",
  },
  {
    id: "Total_Death",
    label: "Death",
    icon: "exclamation-mark-circle",
    insight: "Reported fatalities",
    tone: "red",
  },
  {
    id: "Total_Injured",
    label: "Injured",
    icon: "medical",
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
                <calcite-icon icon={card.icon} scale="l" />
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
