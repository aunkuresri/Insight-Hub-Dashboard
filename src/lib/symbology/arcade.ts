export function arcadeField(field: string): string {
  return `$feature[${JSON.stringify(field)}]`;
}

export function arcadeNumber(value: number): string {
  return Number(value).toPrecision(15).replace(/\.?0+$/, "");
}

export function chartTotalExpression(fields: string[]): string {
  return fields
    .map((field) => {
      const ref = arcadeField(field);
      return `When(IsEmpty(${ref}),0,Max(${ref},0))`;
    })
    .join(" + ");
}

export function sizeFieldExpression(field: string): string {
  const ref = arcadeField(field);
  return `When(IsEmpty(${ref}),0,Max(${ref},0))`;
}

/**
 * Map label for applied pie-chart symbology.
 * Shows the size value (size field or sum of pie slices) and the predominant
 * slice as a percentage of the pie total — e.g. "1,250 (42%)".
 */
export function chartLabelExpression(fields: string[], sizeField?: string | null): string {
  const pieParts = fields.map((field) => {
    const ref = arcadeField(field);
    return `When(IsEmpty(${ref}),0,Max(${ref},0))`;
  });
  const pieTotal = pieParts.join(" + ") || "0";
  const sizeExpr = sizeField ? sizeFieldExpression(sizeField) : pieTotal;
  const maxExpr =
    pieParts.length === 0
      ? "0"
      : pieParts.length === 1
        ? pieParts[0]!
        : `Max(${pieParts.join(", ")})`;

  return [
    `var sizeVal = ${sizeExpr};`,
    `var pieTotal = ${pieTotal};`,
    `var maxSlice = ${maxExpr};`,
    `if (sizeVal <= 0 && pieTotal <= 0) { return ""; }`,
    `var valueText = Text(sizeVal, "#,##0");`,
    `if (pieTotal <= 0) { return valueText; }`,
    `var pct = Round(100 * maxSlice / pieTotal, 0);`,
    `return valueText + " (" + pct + "%)";`,
  ].join("\n");
}
