/**
 * Color schemes used by the on-the-fly symbology engine.
 * Values are 0–255 RGB tuples, matching the original Smart Symbology pyt tool.
 */

export type RGB = [number, number, number];

export const COLOR_SCHEMES = [
  "Auto",
  "Purple - Teal",
  "Blue - Red",
  "Green - Purple",
  "Orange - Blue",
] as const;

export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const CHART_PALETTES: Record<string, RGB[]> = {
  Auto: [
    [31, 119, 180],
    [255, 127, 14],
    [44, 160, 44],
    [214, 39, 40],
    [148, 103, 189],
    [140, 86, 75],
    [227, 119, 194],
    [188, 189, 34],
    [23, 190, 207],
    [127, 127, 127],
  ],
  "Purple - Teal": [
    [87, 65, 155],
    [49, 130, 189],
    [66, 174, 170],
    [126, 201, 172],
    [186, 92, 169],
    [140, 81, 167],
    [92, 164, 214],
    [45, 188, 178],
    [196, 123, 180],
    [100, 100, 145],
  ],
  "Blue - Red": [
    [49, 130, 189],
    [214, 39, 40],
    [107, 174, 214],
    [239, 138, 98],
    [84, 39, 143],
    [165, 15, 21],
    [116, 196, 118],
    [253, 174, 97],
    [158, 202, 225],
    [202, 178, 214],
  ],
  "Green - Purple": [
    [49, 163, 84],
    [117, 107, 177],
    [116, 196, 118],
    [158, 154, 200],
    [0, 109, 44],
    [84, 39, 143],
    [166, 216, 84],
    [188, 189, 220],
    [102, 194, 165],
    [231, 138, 195],
  ],
  "Orange - Blue": [
    [230, 126, 34],
    [52, 152, 219],
    [243, 156, 18],
    [41, 128, 185],
    [211, 84, 0],
    [31, 97, 141],
    [245, 176, 65],
    [93, 173, 226],
    [183, 149, 11],
    [46, 134, 193],
  ],
};

export const BIVARIATE_SCHEMES: Record<string, { LL: RGB; X: RGB; Y: RGB; XY: RGB }> = {
  "Purple - Teal": {
    LL: [232, 232, 232],
    X: [91, 195, 198],
    Y: [186, 92, 169],
    XY: [66, 87, 158],
  },
  "Blue - Red": {
    LL: [238, 238, 238],
    X: [215, 82, 75],
    Y: [72, 139, 190],
    XY: [111, 55, 130],
  },
  "Green - Purple": {
    LL: [238, 238, 238],
    X: [74, 170, 108],
    Y: [145, 96, 170],
    XY: [61, 85, 112],
  },
  "Orange - Blue": {
    LL: [238, 238, 238],
    X: [230, 126, 34],
    Y: [52, 152, 219],
    XY: [97, 76, 126],
  },
};

export const TERNARY_SCHEMES: Record<string, { corner_a: RGB; corner_b: RGB; corner_c: RGB }> = {
  "Red - Green - Blue": {
    corner_a: [231, 76, 60],
    corner_b: [46, 204, 113],
    corner_c: [52, 152, 219],
  },
  "Orange - Green - Blue": {
    corner_a: [230, 126, 34],
    corner_b: [39, 174, 96],
    corner_c: [41, 128, 185],
  },
  "Magenta - Cyan - Yellow": {
    corner_a: [196, 65, 155],
    corner_b: [38, 166, 180],
    corner_c: [230, 190, 55],
  },
  "Red - Purple - Cyan": {
    corner_a: [210, 65, 70],
    corner_b: [137, 90, 170],
    corner_c: [45, 180, 190],
  },
};

export const QUALITATIVE_BRIGHT: RGB[] = [
  [31, 119, 180],
  [255, 127, 14],
  [44, 160, 44],
  [214, 39, 40],
  [148, 103, 189],
  [140, 86, 75],
  [227, 119, 194],
  [127, 127, 127],
  [188, 189, 34],
  [23, 190, 207],
];

export const QUALITATIVE_MUTED: RGB[] = [
  [102, 194, 165],
  [252, 141, 98],
  [141, 160, 203],
  [231, 138, 195],
  [166, 216, 84],
  [255, 217, 47],
  [229, 196, 148],
  [179, 179, 179],
];

/** Sequential / diverging ramps used for single-field choropleth + picker previews. */
export const CHOROPLETH_RAMPS: Record<string, RGB[]> = {
  Auto: [
    [239, 243, 255],
    [189, 215, 231],
    [107, 174, 214],
    [49, 130, 189],
    [8, 81, 156],
  ],
  // Purple → light → Teal
  "Purple - Teal": [
    [106, 81, 163],
    [158, 154, 200],
    [247, 247, 247],
    [127, 205, 187],
    [1, 133, 113],
  ],
  // Blue → light → Red
  "Blue - Red": [
    [5, 113, 176],
    [146, 197, 222],
    [247, 247, 247],
    [244, 165, 130],
    [202, 0, 32],
  ],
  // Green → light → Purple
  "Green - Purple": [
    [27, 120, 55],
    [166, 219, 160],
    [247, 247, 247],
    [194, 165, 207],
    [118, 42, 131],
  ],
  // Orange → light → Blue
  "Orange - Blue": [
    [230, 97, 1],
    [253, 184, 99],
    [247, 247, 247],
    [146, 197, 222],
    [5, 113, 176],
  ],
};

export const SINGLE_SYMBOL_COLORS: Record<string, RGB> = {
  Auto: [31, 119, 180],
  "Purple - Teal": [91, 195, 198],
  "Blue - Red": [72, 139, 190],
  "Green - Purple": [74, 170, 108],
  "Orange - Blue": [230, 126, 34],
};

export function resolveScheme(requested: string, method: string): string {
  const scheme = requested || "Auto";
  if (method === "Single Symbol" || method === "Quantile choropleth") return scheme;
  if (method === "Bivariate Colors (3 x 3)") {
    if (scheme === "Auto") return "Purple - Teal";
    return scheme in BIVARIATE_SCHEMES ? scheme : "Purple - Teal";
  }
  if (method === "Ternary / Triangular Composition") {
    const mapping: Record<string, string> = {
      Auto: "Red - Green - Blue",
      "Purple - Teal": "Red - Purple - Cyan",
      "Blue - Red": "Red - Green - Blue",
      "Green - Purple": "Magenta - Cyan - Yellow",
      "Orange - Blue": "Orange - Green - Blue",
    };
    return mapping[scheme] ?? "Red - Green - Blue";
  }
  if (scheme === "Green - Purple" || scheme === "Orange - Blue") return "Qualitative - Muted";
  return "Qualitative - Bright";
}

export function rgbCss(rgb: RGB, alpha = 1): string {
  if (alpha >= 1) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function bivariatePalette(name: string): Record<string, RGB> {
  const corners = BIVARIATE_SCHEMES[name] ?? BIVARIATE_SCHEMES["Purple - Teal"];
  const result: Record<string, RGB> = {};
  for (let yClass = 1; yClass <= 3; yClass += 1) {
    const v = (yClass - 1) / 2;
    for (let xClass = 1; xClass <= 3; xClass += 1) {
      const u = (xClass - 1) / 2;
      const rgb: RGB = [0, 0, 0];
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          (1 - u) * (1 - v) * corners.LL[channel] +
          u * (1 - v) * corners.X[channel] +
          (1 - u) * v * corners.Y[channel] +
          u * v * corners.XY[channel];
        rgb[channel] = Math.round(value);
      }
      result[`${xClass}_${yClass}`] = rgb;
    }
  }
  return result;
}

export function blendTernary(a: number, b: number, c: number, name: string): RGB {
  const colors = TERNARY_SCHEMES[name] ?? TERNARY_SCHEMES["Red - Green - Blue"];
  return [0, 1, 2].map((channel) =>
    Math.max(
      0,
      Math.min(
        255,
        Math.round(
          a * colors.corner_a[channel] + b * colors.corner_b[channel] + c * colors.corner_c[channel],
        ),
      ),
    ),
  ) as RGB;
}
