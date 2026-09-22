/**
 * Add a field to every Boundary + Chart feature layer in the web map
 * (Division → District → Upazila → Union) via ArcGIS REST addToDefinition.
 *
 * Requires the signed-in ArcGIS identity (or public service) to allow schema
 * changes on the hosted feature layer. Catalog registration is separate.
 */

import { ADMIN_LEVELS } from "@/config/layers";
import { getMapController, type EsriLayer } from "@/lib/gis/map-controller";

export type AddLayerFieldInput = {
  name: string;
  alias: string;
  /** UI type: Double | Integer | String | Date */
  type: string;
};

export type AddLayerFieldResult = {
  attempted: number;
  created: number;
  skipped: number;
  failed: string[];
  message: string;
};

const TYPE_MAP: Record<string, string> = {
  double: "esriFieldTypeDouble",
  integer: "esriFieldTypeInteger",
  string: "esriFieldTypeString",
  date: "esriFieldTypeDate",
};

function sanitizeFieldName(raw: string): string {
  let name = raw.trim().replace(/\s+/g, "_");
  name = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z]/.test(name)) {
    name = `F_${name}`;
  }
  return name.slice(0, 64);
}

function fieldDefinition(name: string, alias: string, uiType: string) {
  const esriType = TYPE_MAP[uiType.trim().toLowerCase()] || "esriFieldTypeDouble";
  const def: Record<string, unknown> = {
    name,
    type: esriType,
    alias: alias || name,
    nullable: true,
    editable: true,
  };
  if (esriType === "esriFieldTypeString") {
    def.length = 255;
  }
  return def;
}

function layerHasField(layer: EsriLayer, name: string): boolean {
  const lower = name.toLowerCase();
  return (layer.fields ?? []).some(
    (f) => (f.name || "").toLowerCase() === lower || (f.alias || "").toLowerCase() === lower,
  );
}

/**
 * Resolve a FeatureServer layer endpoint suitable for admin ops.
 * Accepts .../FeatureServer/N or .../MapServer/N; strips trailing slash.
 */
function featureLayerAdminUrl(layer: EsriLayer): string {
  const raw = (layer.url || "").trim();
  if (!raw) {
    throw new Error(`Layer "${layer.title || "unknown"}" has no service URL.`);
  }

  // Prefer parsedUrl from the API when present (more reliable than string url)
  const parsed = (layer as { parsedUrl?: { path?: string; url?: string } }).parsedUrl;
  let base = (parsed?.path || parsed?.url || raw).replace(/\/+$/, "");

  // Some portal layers expose url without layer index — try layerId
  const layerId = (layer as { layerId?: number }).layerId;
  if (!/\/(FeatureServer|MapServer)\/\d+$/i.test(base) && typeof layerId === "number") {
    if (/\/(FeatureServer|MapServer)$/i.test(base)) {
      base = `${base}/${layerId}`;
    }
  }

  if (!/^https?:\/\//i.test(base)) {
    throw new Error(`Layer "${layer.title}" has an invalid service URL: ${base}`);
  }

  return base;
}

/** Use only cached credentials — never prompt (getCredential freezes UI under the modal). */
async function resolveToken(serviceUrl: string): Promise<string | undefined> {
  try {
    const IdentityManager = (await import("@arcgis/core/identity/IdentityManager.js")).default as {
      findCredential?: (url: string) => { token?: string } | null | undefined;
    };
    return IdentityManager.findCredential?.(serviceUrl)?.token || undefined;
  } catch {
    return undefined;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function postAddToDefinition(layer: EsriLayer, fieldDef: Record<string, unknown>): Promise<void> {
  const base = featureLayerAdminUrl(layer);
  const endpoint = `${base}/addToDefinition`;

  const esriRequest = (await import("@arcgis/core/request.js")).default as (
    url: string,
    opts: unknown,
  ) => Promise<{
    data?: {
      success?: boolean;
      error?: { message?: string; details?: string[]; code?: number };
    };
  }>;

  const token = await resolveToken(base);

  // ArcGIS REST expects application/x-www-form-urlencoded body, not a JS object
  const params = new URLSearchParams();
  params.set("f", "json");
  params.set("addToDefinition", JSON.stringify({ fields: [fieldDef] }));
  if (token) params.set("token", token);

  // no-prompt: never open ArcGIS sign-in under the Manage Data modal (black backdrop + hang)
  const response = await withTimeout(
    esriRequest(endpoint, {
      method: "post",
      body: params.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      responseType: "json",
      authMode: "no-prompt",
    }),
    25_000,
    `addToDefinition (${layer.title || "layer"})`,
  );

  const data = response?.data;
  if (data?.error) {
    const detail =
      (Array.isArray(data.error.details) && data.error.details.length
        ? data.error.details.join(" ")
        : null) ||
      data.error.message ||
      "addToDefinition failed";
    throw new Error(detail);
  }
  if (data && data.success === false) {
    throw new Error(data.error?.message || "addToDefinition returned success=false");
  }
}

/**
 * Collect Boundary + Chart layers for every admin level (Division → Union).
 * Falls back to title heuristics when exact configured titles are missing.
 */
function collectTargetLayers(
  map: NonNullable<ReturnType<typeof getMapController>>,
): EsriLayer[] {
  const byUrl = new Map<string, EsriLayer>();

  const add = (layer: EsriLayer | null | undefined) => {
    if (!layer) return;
    const key = (layer.url || layer.title || "").toLowerCase();
    if (!key || byUrl.has(key)) return;
    byUrl.set(key, layer);
  };

  // Preferred: configured titles for each admin level
  for (const level of ADMIN_LEVELS) {
    add(map.findLayer(level.layerTitles.boundary));
    add(map.findLayer(level.layerTitles.chart));
  }

  // Fallback: any feature layer whose title looks like Boundary / Chart
  for (const layer of map.featureLayers()) {
    const t = (layer.title || "").toLowerCase();
    if (t.includes("boundary") || t.includes("chart")) {
      add(layer);
    }
  }

  return Array.from(byUrl.values());
}

/**
 * Create the attribute column on every Boundary and Chart layer in the web map.
 */
export async function addFieldToWebMapLayers(input: AddLayerFieldInput): Promise<AddLayerFieldResult> {
  const name = sanitizeFieldName(input.name);
  if (!name) {
    return {
      attempted: 0,
      created: 0,
      skipped: 0,
      failed: [],
      message: "Enter a valid field name (letters, numbers, underscore).",
    };
  }

  const map = getMapController();
  if (!map) {
    return {
      attempted: 0,
      created: 0,
      skipped: 0,
      failed: ["Map is not ready."],
      message: "Wait until the web map finishes loading, then try again.",
    };
  }

  const fieldDef = fieldDefinition(name, input.alias || name, input.type);
  const targets = collectTargetLayers(map);

  if (!targets.length) {
    return {
      attempted: 0,
      created: 0,
      skipped: 0,
      failed: ["No Boundary/Chart layers found in the web map."],
      message: "No feature layers were found to update (Division–Union Boundary/Chart).",
    };
  }

  let created = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const layer of targets) {
    const title = layer.title || layer.url || "layer";
    try {
      if (layerHasField(layer, name)) {
        skipped += 1;
        continue;
      }
      // Validate URL early for a clearer error
      featureLayerAdminUrl(layer);
      await postAddToDefinition(layer, fieldDef);
      created += 1;
      try {
        // Refresh only — do not await load() after schema change (can hang)
        (layer as { refresh?: () => void }).refresh?.();
      } catch {
        /* optional */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push(`${title}: ${msg}`);
    }
  }

  const parts: string[] = [];
  if (created) parts.push(`created on ${created} layer(s)`);
  if (skipped) parts.push(`already present on ${skipped} layer(s)`);
  if (failed.length) parts.push(`failed on ${failed.length} layer(s)`);

  let message: string;
  if (created && !failed.length) {
    message = `Field "${name}" ${parts.join("; ")} (Division–Union Boundary/Chart). Reload the map if the column does not appear in symbology yet.`;
  } else if (created && failed.length) {
    message = `Field "${name}" partially applied (${parts.join("; ")}). ${failed[0]}`;
  } else if (!created && skipped && !failed.length) {
    message = `Field "${name}" already exists on the web map layers.`;
  } else if (failed.length) {
    message = `Could not create field on the feature service. ${failed[0]} Sign in to ArcGIS Online with edit privileges if the service is secured.`;
  } else {
    message = `No layers were updated for field "${name}".`;
  }

  return {
    attempted: targets.length,
    created,
    skipped,
    failed,
    message,
  };
}
