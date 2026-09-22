/**
 * Add a field to Boundary + Chart feature layers in the web map
 * via the ArcGIS REST addToDefinition endpoint.
 *
 * Requires the signed-in user (or public service) to allow schema changes
 * on the hosted feature layer. Catalog registration is handled separately.
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

async function postAddToDefinition(layer: EsriLayer, fieldDef: Record<string, unknown>): Promise<void> {
  const base = (layer.url || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error(`Layer "${layer.title}" has no service URL.`);
  }

  const esriRequest = (await import("@arcgis/core/request.js")).default as (url: string, opts: unknown) => Promise<{
    data?: { success?: boolean; error?: { message?: string; details?: string[] } };
  }>;

  const response = await esriRequest(`${base}/addToDefinition`, {
    method: "post",
    query: { f: "json" },
    body: {
      f: "json",
      addToDefinition: JSON.stringify({ fields: [fieldDef] }),
    },
    responseType: "json",
  });

  const data = response?.data;
  if (data?.error) {
    const detail = data.error.details?.join(" ") || data.error.message || "addToDefinition failed";
    throw new Error(detail);
  }
  if (data && data.success === false) {
    throw new Error(data.error?.message || "addToDefinition returned success=false");
  }
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
  const targets: EsriLayer[] = [];
  for (const level of ADMIN_LEVELS) {
    for (const group of ["boundary", "chart"] as const) {
      const layer = map.findLayer(level.layerTitles[group]);
      if (layer) targets.push(layer);
    }
  }

  if (!targets.length) {
    return {
      attempted: 0,
      created: 0,
      skipped: 0,
      failed: ["No Boundary/Chart layers found in the web map."],
      message: "No feature layers were found to update.",
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
      await postAddToDefinition(layer, fieldDef);
      created += 1;
      try {
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
    message = `Field "${name}" ${parts.join("; ")}. Reload the map if the new column does not appear in symbology yet.`;
  } else if (created && failed.length) {
    message = `Field "${name}" partially applied (${parts.join("; ")}). ${failed[0]}`;
  } else if (!created && skipped && !failed.length) {
    message = `Field "${name}" already exists on the web map layers.`;
  } else if (failed.length) {
    message = `Could not create field on the feature service. ${failed[0]} Sign in to ArcGIS with edit privileges if the service is secured.`;
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
