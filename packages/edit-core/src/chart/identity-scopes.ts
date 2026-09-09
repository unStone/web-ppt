import { assertChartIdentity, MAX_CHART_POINTS } from './validation';

export interface ChartIdentityScopes {
  readonly prefix: string;
  readonly frames: readonly (readonly [string, string])[];
}

export function readIdentityScopes(value: unknown): ChartIdentityScopes | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('图表身份作用域无效');
  const scope = value as ChartIdentityScopes;
  assertChartIdentity(scope.prefix, scope.prefix, '图表身份作用域');
  if (!Array.isArray(scope.frames) || scope.frames.length > MAX_CHART_POINTS) throw new Error('图表框架身份数量超限');
  const keys = new Set<string>();
  for (const item of scope.frames) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string'
      || !item[0] || item[0].length > 1024 || keys.has(item[0])) throw new Error('图表框架身份定位无效');
    assertChartIdentity(item[1], item[1], '图表框架身份');
    keys.add(item[0]);
  }
  return scope;
}

export function scopedIdentity(value: unknown, scope: ChartIdentityScopes | undefined, prefix: string): unknown {
  return scope && typeof value === 'string' && value.startsWith(`${scope.prefix}:`)
    ? `${prefix}${value.slice(scope.prefix.length)}` : value;
}
