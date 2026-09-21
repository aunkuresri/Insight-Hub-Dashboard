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
  insight?: string;
};

export type CompositionSlice = {
  name: string;
  value: number;
  color?: string;
};

export type SelectionAncestor = { label: string; value: string };
export type SelectionInfo = {
  unitLabel: string;
  areaName: string;
  ancestors: SelectionAncestor[];
};

type Toast = { kind: "info" | "success" | "danger"; message: string } | null;

type AppliedState = {
  boundary: AppliedLegend | null;
  chart: AppliedLegend | null;
};

type SymFieldsByGroup = Record<LayerGroupId, string[]>;

const emptySymFields = (): SymFieldsByGroup => ({ boundary: [], chart: [] });

const initialGroup = getAppConfig().defaultAnalyticsGroup;
const initialColumns = kpiFieldsForGroup(initialGroup).map((f) => f.id);

type AppState = {
  mapReady: boolean;
  mapError: string | null;
  mapTitle: string;
  mapScale: number;
  currentAdminLevel: AdminLevelId | null;
  leftOpen: boolean;
  rightOpen: boolean;
  locationFilters: LocationFilters;
  toast: Toast;
  applied: AppliedState;
  symLayerGroup: LayerGroupId;
  symFieldsByGroup: SymFieldsByGroup;
  symScheme: string;
  symSizeField: string;
  symApplying: boolean;
  selectionName: string | null;
  selectionGeometry: unknown | null;
  selectionInfo: SelectionInfo | null;
  analyticsBusy: boolean;
  analyticsGroup: string;
  analyticsMetric: string;
  analyticsKpis: KpiValue[];
  rankingRows: RankingRow[];
  rankingColumns: string[];
  composition: CompositionSlice[];
  setMapReady: (ready: boolean, title?: string) => void;
  setMapError: (message: string | null) => void;
  setScale: (level: AdminLevelId | null, scale: number) => void;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  setLocationFilter: (level: AdminLevelId, value: string | null) => void;
  clearLocationFilters: () => Promise<void>;
  applyLocationFilters: () => Promise<void>;
  loadNameOptions: (level: AdminLevelId) => Promise<string[]>;
  refreshAnalytics: () => Promise<void>;
  setAnalyticsGroup: (group: string) => void;
  setAnalyticsMetric: (id: string) => void;
  setSymLayerGroup: (group: LayerGroupId) => void;
  toggleSymField: (id: string) => void;
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
  currentLevel: () => AdminLevelId;
};

export const useAppStore = create<AppState>((set, get) => ({
  mapReady: false,
  mapError: null,
  mapTitle: "",
  mapScale: 0,
  currentAdminLevel: null,
  leftOpen: true,
  rightOpen: true,
  locationFilters: emptyFilters(),
  toast: null,
  applied: { boundary: null, chart: null },
  symLayerGroup: "boundary",
  symFieldsByGroup: emptySymFields(),
  symScheme: "Auto",
  symSizeField: "",
  symApplying: false,
  selectionName: null,
  selectionGeometry: null,
  selectionInfo: null,
  analyticsBusy: false,
  analyticsGroup: initialGroup,
  analyticsMetric: initialColumns[0] ?? getAppConfig().defaultMetric,
  analyticsKpis: [],
  rankingRows: [],
  rankingColumns: initialColumns,
  composition: [],

  currentLevel: () => get().currentAdminLevel ?? ADMIN_LEVELS[0]?.id ?? "division",

  setMapReady: (ready, title) => set({ mapReady: ready, mapTitle: title ?? get().mapTitle, mapError: ready ? null : get().mapError }),
  setMapError: (message) => set({ mapError: message }),
  setScale: (level, scale) => set({ currentAdminLevel: level, mapScale: scale }),
  setLeftOpen: (open) => set({ leftOpen: open }),
  setRightOpen: (open) => set({ rightOpen: open }),

  setLocationFilter: (level, value) => {
    set({ locationFilters: { ...get().locationFilters, [level]: value } });
  },

  applyLocationFilters: async () => {
    const map = getMapController();
    const filters = get().locationFilters;
    if (map) await map.applyFilters(filters);
    void get().refreshAnalytics();
  },

  clearLocationFilters: async () => {
    const filters = emptyFilters();
    set({ locationFilters: filters });
    const map = getMapController();
    if (map) {
      await map.applyFilters(filters);
      await map.resetExtent();
    }
    void get().refreshAnalytics();
  },

  loadNameOptions: async (levelId) => {
    const map = getMapController();
    if (!map) return [];
    const level = getAdminLevel(levelId);
    const layer = map.findLayer(level.layerTitles.boundary);
    if (!layer) return [];
    const nameField = resolveFieldName(map.schemaOf(layer), level.nameField) ?? level.nameField;
    const filters = get().locationFilters;
    let where = "1=1";
    if (level.parentId) {
      const parent = getAdminLevel(level.parentId);
      const parentVal = filters[level.parentId];
      if (parentVal) {
        const pField = resolveFieldName(map.schemaOf(layer), parent.nameField) ?? parent.nameField;
        where = `UPPER(${pField}) = UPPER('${parentVal.replace(/'/g, "''")}')`;
      }
    }
    try {
      const features = await map.queryAttributes(layer, {
        outFields: [nameField],
        returnGeometry: false,
        where,
      });
      return uniqueSorted(features.map((f) => (f.attributes?.[nameField] != null ? String(f.attributes[nameField]) : null)));
    } catch {
      return [];
    }
  },

  setAnalyticsGroup: (group) => {
    const cols = kpiFieldsForGroup(group).map((f) => f.id);
    set({
      analyticsGroup: group,
      rankingColumns: cols,
      analyticsMetric: cols[0] ?? get().analyticsMetric,
    });
    void get().refreshAnalytics();
  },
  setAnalyticsMetric: (id) => set({ analyticsMetric: id }),

  refreshAnalytics: async () => {
    const map = getMapController();
    if (!map) return;
    set({ analyticsBusy: true });
    try {
      const levelId = get().currentLevel();
      const level = getAdminLevel(levelId);
      const layer = map.findLayer(level.layerTitles.boundary);
      if (!layer) {
        set({ analyticsBusy: false, analyticsKpis: [], rankingRows: [], composition: [] });
        return;
      }
      const state = get();
      const schema = map.schemaOf(layer);
      const where = "1=1";
      const geometry = state.selectionGeometry ?? map.currentExtent?.() ?? null;
      const kpis: KpiValue[] = [];
      const count = await map.queryCount(layer, where, geometry);
      kpis.push({ id: "features", label: "Features", value: count });

      for (const field of kpiFieldsForGroup(state.analyticsGroup).slice(0, 4)) {
        const resolved = resolveField(schema, field.id);
        if (!resolved) continue;
        try {
          const stats = await map.queryStats(
            layer,
            [{ statisticType: "sum", onStatisticField: resolved.name, outStatisticFieldName: "total" }],
            where,
            geometry,
          );
          const total = Number(stats?.[0]?.total ?? stats?.[0]?.TOTAL ?? null);
          kpis.push({
            id: field.id,
            label: field.label || labelForField(field.id),
            value: Number.isFinite(total) ? total : null,
          });
        } catch {
          kpis.push({ id: field.id, label: field.label || labelForField(field.id), value: null });
        }
      }

      set({ analyticsKpis: kpis, analyticsBusy: false });
    } catch {
      set({ analyticsBusy: false });
    }
  },

  setSymLayerGroup: (group) => set({ symLayerGroup: group }),
  toggleSymField: (id) => {
    const group = get().symLayerGroup;
    const current = get().symFieldsByGroup[group] ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    set({ symFieldsByGroup: { ...get().symFieldsByGroup, [group]: next } });
  },
  setSymScheme: (scheme) => set({ symScheme: scheme }),
  setSymSizeField: (id) => set({ symSizeField: id }),

  applySymbology: async () => {
    const map = getMapController();
    if (!map) return;
    const { symLayerGroup, symFieldsByGroup, symScheme, symSizeField } = get();
    const symFields = symFieldsByGroup[symLayerGroup] ?? [];
    if (!symFields.length) {
      set({ toast: { kind: "info", message: "Select at least one indicator field." } });
      return;
    }
    set({ symApplying: true });
    try {
      const layers = map.layersFor(symLayerGroup, "all");
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
        map.applyRenderer(
          layer,
          built.renderer,
          symLayerGroup === "chart"
            ? { chartFields: names, sizeField: sizeResolved?.name ?? null }
            : undefined,
        );
        layer.visible = true;
        lastLegend = built.legend;
      }
      set({
        applied: { ...get().applied, [symLayerGroup]: lastLegend },
        symApplying: false,
        toast: {
          kind: "success",
          message: lastLegend ? `${lastLegend.method} applied to ${symLayerGroup} layers.` : "Symbology applied.",
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
    const map = getMapController() as { zoomToLevel?: (l: AdminLevelId) => Promise<void> } | null;
    if (map?.zoomToLevel) await map.zoomToLevel(level);
  },
  zoomToName: async (name) => {
    const map = getMapController() as { zoomToName?: (l: AdminLevelId, n: string) => Promise<void> } | null;
    if (map?.zoomToName) await map.zoomToName(get().currentLevel(), name);
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
