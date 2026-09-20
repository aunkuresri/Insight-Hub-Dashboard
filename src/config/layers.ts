/**
 * Administrative levels and how they map onto the web map.
 *
 * Scale ranges are copied from the published web map group layers so analytics
 * follow the same Division → Union visibility as the map. Adjust `minScale` /
 * `maxScale` / `layerTitles` if you point the app at a different web map.
 *
 * Layer groups:
 *   - Boundary — filled polygons (bivariate / ternary / choropleth / predominant)
 *   - Chart    — pie charts drawn on the same polygons (size = total or a field)
 */

export const LAYER_GROUPS = [
  {
    id: "boundary" as const,
    label: "Boundary",
  },
  {
    id: "chart" as const,
    label: "Chart",
  },
];

export type LayerGroupId = (typeof LAYER_GROUPS)[number]["id"];

export type AdminLevelId = "division" | "district" | "upazila" | "union";

export type AdminLevel = {
  id: AdminLevelId;
  label: string;
  shortLabel: string;
  /** Feature attribute that holds the display name at this level. */
  nameField: string;
  codeField: string;
  parentId: AdminLevelId | null;
  parentNameField: string | null;
  /** Group layer title in the web map. */
  groupTitle: string;
  layerTitles: {
    boundary: string;
    chart: string;
  };
  /**
   * Esri scale visibility (same contract as FeatureLayer.minScale / maxScale):
   * visible when (minScale === 0 || scale <= minScale) && (maxScale === 0 || scale >= maxScale).
   */
  minScale: number;
  maxScale: number;
  /** Comfortable scale used by “View this level on the map”. */
  viewScale: number;
};

export const ADMIN_LEVELS: AdminLevel[] = [
  {
    id: "division",
    label: "Division",
    shortLabel: "Div",
    nameField: "adm1_en",
    codeField: "adm1_pcode",
    parentId: null,
    parentNameField: null,
    groupTitle: "Division",
    layerTitles: {
      boundary: "Division Boundary",
      chart: "Division Chart",
    },
    minScale: 0,
    maxScale: 2_629_532,
    viewScale: 4_200_000,
  },
  {
    id: "district",
    label: "District",
    shortLabel: "Dist",
    nameField: "adm2_en",
    codeField: "adm2_pcode",
    parentId: "division",
    parentNameField: "adm1_en",
    groupTitle: "District",
    layerTitles: {
      boundary: "District Boundary",
      chart: "District Chart",
    },
    minScale: 2_629_532,
    maxScale: 689_316,
    viewScale: 1_350_000,
  },
  {
    id: "upazila",
    label: "Upazila",
    shortLabel: "Upz",
    nameField: "adm3_en",
    codeField: "adm3_pcode",
    parentId: "district",
    parentNameField: "adm2_en",
    groupTitle: "Upazila",
    layerTitles: {
      boundary: "Upazila Boundary",
      chart: "Upazila Chart",
    },
    minScale: 689_319,
    maxScale: 115_648,
    viewScale: 260_000,
  },
  {
    id: "union",
    label: "Union / Ward",
    shortLabel: "Union",
    nameField: "adm4_en",
    codeField: "adm4_pcode",
    parentId: "upazila",
    parentNameField: "adm3_en",
    groupTitle: "Union/Ward",
    layerTitles: {
      boundary: "Union Boundary",
      chart: "Union Chart",
    },
    minScale: 115_648,
    maxScale: 0,
    viewScale: 36_000,
  },
];

export function getAdminLevel(id: AdminLevelId): AdminLevel {
  const found = ADMIN_LEVELS.find((level) => level.id === id);
  if (!found) throw new Error(`Unknown admin level: ${id}`);
  return found;
}

export function ancestorsOf(id: AdminLevelId): AdminLevel[] {
  const result: AdminLevel[] = [];
  let current: AdminLevel | undefined = getAdminLevel(id);
  while (current) {
    result.unshift(current);
    current = current.parentId ? getAdminLevel(current.parentId) : undefined;
  }
  return result;
}

export function scaleToLevel(scale: number): AdminLevelId {
  const finestFirst = [...ADMIN_LEVELS].reverse();
  for (const level of finestFirst) {
    const minOk = level.minScale === 0 || scale <= level.minScale;
    const maxOk = level.maxScale === 0 || scale >= level.maxScale;
    if (minOk && maxOk) return level.id;
  }
  return "division";
}

export const FILTER_KEYS: AdminLevelId[] = ["division", "district", "upazila", "union"];

export type LocationFilters = Record<AdminLevelId, string | null>;

export function emptyFilters(): LocationFilters {
  return { division: null, district: null, upazila: null, union: null };
}

export function deepestFilter(filters: LocationFilters): AdminLevel | null {
  for (const level of [...ADMIN_LEVELS].reverse()) {
    if (filters[level.id]) return level;
  }
  return null;
}
