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
    this.clearSelectionBtn.innerHTML = `<calcite-icon icon="erase" scale="m"></calcite-icon>`;
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

  findLayer(title: string): EsriLayer | null {
    const wanted = title.trim().toLowerCase();
    return this.featureLayers().find((layer) => (layer.title || "").trim().toLowerCase() === wanted) ?? null;
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

  async applyFilters(filters: LocationFilters): Promise<void> {
    for (const level of ADMIN_LEVELS) {
      const where = whereForLevel(level, filters) || "1=1";
      const expression = where === "1=1" ? "1=1" : where;
      for (const group of ["boundary", "chart"] as LayerGroupId[]) {
        const layer = this.findLayer(level.layerTitles[group]);
        if (!layer) continue;
        layer.definitionExpression = expression;
        try {
          (layer as { refresh?: () => void }).refresh?.();
        } catch {
          /* optional */
        }
      }
    }
    await this.zoomToFilters(filters);
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

  async zoomToFilters(filters: LocationFilters): Promise<void> {
    if (!this.view) return;
    const deepest = [...ADMIN_LEVELS].reverse().find((level) => filters[level.id]);
    if (!deepest) {
      await this.resetExtent();
      return;
    }
    const layer = this.findLayer(deepest.layerTitles.boundary);
    if (!layer) return;
    const where = whereForLevel(deepest, filters) || "1=1";
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
