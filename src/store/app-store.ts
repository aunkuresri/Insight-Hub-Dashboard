import { create } from "zustand";
import { kpiFieldsForGroup, labelForField } from "@/config/indicators";
import {
  ADMIN_LEVELS,
  type AdminLevelId,
  type LayerGroupId,
  type LocationFilters,
  emptyFilters,
} from "@/config/layers";
import { getMapController } from "@/lib/gis/map-controller";
import { resolveField, resolveFieldName, type FieldInfo } from "@/lib/gis/fields";
import { whereForLevel } from "@/lib/gis/where";
import {
  buildBoundaryRenderer,
  buildChartRenderer,
  type AppliedLegend,
} from "@/lib/symbology/renderers";

type Toast = { kind: "info" | "success" | "danger"; message: string } | null;

export type SelectionAncestor = { label: string; value: string };
export type SelectionInfo = {
  unitLabel: string;
  areaName: string;
  ancestors: SelectionAncestor[];
};

type AppliedState = {
  boundary: AppliedLegend | null;
  chart: AppliedLegend | null;
};

type SymFieldsByGroup = Record<LayerGroupId, string[]>;

type AppState = {
  mapReady: boolean;
  mapTitle: string;
  mapScale: number;
  currentAdminLevel: AdminLevelId | null;
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
  analyticsKpis: Array<{ id: string; label: string; value: number | null; insight?: string }>;
  setMapReady: (ready: boolean, title?: string) => void;
  setMapScale: (scale: number, level: AdminLevelId | null) => void;
  setLocationFilter: (level: AdminLevelId, value: string | null) => void;
  clearLocationFilters: () => Promise<void>;
  applyLocationFilters: () => Promise<void>;
  loadNameOptions: (level: AdminLevelId) => Promise<string[]>;
  refreshAnalytics: () => Promise<void>;
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

function describeMethod(legend: AppliedLegend | null): string {
  return legend?.method ?? "symbology";
}

const emptySymFields = (): SymFieldsByGroup => ({ boundary: [], chart: [] });

export const useAppStore = create<AppState>((set, get) => ({
  mapReady: false,
  mapTitle: "",
  mapScale: 0,
  currentAdminLevel: null,
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
  analyticsKpis: [],

  currentLevel: () => get().currentAdminLevel ?? ADMIN_LEVELS[0]?.id ?? "division",

  setMapReady: (ready, title) => set({ mapReady: ready, mapTitle: title ?? get().mapTitle }),
  setMapScale: (scale, level) => set({ mapScale: scale, currentAdminLevel: level }),

  setLocationFilter: (level, value) => {
    const filters = { ...get().locationFilters, [level]: value };
    set({ locationFilters: filters });
  },

  applyLocationFilters: async () => {
    const map = getMapController();
    const filters = get().locationFilters;
    if (map) await map.applyFilters(filters);
    void get().refreshAnalytics();
  },

  clearLocationFilters: async () => {
    const map = getMapController();
    const filters = emptyFilters();
    set({ locationFilters: filters });
    if (map) {
      await map.applyFilters(filters);
      await map.resetExtent();
    }
    void get().refreshAnalytics();
  },

  loadNameOptions: async (levelId) => {
    const map = getMapController();
    if (!map) return [];
    const level = ADMIN_LEVELS.find((l) => l.id === levelId);
    if (!level) return [];
    const layer = map.findLayer(level.layerTitles.boundary);
    if (!layer) return [];
    const nameField = resolveFieldName(map.schemaOf(layer), level.nameField) ?? level.nameField;
    const filters = get().locationFilters;
    let where = "1=1";
    if (level.parentId) {
      const parent = ADMIN_LEVELS.find((l) => l.id === level.parentId);
      const parentVal = filters[level.parentId];
      if (parent && parentVal) {
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
      const names = new Set<string>();
      for (const f of features) {
        const v = f.attributes?.[nameField];
        if (v != null && String(v).trim()) names.add(String(v).trim());
      }
      return [...names].sort((a, b) => a.localeCompare(b));
    } catch {
      try {
        const features = await map.queryAttributes(layer, {
          outFields: [nameField],
          returnGeometry: false,
        });
        const names = new Set<string>();
        for (const f of features) {
          const v = f.attributes?.[nameField];
          if (v != null && String(v).trim()) names.add(String(v).trim());
        }
        return [...names].sort((a, b) => a.localeCompare(b));
      } catch {
        return [];
      }
    }
  },

  refreshAnalytics: async () => {
    const map = getMapController();
    if (!map) return;
    set({ analyticsBusy: true });
    try {
      const levelId = get().currentLevel();
      const level = ADMIN_LEVELS.find((l) => l.id === levelId) ?? ADMIN_LEVELS[0];
      const layer = map.findLayer(level.layerTitles.boundary);
      if (!layer) {
        set({ analyticsBusy: false, analyticsKpis: [] });
        return;
      }
      const state = get();
      const schema = map.schemaOf(layer);
      const where = whereForLevel(level, state.locationFilters) || "1=1";
      const geometry = state.selectionGeometry ?? map.currentExtent();
      const kpis: AppState["analyticsKpis"] = [];
      const count = await map.queryCount(layer, where, geometry);
      kpis.push({ id: "features", label: "Features", value: count });

      const fields = kpiFieldsForGroup("Incident").slice(0, 4);
      for (const field of fields) {
        const fieldId = field.id;
        const resolved = resolveField(schema, fieldId);
        if (!resolved) continue;
        try {
          const stats = await map.queryStats(
            layer,
            [
              {
                statisticType: "sum",
                onStatisticField: resolved.name,
                outStatisticFieldName: "total",
              },
            ],
            where,
            geometry,
          );
          const total = Number(stats?.[0]?.total ?? stats?.[0]?.TOTAL ?? null);
          kpis.push({
            id: fieldId,
            label: field.label || labelForField(fieldId),
            value: Number.isFinite(total) ? total : null,
          });
        } catch {
          kpis.push({
            id: fieldId,
            label: field.label || labelForField(fieldId),
            value: null,
          });
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
          message: lastLegend
            ? `${lastLegend.method} applied to ${symLayerGroup} layers.`
            : "Symbology applied.",
        },
      });
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
    set({
      applied: { ...get().applied, [target]: null },
      symFieldsByGroup: { ...get().symFieldsByGroup, [target]: [] },
      toast: { kind: "info", message: `${target} symbology reset.` },
    });
  },

  zoomToLevel: async (level) => {
    const map = getMapController();
    if (!map) return;
    if (typeof (map as { zoomToLevel?: (l: typeof level) => Promise<void> }).zoomToLevel === "function") {
      await (map as { zoomToLevel: (l: typeof level) => Promise<void> }).zoomToLevel(level);
    }
  },
  zoomToName: async (name) => {
    const map = getMapController();
    if (!map) return;
    const m = map as { zoomToName?: (l: string, n: string) => Promise<void> };
    if (typeof m.zoomToName === "function") await m.zoomToName(get().currentLevel(), name);
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
