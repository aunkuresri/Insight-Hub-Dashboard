/**
 * Client-side renderer JSON builders.
 *
 * Output is Esri REST renderer JSON so it can be applied with
 * `jsonUtils.fromJSON` — no published geoprocessing tool required.
 */

import {
  BIVARIATE_SCHEMES,
  CHART_PALETTES,
  CHOROPLETH_RAMPS,
  QUALITATIVE_BRIGHT,
  QUALITATIVE_MUTED,
  SINGLE_SYMBOL_COLORS,
  bivariatePalette,
  blendTernary,
  resolveScheme,
  type RGB,
} from "@/config/symbology-schemes";
import { minMax, numericValues, quantizeTernary, quantileBreaks, safeNumber } from "@/lib/gis/stats";
import { arcadeField, arcadeNumber, chartTotalExpression, sizeFieldExpression } from "@/lib/symbology/arcade";

export type EsriRenderer = Record<string, unknown>;

export type LegendClass = {
  label: string;
  color: RGB;
  value?: string;
};

export type AppliedLegend = {
  method: string;
  scheme: string;
  title: string;
  fields: Array<{ id: string; name: string; label: string }>;
  colors: Record<string, RGB>;
  classes: LegendClass[];
  size?: { min: number; max: number; title: string };
  ternary?: { a: string; b: string; c: string; scheme: string };
  bivariate?: { xLabel: string; yLabel: string; palette: Record<string, RGB> };
};

export type BuildResult = {
  renderer: EsriRenderer;
  legend: AppliedLegend;
};

type Row = Record<string, unknown>;

function polygonSymbol(rgb: RGB, alpha = 220) {
  return {
    type: "esriSFS",
    style: "esriSFSSolid",
    color: [rgb[0], rgb[1], rgb[2], alpha],
    outline: {
      type: "esriSLS",
      style: "esriSLSSolid",
      color: [90, 90, 90, 150],
      width: 0.6,
    },
  };
}

function defaultSymbol() {
  return polygonSymbol([190, 190, 190]);
}

function methodForBoundary(fieldCount: number): string {
  if (fieldCount <= 1) return "Quantile choropleth";
  if (fieldCount === 2) return "Bivariate Colors (3 x 3)";
  if (fieldCount === 3) return "Ternary / Triangular Composition";
  return "Predominant Variable";
}

export function describeMethod(layerGroup: "boundary" | "chart", fieldCount: number): string {
  if (layerGroup === "chart") return "Pie Chart + Data-Driven Size";
  return methodForBoundary(fieldCount);
}

export function buildChartRenderer(args: {
  rows: Row[];
  fields: string[];
  aliases: Record<string, string>;
  requestedScheme: string;
  sizeField?: string | null;
  sizeLabel?: string | null;
}): BuildResult {
  const { rows, fields, aliases, requestedScheme, sizeField, sizeLabel } = args;
  const palette = CHART_PALETTES[requestedScheme] ?? CHART_PALETTES.Auto;
  // 2 vars → 1st & last; 3 → 1st, 2nd & last; n → first n-1 + last of scheme
  const nFields = fields.length;
  const attributes = fields.map((field, index) => {
    let rgb: RGB = [128, 128, 128];
    if (palette.length) {
      if (nFields <= 1) rgb = palette[0]!;
      else if (index === nFields - 1) rgb = palette[palette.length - 1]!;
      else rgb = palette[Math.min(index, palette.length - 2)]!;
    }
    return {
      field,
      label: aliases[field] ?? field,
      color: [rgb[0], rgb[1], rgb[2], 255],
    };
  });

  const sizeValues: number[] = [];
  for (const row of rows) {
    if (sizeField) {
      const n = safeNumber(row[sizeField]);
      sizeValues.push(n != null ? Math.max(0, n) : 0);
    } else {
      let total = 0;
      for (const field of fields) {
        const n = safeNumber(row[field]);
        if (n != null) total += Math.max(0, n);
      }
      sizeValues.push(total);
    }
  }
  const valid = sizeValues.filter((v) => v != null);
  const extent = valid.length ? { min: Math.min(...valid), max: Math.max(...valid) } : { min: 0, max: 1 };
  let minDataValue = extent.min;
  let maxDataValue = extent.max;
  if (maxDataValue <= 0) {
    minDataValue = 0;
    maxDataValue = 1;
  } else if (minDataValue === maxDataValue) {
    minDataValue = 0;
  }

  const valueExpression = sizeField ? sizeFieldExpression(sizeField) : chartTotalExpression(fields);
  const sizeTitle = sizeField ? (sizeLabel || sizeField) : "Total selected indicators";

  const renderer: EsriRenderer = {
    type: "pieChart",
    attributes,
    size: 24,
    holePercentage: 0,
    outline: {
      type: "esriSLS",
      style: "esriSLSSolid",
      color: [65, 65, 65, 220],
      width: 0.6,
    },
    defaultColor: [0, 0, 0, 0],
    defaultLabel: "No data",
    legendOptions: { title: "Selected indicators" },
    visualVariables: [
      {
        type: "sizeInfo",
        valueExpression,
        valueExpressionTitle: sizeTitle,
        minDataValue,
        maxDataValue,
        minSize: 12,
        maxSize: 48,
      },
    ],
    backgroundFillSymbol: {
      type: "esriSFS",
      style: "esriSFSSolid",
      color: [0, 0, 0, 0],
      outline: {
        type: "esriSLS",
        style: "esriSLSNull",
        color: [0, 0, 0, 0],
        width: 0,
      },
    },
  };

  return {
    renderer,
    legend: {
      method: "Pie Chart + Data-Driven Size",
      scheme: requestedScheme,
      title: "Selected indicators",
      fields: fields.map((name) => ({ id: name, name, label: aliases[name] ?? name })),
      colors: Object.fromEntries(
        attributes.map((a) => [a.field, [a.color[0], a.color[1], a.color[2]] as RGB]),
      ),
      classes: attributes.map((a) => ({
        label: a.label,
        color: [a.color[0], a.color[1], a.color[2]] as RGB,
        value: a.field,
      })),
      size: { min: minDataValue, max: maxDataValue, title: sizeTitle },
    },
  };
}

export function buildBoundaryRenderer(args: {
  rows: Row[];
  fields: string[];
  aliases: Record<string, string>;
  requestedScheme: string;
}): BuildResult {
  const { rows, fields, aliases, requestedScheme } = args;
  const method = methodForBoundary(fields.length);
  if (method === "Quantile choropleth") {
    const field = fields[0]!;
    const values = numericValues(rows, field);
    const breaks = quantileBreaks(values, 5);
    const ramp = CHOROPLETH_RAMPS[requestedScheme] ?? CHOROPLETH_RAMPS.Auto;
    if (fields.length === 0 || values.length === 0) {
      const rgb = SINGLE_SYMBOL_COLORS[requestedScheme] ?? SINGLE_SYMBOL_COLORS.Auto;
      return {
        renderer: {
          type: "simple",
          symbol: polygonSymbol(rgb),
          label: aliases[field] ?? field,
        },
        legend: {
          method: "Single Symbol",
          scheme: requestedScheme,
          title: aliases[field] ?? field,
          fields: fields.map((name) => ({ id: name, name, label: aliases[name] ?? name })),
          colors: { [field]: rgb },
          classes: [{ label: aliases[field] ?? field, color: rgb }],
        },
      };
    }
    const classBreakInfos = breaks.slice(0, -1).map((lo, i) => {
      const hi = breaks[i + 1]!;
      const rgb = ramp[Math.min(i, ramp.length - 1)]!;
      return {
        classMinValue: lo,
        classMaxValue: hi,
        label: `${lo.toFixed(1)} – ${hi.toFixed(1)}`,
        symbol: polygonSymbol(rgb),
      };
    });
    return {
      renderer: {
        type: "classBreaks",
        field,
        classificationMethod: "esriClassifyQuantile",
        minValue: breaks[0],
        classBreakInfos,
        defaultSymbol: defaultSymbol(),
        defaultLabel: "No data",
      },
      legend: {
        method,
        scheme: requestedScheme,
        title: aliases[field] ?? field,
        fields: fields.map((name) => ({ id: name, name, label: aliases[name] ?? name })),
        colors: Object.fromEntries(
          classBreakInfos.map((c, i) => [`c${i}`, [c.symbol.color[0], c.symbol.color[1], c.symbol.color[2]] as RGB]),
        ),
        classes: classBreakInfos.map((c) => ({
          label: c.label,
          color: [c.symbol.color[0], c.symbol.color[1], c.symbol.color[2]] as RGB,
        })),
      },
    };
  }
  // Fallback for multi-field methods — full bivariate/ternary/predominant logic in complete source
  return {
    renderer: { type: "simple", symbol: defaultSymbol() },
    legend: {
      method,
      scheme: requestedScheme,
      title: method,
      fields: fields.map((name) => ({ id: name, name, label: aliases[name] ?? name })),
      colors: {},
      classes: [],
    },
  };
}

export { BIVARIATE_SCHEMES, minMax };
