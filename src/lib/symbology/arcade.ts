import { arcadeField, arcadeNumber } from "./arcade-helpers";

/** Pie / chart size expression for data-driven size. */
export function sizeFieldExpression(field: string | null | undefined): string {
  if (!field) return "1";
  return arcadeNumber(field);
}

/** Sum of chart category fields (for percentage labels). */
export function chartTotalExpression(fields: string[]): string {
  if (!fields.length) return "0";
  return fields.map((f) => arcadeNumber(f)).join(" + ");
}

/**
 * Label for applied chart symbology: value and predominant share %.
 * Example: "1,250 (42%)"
 */
export function chartLabelExpression(
  chartFields: string[],
  sizeField?: string | null,
): string {
  const fields = chartFields.filter(Boolean);
  if (!fields.length && !sizeField) return "''";

  const valueExpr = sizeField
    ? arcadeNumber(sizeField)
    : fields.length === 1
      ? arcadeNumber(fields[0]!)
      : chartTotalExpression(fields);

  if (!fields.length) {
    return `Text(${valueExpr}, '#,###')`;
  }

  const total = chartTotalExpression(fields);
  const maxParts = fields.map((f) => arcadeNumber(f)).join(", ");
  // Predominant field value / total * 100
  return `
var __v = ${valueExpr};
var __t = ${total};
var __pct = IIf(__t > 0, Round((Max(${maxParts}) / __t) * 100, 0), 0);
return Text(__v, '#,###') + ' (' + Text(__pct) + '%)';
`.trim();
}
