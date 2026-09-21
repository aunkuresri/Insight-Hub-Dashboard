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
  };
  when: () => Promise<void>;
  goTo: (target: unknown, opts?: unknown) => Promise<void>;
  destroy: () => void;
  on: (event: string, cb: (ev: unknown) => void) => { remove: () => void };
  hitTest: (screenPoint: unknown, opts?: unknown) => Promise<{ results: Array<{ graphic?: EsriFeature & { layer?: EsriLayer }; mapPoint?: unknown }> }>;
  toMap?: (screenPoint: { x: number; y: number }) => unknown;
  viewpoint?: unknown;
  extent?: unknown;
};

type MapControllerEvents = {
  onScale?: (scale: number, level: AdminLevelId | null) => void;
  onReady?: (info: { title: string; layers: Array<{ id: string; title: string }> }) => void;
  onError?: (message: string) => void;
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

function isBoundaryLayer(layer: EsriLayer): boolean {
  return !isChartLayer(layer) && layer.type === "feature";
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

  async init(container: HTMLDivElement, events: MapControllerEvents = {}): Promise<void> {
    this.events = events;
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
      portalItem: { id: config.webMapId },
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

    this.scaleHandle = view.on("watch:scale", () => {
      const scale = view.scale;
      const level = scaleToLevel(scale);
      this.events.onScale?.(scale, level);
    });

    this.clickHandle = view.on("click", async (ev: unknown) => {
      const e = ev as { x: number; y: number };
      try {
        const hit = await view.hitTest(e);
        const graphic = hit.results.find((r) => r.graphic?.layer)?.graphic;
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
    this.events.onScale?.(view.scale, scaleToLevel(view.scale));
  }

  featureLayers(): EsriLayer[] {
    if (!this.map) return [];
    return this.map.allLayers
      .toArray()
      .filter((l) => l.type === "feature") as EsriLayer[];
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
    return (layer.fields ?? []).map((f) => toFieldInfoFromEsri(f));
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

  applyDefinitionExpression(filters: LocationFilters): void {
    for (const layer of this.featureLayers()) {
      const level = this.detectLevel(layer);
      layer.definitionExpression = whereForLevel(level, filters) || "1=1";
    }
  }

  private detectLevel(layer: EsriLayer): AdminLevelId | null {
    const t = `${layer.title} ${layer.id}`.toLowerCase();
    for (const level of ADMIN_LEVELS) {
      if (t.includes(level.id) || t.includes(level.label.toLowerCase())) return level.id;
    }
    return null;
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

  /** Value + predominant % text labels on pie chart symbols. */
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
      }
    }
  }

  setPadding(padding: Partial<EsriMapView["padding"]>): void {
    if (!this.view) return;
    this.view.padding = { ...this.view.padding, ...padding };
  }

  destroy(): void {
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
