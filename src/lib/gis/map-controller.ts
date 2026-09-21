/**
 * ArcGIS Maps SDK controller.
 *
 * All @arcgis/core imports are dynamic so this module is safe to parse during
 * SSR. Call `createMapController` only in the browser.
 */

import { getAppConfig } from "@/config/app-config";
import {
  ADMIN_LEVELS,
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
  };
  when: () => Promise<void>;
  goTo: (target: unknown, opts?: unknown) => Promise<void>;
  destroy: () => void;
  on: (event: string, cb: (ev: unknown) => void) => { remove: () => void };
  hitTest: (screenPoint: unknown, opts?: unknown) => Promise<{
    results: Array<{ graphic?: EsriFeature & { layer?: EsriLayer }; mapPoint?: unknown }>;
  }>;
  toMap?: (screenPoint: { x: number; y: number }) => unknown;
  viewpoint?: unknown;
  extent?: unknown;
  whenLayerView: (layer: EsriLayer) => Promise<{ highlight: (id: unknown) => { remove: () => void } }>;
};

type MapControllerEvents = {
  onScale?: (level: AdminLevelId | null, scale: number) => void;
  onReady?: (info?: { title: string; layers: Array<{ id: string; title: string }> }) => void;
  onError?: (message: string) => void;
  onExtentSettled?: () => void;
  onOpenLeftPanel?: () => void;
  onOpenRightPanel?: () => void;
  onSelection?: (payload: {
    layerId: string;
    layerTitle: string;
    attributes: Record<string, unknown>;
  } | null) => void;
};

function isChartLayer(layer: EsriLayer): boolean {
  const t = `${layer.title} ${layer.id}`.toLowerCase();
  return t.includes("chart") || t.includes("pie");
}

let singleton: MapController | null = null;

export class MapController {
  private modules: EsriModules | null = null;
  private map: EsriWebMap | null = null;
  private view: EsriMapView | null = null;
  private widgets: Array<{ destroy: () => void }> = [];
  private originalRenderers = new Map<string, unknown>();
  private originalPopupTemplates = new Map<string, unknown>();
  private initialViewpoint: unknown = null;
  private events: MapControllerEvents = {};
  private scaleHandle: { remove: () => void } | null = null;
  private clickHandle: { remove: () => void } | null = null;
  private highlightHandle: { remove: () => void } | null = null;
  private extentOverride: unknown | null = null;
  legendHost: HTMLDivElement | null = null;
  private onOpenLeft: (() => void) | null = null;
  private onOpenRight: (() => void) | null = null;

  async init(container: HTMLDivElement, events: MapControllerEvents = {}): Promise<void> {
    this.events = events;
    this.onOpenLeft = events.onOpenLeftPanel ?? null;
    this.onOpenRight = events.onOpenRightPanel ?? null;
    const config = getAppConfig();
    const [
      esriConfig,
      WebMap,
      MapView,
      Zoom,
      Home,
      Expand,
      Legend,
      BasemapGallery,
      ScaleBar,
      PopupTemplate,
      jsonUtils,
    ] = await Promise.all([
      import("@arcgis/core/config").then((m) => m.default),
      import("@arcgis/core/WebMap").then((m) => m.default),
      import("@arcgis/core/views/MapView").then((m) => m.default),
      import("@arcgis/core/widgets/Zoom").then((m) => m.default),
      import("@arcgis/core/widgets/Home").then((m) => m.default),
      import("@arcgis/core/widgets/Expand").then((m) => m.default),
      import("@arcgis/core/widgets/Legend").then((m) => m.default),
      import("@arcgis/core/widgets/BasemapGallery").then((m) => m.default),
      import("@arcgis/core/widgets/ScaleBar").then((m) => m.default),
      import("@arcgis/core/PopupTemplate").then((m) => m.default),
      import("@arcgis/core/renderers/support/jsonUtils").then((m) => m),
    ]);

    this.modules = {
      esriConfig: esriConfig as EsriModules["esriConfig"],
      WebMap: WebMap as EsriModules["WebMap"],
      MapView: MapView as EsriModules["MapView"],
      Zoom: Zoom as EsriModules["Zoom"],
      Home: Home as EsriModules["Home"],
      Expand: Expand as EsriModules["Expand"],
      Legend: Legend as EsriModules["Legend"],
      BasemapGallery: BasemapGallery as EsriModules["BasemapGallery"],
      ScaleBar: ScaleBar as EsriModules["ScaleBar"],
      PopupTemplate: PopupTemplate as EsriModules["PopupTemplate"],
      jsonUtils: jsonUtils as EsriModules["jsonUtils"],
    };

    esriConfig.portalUrl = config.portalUrl;
    esriConfig.assetsPath = "https://js.arcgis.com/4.33/@arcgis/core/assets";
    esriConfig.request.timeout = 120000;

    const webmap = new WebMap({
      portalItem: { id: config.webmapId },
    });
    this.map = webmap as EsriWebMap;

    const view = new MapView({
      container,
      map: webmap,
      popup: {
        dockEnabled: true,
        dockOptions: { position: "bottom-right", breakpoint: false },
      },
    }) as EsriMapView;
    this.view = view;

    await view.when();
    this.initialViewpoint = view.viewpoint;

    const zoom = new Zoom({ view });
    const home = new Home({ view });
    const legend = new Legend({ view });
    const basemapGallery = new BasemapGallery({ view });
    const scaleBar = new ScaleBar({ view, unit: "metric" });
    const legendExpand = new Expand({
      view,
      content: legend,
      expandIcon: "legend",
      group: "top-right",
    });
    const basemapExpand = new Expand({
      view,
      content: basemapGallery,
      expandIcon: "basemap",
      group: "top-right",
    });

    view.ui.add(zoom, "top-left");
    view.ui.add(home, "top-left");
    view.ui.add(legendExpand, "top-right");
    view.ui.add(basemapExpand, "top-right");
    view.ui.add(scaleBar, "bottom-left");

    this.widgets = [zoom, home, legend, basemapGallery, scaleBar, legendExpand, basemapExpand].map(
      (w) => w as { destroy: () => void },
    );

    for (const layer of this.featureLayers()) {
      if (!this.originalRenderers.has(layer.id)) {
        this.originalRenderers.set(layer.id, layer.renderer ?? null);
      }
      if (!this.originalPopupTemplates.has(layer.id)) {
        this.originalPopupTemplates.set(layer.id, layer.popupTemplate ?? null);
      }
      if (isChartLayer(layer)) {
        layer.popupEnabled = false;
      }
    }

    const scaleWatcher = (view as { watch?: (prop: string, cb: (v: number) => void) => { remove: () => void } }).watch;
    if (typeof scaleWatcher === "function") {
      this.scaleHandle = scaleWatcher.call(view, "scale", (scale: number) => {
        this.events.onScale?.(scaleToLevel(scale), scale);
      });
    } else {
      this.scaleHandle = view.on("resize", () => {
        this.events.onScale?.(scaleToLevel(view.scale), view.scale);
      });
    }

    this.clickHandle = view.on("click", async (ev: unknown) => {
      const e = ev as { x: number; y: number };
      try {
        const hit = await view.hitTest(e);
        const graphic = (hit.results ?? []).find((r) => r.graphic?.layer)?.graphic;
        if (graphic?.layer && graphic.attributes) {
          this.events.onSelection?.({
            layerId: graphic.layer.id,
            layerTitle: graphic.layer.title,
            attributes: graphic.attributes,
          });
        } else {
          this.events.onSelection?.(null);
        }
      } catch {
        this.events.onSelection?.(null);
      }
    });

    const title = this.map.portalItem?.title ?? "Web Map";
    const layers = this.featureLayers().map((l) => ({ id: l.id, title: l.title }));
    this.events.onReady?.({ title, layers });
    this.events.onScale?.(scaleToLevel(view.scale), view.scale);
    this.events.onExtentSettled?.();
  }

  featureLayers(): EsriLayer[] {
    if (!this.map) return [];
    return this.map.allLayers.toArray().filter((l) => l.type === "feature") as EsriLayer[];
  }

  layersFor(group: LayerGroupId, level: AdminLevelId | "all"): EsriLayer[] {
    const all = this.featureLayers();
    return all.filter((layer) => {
      const chart = isChartLayer(layer);
      if (group === "chart" && !chart) return false;
      if (group === "boundary" && chart) return false;
      if (level === "all") return true;
      const t = `${layer.title} ${layer.id}`.toLowerCase();
      return t.includes(level) || t.includes(level.replace(/_/g, " "));
    });
  }

  schemaOf(layer: EsriLayer): FieldInfo[] {
    return toFieldInfoFromEsri(layer.fields ?? []);
  }

  async queryAttributes(
    layer: EsriLayer,
    opts: { outFields: string[]; returnGeometry?: boolean; where?: string },
  ): Promise<EsriFeature[]> {
    const result = await layer.queryFeatures({
      where: opts.where ?? "1=1",
      outFields: opts.outFields,
      returnGeometry: opts.returnGeometry ?? false,
      num: 2000,
    });
    return result.features;
  }

  findLayer(title: string): EsriLayer | null {
    const t = title.toLowerCase();
    return (
      this.featureLayers().find(
        (l) =>
          l.title.toLowerCase() === t ||
          l.id.toLowerCase() === t ||
          l.title.toLowerCase().includes(t),
      ) ?? null
    );
  }

  async applyFilters(filters: LocationFilters): Promise<void> {
    for (const level of ADMIN_LEVELS) {
      const where = whereForLevel(level, filters) || "1=1";
      for (const group of ["boundary", "chart"] as const) {
        const layer = this.findLayer(level.layerTitles[group]);
        if (!layer) continue;
        layer.definitionExpression = where;
        try {
          (layer as { refresh?: () => void }).refresh?.();
        } catch {
          /* optional */
        }
      }
    }
    await this.zoomToFilters(filters);
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

  setExtentOverride(extent: unknown | null): void {
    if (!extent) {
      this.extentOverride = null;
      return;
    }
    const ext = extent as { clone?: () => unknown };
    this.extentOverride = typeof ext.clone === "function" ? ext.clone() : extent;
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

  async resetExtent(): Promise<void> {
    if (!this.view || !this.initialViewpoint) return;
    this.extentOverride = null;
    await this.view.goTo(this.initialViewpoint, { duration: 700 });
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

  async queryCount(layer: EsriLayer, where?: string, geometry?: unknown | null): Promise<number> {
    try {
      return await layer.queryFeatureCount({
        where: where ?? "1=1",
        geometry: geometry ?? undefined,
      });
    } catch {
      return 0;
    }
  }

  async queryStats(
    layer: EsriLayer,
    stats: Array<{ statisticType: string; onStatisticField: string; outStatisticFieldName: string }>,
    where?: string,
    geometry?: unknown | null,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const result = await layer.queryFeatures({
        where: where ?? "1=1",
        geometry: geometry ?? undefined,
        outStatistics: stats,
        returnGeometry: false,
      });
      return result.features.map((f) => f.attributes);
    } catch {
      return [];
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

  setPanelToggleVisibility(_opts: { left?: boolean; right?: boolean }): void {
    /* Panel toggles optional in simplified controller */
  }

  syncLegendFilter(_applied?: { boundary: AppliedLegend | null; chart: AppliedLegend | null }): void {
    /* Custom legend sync optional */
  }

  async goHome(): Promise<void> {
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

  /** Value + predominant % text labels on pie chart symbols — e.g. "1,250 (42%)". */
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
        this.clearLayerLabels(layer);
      } else {
        layer.popupEnabled = true;
        this.clearLayerLabels(layer);
      }
    }
  }

  setPadding(padding: Partial<EsriMapView["padding"]>): void {
    if (!this.view) return;
    this.view.padding = { ...this.view.padding, ...padding };
  }

  destroy(): void {
    this.clearHighlight();
    this.scaleHandle?.remove();
    this.clickHandle?.remove();
    this.scaleHandle = null;
    this.clickHandle = null;
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
    this.map = null;
    this.modules = null;
  }
}

export function getMapController(): MapController | null {
  return singleton;
}

export async function createMapController(
  container: HTMLDivElement,
  events?: MapControllerEvents,
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
