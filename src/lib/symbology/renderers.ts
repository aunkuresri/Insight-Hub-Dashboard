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
  /** Feature count in this class (when known). */
  count?: number;
};

export type AppliedLegend = {
  method: string;
  scheme: string;
  title: string;
  fields: Array<{ id: string; name: string; label: string }>;
  colors: Record<string, RGB>;
  classes: LegendClass[];
  size?: {
    min: number;
    max: number;
    title: string;
    /** Counts for high / mid / low size legend rows. */
    counts?: { high: number; mid: number; low: number };
  };
  ternary?: { a: string; b: string; c: string; scheme: string };
  bivariate?: { xLabel: string; yLabel: string; palette: Record<string, RGB>; breaksX?: number[]; breaksY?: number[] };
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

function colorsFromScheme(requestedScheme: string, count: number): RGB[] {
  const palette = CHART_PALETTES[requestedScheme] ?? CHART_PALETTES.Auto;
  if (count <= 0) return [];
  if (count === 1) return [palette[0] ?? SINGLE_SYMBOL_COLORS[requestedScheme] ?? SINGLE_SYMBOL_COLORS.Auto];
  if (palette.length === 1) return Array.from({ length: count }, () => palette[0]!);
  const out: RGB[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i === count - 1) {
      out.push(palette[palette.length - 1]!);
    } else {
      const idx = Math.min(i, palette.length - 2);
      out.push(palette[idx]!);
    }
  }
  return out;
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
  const attributes = fields.map((field, index) => {
    const n = fields.length;
    let rgb = palette[0]!;
    if (palette.length && n > 1) {
      rgb = index === n - 1 ? palette[palette.length - 1]! : palette[Math.min(index, palette.length - 2)]!;
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

  const sizeLowBreak = minDataValue + (maxDataValue - minDataValue) * 0.12;
  const sizeMid = (minDataValue + maxDataValue) / 2;
  const sizeCounts = {
    high: valid.filter((v) => v >= sizeMid).length,
    mid: valid.filter((v) => v >= sizeLowBreak && v < sizeMid).length,
    low: valid.filter((v) => v < sizeLowBreak).length,
  };

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
      size: { min: minDataValue, max: maxDataValue, title: sizeTitle, counts: sizeCounts },
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
  if (fields.length <= 1) return buildChoropleth({ rows, field: fields[0]!, aliases, requestedScheme });
  if (fields.length === 2)
    return buildBivariate({
      rows,
      fieldX: fields[0]!,
      fieldY: fields[1]!,
      aliases,
      requestedScheme,
    });
  if (fields.length === 3) return buildTernary({ rows, fields, aliases, requestedScheme });
  return buildPredominance({ rows, fields, aliases, requestedScheme });
}

function buildChoropleth(args: {
  rows: Row[];
  field: string;
  aliases: Record<string, string>;
  requestedScheme: string;
}): BuildResult {
  const { rows, field, aliases, requestedScheme } = args;
  const values = numericValues(rows, field);
  const ramp = CHOROPLETH_RAMPS[requestedScheme] ?? CHOROPLETH_RAMPS.Auto;
  const label = aliases[field] ?? field;

  if (values.length < 2 || values[0] === values[values.length - 1]) {
    const rgb = SINGLE_SYMBOL_COLORS[requestedScheme] ?? SINGLE_SYMBOL_COLORS.Auto;
    return {
      renderer: {
        type: "simple",
        label,
        symbol: polygonSymbol(rgb),
      },
      legend: {
        method: "Quantile choropleth",
        scheme: requestedScheme,
        title: label,
        fields: [{ id: field, name: field, label }],
        colors: { fill: rgb },
        classes: [{ label: withCount(formatBreak(values[0] ?? 0), values.length), color: rgb, count: values.length }],
      },
    };
  }

  const desired = Math.min(5, ramp.length);
  const edges = buildClassEdges(values, desired);
  const actualClasses = Math.max(1, edges.length - 1);
  const infos: Array<Record<string, unknown>> = [];
  const classes: LegendClass[] = [];

  for (let i = 0; i < actualClasses; i += 1) {
    const minV = edges[i]!;
    const maxV = edges[i + 1]!;
    const colorIndex =
      actualClasses <= 1
        ? 0
        : Math.round((i / (actualClasses - 1)) * (ramp.length - 1));
    const rgb = ramp[Math.min(colorIndex, ramp.length - 1)]!;
    const classLabel =
      actualClasses === 1
        ? `${formatBreak(minV)} – ${formatBreak(maxV)}`
        : i === 0
          ? `≤ ${formatBreak(maxV)}`
          : i === actualClasses - 1
            ? `> ${formatBreak(minV)}`
            : `${formatBreak(minV)} – ${formatBreak(maxV)}`;
    const count = countClassMembers(values, i, actualClasses, edges);
    const labelWithCount = withCount(classLabel, count);
    infos.push({
      classMinValue: minV,
      classMaxValue: maxV,
      label: labelWithCount,
      symbol: polygonSymbol(rgb),
    });
    classes.push({ label: labelWithCount, color: rgb, count });
  }

  return {
    renderer: {
      type: "classBreaks",
      field,
      classificationMethod: "esriClassifyQuantile",
      minValue: values[0],
      classBreakInfos: infos,
      defaultSymbol: defaultSymbol(),
      defaultLabel: "No data",
      legendOptions: { title: label },
    },
    legend: {
      method: "Quantile choropleth",
      scheme: requestedScheme,
      title: label,
      fields: [{ id: field, name: field, label }],
      colors: Object.fromEntries(classes.map((c, i) => [`c${i}`, c.color])),
      classes,
    },
  };
}

/** Count values in a class break, matching legend labels (≤ / range / >). */
function countClassMembers(
  values: number[],
  classIndex: number,
  classCount: number,
  edges: number[],
): number {
  if (classCount <= 0 || values.length === 0) return 0;
  if (classCount === 1) return values.length;
  const minV = edges[classIndex]!;
  const maxV = edges[classIndex + 1]!;
  if (classIndex === 0) {
    return values.filter((v) => v <= maxV).length;
  }
  if (classIndex === classCount - 1) {
    return values.filter((v) => v > minV).length;
  }
  return values.filter((v) => v > minV && v <= maxV).length;
}

function withCount(label: string, count: number): string {
  return `${label} (${count})`;
}

function buildClassEdges(values: number[], desired: number): number[] {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length === 0) return [0, 1];
  if (unique.length === 1) return [unique[0]!, unique[0]!];

  const classCount = Math.min(Math.max(desired, 2), unique.length);

  const rawBreaks = quantileBreaks(values, classCount);
  let edges = [...new Set([values[0]!, ...rawBreaks, values[values.length - 1]!])].sort(
    (a, b) => a - b,
  );

  if (edges.length - 1 < classCount && unique.length >= classCount) {
    edges = spacedUniqueEdges(unique, classCount);
  }

  if (edges.length < 2) {
    edges = [unique[0]!, unique[unique.length - 1]!];
  }
  return edges;
}

function spacedUniqueEdges(unique: number[], classCount: number): number[] {
  const n = unique.length;
  if (n <= 1) return [unique[0] ?? 0, unique[0] ?? 0];
  const edges: number[] = [unique[0]!];
  for (let c = 1; c < classCount; c += 1) {
    const idx = Math.min(n - 1, Math.round((c * (n - 1)) / classCount));
    const v = unique[idx]!;
    if (v > edges[edges.length - 1]!) edges.push(v);
  }
  const last = unique[n - 1]!;
  if (edges[edges.length - 1]! < last) edges.push(last);
  return edges;
}

/**
 * Uses unique-value spacing when classic quantiles would collapse to zeros.
 */
function tertileBreaks(values: number[]): [number, number] {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length <= 1) return [unique[0] ?? 0, unique[0] ?? 0];
  const i1 = Math.max(1, Math.floor(unique.length / 3));
  const i2 = Math.max(i1 + 1, Math.floor((2 * unique.length) / 3));
  return [unique[i1]!, unique[i2]!];
}

function formatBreak(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(value)) return String(value);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(3);
}

function buildBivariate(args: {
  rows: Row[];
  fieldX: string;
  fieldY: string;
  aliases: Record<string, string>;
  requestedScheme: string;
}): BuildResult {
  const { rows, fieldX, fieldY, aliases, requestedScheme } = args;
  const valuesX = numericValues(rows, fieldX);
  const valuesY = numericValues(rows, fieldY);
  const [xLow, xHigh] = tertileBreaks(valuesX.length ? valuesX : [0]);
  const [yLow, yHigh] = tertileBreaks(valuesY.length ? valuesY : [0]);
  const scheme = resolveScheme(requestedScheme, "bivariate");
  const palette = bivariatePalette(scheme);

  const labelX = aliases[fieldX] ?? fieldX;
  const labelY = aliases[fieldY] ?? fieldY;

  const classes: LegendClass[] = [];
  const uniqueValueInfos: Array<Record<string, unknown>> = [];
  const codes = ["LL", "LM", "LH", "ML", "MM", "MH", "HL", "HM", "HH"] as const;
  for (const code of codes) {
    const rgb = palette[code] ?? ([180, 180, 180] as RGB);
    const label = code;
    classes.push({ label, color: rgb, value: code });
    uniqueValueInfos.push({
      value: code,
      label,
      symbol: polygonSymbol(rgb),
    });
  }

  const arcade = `
Var x = ${arcadeNumber(fieldX)};
Var y = ${arcadeNumber(fieldY)};
Var xBin = When(x <= ${xLow}, 0, x <= ${xHigh}, 1, 2);
Var yBin = When(y <= ${yLow}, 0, y <= ${yHigh}, 1, 2);
Var codes = ["LL", "LM", "LH", "ML", "MM", "MH", "HL", "HM", "HH"];
return codes[xBin * 3 + yBin];
`.trim();

  return {
    renderer: {
      type: "uniqueValue",
      valueExpression: arcade,
      valueExpressionTitle: `${labelX} × ${labelY}`,
      uniqueValueInfos,
      defaultSymbol: defaultSymbol(),
      defaultLabel: "No data",
      legendOptions: { title: `${labelX} × ${labelY}` },
    },
    legend: {
      method: "Bivariate Colors (3 x 3)",
      scheme,
      title: `${labelX} × ${labelY}`,
      fields: [
        { id: fieldX, name: fieldX, label: labelX },
        { id: fieldY, name: fieldY, label: labelY },
      ],
      colors: Object.fromEntries(classes.map((c) => [c.value ?? c.label, c.color])),
      classes,
      bivariate: {
        xLabel: labelX,
        yLabel: labelY,
        palette: Object.fromEntries(codes.map((c) => [c, palette[c] ?? ([180, 180, 180] as RGB)])),
        breaksX: [xLow, xHigh],
        breaksY: [yLow, yHigh],
      },
    },
  };
}

function buildTernary(args: {
  rows: Row[];
  fields: string[];
  aliases: Record<string, string>;
  requestedScheme: string;
}): BuildResult {
  const { rows, fields, aliases, requestedScheme } = args;
  const a = fields[0]!;
  const b = fields[1]!;
  const c = fields[2]!;
  const labels = [aliases[a] ?? a, aliases[b] ?? b, aliases[c] ?? c];
  const scheme = resolveScheme(requestedScheme, "ternary");

  const classes: LegendClass[] = [];
  const uniqueValueInfos: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    /* schema only — values applied via arcade */
  }
  const codes = quantizeTernary();
  for (const code of codes) {
    const parts = code.split(",").map(Number);
    const aa = (parts[0] ?? 0) / 6;
    const bb = (parts[1] ?? 0) / 6;
    const cc = (parts[2] ?? 0) / 6;
    const rgb = blendTernary(aa, bb, cc, scheme);
    const label = code;
    classes.push({ label, color: rgb, value: code });
    uniqueValueInfos.push({
      value: code,
      label,
      symbol: polygonSymbol(rgb),
    });
  }

  const arcade = `
Var a = ${arcadeNumber(a)};
Var b = ${arcadeNumber(b)};
Var c = ${arcadeNumber(c)};
Var s = a + b + c;
If (s <= 0) { return "2,2,2"; }
Var pa = a / s;
Var pb = b / s;
Var pc = c / s;
Var ia = Floor(pa * 6 + 0.5);
Var ib = Floor(pb * 6 + 0.5);
Var ic = 6 - ia - ib;
If (ic < 0) {
  ic = 0;
  If (ia > ib) { ia = ia - 1; } Else { ib = ib - 1; }
}
return ia + "," + ib + "," + ic;
`.trim();

  return {
    renderer: {
      type: "uniqueValue",
      valueExpression: arcade,
      valueExpressionTitle: "Ternary composition",
      uniqueValueInfos,
      defaultSymbol: defaultSymbol(),
      defaultLabel: "No data",
      legendOptions: { title: "Ternary composition" },
    },
    legend: {
      method: "Ternary / Triangular Composition",
      scheme,
      title: "Ternary composition",
      fields: fields.map((name, i) => ({ id: name, name, label: labels[i]! })),
      colors: Object.fromEntries(classes.map((c) => [c.value ?? c.label, c.color])),
      classes,
      ternary: { a: labels[0]!, b: labels[1]!, c: labels[2]!, scheme },
    },
  };
}

function buildPredominance(args: {
  rows: Row[];
  fields: string[];
  aliases: Record<string, string>;
  requestedScheme: string;
}): BuildResult {
  const { rows, fields, aliases, requestedScheme } = args;
  const scheme = resolveScheme(requestedScheme, "qualitative");
  const palette =
    scheme === "Bright" || requestedScheme === "Bright"
      ? QUALITATIVE_BRIGHT
      : QUALITATIVE_MUTED;
  const colors = colorsFromScheme(
    requestedScheme === "Bright" || requestedScheme === "Muted" ? requestedScheme : "Auto",
    fields.length,
  );

  const classes: LegendClass[] = [];
  const uniqueValueInfos: Array<Record<string, unknown>> = [];
  fields.forEach((field, index) => {
    const rgb = colors[index] ?? palette[index % palette.length]!;
    const label = aliases[field] ?? field;
    classes.push({ label, color: rgb, value: field });
    uniqueValueInfos.push({
      value: field,
      label,
      symbol: polygonSymbol(rgb),
    });
  });

  const fieldList = fields.map((f) => arcadeField(f)).join(", ");
  const arcade = `
Var fields = [${fieldList}];
Var labels = [${fields.map((f) => JSON.stringify(f)).join(", ")}];
Var best = -1;
Var bestVal = -1;
For (var i = 0; i < Count(fields); i++) {
  Var v = Number(fields[i]);
  If (!IsEmpty(v) && v > bestVal) {
    bestVal = v;
    best = i;
  }
}
If (best < 0) { return ""; }
return labels[best];
`.trim();

  return {
    renderer: {
      type: "uniqueValue",
      valueExpression: arcade,
      valueExpressionTitle: "Predominant variable",
      uniqueValueInfos,
      defaultSymbol: defaultSymbol(),
      defaultLabel: "No data",
      legendOptions: { title: "Predominant variable" },
    },
    legend: {
      method: "Predominant Variable",
      scheme: requestedScheme,
      title: "Predominant variable",
      fields: fields.map((name) => ({ id: name, name, label: aliases[name] ?? name })),
      colors: Object.fromEntries(classes.map((c) => [c.value ?? c.label, c.color])),
      classes,
    },
  };
}
