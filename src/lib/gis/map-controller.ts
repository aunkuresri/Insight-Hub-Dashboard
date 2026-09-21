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
import { chartLabelExpression } from "@/lib/symbology/arcade";

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
  /** Actual object-id field name on the service (often "objectid"). */
  objectIdField?: string;
  globalIdField?: string;
  definitionExpression?: string;
  renderer?: unknown;
  fields?: Array<{ name: string; alias?: string; type: string }>;
  outFields?: string[] | string;
  popupTemplate?: unknown;
  popupEnabled?: boolean;
  labelingInfo?: unknown[] | null;
  labelsVisible?: boolean;
  queryFeatures: (query: Record<string, unknown>) => Promise<{
    features: EsriFeature[];
    exceededTransferLimit?: boolean;
  }>;
  queryExtent: (query: Record<string, unknown>) => Promise<{ extent: unknown; count: number }>;
  queryFeatureCount: (query: Record<string, unknown>) => Promise<number>;
  createQuery?: () => Record<string, unknown>;
  /** Feature service sublayer URL (…/FeatureServer/N). */
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

export type MapEvents = {
  onReady?: () => void;
  onScale?: (level: AdminLevelId, scale: number) => void;
  onExtentSettled?: () => void;
  onError?: (message: string) => void;
  onOpenLeftPanel?: () => void;
  onOpenRightPanel?: () => void;
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
  private initialViewpoint: unknown = null;
  private handles: Array<{ remove: () => void }> = [];
  private highlightHandle: { remove: () => void } | null = null;
  private widgets: Array<{ destroy: () => void }> = [];
  private filterToggleBtn: HTMLButtonElement | null = null;
  private symbologyToggleBtn: HTMLButtonElement | null = null;
  private onOpenLeft: (() => void) | null = null;
  private onOpenRight: (() => void) | null = null;
  private extentOverride: unknown | null = null;

  async init(container: HTMLDivElement, events: MapEvents = {}): Promise<void> {
    const config = getAppConfig();
    const modules = await loadEsri();
    this.modules = modules;

    modules.esriConfig.portalUrl = config.portalUrl;
    modules.esriConfig.assetsPath = `https://js.arcgis.com/${config.arcgisVersion}/@arcgis/core/assets`;
    modules.esriConfig.request.timeout = 90_000;

    if (config.oauthAppId && config.oauthAppId !== "YOUR_ENTERPRISE_APP_ID") {
      const [IdentityManager, OAuthInfo] = await Promise.all([
        import("@arcgis/core/identity/IdentityManager.js"),
        import("@arcgis/core/identity/OAuthInfo.js"),
      ]);
      const info = new (OAuthInfo as unknown as { default: new (p: unknown) => unknown }).default({
        appId: config.oauthAppId,
        portalUrl: config.portalUrl,
        popup: false,
      });
      (IdentityManager as { default: { registerOAuthInfos: (i: unknown[]) => void } }).default.registerOAuthInfos([
        info,
      ]);
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
    const scaleBar = new modules.ScaleBar({ view, unit: "metric", style: "ruler" });

    view.ui.add(home, "top-left");
    view.ui.add(basemapExpand, "top-left");
    view.ui.add(zoom, "bottom-left");
    view.ui.add(scaleBar, "bottom-right");

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

    this.widgets.push(zoom, home, esriLegend, basemapGallery, basemapExpand, scaleBar);

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
    await this.view.goTo(this.initialViewpoint, { duration: 700 });
  }

  async goToScale(scale: number): Promise<void> {
    if (!this.view) return;
    await this.view.goTo({ scale }, { duration: 500 });
  }

  applyRenderer(
    layer: EsriLayer,
    rendererJson: EsriRenderer,
    options?: { chartFields?: string[]; sizeField?: string | null },
  ): void {
    if (!this.modules) return;
    if (!this.originalRenderers.has(layer.id)) {
      this.originalRenderers.set(layer.id, layer.renderer ?? null);
    }
    layer.renderer = this.modules.jsonUtils.fromJSON(rendererJson);
    if (isChartLayer(layer)) {
      layer.popupEnabled = false;
      this.applyChartValueLabels(layer, options?.chartFields ?? [], options?.sizeField);
    } else {
      layer.popupEnabled = true;
      this.clearLayerLabels(layer);
      if (!layer.outFields || (Array.isArray(layer.outFields) && layer.outFields.length === 0)) {
        layer.outFields = ["*"];
      }
      if (!layer.popupTemplate && this.originalPopupTemplates.has(layer.id)) {
        layer.popupTemplate = this.originalPopupTemplates.get(layer.id) ?? null;
      }
    }
  }

  /** Value + predominant % text labels beside pie symbols. */
  private applyChartValueLabels(
    layer: EsriLayer,
    chartFields: string[],
    sizeField?: string | null,
  ): void {
    const fields = chartFields.filter(Boolean);
    if (!fields.length && !sizeField) {
      this.clearLayerLabels(layer);
      return;
    }
    const expression = chartLabelExpression(fields, sizeField);
    const needed = [...fields];
    if (sizeField) needed.push(sizeField);
    if (!layer.outFields || layer.outFields === "*") {
      layer.outFields = ["*", ...needed];
    } else if (Array.isArray(layer.outFields)) {
      const set = new Set(layer.outFields.map(String));
      for (const f of needed) set.add(f);
      layer.outFields = [...set];
    }
    layer.labelingInfo = [
      {
        labelExpressionInfo: { expression },
        labelPlacement: "center-center",
        deconflictionStrategy: "static",
        symbol: {
          type: "text",
          color: [40, 40, 40, 255],
          haloColor: [255, 255, 255, 230],
          haloSize: 1.25,
          font: {
            family: "Avenir Next",
            size: 9,
            weight: "bold",
          },
        },
      },
    ];
    layer.labelsVisible = true;
  }

  private clearLayerLabels(layer: EsriLayer): void {
    layer.labelingInfo = [];
    layer.labelsVisible = false;
  }

  resetRenderers(group?: LayerGroupId): void {
    for (const layer of this.featureLayers()) {
      if (group) {
        const isChart = isChartLayer(layer);
        if (group === "chart" && !isChart) continue;
        if (group === "boundary" && isChart) continue;
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
        this.clearLayerLabels(layer);
      } else {
        layer.popupEnabled = true;
        this.clearLayerLabels(layer);
        if (!layer.outFields || (Array.isArray(layer.outFields) && layer.outFields.length === 0)) {
          layer.outFields = ["*"];
        }
        if (this.originalPopupTemplates.has(layer.id)) {
          layer.popupTemplate = this.originalPopupTemplates.get(layer.id) ?? null;
        }
      }
    }
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
    const pageSize = 2000;
    const features: EsriFeature[] = [];
    let start = 0;
    const hardCap = options.num ?? 20_000;
    const geometry = options.geometry ?? null;

    while (features.length < hardCap) {
      const take = Math.min(pageSize, hardCap - features.length);
      const query: Record<string, unknown> = {
        where,
        outFields: options.outFields ?? ["*"],
        returnGeometry: options.returnGeometry ?? false,
        returnDistinctValues: options.returnDistinctValues ?? false,
        orderByFields: options.orderByFields,
        num: take,
        start,
      };
      if (geometry) {
        query.geometry = geometry;
        query.spatialRelationship = "intersects";
      }
      const result = await layer.queryFeatures(query);
      features.push(...result.features);
      if (!result.exceededTransferLimit || result.features.length === 0) break;
      start += result.features.length;
    }
    return features;
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
      returnGeometry: false,
    };
    if (geometry) {
      query.geometry = geometry;
      query.spatialRelationship = "intersects";
    }
    const result = await layer.queryFeatures(query);
    const row = result.features[0]?.attributes ?? {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(row)) {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? n : 0;
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
    try {
      this.webmap?.destroy?.();
    } catch {
      /* ignore */
    }
    this.webmap = null;
  }
}
