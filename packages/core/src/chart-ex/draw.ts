import { accentColor, formatNumber, lineEl, mix, niceScale, nf, polyEl, rectEl, shapeEl, solid, textEl, tickValues } from '../chart/util';
import type { Rect, Pt } from '../chart/util';
import type { ChartEnv } from '../chart/hook';
import type { Fill, SlideElement } from '../types';
import type { ChartExModel, Series } from './model';
import { hierarchy, squarify, sunburst } from './hierarchy';
import type { TreeNode } from './hierarchy';
import { boxSummary, histogram, waterfall } from './statistics';
export function draw(model: ChartExModel, width: number, height: number, env: ChartEnv): SlideElement[] {
  if (!(width >= 40 && height >= 40) || !Number.isFinite(width + height))
    throw new Error('ChartEx 画布无效');
  const out: SlideElement[] = [rectEl({ x: 0, y: 0, w: width, h: height }, model.background, null)];
  const size = Math.max(8, Math.min(model.size, width / 15, height / 12));
  const label = (rect: Rect, text: string, color = model.textColor, align: 'left' | 'center' | 'right' = 'center'): void => {
    if (!text || rect.w < size * 1.5 || rect.h < size)
      return;
    const el = textEl(rect.x, rect.y, rect.w, rect.h, text, { size, color, fonts: model.fonts, align, anchor: 'middle' });
    if (el.text) {
      el.text.wrap = false;
      el.text.autoFitCompute = true;
    }
    out.push(el);
  };
  const pad = Math.min(width, height) * 0.035;
  let plot: Rect = { x: pad, y: pad, w: width - 2 * pad, h: height - 2 * pad };
  if (model.title) {
    label({ ...plot, h: size * 2 }, model.title);
    plot = { ...plot, y: plot.y + size * 2.4, h: plot.h - size * 2.4 };
  }
  const pointFill = (series: Series, at: number): Fill => series.points.get(at) ?? series.fill;
  const line = (x1: number, y1: number, x2: number, y2: number, color = model.textColor): void => {
    const el = lineEl(x1, y1, x2, y2, { color, width: 1, dash: null });
    if (el)
      out.push(el);
  };
  const rect = (r: Rect, fill: Fill, border = '#ffffff'): void => { out.push(rectEl(r, fill, { color: border, width: 1, dash: null })); };
  const series = model.series[0];
  const tree = model.kind === 'treemap' || model.kind === 'sunburst' ? hierarchy(series) : null;
  const groupFill = (node: TreeNode, i: number): Fill => series.points.get(node.point) ?? solid(accentColor(env.ctx, i));
  const category = (s: Series, i: number): string => s.categories[0]?.[i] ?? String(i + 1);
  if (model.legend) {
    const items = tree
      ? tree.children.map((node, i) => ({ name: node.name, fill: groupFill(node, i) }))
      : model.series.map((s) => ({ name: s.name, fill: s.fill })).filter((item) => item.name);
    const horizontal = model.legend === 't' || model.legend === 'b';
    const band = horizontal ? Math.min(plot.h * 0.2, size * 2) : Math.min(plot.w * 0.3, size * 9);
    const region = horizontal ? { x: plot.x, y: model.legend === 't' ? plot.y : plot.y + plot.h - band, w: plot.w, h: band }
      : { x: model.legend === 'l' ? plot.x : plot.x + plot.w - band, y: plot.y, w: band, h: plot.h };
    items.forEach((item, i) => {
      const w = horizontal ? region.w / Math.max(1, items.length) : region.w;
      const x = region.x + (horizontal ? i * w : 0), y = region.y + (horizontal ? 0 : i * size * 1.8);
      if (y + size * 1.8 > region.y + region.h)
        return;
      rect({ x, y: y + size * 0.4, w: size, h: size * 0.7 }, item.fill);
      label({ x: x + size * 1.4, y, w: Math.max(0, w - size * 1.4), h: size * 1.8 }, item.name, model.textColor, 'left');
    });
    if (items.length)
      plot = horizontal ? { ...plot, y: plot.y + (model.legend === 't' ? band : 0), h: plot.h - band }
        : { ...plot, x: plot.x + (model.legend === 'l' ? band : 0), w: plot.w - band };
  }
  if (tree) {
    const color = (group: number, depth: number): Fill => solid(mix(accentColor(env.ctx, group), '#ffffff', Math.min(0.5, depth * 0.13)));
    if (model.kind === 'treemap') {
      const visit = (parent: TreeNode, region: Rect, depth: number, group: number): void => {
        squarify(parent.children, region).forEach(({ node, rect: r }) => {
          const branch = depth === 0 ? tree.children.indexOf(node) : group;
          rect(r, depth === 0 ? groupFill(node, branch) : series.points.get(node.point) ?? color(branch, depth));
          if (node.children.length) {
            const banner = depth === 0 && series.parentLabels === 'banner' ? Math.min(size * 1.7, r.h / 3) : 0;
            visit(node, { x: r.x + 1, y: r.y + 1 + banner, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - 2 - banner) }, depth + 1, branch);
            if (depth === 0 && series.parentLabels !== 'none')
              label({ ...r, h: size * 1.7 }, node.name, '#ffffff', 'left');
          }
          else
            label({ x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 6 }, node.name, '#ffffff');
        });
      };
      visit(tree, plot, 0, 0);
    }
    else {
      const layout = sunburst(tree), radius = Math.min(plot.w, plot.h) / 2;
      const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
      for (const sector of layout.sectors) {
        const inner = radius * sector.depth / layout.depth, outer = radius * (sector.depth + 1) / layout.depth;
        out.push(shapeEl(cx - radius, cy - radius, radius * 2, radius * 2, sectorPath(radius, inner, outer, sector.start, sector.end), series.points.get(sector.node.point) ?? color(sector.group, sector.depth), { color: '#ffffff', width: 1, dash: null }));
        const angle = (sector.start + sector.end) / 2, mid = (inner + outer) / 2;
        const labelWidth = Math.min(outer - inner - 3, (sector.end - sector.start) * mid * 0.8);
        if (labelWidth >= size * 2) {
          label({ x: cx + Math.cos(angle) * mid - labelWidth / 2, y: cy + Math.sin(angle) * mid - size / 2, w: labelWidth, h: size * 1.2 }, sector.node.name, '#ffffff');
        }
      }
    }
    return out;
  }
  if (model.kind === 'funnel') {
    if (series.values.some((v) => v !== null && v < 0))
      throw new Error('ChartEx 漏斗负宽度');
    const maximum = series.values.reduce<number>((m, v) => Math.max(m, v ?? 0), 0);
    if (!(maximum > 0))
      throw new Error('ChartEx 漏斗无正值');
    const labels = Math.min(plot.w * 0.27, size * 8), band = plot.h / series.values.length;
    series.values.forEach((value, i) => {
      const w = (plot.w - labels) * (value ?? 0) / maximum;
      rect({ x: plot.x + labels + (plot.w - labels - w) / 2, y: plot.y + i * band + band * 0.13, w, h: band * 0.74 }, pointFill(series, i));
      label({ x: plot.x, y: plot.y + i * band, w: labels - size / 2, h: band }, category(series, i), model.textColor, 'right');
      if (series.labels)
        label({ x: plot.x + labels, y: plot.y + i * band, w: plot.w - labels, h: band }, formatNumber(value ?? 0, null));
    });
    return out;
  }
  plot = { x: plot.x + size * 3.5, y: plot.y, w: Math.max(1, plot.w - size * 4.5), h: Math.max(1, plot.h - size * 3) };
  const axis = (values: number[]): ((v: number) => number) => {
    const lo = values.reduce((a, b) => Math.min(a, b), 0), hi = values.reduce((a, b) => Math.max(a, b), 0);
    const scale = niceScale(lo, hi, 5);
    if (!Number.isFinite(scale.max - scale.min) || !(scale.max > scale.min))
      throw new Error('ChartEx 值域超限');
    const y = (v: number): number => plot.y + plot.h * (1 - (v - scale.min) / (scale.max - scale.min));
    for (const tick of tickValues(scale)) {
      line(plot.x, y(tick), plot.x + plot.w, y(tick), '#dddddd');
      label({ x: 0, y: y(tick) - size / 2, w: plot.x - size / 2, h: size * 1.2 }, formatNumber(tick, null), model.textColor, 'right');
    }
    return y;
  };
  if (model.kind === 'waterfall') {
    const steps = waterfall(series), y = axis(steps.flatMap((s) => [s.from, s.to])), band = plot.w / steps.length;
    steps.forEach((s, i) => {
      const fill = series.points.get(i) ?? solid(accentColor(env.ctx, s.total ? 2 : s.to >= s.from ? 0 : 1));
      const x = plot.x + i * band + band * 0.15;
      rect({ x, y: Math.min(y(s.from), y(s.to)), w: band * 0.7, h: Math.abs(y(s.from) - y(s.to)) }, fill);
      if (i + 1 < steps.length)
        line(x + band * 0.7, y(s.to), x + band, y(s.to), '#999999');
      label({ x: plot.x + i * band, y: plot.y + plot.h + size / 3, w: band, h: size * 2 }, category(series, i));
    });
  }
  else if (model.kind === 'histogram' || model.kind === 'pareto') {
    let bins = histogram(series);
    if (model.kind === 'pareto')
      bins = bins.map((bin, i) => ({ ...bin, i })).sort((a, b) => b.count - a.count || a.i - b.i);
    if (bins.some((b) => b.count < 0 || !Number.isFinite(b.count)))
      throw new Error('ChartEx 频数无效');
    const y = axis(bins.map((b) => b.count)), band = plot.w / bins.length;
    let sum = 0;
    const total = bins.reduce((n, b) => n + b.count, 0), points: Pt[] = [];
    bins.forEach((bin, i) => {
      const x = plot.x + i * band;
      rect({ x: x + 0.5, y: y(bin.count), w: Math.max(0, band - 1), h: y(0) - y(bin.count) }, series.fill);
      label({ x, y: plot.y + plot.h + size / 3, w: band, h: size * 2 }, bin.label);
      sum += bin.count;
      points.push([x + band / 2, plot.y + plot.h * (1 - sum / (total || 1))]);
    });
    if (model.kind === 'pareto') {
      const el = polyEl([points], null, { color: accentColor(env.ctx, 1), width: 2, dash: null }, false);
      if (el)
        out.push(el);
      for (const ratio of [0, 0.5, 1])
        label({ x: plot.x + plot.w, y: plot.y + plot.h * (1 - ratio) - size / 2, w: size * 2.8, h: size }, `${ratio * 100}%`);
    }
  }
  else {
    const boxes = model.series.map((s) => boxSummary(s.values, s.quartile));
    const y = axis(boxes.flatMap((b, i) => [b.low, b.high, ...(model.series[i].outliers ? b.outliers : []), ...(model.series[i].meanMarker || model.series[i].meanLine ? [b.mean] : [])])), band = plot.w / boxes.length;
    const means: Pt[] = [];
    boxes.forEach((box, i) => {
      const s = model.series[i], cx = plot.x + band * (i + 0.5), w = band * 0.5;
      line(cx, y(box.low), cx, y(box.high));
      line(cx - w / 3, y(box.low), cx + w / 3, y(box.low));
      line(cx - w / 3, y(box.high), cx + w / 3, y(box.high));
      rect({ x: cx - w / 2, y: y(box.q3), w, h: y(box.q1) - y(box.q3) }, s.fill, model.textColor);
      line(cx - w / 2, y(box.median), cx + w / 2, y(box.median));
      const points = [...(s.outliers ? box.outliers : []), ...(s.innerPoints ? box.inner : [])];
      for (const v of points)
        rect({ x: cx - 2, y: y(v) - 2, w: 4, h: 4 }, solid(model.textColor), model.textColor);
      if (s.meanMarker) {
        line(cx - 3, y(box.mean) - 3, cx + 3, y(box.mean) + 3);
        line(cx - 3, y(box.mean) + 3, cx + 3, y(box.mean) - 3);
      }
      if (s.meanLine)
        means.push([cx, y(box.mean)]);
      label({ x: plot.x + band * i, y: plot.y + plot.h + size / 3, w: band, h: size * 2 }, s.name || String(i + 1));
    });
    const meanLine = polyEl([means], null, { color: model.textColor, width: 1, dash: null }, false);
    if (meanLine)
      out.push(meanLine);
  }
  return out;
}
function sectorPath(center: number, inner: number, outer: number, start: number, end: number): string {
  const p = (r: number, a: number): string => `${nf(center + r * Math.cos(a))} ${nf(center + r * Math.sin(a))}`;
  // 整圆分成两个弧，避免 SVG 同起终点圆弧退化为空路径。
  const middle = (start + end) / 2;
  const arc = (r: number, a: number, b: number, direction: number): string => `A ${nf(r)} ${nf(r)} 0 0 ${direction} ${p(r, a)} A ${nf(r)} ${nf(r)} 0 0 ${direction} ${p(r, b)}`;
  return `M ${p(outer, start)} ${arc(outer, middle, end, 1)} L ${p(inner, end)} ${inner > 0 ? arc(inner, middle, start, 0) : ''} Z`;
}
