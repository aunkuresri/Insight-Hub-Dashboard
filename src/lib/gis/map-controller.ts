/**
 * ArcGIS Maps SDK controller.
 *
 * All @arcgis/core imports are dynamic so this module is safe to parse during
 * SSR. Call `createMapController` only in the browser.
 */

import { getAppConfig } from "@/config/app-config";
import {
  ADMIN_LEVELS,
  type AdminLevel,
  type AdminLevelId,
  type LayerGroupId,
  type LocationFilters,
  scaleToLevel,
} from "@/config/layers";
import { toFieldInfoFromEsri, type FieldInfo } from "@/lib/gis/fields";
import { whereForLevel } from "@/lib/gis/where";
import type { AppliedLegend, EsriRenderer } from "@/lib/symbology/renderers";

type EsriModules = {
  esriConfig: { portalUrl: string; assetsPath: string; request: { timeout: number } };
  WebMap: new (props: unknown) => EsriWebMap;
  MapView: new (props: unknown) => EsriMapView;
  Zoom: new (props: unknown) => { destroy: () => void };
  Home: new (props: unknown) => { destroy: () => void };
  Expand: new (props: unknown) => { content: unknown; destroy: () => void };
  Legend: new (props: unknown) => {
    destroy: () => void;
    layerInfos?: Array<{ layer: unknown }>;
  };
  BasemapGallery: new (props: unknown) => { destroy: () => void };
  LayerList: new (props: unknown) => { destroy: () => void };
  ScaleBar: new (props: unknown) => { destroy: () => void };
  PopupTemplate: new (props: unknown) => unknown;
  jsonUtils: { fromJSON: (json: unknown) => unknown };
};

type EsriWebMap = {
  portalItem?: { title?: string };
  basemap?: unknown;
  load: () => Promise<unknown>;
  allLayers: { toArray: () => EsriLayer[] };
  layers: { toArray: () => EsriLayer[] };
  /** Standalone hosted tables (CSV / table items) — not in allLayers. */
  tables?: { toArray: () => EsriLayer[] };
  destroy?: () => void;
};

export type EsriLayer = {
  id: string;
  title: string;
  type: string;
  visible: boolean;
  opacity: number;
  minScale: number;
  maxScale: number;
  objectIdField?: string;
  globalIdField?: string;
  definitionExpression?: string;
  renderer?: unknown;
  fields?: Array<{ name: string; alias?: string; type: string }>;
  outFields?: string[] | string;
  popupTemplate?: unknown;
  popupEnabled?: boolean;
  queryFeatures: (query: Record<string, unknown>) => Promise<{
    features: EsriFeature[];
    exceededTransferLimit?: boolean;
  }>;
  queryExtent: (query: Record<string, unknown>) => Promise<{ extent: unknown; count: number }>;
  queryFeatureCount: (query: Record<string, unknown>) => Promise<number>;
  createQuery?: () => Record<string, unknown>;
  url?: string;
  applyEdits?: (edits: {
    updateFeatures?: Array<{ attributes: Record<string, unknown> }>;
  }) => Promise<{ updateFeatureResults?: Array<{ objectId?: number; error?: unknown }> }>;
};

export type EsriFeature = {
  attributes: Record<string, unknown>;
  geometry?: unknown;
};

type EsriMapView = {
  container: HTMLDivElement | string | null;
  map: EsriWebMap;
  scale: number;
  ready: boolean;
  padding: { left: number; right: number; top: number; bottom: number };
  popup: {
    autoOpenEnabled: boolean;
    dockEnabled: boolean;
    dockOptions: unknown;
    defaultPopupTemplateEnabled?: boolean;
    visible?: boolean;
  };
  ui: {
    add: (w: unknown, pos?: string) => void;
    remove: (w: unknown) => void;
    empty: (pos?: string) => void;
    components: string[];
    padding: { left: number; right: number; top: number; bottom: number };
  };
  when: () => Promise<void>;
  goTo: (target: unknown, opts?: unknown) => Promise<unknown>;
  watch: (prop: string, cb: (v: unknown) => void) => { remove: () => void };
  whenLayerView: (layer: EsriLayer) => Promise<{ highlight: (id: unknown) => { remove: () => void } }>;
  hitTest: (e: unknown) => Promise<{ results: Array<{ graphic?: EsriFeature; layer?: EsriLayer }> }>;
  on: (event: string, cb: (e: unknown) => void) => { remove: () => void };
  destroy: () => void;
  viewpoint: { clone: () => unknown };
  extent: unknown;
  animation?: unknown;
};

export type MapFeatureSelectPayload = {
  name: string;
  geometry: unknown;
  info: {
    unitLabel: string;
    areaName: string;
    ancestors: Array<{ label: string; value: string }>;
  };
};

export type MapEvents = {
  onReady?: () => void;
  onScale?: (level: AdminLevelId, scale: number) => void;
  onExtentSettled?: () => void;
  onError?: (message: string) => void;
  onOpenLeftPanel?: () => void;
  onOpenRightPanel?: () => void;
  /** Fired when the user clicks a boundary polygon on the map. */
  onFeatureSelect?: (payload: MapFeatureSelectPayload | null) => void;
};

function isChartLayer(layer: EsriLayer): boolean {
  return /chart/i.test(layer.title || "");
}

async function loadEsri(): Promise<EsriModules> {
  const [
    configMod,
    webmapMod,
    viewMod,
    zoomMod,
    homeMod,
    expandMod,
    legendMod,
    basemapGalleryMod,
    layerListMod,
    scaleMod,
    popupTemplateMod,
    jsonMod,
  ] = await Promise.all([
    import("@arcgis/core/config.js"),
    import("@arcgis/core/WebMap.js"),
    import("@arcgis/core/views/MapView.js"),
    import("@arcgis/core/widgets/Zoom.js"),
    import("@arcgis/core/widgets/Home.js"),
    import("@arcgis/core/widgets/Expand.js"),
    import("@arcgis/core/widgets/Legend.js"),
    import("@arcgis/core/widgets/BasemapGallery.js"),
    import("@arcgis/core/widgets/LayerList.js"),
    import("@arcgis/core/widgets/ScaleBar.js"),
    import("@arcgis/core/PopupTemplate.js"),
    import("@arcgis/core/renderers/support/jsonUtils.js"),
  ]);
  return {
    esriConfig: configMod.default as EsriModules["esriConfig"],
    WebMap: webmapMod.default as unknown as EsriModules["WebMap"],
    MapView: viewMod.default as unknown as EsriModules["MapView"],
    Zoom: zoomMod.default as unknown as EsriModules["Zoom"],
    Home: homeMod.default as unknown as EsriModules["Home"],
    Expand: expandMod.default as unknown as EsriModules["Expand"],
    Legend: legendMod.default as unknown as EsriModules["Legend"],
    BasemapGallery: basemapGalleryMod.default as unknown as EsriModules["BasemapGallery"],
    LayerList: layerListMod.default as unknown as EsriModules["LayerList"],
    ScaleBar: scaleMod.default as unknown as EsriModules["ScaleBar"],
    PopupTemplate: popupTemplateMod.default as unknown as EsriModules["PopupTemplate"],
    jsonUtils: jsonMod as EsriModules["jsonUtils"],
  };
}

export class MapController {
  view: EsriMapView | null = null;
  webmap: EsriWebMap | null = null;
  legendHost: HTMLDivElement | null = null;
  private esriLegendHost: HTMLElement | null = null;
  private esriLegend: {
    destroy: () => void;
    layerInfos?: Array<{ layer: unknown }>;
  } | null = null;
  private legendExpand: { content: unknown; destroy: () => void } | null = null;
  private modules: EsriModules | null = null;
  private originalRenderers = new Map<string, unknown>();
  private originalPopupTemplates = new Map<string, unknown>();

  private chartCalloutLayer: {
    removeAll: () => void;
    addMany: (g: unknown[]) => void;
    visible: boolean;
  } | null = null;

  /** Client-side FeatureLayers with joined indicator attrs for pie charts. */
  private joinedChartLayers = new Map<
    string,
    { layer: EsriLayer; originalId: string; originalVisible: boolean }
  >();

  private initialViewpoint: unknown = null;
  private handles: Array<{ remove: () => void }> = [];
  private highlightHandle: { remove: () => void } | null = null;
  private widgets: Array<{ destroy: () => void }> = [];
  private filterToggleBtn: HTMLButtonElement | null = null;
  private symbologyToggleBtn: HTMLButtonElement | null = null;
  private clearSelectionBtn: HTMLButtonElement | null = null;
  private onOpenLeft: (() => void) | null = null;
  private onOpenRight: (() => void) | null = null;
  private onClearSelection: (() => void) | null = null;
  private extentOverride: unknown | null = null;

  async init(container: HTMLDivElement, events: MapEvents = {}): Promise<void> {
    const config = getAppConfig();
    const modules = await loadEsri();
    this.modules = modules;

    modules.esriConfig.portalUrl = config.portalUrl;
    modules.esriConfig.assetsPath = `https://js.arcgis.com/${config.arcgisVersion}/@arcgis/core/assets`;
    modules.esriConfig.request.timeout = 90_000;

    if (config.oauthAppId && config.oauthAppId !== "YOUR_ENTERPRISE_APP_ID") {
      const [IdentityManagerMod, OAuthInfoMod] = await Promise.all([
        import("@arcgis/core/identity/IdentityManager.js"),
        import("@arcgis/core/identity/OAuthInfo.js"),
      ]);
      const IdentityManager = IdentityManagerMod.default as {
        registerOAuthInfos: (i: unknown[]) => void;
        checkSignInStatus: (url: string) => Promise<{ token?: string }>;
        getCredential: (url: string) => Promise<{ token?: string }>;
      };
      const OAuthInfo = OAuthInfoMod.default as new (p: unknown) => unknown;

      IdentityManager.registerOAuthInfos([
        new OAuthInfo({
          appId: config.oauthAppId,
          portalUrl: config.portalUrl,
          popup: false,
        }),
      ]);

      try {
        await IdentityManager.checkSignInStatus(config.portalUrl);
      } catch {
        await IdentityManager.getCredential(config.portalUrl);
      }
    }

    const webmap = new modules.WebMap({
      portalItem: { id: config.webmapId, portal: { url: config.portalUrl } },
    });

    const view = new modules.MapView({
      container,
      map: webmap,
      constraints: { snapToZoom: false },
      ui: { components: ["attribution"] },
      popup: {
        autoOpenEnabled: true,
        defaultPopupTemplateEnabled: true,
        dockEnabled: false,
      },
    });

    try {
      if (view.popup) {
        view.popup.autoOpenEnabled = true;
        view.popup.dockEnabled = false;
        view.popup.defaultPopupTemplateEnabled = true;
      }
    } catch {
      /* popup chrome is optional */
    }

    this.webmap = webmap;
    this.view = view;

    try {
      await view.when();
    } catch (err) {
      const message = err instanceof Error ? err.message : "The web map failed to load.";
      events.onError?.(message);
      throw err;
    }

    this.initialViewpoint = view.viewpoint.clone();

    const legendRoot = document.createElement("div");
    legendRoot.className = "map-legend-root";

    const customHost = document.createElement("div");
    customHost.className = "custom-smart-legend";
    this.legendHost = customHost;

    const esriHost = document.createElement("div");
    esriHost.className = "esri-smart-legend-host";
    this.esriLegendHost = esriHost;

    legendRoot.append(customHost, esriHost);

    const esriLegend = new modules.Legend({
      view,
      container: esriHost,
      hideLayersNotInCurrentView: true,
    });
    this.esriLegend = esriLegend;

    const zoom = new modules.Zoom({ view, layout: "horizontal" });
    const home = new modules.Home({ view });

    this.legendExpand = null;

    const basemapGallery = new modules.BasemapGallery({ view });
    const basemapExpand = new modules.Expand({
      view,
      content: basemapGallery,
      expandIcon: "basemap",
      expandTooltip: "Basemap",
      group: "top-left-tools",
      mode: "floating",
    });
    const layerList = new modules.LayerList({ view });
    const layerListExpand = new modules.Expand({
      view,
      content: layerList,
      expandIcon: "layers",
      expandTooltip: "Layers",
      group: "top-left-tools",
      mode: "floating",
    });
    const scaleBar = new modules.ScaleBar({ view, unit: "metric", style: "ruler" });

    view.ui.add(home, "top-left");
    view.ui.add(basemapExpand, "top-left");
    view.ui.add(layerListExpand, "top-left");
    view.ui.add(zoom, "bottom-left");
    view.ui.add(scaleBar, "bottom-right");

    // Clear selection — icon-only, same Esri widget style as Basemap, directly below it
    this.clearSelectionBtn = document.createElement("button");
    this.clearSelectionBtn.type = "button";
    this.clearSelectionBtn.className = "esri-widget esri-widget--button";
    this.clearSelectionBtn.title = "Clear selection";
    this.clearSelectionBtn.setAttribute("aria-label", "Clear selection");
    this.clearSelectionBtn.innerHTML = `<calcite-icon icon="reset" scale="m"></calcite-icon>`;
    this.clearSelectionBtn.addEventListener("click", () => this.onClearSelection?.());
    this.clearSelectionBtn.style.display = "none";
    view.ui.add(this.clearSelectionBtn, "top-left");

    this.onOpenLeft = events.onOpenLeftPanel ?? null;
    this.onOpenRight = events.onOpenRightPanel ?? null;

    this.filterToggleBtn = this.createPanelToggleButton({
      title: "Smart Symbology",
      icon: "classify-pixels",
      onClick: () => this.onOpenLeft?.(),
    });
    this.symbologyToggleBtn = this.createPanelToggleButton({
      title: "Legends",
      icon: "legend",
      onClick: () => this.onOpenRight?.(),
    });
    view.ui.add(this.filterToggleBtn, "top-left");
    view.ui.add(this.symbologyToggleBtn, "top-right");
    this.filterToggleBtn.style.display = "none";
    this.symbologyToggleBtn.style.display = "none";

    this.widgets.push(
      zoom,
      home,
      esriLegend,
      basemapGallery,
      basemapExpand,
      layerList,
      layerListExpand,
      scaleBar,
    );

    for (const layer of this.featureLayers()) {
      this.originalRenderers.set(layer.id, layer.renderer);
      this.originalPopupTemplates.set(layer.id, layer.popupTemplate ?? null);

      if (isChartLayer(layer)) {
        layer.popupEnabled = false;
        continue;
      }

      layer.popupEnabled = true;
      if (!layer.outFields || (Array.isArray(layer.outFields) && layer.outFields.length === 0)) {
        layer.outFields = ["*"];
      }
    }

    this.handles.push(
      view.watch("scale", () => {
        if (!this.view) return;
        events.onScale?.(scaleToLevel(this.view.scale), this.view.scale);
      }),
    );

    this.handles.push(
      view.watch("stationary", (stationary) => {
        if (!this.view || !stationary) return;
        events.onScale?.(scaleToLevel(this.view.scale), this.view.scale);
        events.onExtentSettled?.();
      }),
    );

    events.onScale?.(scaleToLevel(view.scale), view.scale);

    this.handles.push(
      view.on("click", (event) => {
        void this.handleMapClick(event, events);
      }),
    );

    events.onReady?.();
  }

  private createPanelToggleButton(opts: {
    title: string;
    icon: string;
    onClick: () => void;
  }): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "esri-widget esri-widget--button map-panel-toggle-btn";
    btn.title = opts.title;
    btn.setAttribute("aria-label", opts.title);
    btn.innerHTML = `<calcite-icon icon="${opts.icon}" scale="s"></calcite-icon>`;
    btn.addEventListener("click", () => opts.onClick());
    return btn;
  }

  syncLegendFilter(applied: { boundary: AppliedLegend | null; chart: AppliedLegend | null }): void {
    if (!this.esriLegend) return;

    const bothApplied = Boolean(applied.boundary && applied.chart);
    if (bothApplied) {
      this.esriLegend.layerInfos = [];
      if (this.esriLegendHost) this.esriLegendHost.style.display = "none";
      return;
    }

    const layers = this.featureLayers().filter((layer) => {
      const isChart = isChartLayer(layer);
      if (isChart && applied.chart) return false;
      if (!isChart && applied.boundary) return false;
      return true;
    });

    this.esriLegend.layerInfos = layers.map((layer) => ({ layer }));
    if (this.esriLegendHost) {
      this.esriLegendHost.style.display = layers.length ? "" : "none";
    }
  }

  featureLayers(): EsriLayer[] {
    if (!this.webmap) return [];
    return this.webmap.allLayers.toArray().filter((layer) => layer.type === "feature");
  }

  /** Geometry feature layers + standalone tables (hosted CSV tables live here). */
  allDataLayers(): EsriLayer[] {
    if (!this.webmap) return [];
    const byId = new Map<string, EsriLayer>();
    for (const layer of this.webmap.allLayers.toArray()) {
      if (layer.type === "feature" || layer.type === "table") {
        byId.set(layer.id || layer.title || String(byId.size), layer);
      }
    }
    try {
      const tables = this.webmap.tables?.toArray?.() ?? [];
      for (const layer of tables) {
        byId.set(layer.id || layer.title || String(byId.size), layer);
      }
    } catch {
      /* tables collection optional */
    }
    return Array.from(byId.values());
  }

  findLayer(title: string): EsriLayer | null {
    const wanted = title.trim().toLowerCase();
    const norm = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\.csv$/i, "")
        .replace(/[\s_\-]+/g, "");
    const wantedNorm = norm(wanted);
    const layers = this.allDataLayers();
    const exact = layers.find((layer) => (layer.title || "").trim().toLowerCase() === wanted);
    if (exact) return exact;
    // with/without .csv
    const alt = wanted.endsWith(".csv") ? wanted.slice(0, -4) : `${wanted}.csv`;
    const altHit = layers.find((layer) => (layer.title || "").trim().toLowerCase() === alt);
    if (altHit) return altHit;
    const byNorm = layers.find((layer) => norm(layer.title || "") === wantedNorm);
    if (byNorm) return byNorm;
    const soft = layers.find((layer) => {
      const t = (layer.title || "").trim().toLowerCase();
      return t.includes(wanted) || wanted.includes(t);
    });
    return soft ?? null;
  }

  layersFor(group: LayerGroupId, levelId: AdminLevelId | "all"): EsriLayer[] {
    const levels = levelId === "all" ? ADMIN_LEVELS : ADMIN_LEVELS.filter((l) => l.id === levelId);
    const found: EsriLayer[] = [];
    for (const level of levels) {
      const layer = this.findLayer(level.layerTitles[group]);
      if (layer) found.push(layer);
    }
    return found;
  }

  schemaOf(layer: EsriLayer): FieldInfo[] {
    return toFieldInfoFromEsri(layer.fields ?? []);
  }

  /**
   * Apply admin + Unit filters to all boundary/chart layers.
   * Unit is applied when the layer has a Unit field; otherwise names matching
   * that Unit are loaded from the hosted admin table and used in an IN clause.
   */
  async applyFilters(filters: LocationFilters, unit?: string | null): Promise<void> {
    const unitTrim = unit?.trim() || null;
    // Deepest selected admin filter (union > upazila > district > division).
    // Coarser boundary/chart layers are hidden so e.g. selecting a Union does not
    // leave the full Upazila polygon visible underneath.
    const levelOrder = ADMIN_LEVELS.map((l) => l.id);
    const deepestIdx = [...levelOrder]
      .map((id, i) => (filters[id] ? i : -1))
      .filter((i) => i >= 0)
      .reduce((a, b) => Math.max(a, b), -1);

    // Pre-load name lists per level when Unit is set but may not exist on geometry.
    const namesByLevel = new Map<string, string[]>();
    if (unitTrim) {
      for (const level of ADMIN_LEVELS) {
        try {
          const names = await this.namesForUnitOnLevel(level, unitTrim, filters);
          if (names.length) namesByLevel.set(level.id, names);
        } catch {
          /* table optional */
        }
      }
    }

    for (let li = 0; li < ADMIN_LEVELS.length; li++) {
      const level = ADMIN_LEVELS[li]!;
      // Hide coarser levels when a finer filter is active (e.g. hide Upazila when Union is set).
      const hideCoarser = deepestIdx >= 0 && li < deepestIdx;

      for (const group of ["boundary", "chart"] as LayerGroupId[]) {
        const layer = this.findLayer(level.layerTitles[group]);
        if (!layer) continue;

        let expression: string;
        if (hideCoarser) {
          expression = "1=0";
        } else {
          const schema = this.schemaOf(layer);
          const hasUnit = schema.some((f) => f.name.toLowerCase() === "unit");
          expression = whereForLevel(level, filters, hasUnit ? unitTrim : null) || "1=1";
          if (unitTrim && !hasUnit) {
            const names = namesByLevel.get(level.id) ?? [];
            if (names.length) {
              const nameField = level.nameField;
              const inList = names
                .map((n) => `'${n.replaceAll("'", "''")}'`)
                .join(",");
              const nameClause = `${nameField} IN (${inList})`;
              expression =
                expression && expression !== "1=1"
                  ? `(${expression}) AND (${nameClause})`
                  : nameClause;
            }
          }
          if (!expression) expression = "1=1";
        }

        layer.definitionExpression = expression;
        try {
          (layer as { refresh?: () => void }).refresh?.();
        } catch {
          /* optional */
        }

        // Client-side joined chart layers must follow the same filter
        const joined = this.joinedChartLayers.get(layer.id);
        if (joined?.layer) {
          const jl = joined.layer as EsriLayer & {
            definitionExpression?: string;
            refresh?: () => void;
          };
          jl.definitionExpression = expression;
          try {
            jl.refresh?.();
          } catch {
            /* optional */
          }
          // Hide joined chart when parent chart is hidden (coarser level)
          if (hideCoarser) {
            jl.visible = false;
          } else {
            jl.visible = true;
          }
        }
      }
    }
    await this.zoomToFilters(filters, unitTrim);
  }

  /** Admin feature names at a level that belong to the given Unit (from hosted table). */
  private async namesForUnitOnLevel(
    level: (typeof ADMIN_LEVELS)[number],
    unit: string,
    filters: LocationFilters,
  ): Promise<string[]> {
    const table = this.findLayer(level.tableTitle);
    if (!table) return [];
    const unitEsc = unit.replaceAll("'", "''");
    const clauses = [`Unit = '${unitEsc}'`];
    if (filters.division && level.id !== "division") {
      clauses.push(`adm1_en = '${filters.division.replaceAll("'", "''")}'`);
    }
    if (filters.district && (level.id === "upazila" || level.id === "union")) {
      clauses.push(`adm2_en = '${filters.district.replaceAll("'", "''")}'`);
    }
    if (filters.upazila && level.id === "union") {
      clauses.push(`adm3_en = '${filters.upazila.replaceAll("'", "''")}'`);
    }
    const where = clauses.join(" AND ");
    try {
      const features = await this.queryAttributes(table, {
        where,
        outFields: [level.nameField],
        returnGeometry: false,
        returnDistinctValues: true,
        num: 5000,
      });
      const names = new Set<string>();
      for (const f of features) {
        const v = f.attributes?.[level.nameField];
        if (v != null && String(v).trim()) names.add(String(v).trim());
      }
      return Array.from(names);
    } catch {
      return [];
    }
  }

  async applyEdits(
    layer: EsriLayer,
    updates: Array<{ attributes: Record<string, unknown> }>,
  ): Promise<{ updated: number }> {
    if (!updates.length) return { updated: 0 };

    const oidField = this.resolveObjectIdFieldName(layer);

    const normalized = updates.map((u) => {
      const attrs = { ...(u.attributes ?? {}) };
      let oid: unknown = undefined;
      for (const key of Object.keys(attrs)) {
        if (key.toLowerCase() === "objectid" || key.toLowerCase() === "fid" || key.toLowerCase() === "oid") {
          oid = attrs[key];
          delete attrs[key];
        }
      }
      if (oid == null && oidField && attrs[oidField] != null) {
        oid = attrs[oidField];
      }
      if (oid != null && oidField) {
        attrs[oidField] = oid;
      }
      for (const key of Object.keys(attrs)) {
        if (
          key !== oidField &&
          (key.toLowerCase() === "objectid" || key.toLowerCase() === "fid" || key.toLowerCase() === "oid")
        ) {
          delete attrs[key];
        }
      }
      return { attributes: attrs };
    });

    // REST applyEdits — exact field names (avoids JS API OBJECTID rewrite).
    const layerUrl = typeof layer.url === "string" ? layer.url.replace(/\/$/, "") : "";
    if (layerUrl && /\/FeatureServer\/\d+$/i.test(layerUrl)) {
      return this.applyEditsRest(layer, layerUrl, oidField, normalized);
    }

    if (typeof layer.applyEdits !== "function") {
      throw new Error(
        `Layer "${layer.title}" does not support applyEdits. Confirm the feature service allows updates.`,
      );
    }
    try {
      (layer as { objectIdField?: string }).objectIdField = oidField;
    } catch {
      /* ignore */
    }
    const result = await layer.applyEdits({ updateFeatures: normalized });
    const rows = result?.updateFeatureResults ?? [];
    const failed = rows.filter((r) => r.error);
    if (failed.length === rows.length && rows.length > 0) {
      const first = failed[0]?.error;
      let detail = "";
      if (first && typeof first === "object") {
        const e = first as Record<string, unknown>;
        detail = String(e.message ?? e.description ?? e.details ?? "").trim();
      } else if (typeof first === "string") {
        detail = first.trim();
      }
      throw new Error(
        detail
          ? `Edit failed on "${layer.title}": ${detail}`
          : `All ${failed.length} edit(s) failed on "${layer.title}". Sign in to ArcGIS with edit rights, or enable editing on the service.`,
      );
    }
    return { updated: rows.filter((r) => !r.error).length || updates.length };
  }

  /** REST applyEdits — same path as Pro toolbox fl.edit_features. */
  private async applyEditsRest(
    layer: EsriLayer,
    layerUrl: string,
    oidField: string,
    normalized: Array<{ attributes: Record<string, unknown> }>,
  ): Promise<{ updated: number }> {
    let token = "";
    try {
      const IdentityManager = await import("@arcgis/core/identity/IdentityManager.js");
      const im = (
        IdentityManager as {
          default: {
            findCredential?: (url: string) => { token?: string } | null;
            checkSignInStatus?: (url: string) => Promise<{ token?: string }>;
          };
        }
      ).default;
      const cred = im.findCredential?.(layerUrl) ?? null;
      if (cred?.token) {
        token = cred.token;
      } else if (typeof im.checkSignInStatus === "function") {
        try {
          const signed = await im.checkSignInStatus(layerUrl);
          if (signed?.token) token = signed.token;
        } catch {
          /* anonymous */
        }
      }
    } catch {
      /* identity optional */
    }

    const BATCH = 250;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < normalized.length; i += BATCH) {
      const batch = normalized.slice(i, i + BATCH);
      const body = new URLSearchParams();
      body.set("f", "json");
      body.set("rollbackOnFailure", "false");
      body.set("updates", JSON.stringify(batch.map((u) => ({ attributes: u.attributes }))));
      if (token) body.set("token", token);

      const res = await fetch(`${layerUrl}/applyEdits`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      let json: {
        updateResults?: Array<{
          success?: boolean;
          objectId?: number;
          error?: { description?: string; code?: number };
        }>;
        error?: { message?: string; details?: string[] };
      };
      try {
        json = await res.json();
      } catch {
        throw new Error(`Edit failed on "${layer.title}": invalid response from applyEdits.`);
      }

      if (json.error) {
        const msg = json.error.message || json.error.details?.join("; ") || "applyEdits error";
        throw new Error(`Edit failed on "${layer.title}": ${msg}`);
      }

      const rows = json.updateResults ?? [];
      for (const r of rows) {
        if (r.success) updated++;
        else errors.push(r.error?.description || `code ${r.error?.code ?? "?"}`);
      }
    }

    if (!updated && errors.length) {
      throw new Error(
        `Edit failed on "${layer.title}": ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}. OID field used: ${oidField}.`,
      );
    }
    if (!updated) updated = normalized.length;
    return { updated };
  }

  /**
   * Prefer the oid field from schema by type (esriFieldTypeOID / oid), same as
   * the Pro toolbox. Do not trust layer.objectIdField first — it is often
   * "OBJECTID" while the hosted feature service field is "objectid".
   */
  private resolveObjectIdFieldName(layer: EsriLayer): string {
    const fields = layer.fields ?? [];
    const byType = fields.find((f) => {
      const t = (f.type || "").toLowerCase();
      return t === "oid" || t === "esrifieldtypeoid" || t.includes("oid");
    });
    if (byType) return byType.name;
    for (const name of ["objectid", "OBJECTID", "ObjectId", "fid", "FID", "oid", "OID"]) {
      const hit = fields.find((f) => f.name === name);
      if (hit) return hit.name;
    }
    const lower = fields.find(
      (f) =>
        f.name.toLowerCase() === "objectid" ||
        f.name.toLowerCase() === "fid" ||
        f.name.toLowerCase() === "oid",
    );
    if (lower) return lower.name;
    if (typeof layer.objectIdField === "string" && layer.objectIdField.trim()) {
      return layer.objectIdField.trim();
    }
    return "objectid";
  }


  setExtentOverride(extent: unknown | null): void {
    if (!extent) {
      this.extentOverride = null;
      return;
    }
    const ext = extent as { clone?: () => unknown };
    this.extentOverride = typeof ext.clone === "function" ? ext.clone() : extent;
  }

  currentExtent(): unknown | null {
    if (this.extentOverride) {
      const ext = this.extentOverride as { clone?: () => unknown };
      return typeof ext.clone === "function" ? ext.clone() : this.extentOverride;
    }
    if (!this.view?.extent) return null;
    const ext = this.view.extent as { clone?: () => unknown };
    return typeof ext.clone === "function" ? ext.clone() : this.view.extent;
  }

  async zoomToFilters(filters: LocationFilters, unit?: string | null): Promise<void> {
    if (!this.view) return;
    // Prefer deepest admin selection; if only Unit is set, zoom on District layer by Unit.
    const deepest = [...ADMIN_LEVELS].reverse().find((level) => filters[level.id]);
    if (!deepest && !(unit && unit.trim())) {
      await this.resetExtent();
      return;
    }
    const targetLevel = deepest ?? ADMIN_LEVELS.find((l) => l.id === "district") ?? ADMIN_LEVELS[0]!;
    const layer = this.findLayer(targetLevel.layerTitles.boundary);
    if (!layer) return;
    let where = whereForLevel(targetLevel, filters, unit) || "1=1";
    const schema = this.schemaOf(layer);
    const hasUnit = schema.some((f) => f.name.toLowerCase() === "unit");
    if (unit && unit.trim() && !hasUnit) {
      where = whereForLevel(targetLevel, filters, null) || "1=1";
    }
    if (!where) where = "1=1";
    try {
      const result = await layer.queryExtent({ where, returnGeometry: true });
      if (result.count > 0 && result.extent) {
        await this.view.goTo(result.extent, { duration: 700 });
      }
    } catch {
      /* keep current extent */
    }
  }

  async resetExtent(): Promise<void> {
    if (!this.view || !this.initialViewpoint) return;
    this.extentOverride = null;
    await this.view.goTo(this.initialViewpoint, { duration: 700 });
  }

  async goToScale(scale: number): Promise<void> {
    if (!this.view) return;
    await this.view.goTo({ scale }, { duration: 500 });
  }

  async zoomToLevel(levelId: AdminLevelId): Promise<void> {
    if (!this.view) return;
    const level = ADMIN_LEVELS.find((l) => l.id === levelId);
    if (!level) return;
    try {
      await this.view.goTo({ scale: level.viewScale }, { duration: 700 });
    } catch {
      /* ignore */
    }
  }

  async zoomToName(levelId: AdminLevelId, name: string): Promise<void> {
    if (!this.view || !name) return;
    const level = ADMIN_LEVELS.find((l) => l.id === levelId);
    if (!level) return;
    const layer = this.findLayer(level.layerTitles.boundary);
    if (!layer) return;
    const nameField = level.nameField;
    const where = `UPPER(${nameField}) = UPPER('${name.replace(/'/g, "''")}')`;
    try {
      const result = await layer.queryExtent({ where, returnGeometry: true });
      if (result.count > 0 && result.extent) {
        await this.view.goTo(result.extent, { duration: 700 });
      }
    } catch {
      /* ignore */
    }
  }

  async queryAttributes(
    layer: EsriLayer,
    options: {
      where?: string;
      outFields?: string[];
      orderByFields?: string[];
      num?: number;
      returnGeometry?: boolean;
      returnDistinctValues?: boolean;
      geometry?: unknown | null;
      /** Simplify geometries (map units). Speeds chart placement queries a lot. */
      maxAllowableOffset?: number;
    } = {},
  ): Promise<EsriFeature[]> {
    const where = options.where || layer.definitionExpression || "1=1";
    const query: Record<string, unknown> = {
      where,
      outFields: options.outFields ?? ["*"],
      returnGeometry: options.returnGeometry ?? false,
      num: options.num,
      orderByFields: options.orderByFields,
      returnDistinctValues: options.returnDistinctValues,
    };
    if (options.geometry) {
      query.geometry = options.geometry;
      query.spatialRelationship = "intersects";
    }
    if (options.maxAllowableOffset != null && options.maxAllowableOffset > 0) {
      query.maxAllowableOffset = options.maxAllowableOffset;
    }
    const result = await layer.queryFeatures(query);
    return result.features ?? [];
  }

  async queryStats(
    layer: EsriLayer,
    stats: Array<{ statisticType: string; onStatisticField: string; outStatisticFieldName: string }>,
    where?: string,
    geometry?: unknown | null,
  ): Promise<Record<string, number>> {
    const query: Record<string, unknown> = {
      where: where || layer.definitionExpression || "1=1",
      outStatistics: stats,
    };
    if (geometry) {
      query.geometry = geometry;
      query.spatialRelationship = "intersects";
    }
    const result = await layer.queryFeatures(query);
    const attrs = result.features?.[0]?.attributes ?? {};
    const out: Record<string, number> = {};
    for (const s of stats) {
      const v = Number(attrs[s.outStatisticFieldName]);
      out[s.outStatisticFieldName] = Number.isFinite(v) ? v : 0;
    }
    return out;
  }

  async queryCount(layer: EsriLayer, where?: string, geometry?: unknown | null): Promise<number> {
    const query: Record<string, unknown> = {
      where: where || layer.definitionExpression || "1=1",
    };
    if (geometry) {
      query.geometry = geometry;
      query.spatialRelationship = "intersects";
    }
    return layer.queryFeatureCount(query);
  }

  /**
   * Click a boundary polygon to drive KPI cards for that area only.
   * Chart layers are ignored. Empty clicks do not clear (use Clear selection).
   */
  private async handleMapClick(event: unknown, events: MapEvents): Promise<void> {
    if (!this.view || !events.onFeatureSelect) return;
    try {
      const response = await this.view.hitTest(event as never);
      const hits = (response?.results ?? []).filter((r) => {
        const layer = r.layer;
        if (!layer) return false;
        if (layer.type && layer.type !== "feature") return false;
        if (isChartLayer(layer)) return false;
        return Boolean(r.graphic);
      });
      if (!hits.length) return;

      const hit = hits[0];
      const layer = hit.layer!;
      const graphic = hit.graphic!;
      const attrs = (graphic.attributes ?? {}) as Record<string, unknown>;

      const title = (layer.title || "").trim().toLowerCase();
      const level =
        ADMIN_LEVELS.find((l) => l.layerTitles.boundary.trim().toLowerCase() === title) ??
        ADMIN_LEVELS.find((l) => title.includes(l.label.toLowerCase()) || title.includes(l.id)) ??
        null;

      let name = "";
      if (level) {
        name = String(attrs[level.nameField] ?? attrs[level.nameField.toLowerCase()] ?? "").trim();
      }
      if (!name) {
        for (const l of [...ADMIN_LEVELS].reverse()) {
          const v = String(attrs[l.nameField] ?? attrs[l.nameField.toLowerCase()] ?? "").trim();
          if (v) {
            name = v;
            break;
          }
        }
      }
      if (!name) {
        for (const [key, val] of Object.entries(attrs)) {
          if (/adm\d_en$/i.test(key) && String(val ?? "").trim()) {
            name = String(val).trim();
            break;
          }
        }
      }
      if (!name) return;

      const rawGeom = graphic.geometry;
      const geometry =
        rawGeom && typeof (rawGeom as { clone?: () => unknown }).clone === "function"
          ? (rawGeom as { clone: () => unknown }).clone()
          : rawGeom;

      const resolvedLevel =
        level ??
        [...ADMIN_LEVELS].reverse().find((l) => String(attrs[l.nameField] ?? "").trim() === name) ??
        null;

      const ancestors: Array<{ label: string; value: string }> = [];
      if (resolvedLevel) {
        for (const parent of ADMIN_LEVELS) {
          if (parent.id === resolvedLevel.id) break;
          const v = String(attrs[parent.nameField] ?? "").trim();
          if (v) ancestors.push({ label: parent.label, value: v });
        }
      }

      await this.highlightFeature(layer, graphic);

      events.onFeatureSelect({
        name,
        geometry: geometry ?? null,
        info: {
          unitLabel: resolvedLevel?.label ?? "Area",
          areaName: name,
          ancestors,
        },
      });
    } catch {
      /* hit-test optional */
    }
  }

  async highlightFeature(layer: EsriLayer, graphic: EsriFeature): Promise<void> {
    if (!this.view) return;
    this.clearHighlight();
    try {
      const layerView = await this.view.whenLayerView(layer);
      const oidField = layer.objectIdField || "OBJECTID";
      const oid = graphic.attributes?.[oidField] ?? graphic.attributes?.objectid;
      this.highlightHandle = layerView.highlight(oid ?? graphic);
    } catch {
      this.highlightHandle = null;
    }
  }

  clearHighlight(): void {
    try {
      this.highlightHandle?.remove();
    } catch {
      /* ignore */
    }
    this.highlightHandle = null;
  }

  setPanelToggleVisibility(opts: { left?: boolean; right?: boolean }): void {
    if (this.filterToggleBtn && typeof opts.left === "boolean") {
      this.filterToggleBtn.style.display = opts.left ? "flex" : "none";
    }
    if (this.symbologyToggleBtn && typeof opts.right === "boolean") {
      this.symbologyToggleBtn.style.display = opts.right ? "flex" : "none";
    }
  }

  /** Show/hide the Clear selection control under the basemap button. */
  setClearSelectionVisible(visible: boolean): void {
    if (!this.clearSelectionBtn) return;
    this.clearSelectionBtn.style.display = visible ? "flex" : "none";
  }

  setOnClearSelection(handler: (() => void) | null): void {
    this.onClearSelection = handler;
  }

  async ensureChartCalloutLayer(): Promise<void> {
    if (this.chartCalloutLayer || !this.webmap || !this.modules) return;
    try {
      const GraphicsLayerMod = await import("@arcgis/core/layers/GraphicsLayer.js");
      const layer = new (GraphicsLayerMod as { default: new (p: unknown) => {
        removeAll: () => void;
        addMany: (g: unknown[]) => void;
        visible: boolean;
      } }).default({ title: "Chart callouts", listMode: "hide" });
      this.chartCalloutLayer = layer;
      (this.webmap.layers as { add?: (l: unknown) => void }).add?.(layer);
    } catch {
      /* optional */
    }
  }

  clearChartCallouts(): void {
    try {
      this.chartCalloutLayer?.removeAll();
    } catch {
      /* ignore */
    }
  }

  /** Remove client-side joined chart layers and restore original chart visibility. */
  clearJoinedChartLayers(): void {
    if (!this.webmap) {
      this.joinedChartLayers.clear();
      return;
    }
    for (const [, entry] of this.joinedChartLayers) {
      try {
        (this.webmap.layers as { remove?: (l: unknown) => void }).remove?.(entry.layer);
      } catch {
        /* ignore */
      }
      try {
        const orig = this.findLayerById(entry.originalId);
        if (orig) orig.visible = entry.originalVisible;
      } catch {
        /* ignore */
      }
    }
    this.joinedChartLayers.clear();
  }

  private findLayerById(id: string): EsriLayer | null {
    if (!this.webmap) return null;
    for (const layer of this.featureLayers()) {
      if (layer.id === id) return layer;
    }
    return null;
  }

  /**
   * Apply a pie-chart (or any) renderer using joined table values.
   * Builds a client-side FeatureLayer so attributes exist on features.
   */
  async applyJoinedChartRenderer(options: {
    layer: EsriLayer;
    rendererJson: EsriRenderer;
    rows: Array<Record<string, unknown>>;
    keyField: string;
    valueFields: string[];
  }): Promise<void> {
    if (!this.modules || !this.webmap) return;
    const { layer, rendererJson, rows, keyField, valueFields } = options;

    // Index joined rows by admin name (+ Unit / Custom_Unit_Code fallbacks)
    // Normalize Barishal/Barisal etc. so geometry names match table names.
    const normPlace = (value: unknown): string => {
      let s = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      s = s.replace(/\bbarishal\b/g, "barisal");
      s = s.replace(/\bchattogram\b/g, "chittagong");
      s = s.replace(/\bbogura\b/g, "bogra");
      s = s.replace(/\bjashore\b/g, "jessore");
      s = s.replace(/\bcumilla\b/g, "comilla");
      return s;
    };
    const byKey = new Map<string, Record<string, unknown>>();
    const addKey = (k: string, row: Record<string, unknown>) => {
      const nk = normPlace(k);
      if (!nk) return;
      const prev = byKey.get(nk);
      if (!prev) {
        byKey.set(nk, row);
        return;
      }
      // Sum numeric fields when multiple rows share a key
      const merged = { ...prev };
      for (const [fk, fv] of Object.entries(row)) {
        const n = Number(fv);
        if (Number.isFinite(n) && typeof prev[fk] !== "string") {
          const pn = Number(prev[fk]);
          merged[fk] = (Number.isFinite(pn) ? pn : 0) + n;
        }
      }
      byKey.set(nk, merged);
    };
    for (const row of rows) {
      for (const [k, v] of Object.entries(row)) {
        if (k.toLowerCase() === keyField.toLowerCase()) {
          addKey(String(v ?? ""), row);
        }
      }
      for (const alt of ["adm1_en", "adm2_en", "adm3_en", "adm4_en", "Unit", "Custom_Unit_Code"]) {
        for (const [k, v] of Object.entries(row)) {
          if (k.toLowerCase() === alt.toLowerCase()) {
            addKey(String(v ?? ""), row);
          }
        }
      }
    }

    const oidField = layer.objectIdField || "OBJECTID";
    const where = layer.definitionExpression || "1=1";
    // Only need the name key for grouping; values come from the joined rows.
    // Simplified geometries + extent.center → fast multipart chart placement.
    const features = await this.queryAttributes(layer, {
      where,
      outFields: [keyField, "adm1_en", "adm2_en", "adm3_en", "adm4_en", "Unit", "Custom_Unit_Code", oidField].filter(
        (v, i, a) => Boolean(v) && a.indexOf(v) === i,
      ),
      returnGeometry: true,
      num: 50_000,
      // Coarse simplification: we only use extent centers, not ring detail.
      maxAllowableOffset: 500,
    });

    // One chart per administrative unit — collect ALL polygon parts, then
    // place the chart at the largest part's extent center (no geometryEngine).
    const byName = new Map<
      string,
      { name: string; geometries: unknown[]; attrs: Record<string, unknown> }
    >();
    for (const f of features) {
      const attrs = { ...(f.attributes ?? {}) };
      let name = "";
      for (const [k, v] of Object.entries(attrs)) {
        if (k.toLowerCase() === keyField.toLowerCase()) {
          name = String(v ?? "").trim();
          break;
        }
      }
      if (!name || !f.geometry) continue;
      const nk = normPlace(name);
      const entry = byName.get(nk);
      if (entry) {
        entry.geometries.push(f.geometry);
      } else {
        byName.set(nk, { name, geometries: [f.geometry], attrs });
      }
    }

    // Fast chart location for multipart admin units:
    // use each part's extent center and keep the part with the largest extent.
    // No geometryEngine.union / centroid / labelPoint (those were the lag).
    const extentCenter = (g: unknown): unknown | null => {
      const geom = g as {
        extent?: {
          center?: unknown;
          xmin?: number;
          xmax?: number;
          ymin?: number;
          ymax?: number;
          spatialReference?: unknown;
        };
        spatialReference?: unknown;
        type?: string;
      } | null;
      if (!geom) return null;
      const ext = geom.extent;
      if (ext?.center) return ext.center;
      if (
        ext &&
        typeof ext.xmin === "number" &&
        typeof ext.xmax === "number" &&
        typeof ext.ymin === "number" &&
        typeof ext.ymax === "number"
      ) {
        return {
          type: "point",
          x: (ext.xmin + ext.xmax) / 2,
          y: (ext.ymin + ext.ymax) / 2,
          spatialReference: ext.spatialReference ?? geom.spatialReference,
        };
      }
      return null;
    };

    const extentArea = (g: unknown): number => {
      const ext = (g as { extent?: { width?: number; height?: number; xmin?: number; xmax?: number; ymin?: number; ymax?: number } } | null)?.extent;
      if (!ext) return 0;
      if (typeof ext.width === "number" && typeof ext.height === "number") {
        return Math.abs(ext.width * ext.height);
      }
      if (
        typeof ext.xmin === "number" &&
        typeof ext.xmax === "number" &&
        typeof ext.ymin === "number" &&
        typeof ext.ymax === "number"
      ) {
        return Math.abs((ext.xmax - ext.xmin) * (ext.ymax - ext.ymin));
      }
      return 0;
    };

    const graphics: unknown[] = [];
    let oid = 1;
    for (const { name, geometries, attrs } of byName.values()) {
      const hit = byKey.get(normPlace(name));
      const merged: Record<string, unknown> = { ...attrs, [oidField]: oid++ };
      for (const vf of valueFields) {
        let val: unknown = 0;
        if (hit) {
          if (vf in hit) val = hit[vf];
          else {
            for (const [k, v] of Object.entries(hit)) {
              if (k.toLowerCase() === vf.toLowerCase()) {
                val = v;
                break;
              }
            }
          }
        }
        const n = Number(val);
        merged[vf] = Number.isFinite(n) ? n : 0;
      }
      merged[keyField] = name;

      // Skip empty pies (no joined data) — avoids blank circles for unmatched units
      const hasData = valueFields.some((vf) => {
        const n = Number(merged[vf]);
        return Number.isFinite(n) && n > 0;
      });
      if (!hasData) continue;

      // Largest part by extent area → extent center (one point per admin unit).
      let bestGeom: unknown = geometries[0];
      let bestArea = -1;
      for (const g of geometries) {
        const a = extentArea(g);
        if (a > bestArea) {
          bestArea = a;
          bestGeom = g;
        }
      }
      const geom = extentCenter(bestGeom) ?? bestGeom;

      graphics.push({
        geometry: geom,
        attributes: merged,
      });
    }

    // Remove previous joined layer for this source
    const prev = this.joinedChartLayers.get(layer.id);
    if (prev) {
      try {
        (this.webmap.layers as { remove?: (l: unknown) => void }).remove?.(prev.layer);
      } catch {
        /* ignore */
      }
      this.joinedChartLayers.delete(layer.id);
    }

    const FeatureLayerMod = await import("@arcgis/core/layers/FeatureLayer.js");
    const FeatureLayer = (FeatureLayerMod as { default: new (p: unknown) => EsriLayer }).default;

    const fields: Array<{ name: string; type: string; alias?: string }> = [
      { name: oidField, type: "oid" },
      { name: keyField, type: "string" },
    ];
    for (const vf of valueFields) {
      fields.push({ name: vf, type: "double", alias: vf });
    }
    // Keep common admin fields if present
    for (const af of ["adm1_en", "adm2_en", "adm3_en", "adm4_en", "Unit", "Custom_Unit_Code"]) {
      if (!fields.some((f) => f.name === af)) {
        fields.push({ name: af, type: "string" });
      }
    }

    // Centroid conversion yields points; fall back to source layer type.
    const sampleGeom = (graphics[0] as { geometry?: { type?: string } } | undefined)?.geometry;
    const geomType =
      (sampleGeom?.type === "point" ? "point" : null) ||
      (layer as { geometryType?: string }).geometryType ||
      (features[0]?.geometry as { type?: string } | undefined)?.type ||
      "polygon";

    // Scale dependency: prefer web-map layer values, else ADMIN_LEVELS ranges
    // (Division / District / Upazila / Union Chart must not all show at once).
    const titleLower = (layer.title || "").trim().toLowerCase();
    const levelMatch = ADMIN_LEVELS.find(
      (l) =>
        l.layerTitles.chart.toLowerCase() === titleLower ||
        l.layerTitles.boundary.toLowerCase() === titleLower ||
        titleLower.includes(l.id),
    );
    let minScale = Number(layer.minScale);
    let maxScale = Number(layer.maxScale);
    if (!Number.isFinite(minScale) || minScale < 0) minScale = 0;
    if (!Number.isFinite(maxScale) || maxScale < 0) maxScale = 0;
    // If the layer reports "always visible" (0/0) but we know admin scale ranges, use those.
    if (minScale === 0 && maxScale === 0 && levelMatch) {
      minScale = levelMatch.minScale;
      maxScale = levelMatch.maxScale;
    }

    const renderer = this.modules.jsonUtils.fromJSON(rendererJson);
    const client = new FeatureLayer({
      source: graphics,
      objectIdField: oidField,
      fields,
      geometryType: geomType === "point" || geomType === "polygon" || geomType === "polyline" ? geomType : "polygon",
      spatialReference: (features[0]?.geometry as { spatialReference?: unknown } | undefined)?.spatialReference,
      renderer,
      title: `${layer.title || "Chart"} (data)`,
      listMode: "hide",
      popupEnabled: true,
      outFields: ["*"],
      opacity: layer.opacity ?? 1,
      minScale,
      maxScale,
    }) as EsriLayer & { minScale?: number; maxScale?: number };

    // Ensure scale props stick (some client FeatureLayers ignore ctor options).
    try {
      client.minScale = minScale;
      client.maxScale = maxScale;
    } catch {
      /* ignore */
    }

    const originalVisible = layer.visible;
    layer.visible = false;

    (this.webmap.layers as { add?: (l: unknown) => void }).add?.(client);
    this.joinedChartLayers.set(layer.id, {
      layer: client,
      originalId: layer.id,
      originalVisible,
    });

    if (!this.originalRenderers.has(layer.id)) {
      this.originalRenderers.set(layer.id, layer.renderer ?? null);
    }
  }

  applyRenderer(layer: EsriLayer, rendererJson: EsriRenderer): void {
    if (!this.modules) return;
    if (!this.originalRenderers.has(layer.id)) {
      this.originalRenderers.set(layer.id, layer.renderer ?? null);
    }
    layer.renderer = this.modules.jsonUtils.fromJSON(rendererJson);
    if (isChartLayer(layer)) {
      layer.popupEnabled = false;
    } else {
      layer.popupEnabled = true;
      if (!layer.outFields || (Array.isArray(layer.outFields) && layer.outFields.length === 0)) {
        layer.outFields = ["*"];
      }
      if (!layer.popupTemplate && this.originalPopupTemplates.has(layer.id)) {
        layer.popupTemplate = this.originalPopupTemplates.get(layer.id) ?? null;
      }
    }
  }

  resetRenderers(group?: LayerGroupId): void {
    if (!group || group === "chart") {
      this.clearChartCallouts();
      this.clearJoinedChartLayers();
    }
    for (const layer of this.featureLayers()) {
      if (group) {
        const chart = isChartLayer(layer);
        if (group === "chart" && !chart) continue;
        if (group === "boundary" && chart) continue;
      }
      if (this.originalRenderers.has(layer.id)) {
        layer.renderer = this.originalRenderers.get(layer.id) as EsriLayer["renderer"];
      }
      try {
        (layer as { refresh?: () => void }).refresh?.();
      } catch {
        /* optional */
      }
      if (isChartLayer(layer)) {
        layer.popupEnabled = false;
      } else {
        layer.popupEnabled = true;
      }
    }
  }

  setPadding(padding: Partial<EsriMapView["padding"]>): void {
    if (!this.view) return;
    this.view.padding = { ...this.view.padding, ...padding };
  }

  destroy(): void {
    this.clearHighlight();
    for (const h of this.handles) {
      try {
        h.remove();
      } catch {
        /* ignore */
      }
    }
    this.handles = [];
    for (const w of this.widgets) {
      try {
        w.destroy();
      } catch {
        /* ignore */
      }
    }
    this.widgets = [];
    try {
      this.view?.destroy();
    } catch {
      /* ignore */
    }
    this.view = null;
    this.webmap = null;
    this.modules = null;
  }
}

let singleton: MapController | null = null;

export function getMapController(): MapController | null {
  return singleton;
}

export async function createMapController(
  container: HTMLDivElement,
  events: MapEvents = {},
): Promise<MapController> {
  if (singleton) {
    singleton.destroy();
    singleton = null;
  }
  const controller = new MapController();
  singleton = controller;
  await controller.init(container, events);
  return controller;
}

export function clearMapController(): void {
  singleton?.destroy();
  singleton = null;
}

export type { AppliedLegend };
