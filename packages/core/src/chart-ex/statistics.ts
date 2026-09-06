import type { Series } from './model';
export interface BoxSummary {
  low: number;
  high: number;
  q1: number;
  median: number;
  q3: number;
  mean: number;
  outliers: number[];
  inner: number[];
}
export function boxSummary(values: readonly (number | null)[], method: Series['quartile']): BoxSummary {
  const data = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!data.length)
    throw new Error('ChartEx 箱线无数据');
  const median = (a: number[]): number => a.length % 2 ? a[(a.length - 1) / 2] : a[a.length / 2 - 1] / 2 + a[a.length / 2] / 2;
  const mid = Math.floor(data.length / 2);
  const q1 = data.length === 1 ? data[0] : median(data.slice(0, mid + (method === 'inclusive' && data.length % 2 ? 1 : 0)));
  const q3 = data.length === 1 ? data[0] : median(data.slice(mid + (method === 'exclusive' && data.length % 2 ? 1 : 0)));
  const iqr = q3 - q1;
  const inner = data.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return { low: inner[0], high: inner[inner.length - 1], q1, median: median(data), q3,
    mean: data.reduce((n, v) => n + v / data.length, 0), inner,
    outliers: data.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr) };
}
export interface Bin {
  label: string;
  count: number;
  lo: number;
  hi: number;
}
export function histogram(series: Series): Bin[] {
  const values = series.values.filter((v): v is number => v !== null);
  if (!values.length)
    throw new Error('ChartEx 直方图无数据');
  if (series.binning.aggregation) {
    const totals = new Map<string, number>();
    series.values.forEach((v, i) => { if (v !== null) {
      const label = series.categories[0]?.[i];
      if (label === null || label === undefined)
        throw new Error('ChartEx 聚合类别缺失');
      totals.set(label, (totals.get(label) ?? 0) + v);
    } });
    return [...totals].map(([label, count]) => ({ label, count, lo: 0, hi: 0 }));
  }
  const config = series.binning;
  if (config.size !== undefined && !(config.size > 0) || config.count !== undefined && !(config.count > 0))
    throw new Error('ChartEx 分箱宽度/数量无效');
  const minimum = values.reduce((n, v) => Math.min(n, v), Infinity), maximum = values.reduce((n, v) => Math.max(n, v), -Infinity);
  const lo = config.underflow ?? minimum, hi = config.overflow ?? maximum;
  if (hi < lo)
    throw new Error('ChartEx 分箱边界反向');
  const average = values.reduce((n, v) => n + v / values.length, 0);
  // Scott 法则与 Office 自动分箱相同；常量分布必须保留一个非空区间。
  const deviation = Math.sqrt(values.reduce((n, v) => n + (v - average) * (v - average), 0) / Math.max(1, values.length - 1));
  const width = config.size ?? (config.count ? (hi - lo) / config.count : 3.5 * deviation / Math.cbrt(values.length));
  const step = width || 1;
  const bounded = config.overflow !== undefined || config.count !== undefined;
  const count = hi === lo ? 1 : Math.max(1, config.count ?? (config.closed === 'l' && !bounded ? Math.floor((hi - lo) / step) + 1 : Math.ceil((hi - lo) / step)));
  if (count > 1000 || !Number.isFinite(step) || !Number.isFinite(count))
    throw new Error('ChartEx 分箱数量超限');
  // 计数与标签共用区间定义，最后一个有限区间必须接住 overflow 阈值。
  const bins = Array.from({ length: count }, (_, i) => ({
    lo: lo + i * step, hi: i === count - 1 && bounded ? hi : lo + (i + 1) * step,
    closedLow: i === 0 ? config.underflow === undefined : config.closed === 'l',
    closedHigh: config.closed === 'r' || i === count - 1 && bounded,
    count: 0, label: '',
  }));
  if (bins.some((bin) => !Number.isFinite(bin.lo + bin.hi) || bin.hi < bin.lo))
    throw new Error('ChartEx 分箱区间超限');
  if (config.underflow !== undefined)
    bins.unshift({ lo: -Infinity, hi: lo, closedLow: false, closedHigh: true, count: 0, label: `≤ ${lo}` });
  if (config.overflow !== undefined)
    bins.push({ lo: hi, hi: Infinity, closedLow: false, closedHigh: false, count: 0, label: `> ${hi}` });
  for (const value of values) {
    const bin = bins.find((b) => (value > b.lo || b.closedLow && value === b.lo)
      && (value < b.hi || b.closedHigh && value === b.hi));
    if (!bin) throw new Error('ChartEx 观测不在分箱内');
    bin.count++;
  }
  return bins.map(({ lo, hi, count, label, closedLow, closedHigh }) => ({ lo, hi, count,
    label: label || `${closedLow ? '[' : '('}${+lo.toPrecision(6)}, ${+hi.toPrecision(6)}${closedHigh ? ']' : ')'}` }));
}
export function waterfall(series: Series): {
  from: number;
  to: number;
  total: boolean;
}[] {
  let sum = 0;
  return series.values.map((value, index) => {
    const v = value ?? 0, total = series.totals.has(index);
    const from = total ? 0 : sum, to = total ? v : sum + v;
    if (!Number.isFinite(to))
      throw new Error('ChartEx 瀑布累计超限');
    sum = to;
    return { from, to, total };
  });
}
