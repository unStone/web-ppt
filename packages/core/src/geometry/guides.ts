const rad = (degrees: number): number => degrees * Math.PI / 180;

export const DRAWINGML_DEGREE = 60000;
export type GuideDefinition = readonly [name: string, formula: string];

export function builtinGuideValues(width: number, height: number): Record<string, number> {
  const ss = Math.min(width, height);
  const values: Record<string, number> = {
    l: 0, t: 0, r: width, b: height, w: width, h: height,
    hc: width / 2, vc: height / 2, ls: Math.max(width, height), ss,
    cd2: 180 * DRAWINGML_DEGREE, cd4: 90 * DRAWINGML_DEGREE,
    cd8: 45 * DRAWINGML_DEGREE,
    '3cd4': 270 * DRAWINGML_DEGREE, '3cd8': 135 * DRAWINGML_DEGREE,
    '5cd8': 225 * DRAWINGML_DEGREE, '7cd8': 315 * DRAWINGML_DEGREE,
  };
  for (const divisor of [2, 3, 4, 5, 6, 8, 10, 32]) {
    values[`hd${divisor}`] = height / divisor;
    values[`wd${divisor}`] = width / divisor;
  }
  for (const divisor of [2, 4, 6, 8, 16, 32]) values[`ssd${divisor}`] = ss / divisor;
  return values;
}

export function guideToken(value: string | null, guides: Readonly<Record<string, number>>): number {
  if (value === null) return 0;
  if (Object.prototype.hasOwnProperty.call(guides, value)) return guides[value];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function evaluateGuideFormula(
  formula: string,
  guides: Readonly<Record<string, number>>,
): number {
  const [op, ...args] = formula.trim().split(/\s+/);
  const x = guideToken(args[0] ?? '0', guides);
  const y = guideToken(args[1] ?? '0', guides);
  const z = guideToken(args[2] ?? '0', guides);
  let value: number;
  switch (op) {
    case '*/': value = z === 0 ? 0 : x * y / z; break;
    case '+-': value = x + y - z; break;
    case '+/': value = z === 0 ? 0 : (x + y) / z; break;
    case '?:': value = x > 0 ? y : z; break;
    case 'abs': value = Math.abs(x); break;
    case 'at2': value = Math.atan2(y, x) * 180 * DRAWINGML_DEGREE / Math.PI; break;
    case 'cat2': value = x * Math.cos(Math.atan2(z, y)); break;
    case 'cos': value = x * Math.cos(rad(y / DRAWINGML_DEGREE)); break;
    case 'max': value = Math.max(x, y); break;
    case 'min': value = Math.min(x, y); break;
    case 'mod': value = Math.sqrt(x * x + y * y + z * z); break;
    case 'pin': value = y < x ? x : y > z ? z : y; break;
    case 'sat2': value = x * Math.sin(Math.atan2(z, y)); break;
    case 'sin': value = x * Math.sin(rad(y / DRAWINGML_DEGREE)); break;
    case 'sqrt': value = Math.sqrt(Math.max(x, 0)); break;
    case 'tan': value = x * Math.tan(rad(y / DRAWINGML_DEGREE)); break;
    case 'val': value = x; break;
    default: value = 0;
  }
  return Number.isFinite(value) ? value : 0;
}

export function evaluateGuideDefinitions(
  definitions: readonly GuideDefinition[],
  values: Record<string, number>,
  preserved: ReadonlySet<string> = new Set(),
): Record<string, number> {
  for (const [name, formula] of definitions) {
    if (!preserved.has(name)) values[name] = evaluateGuideFormula(formula, values);
  }
  return values;
}

export function presetGuideValues(
  width: number,
  height: number,
  defaults: readonly GuideDefinition[],
  guides: readonly GuideDefinition[],
  adjustments: Readonly<Record<string, number>>,
): Record<string, number> {
  const values = builtinGuideValues(width, height);
  const explicit = new Set(Object.keys(adjustments));
  Object.assign(values, adjustments);
  evaluateGuideDefinitions(defaults, values, explicit);
  return evaluateGuideDefinitions(guides, values);
}
