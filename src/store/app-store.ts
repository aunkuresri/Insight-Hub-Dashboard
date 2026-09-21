import { create } from "zustand";
import { getAppConfig } from "@/config/app-config";
import { INDICATOR_GROUPS, allIndicatorFields, kpiFieldsForGroup, labelForField } from "@/config/indicators";
import {
  ADMIN_LEVELS,
  emptyFilters,
  getAdminLevel,
  type AdminLevelId,
  type LayerGroupId,
  type LocationFilters,
} from "@/config/layers";
import { resolveField, resolveFieldName, type FieldInfo } from "@/lib/gis/fields";
import { getMapController } from "@/lib/gis/map-controller";
import { uniqueSorted } from "@/lib/utils";
import { buildBoundaryRenderer, buildChartRenderer, describeMethod, type AppliedLegend } from "@/lib/symbology/renderers";

export type RankingRow = {
  name: string;
  value: number;
  columns: Record<string, number>;
};

export type KpiValue = {
  id: string;
  label: string;
  value: number | null;
};

export type CompositionSlice = {
  id: string;
  label: string;
  value: number;
};

type Toast = { kind: "success" | "danger" | "info"; message: string } | null;

const RANKING_COLUMN_COUNT = 3;

/** Fixed Incident fields for the map KPI bar — independent of analytics window group. */
const MAP_INCIDENT_KPI_IDS = [
  "Total_Incidents",
  "Total_Death",
  "Total_Injured",
] as const;

function defaultRankingColumns(groupId: string): string[] {
  const group = INDICATOR_GROUPS.find((g) => g.id === groupId);
  const ids = (group?.fields ?? []).map((f) => f.id);
  return ids.slice(0, RANKING_COLUMN_COUNT);
}

type SymFieldsByGroup = Record<LayerGroupId, string[]>;

export type SelectionAncestor = {
  label: string;
  value: string;
};

export type SelectionInfo = {
  unitLabel: string;
  areaName: string;
  ancestors: SelectionAncestor[];
};

type AppState = {
  mapReady: boolean;
  mapError: string | null;
  mapScale: number;
  levelMode: "auto" | "manual";
  autoLevel: AdminLevelId;
  manualLevel: AdminLevelId;
  filters: LocationFilters;
  filterOptions: Record<AdminLevelId, string[]>;
  analyticsGroup: string;
  analyticsMetric: string;
  rankingColumns: string[];
  kpis: KpiValue[];
  mapIncidentKpis: KpiValue[];
  ranking: RankingRow[];
  composition: CompositionSlice[];
  featureCount: number;
  analyticsLoading: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  toast: Toast;
  selectionName: string | null;
  selectionGeometry: unknown | null;
  selectionInfo: SelectionInfo | null;
  symLayerGroup: LayerGroupId;
  symAdminLevel: AdminLevelId | "all";
  symBrowseGroup: string | null;
  symFieldsByGroup: SymFieldsByGroup;
  symScheme: string;
  symSizeField: string;
  symApplying: boolean;
  applied: Record<LayerGroupId, AppliedLegend | null>;
  currentLevel: () => AdminLevelId;
  currentSymFields: () => string[];
  setMapReady: (ready: boolean) => void;
  setMapError: (message: string | null) => void;
  setScale: (level: AdminLevelId, scale: number) => void;
  setLevelMode: (mode: "auto" | "manual") => void;
  setManualLevel: (level: AdminLevelId) => void;
  setFilter: (level: AdminLevelId, value: string | null) => Promise<void>;
  clearFilters: () => Promise<void>;
  refreshFilterOptions: () => Promise<void>;
  refreshAnalytics: () => Promise<void>;
  setAnalyticsGroup: (id: string) => void;
  setRankingColumn: (index: number, fieldId: string) => void;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  setSymLayerGroup: (id: LayerGroupId) => void;
  setSymAdminLevel: (id: AdminLevelId | "all") => void;
  setSymBrowseGroup: (id: string | null) => void;
  toggleSymField: (id: string) => void;
  removeSymField: (id: string) => void;
  setSymScheme: (scheme: string) => void;
  setSymSizeField: (id: string) => void;
  applySymbology: () => Promise<void>;
  resetSymbology: (group?: LayerGroupId) => void;
  zoomToLevel: (level: AdminLevelId) => Promise<void>;
  zoomToName: (name: string) => Promise<void>;
  clearRankingSelection: () => void;
  setMapSelection: (name: string | null, geometry: unknown | null, info?: SelectionInfo | null) => void;
  clearMapSelection: () => void;
  showToast: (toast: Toast) => void;
};

function nextFilters(current: LocationFilters, level: AdminLevelId, value: string | null): LocationFilters {
  const next = { ...current, [level]: value };
  const ids: AdminLevelId[] = ["division", "district", "upazila", "union"];
  const idx = ids.indexOf(level);
  for (const child of ids.slice(idx + 1)) next[child] = null;
  return next;
}

const initialGroup = getAppConfig().defaultAnalyticsGroup;
const initialColumns = defaultRankingColumns(initialGroup);

let analyticsRequestId = 0;

export const useAppStore = create<AppState>((set, get) => ({
  mapReady: false,
  mapError: null,
  mapScale: 0,
  levelMode: "auto",
  autoLevel: "division",
  manualLevel: "division",
  filters: emptyFilters(),
  filterOptions: { division: [], district: [], upazila: [], union: [] },
  analyticsGroup: initialGroup,
  analyticsMetric: initialColumns[0] ?? getAppConfig().defaultMetric,
  rankingColumns: initialColumns,
  kpis: [],
  mapIncidentKpis: [],
  ranking: [],
  composition: [],
  featureCount: 0,
  analyticsLoading: false,
  leftOpen: true,
  rightOpen: true,
  toast: null,
  selectionName: null,
  selectionGeometry: null,
  selectionInfo: null,
  symLayerGroup: "boundary",
  symAdminLevel: "all",
  symBrowseGroup: INDICATOR_GROUPS[0]?.id ?? null,
  symFieldsByGroup: { boundary: [], chart: [] },
  symScheme: "Auto",
  symSizeField: "",
  symApplying: false,
  applied: { boundary: null, chart: null },

  currentLevel: () => (get().levelMode === "auto" ? get().autoLevel : get().manualLevel),

  currentSymFields: () => {
    const { symLayerGroup, symFieldsByGroup } = get();
    return symFieldsByGroup[symLayerGroup] ?? [];
  },

  setMapReady: (ready) => {
    set({ mapReady: ready });
    if (ready) {
      void get().refreshFilterOptions();
      void get().refreshAnalytics();
    }
  },
  setMapError: (message) => set({ mapError: message }),
  setScale: (level, scale) => {
    set({ autoLevel: level, mapScale: scale });
  },
  setLevelMode: (mode) => {
    set({ levelMode: mode, manualLevel: get().autoLevel });
    void get().refreshAnalytics();
  },
  setManualLevel: (level) => {
    set({ manualLevel: level, levelMode: "manual" });
    void get().refreshAnalytics();
  },
  setFilter: async (level, value) => {
    const filters = nextFilters(get().filters, level, value);
    const map = getMapController();
    if (map) await map.applyFilters(filters);
    set({ filters, selectionName: null, selectionGeometry: null, selectionInfo: null });
    await get().refreshFilterOptions();
    await get().refreshAnalytics();
  },
  clearFilters: async () => {
    const filters = emptyFilters();
    const map = getMapController();
    if (map) {
      await map.applyFilters(filters);
      await map.resetExtent();
    }
    set({ filters, selectionName: null, selectionGeometry: null, selectionInfo: null });
    await get().refreshFilterOptions();
    await get().refreshAnalytics();
  },
  refreshFilterOptions: async () => {
    const map = getMapController();
    if (!map) return;
    const { filters } = get();
    const options: Record<AdminLevelId, string[]> = { division: [], district: [], upazila: [], union: [] };
    for (const level of ADMIN_LEVELS) {
      const parentReady = !level.parentId || Boolean(filters[level.parentId]);
      if (level.id !== "division" && !parentReady) {
        options[level.id] = [];
        continue;
      }
      const layer = map.findLayer(level.layerTitles.boundary);
      if (!layer) continue;
      const nameField = resolveFieldName(map.schemaOf(layer), level.nameField) ?? level.nameField;
      const parentWhere = level.parentId
        ? (() => {
            const parent = getAdminLevel(level.parentId!);
            const pField = resolveFieldName(map.schemaOf(layer), parent.nameField) ?? parent.nameField;
            const pValue = filters[parent.id];
            return pValue ? `${pField} = '${pValue.replaceAll("'", "''")}'` : "1=1";
          })()
        : "1=1";
      try {
        const features = await map.queryAttributes(layer, {
          where: parentWhere,
          outFields: [nameField],
          returnDistinctValues: true,
          returnGeometry: false,
          orderByFields: [nameField],
          num: 5000,
        });
        options[level.id] = uniqueSorted(features.map((f) => String(f.attributes[nameField] ?? "")));
      } catch {
        try {
          const features = await map.queryAttributes(layer, {
            where: parentWhere,
            outFields: [nameField],
            returnGeometry: false,
            num: 5000,
          });
          options[level.id] = uniqueSorted(features.map((f) => String(f.attributes[nameField] ?? "")));
        } catch {
          options[level.id] = [];
        }
      }
    }
    set({ filterOptions: options });
  },
  refreshAnalytics: async () => {
    const map = getMapController();
    if (!map) return;
    const state = get();
    const level = getAdminLevel(state.currentLevel());
    const layer = map.findLayer(level.layerTitles.boundary);
    if (!layer) return;
    const requestId = ++analyticsRequestId;
    set({ analyticsLoading: true });
    try {
      const schema = map.schemaOf(layer);
      const where = layer.definitionExpression || "1=1";
      const nameField = resolveFieldName(schema, level.nameField) ?? level.nameField;
      const geometry = state.selectionGeometry ?? map.currentExtent();
      const count = await map.queryCount(layer, where, geometry);
      const group = INDICATOR_GROUPS.find((g) => g.id === state.analyticsGroup);
      const groupFields = group?.fields ?? [];
      const kpiFieldDefs = kpiFieldsForGroup(state.analyticsGroup);
      const mapIncidentFieldDefs = MAP_INCIDENT_KPI_IDS.map((id) => ({
        id,
        label: labelForField(id),
      }));
      const statsFieldMap = new Map<
        string,
        { statisticType: string; onStatisticField: string; outStatisticFieldName: string; id: string; label: string }
      >();
      for (const field of [...kpiFieldDefs, ...mapIncidentFieldDefs]) {
        if (statsFieldMap.has(field.id)) continue;
        const resolved = resolveFieldName(schema, field.id);
        if (!resolved) continue;
        statsFieldMap.set(field.id, {
          statisticType: "sum",
          onStatisticField: resolved,
          outStatisticFieldName: `kpi_${field.id}`,
          id: field.id,
          label: field.label,
        });
      }
      const kpiStats = Array.from(statsFieldMap.values());
      let kpiValues: KpiValue[] = kpiFieldDefs.map((f) => ({ id: f.id, label: f.label, value: null }));
      let mapIncidentKpis: KpiValue[] = mapIncidentFieldDefs.map((f) => ({
        id: f.id,
        label: f.label,
        value: null,
      }));
      if (kpiStats.length) {
        const stats = await map.queryStats(
          layer,
          kpiStats.map(({ statisticType, onStatisticField, outStatisticFieldName }) => ({
            statisticType,
            onStatisticField,
            outStatisticFieldName,
          })),
          where,
          geometry,
        );
        const byId = new Map(
          kpiStats.map((s) => [s.id, (stats as Record<string, number>)[s.outStatisticFieldName] ?? null] as const),
        );
        kpiValues = kpiFieldDefs.map((f) => ({
          id: f.id,
          label: f.label,
          value: byId.has(f.id) ? (byId.get(f.id) ?? null) : null,
        }));
        mapIncidentKpis = mapIncidentFieldDefs.map((f) => ({
          id: f.id,
          label: f.label,
          value: byId.has(f.id) ? (byId.get(f.id) ?? null) : null,
        }));
      }
      const compositionFields = groupFields
        .map((f) => {
          const resolved = resolveField(schema, f.id);
          return resolved ? { ...f, name: resolved.name } : null;
        })
        .filter(Boolean) as Array<{ id: string; label: string; name: string }>;
      let composition: CompositionSlice[] = [];
      if (compositionFields.length) {
        const stats = await map.queryStats(
          layer,
          compositionFields.map((f) => ({
            statisticType: "sum",
            onStatisticField: f.name,
            outStatisticFieldName: `sum_${f.id}`,
          })),
          where,
          geometry,
        );
        composition = compositionFields.map((f) => ({
          id: f.id,
          label: f.label,
          value: (stats as Record<string, number>)[`sum_${f.id}`] ?? 0,
        }));
      }
      const columnIds = state.rankingColumns.length
        ? state.rankingColumns
        : defaultRankingColumns(state.analyticsGroup);
      const resolvedColumns = columnIds
        .map((id) => {
          const info = resolveField(schema, id);
          return info ? { id, name: info.name, label: labelForField(id) } : null;
        })
        .filter(Boolean) as Array<{ id: string; name: string; label: string }>;
      let ranking: RankingRow[] = [];
      const primary = resolvedColumns[0];
      if (primary) {
        const outFields = Array.from(new Set([nameField, ...resolvedColumns.map((c) => c.name)]));
        const features = await map.queryAttributes(layer, {
          where,
          outFields,
          orderByFields: [`${primary.name} DESC`],
          num: getAppConfig().rankingRows,
          returnGeometry: false,
          geometry,
        });
        ranking = features.map((feature) => {
          const attrs = feature.attributes;
          const columns: Record<string, number> = {};
          for (const col of resolvedColumns) {
            const n = Number(attrs[col.name]);
            columns[col.id] = Number.isFinite(n) ? n : 0;
          }
          return {
            name: String(attrs[nameField] ?? "—"),
            value: columns[primary.id] ?? 0,
            columns,
          };
        });
      }
      if (requestId !== analyticsRequestId) return;
      set({
        kpis: kpiValues,
        mapIncidentKpis,
        ranking,
        composition,
        featureCount: count,
        analyticsLoading: false,
        analyticsMetric: primary?.id ?? state.analyticsMetric,
      });
    } catch (err) {
      if (requestId !== analyticsRequestId) return;
      set({
        analyticsLoading: false,
        toast: {
          kind: "danger",
          message: err instanceof Error ? err.message : "Analytics query failed.",
        },
      });
    }
  },
  setAnalyticsGroup: (id) => {
    const columns = defaultRankingColumns(id);
    set({
      analyticsGroup: id,
      rankingColumns: columns,
      analyticsMetric: columns[0] ?? get().analyticsMetric,
    });
    void get().refreshAnalytics();
  },
  setRankingColumn: (index, fieldId) => {
    const { rankingColumns } = get();
    const allowed = new Set(allIndicatorFields().map((f) => f.id));
    if (!allowed.has(fieldId)) return;
    if (rankingColumns.some((id, i) => i !== index && id === fieldId)) {
      set({
        toast: {
          kind: "info",
          message: "That indicator is already used in another column. Choose a different field.",
        },
      });
      return;
    }
    const next = [...rankingColumns];
    while (next.length <= index) next.push("");
    next[index] = fieldId;
    const cleaned = next.filter(Boolean).slice(0, RANKING_COLUMN_COUNT);
    set({
      rankingColumns: cleaned,
      analyticsMetric: cleaned[0] ?? get().analyticsMetric,
    });
    void get().refreshAnalytics();
  },
  setLeftOpen: (open) => set({ leftOpen: open }),
  setRightOpen: (open) => set({ rightOpen: open }),
  setSymLayerGroup: (id) => {
    if (get().symLayerGroup === id) return;
    set({ symLayerGroup: id });
  },
  setSymAdminLevel: (id) => set({ symAdminLevel: id }),
  setSymBrowseGroup: (id) => set({ symBrowseGroup: id }),
  toggleSymField: (id) => {
    const { symLayerGroup, symFieldsByGroup } = get();
    const current = symFieldsByGroup[symLayerGroup] ?? [];
    const max = symLayerGroup === "chart" ? getAppConfig().chartMaxIndicators : 12;
    let next: string[];
    if (current.includes(id)) {
      next = current.filter((f) => f !== id);
    } else {
      if (current.length >= max) {
        set({ toast: { kind: "info", message: `Select at most ${max} indicators for this method.` } });
        return;
      }
      next = [...current, id];
    }
    set({
      symFieldsByGroup: {
        ...symFieldsByGroup,
        [symLayerGroup]: next,
      },
    });
  },
  removeSymField: (id) => {
    const { symLayerGroup, symFieldsByGroup } = get();
    const current = symFieldsByGroup[symLayerGroup] ?? [];
    set({
      symFieldsByGroup: {
        ...symFieldsByGroup,
        [symLayerGroup]: current.filter((f) => f !== id),
      },
    });
  },
  setSymScheme: (scheme) => set({ symScheme: scheme }),
  setSymSizeField: (id) => set({ symSizeField: id }),
  applySymbology: async () => {
    const map = getMapController();
    if (!map) return;
    const { symLayerGroup, symFieldsByGroup, symScheme, symSizeField } = get();
    const symFields = symFieldsByGroup[symLayerGroup] ?? [];
    const symAdminLevel = "all" as const;
    if (!symFields.length) {
      set({ toast: { kind: "info", message: "Select at least one indicator field." } });
      return;
    }
    set({ symApplying: true });
    try {
      const layers = map.layersFor(symLayerGroup, symAdminLevel);
      if (!layers.length) throw new Error("No matching web map layers were found for that group / level.");
      let lastLegend: AppliedLegend | null = null;
      for (const layer of layers) {
        const schema: FieldInfo[] = map.schemaOf(layer);
        const resolved = symFields
          .map((id) => {
            const info = resolveField(schema, id);
            return info ? { id, name: info.name, label: labelForField(id) } : null;
          })
          .filter(Boolean) as Array<{ id: string; name: string; label: string }>;
        if (!resolved.length) throw new Error(`None of the selected fields exist on "${layer.title}".`);
        const aliases = Object.fromEntries(resolved.map((f) => [f.name, f.label]));
        const names = resolved.map((f) => f.name);
        const sizeResolved = symSizeField ? resolveField(schema, symSizeField) : null;
        const queryFields = sizeResolved ? [...new Set([...names, sizeResolved.name])] : names;
        const features = await map.queryAttributes(layer, {
          outFields: queryFields,
          returnGeometry: false,
        });
        const rows = features.map((f) => f.attributes);
        const built =
          symLayerGroup === "chart"
            ? buildChartRenderer({
                rows,
                fields: names,
                aliases,
                requestedScheme: symScheme,
                sizeField: sizeResolved?.name,
                sizeLabel: sizeResolved ? labelForField(symSizeField) : null,
              })
            : buildBoundaryRenderer({
                rows,
                fields: names,
                aliases,
                requestedScheme: symScheme,
              });
        map.applyRenderer(layer, built.renderer);
        layer.visible = true;
        lastLegend = built.legend;
      }
      set({
        applied: { ...get().applied, [symLayerGroup]: lastLegend },
        symApplying: false,
        toast: {
          kind: "success",
          message: lastLegend
            ? `${lastLegend.method} applied to ${symLayerGroup} layers.`
            : "Symbology applied.",
        },
      });
      map.syncLegendFilter?.(get().applied);
    } catch (err) {
      set({
        symApplying: false,
        toast: {
          kind: "danger",
          message: err instanceof Error ? err.message : "Symbology apply failed.",
        },
      });
    }
  },
  resetSymbology: (group) => {
    const map = getMapController();
    const target = group ?? get().symLayerGroup;
    if (map) map.resetRenderers(target);
    const applied = { ...get().applied, [target]: null };
    set({
      applied,
      symFieldsByGroup: { ...get().symFieldsByGroup, [target]: [] },
      toast: { kind: "info", message: `${target} symbology reset.` },
    });
    map?.syncLegendFilter?.(applied);
  },
  zoomToLevel: async (level) => {
    const map = getMapController();
    if (map && typeof (map as { zoomToLevel?: (l: AdminLevelId) => Promise<void> }).zoomToLevel === "function") {
      await (map as { zoomToLevel: (l: AdminLevelId) => Promise<void> }).zoomToLevel(level);
    }
  },
  zoomToName: async (name) => {
    const map = getMapController();
    if (map && typeof (map as { zoomToName?: (l: AdminLevelId, n: string) => Promise<void> }).zoomToName === "function") {
      await (map as { zoomToName: (l: AdminLevelId, n: string) => Promise<void> }).zoomToName(get().currentLevel(), name);
    }
  },
  clearRankingSelection: () => {
    getMapController()?.clearHighlight?.();
  },
  setMapSelection: (name, geometry, info = null) => {
    set({
      selectionName: name,
      selectionGeometry: geometry,
      selectionInfo: name ? info ?? null : null,
    });
    void get().refreshAnalytics();
  },
  clearMapSelection: () => {
    set({ selectionName: null, selectionGeometry: null, selectionInfo: null });
    getMapController()?.clearHighlight?.();
    void get().refreshAnalytics();
  },
  showToast: (toast) => set({ toast }),
}));

export { describeMethod };
