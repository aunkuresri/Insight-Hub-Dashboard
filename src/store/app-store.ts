import { create } from "zustand";
import { getAppConfig } from "@/config/app-config";
import { INDICATOR_GROUPS, labelForField } from "@/config/indicators";
import {
  ADMIN_LEVELS,
  type AdminLevelId,
  type LayerGroupId,
  type LocationFilters,
  emptyLocationFilters,
} from "@/config/layers";
import type { FieldInfo } from "@/lib/gis/fields";
import { resolveField } from "@/lib/gis/fields";
import { createMapController, getMapController, type MapController } from "@/lib/gis/map-controller";
import { buildBoundaryRenderer, buildChartRenderer, describeMethod, type AppliedLegend } from "@/lib/symbology/renderers";
import { DEFAULT_SCHEME_BY_METHOD } from "@/config/symbology-schemes";

type Toast = { kind: "info" | "success" | "danger"; message: string } | null;

type AnalyticsSnapshot = {
  kpis: Array<{ id: string; label: string; value: number | string; insight?: string }>;
  charts: Array<{
    id: string;
    title: string;
    description?: string;
    type: "pie" | "bar";
    data: Array<{ name: string; value: number; color?: string }>;
  }>;
  ranking: Array<Record<string, string | number>>;
  rankingColumns: string[];
};

type AppState = {
  mapReady: boolean;
  mapError: string | null;
  scale: number;
  adminLevel: AdminLevelId;
  filters: LocationFilters;
  filterDraft: LocationFilters;
  filterOptions: Record<AdminLevelId, string[]>;
  applied: Record<LayerGroupId, AppliedLegend | null>;
  symLayerGroup: LayerGroupId;
  symFieldsByGroup: Record<LayerGroupId, string[]>;
  symScheme: string;
  symSizeField: string;
  symApplying: boolean;
  analytics: AnalyticsSnapshot | null;
  analyticsBusy: boolean;
  toast: Toast;
  initMap: (container: HTMLDivElement) => Promise<void>;
  destroyMap: () => void;
  setFilterDraft: (level: AdminLevelId, value: string) => void;
  applyFilters: () => Promise<void>;
  clearFilters: () => Promise<void>;
  loadFilterOptions: () => Promise<void>;
  setSymLayerGroup: (g: LayerGroupId) => void;
  toggleSymField: (id: string) => void;
  clearSymFields: () => void;
  setSymScheme: (scheme: string) => void;
  setSymSizeField: (id: string) => void;
  applySymbology: () => Promise<void>;
  resetSymbology: (group?: LayerGroupId) => void;
  refreshAnalytics: () => Promise<void>;
  showToast: (t: Toast) => void;
};

const emptyAnalytics = (): AnalyticsSnapshot => ({
  kpis: [],
  charts: [],
  ranking: [],
  rankingColumns: [],
});

export const useAppStore = create<AppState>((set, get) => ({
  mapReady: false,
  mapError: null,
  scale: 0,
  adminLevel: "division",
  filters: emptyLocationFilters(),
  filterDraft: emptyLocationFilters(),
  filterOptions: { division: [], district: [], upazila: [], union: [] },
  applied: { boundary: null, chart: null },
  symLayerGroup: "boundary",
  symFieldsByGroup: { boundary: [], chart: [] },
  symScheme: DEFAULT_SCHEME_BY_METHOD["Quantile choropleth"] ?? "Blues",
  symSizeField: "",
  symApplying: false,
  analytics: null,
  analyticsBusy: false,
  toast: null,

  initMap: async (container) => {
    try {
      const map = await createMapController(container, {
        onReady: () => set({ mapReady: true, mapError: null }),
        onScale: (level, scale) => set({ adminLevel: level, scale }),
        onError: (message) => set({ mapError: message, mapReady: false }),
      });
      void get().loadFilterOptions();
      void map;
    } catch (err) {
      set({
        mapReady: false,
        mapError: err instanceof Error ? err.message : "Map failed to load",
      });
    }
  },

  destroyMap: () => {
    const map = getMapController();
    map?.destroy();
    set({ mapReady: false });
  },

  setFilterDraft: (level, value) => {
    const draft = { ...get().filterDraft, [level]: value };
    // Cascade clear deeper levels
    const order: AdminLevelId[] = ["division", "district", "upazila", "union"];
    const idx = order.indexOf(level);
    for (let i = idx + 1; i < order.length; i++) {
      draft[order[i]!] = "";
    }
    set({ filterDraft: draft });
  },

  applyFilters: async () => {
    const map = getMapController();
    if (!map) return;
    const filters = { ...get().filterDraft };
    set({ filters });
    await map.applyFilters(filters);
    void get().refreshAnalytics();
  },

  clearFilters: async () => {
    const empty = emptyLocationFilters();
    set({ filters: empty, filterDraft: empty });
    const map = getMapController();
    if (map) await map.applyFilters(empty);
    void get().refreshAnalytics();
  },

  loadFilterOptions: async () => {
    const map = getMapController();
    if (!map) return;
    const options: Record<AdminLevelId, string[]> = {
      division: [],
      district: [],
      upazila: [],
      union: [],
    };
    for (const level of ADMIN_LEVELS) {
      const layer = map.findLayer(level.layerTitles.boundary);
      if (!layer) continue;
      try {
        const features = await map.queryAttributes(layer, {
          outFields: [level.nameField],
          returnDistinctValues: true,
          returnGeometry: false,
          num: 5000,
        });
        const names = new Set<string>();
        for (const f of features) {
          const v = f.attributes?.[level.nameField];
          if (v != null && String(v).trim()) names.add(String(v).trim());
        }
        options[level.id] = [...names].sort((a, b) => a.localeCompare(b));
      } catch {
        options[level.id] = [];
      }
    }
    set({ filterOptions: options });
  },

  setSymLayerGroup: (g) => {
    const method = describeMethod(g, (get().symFieldsByGroup[g] ?? []).length || 1);
    set({
      symLayerGroup: g,
      symScheme: DEFAULT_SCHEME_BY_METHOD[method] ?? get().symScheme,
    });
  },

  toggleSymField: (id) => {
    const g = get().symLayerGroup;
    const current = get().symFieldsByGroup[g] ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    set({
      symFieldsByGroup: { ...get().symFieldsByGroup, [g]: next },
      symScheme:
        DEFAULT_SCHEME_BY_METHOD[describeMethod(g, next.length || 1)] ?? get().symScheme,
    });
  },

  clearSymFields: () => {
    const g = get().symLayerGroup;
    set({ symFieldsByGroup: { ...get().symFieldsByGroup, [g]: [] } });
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
          message: `Applied ${lastLegend?.method ?? "symbology"} to ${symLayerGroup} layers.`,
        },
      });
      map.syncLegendFilter(get().applied);
      void get().refreshAnalytics();
    } catch (err) {
      set({
        symApplying: false,
        toast: {
          kind: "danger",
          message: err instanceof Error ? err.message : "Failed to apply symbology.",
        },
      });
    }
  },

  resetSymbology: (group) => {
    const map = getMapController();
    map?.resetRenderers(group);
    if (group) {
      set({ applied: { ...get().applied, [group]: null } });
    } else {
      set({ applied: { boundary: null, chart: null } });
    }
    map?.syncLegendFilter(get().applied);
  },

  refreshAnalytics: async () => {
    /* analytics refresh is handled by analytics panel / map kpi bar consumers */
    set({ analyticsBusy: false });
  },

  showToast: (t) => set({ toast: t }),
}));

export type { AppliedLegend, AnalyticsSnapshot, Toast };
