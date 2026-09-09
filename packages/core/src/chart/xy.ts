import type { SlideElement } from '../types';
import { defaultAxis, type Axis, type ChartModel, type PlotGroup } from './model';
import { axisInsets, makeValueView, makeXY, renderAxes, tickTarget, valueExtent, xExtent,
  type AxisView, type Extent, type Insets } from './frame';
import { renderBubbles, renderScatter, type PlotEnv } from './plots';
import type { Rect } from './util';

interface XYAxes { group: PlotGroup; x: AxisView; y: AxisView }
interface XYBinding { group: PlotGroup; x: Axis; y: Axis }

/** 数值坐标必须沿本组的 axId 解析，混合图的第一条轴通常是别组的类别轴。 */
function bindings(m: ChartModel, groups: PlotGroup[]): XYBinding[] {
  const numeric = m.axes.filter(axis => axis.kind === 'val');
  return groups.map(group => {
    const bound = numeric.filter(axis => group.axIds.includes(axis.id));
    const axes = bound.length ? bound : numeric;
    const x = axes.find(axis => axis.pos === 'b' || axis.pos === 't') ?? axes[0] ?? defaultAxis('val');
    const y = axes.find(axis => axis !== x) ?? defaultAxis('val');
    return { group, x, y };
  });
}

/** 一次解析轴对并汇总值域；共享轴的比例尺不受另一条轴的分组影响。 */
export function bindXYAxes(m: ChartModel, groups: PlotGroup[], region: Rect, cartGroups: PlotGroup[] = []) {
  const pairs = bindings(m, groups);
  const extent = (axis: Axis, fallback: Extent = { lo: 0, hi: 1 }): Extent => {
    const xs = pairs.filter(pair => pair.x === axis).map(pair => pair.group);
    const ys = [...cartGroups.filter(group => axis.id && group.axIds.includes(axis.id)),
      ...pairs.filter(pair => pair.y === axis).map(pair => pair.group)];
    const x = xs.length ? xExtent(xs) : null, y = ys.length ? valueExtent(ys) : null;
    return x && y ? { lo: Math.min(x.lo, y.lo), hi: Math.max(x.hi, y.hi) } : x ?? y ?? fallback;
  };
  const axes = (existing: AxisView[] = []): XYAxes[] => {
    const views = new Map<Axis, AxisView>(existing.map(view => [view.axis, view]));
    const view = (axis: Axis, horizontal: boolean, format: string | null): AxisView => {
      let result = views.get(axis);
      if (!result) {
        result = makeValueView(axis, horizontal ? axis.pos === 't' ? 't' : 'b' : axis.pos === 'r' ? 'r' : 'l',
          extent(axis), tickTarget(horizontal ? region.w : region.h, m.textSize), horizontal ? null : format, m);
        views.set(axis, result);
      }
      return result;
    };
    return pairs.map(({ group, x, y }) => ({ group,
      x: view(x, true, null), y: view(y, false, group.series.find(series => series.fmt)?.fmt ?? null) }));
    };

  return { axes, extent };
}

export function xyInsets(m: ChartModel, axes: XYAxes[], base: Insets): Insets {
  const insets = { ...base };
  for (const pair of axes) {
    const next = axisInsets(m, pair.x, pair.y, false);
    for (const side of ['l', 'r', 't', 'b'] as const) insets[side] = Math.max(insets[side], next[side]);
  }
  return insets;
}

/** 各轴对使用同一绘图区；背景只由外层绘制，否则后画的系列会擦掉已有图形。 */
export function paintXY(m: ChartModel, axes: XYAxes[], rect: Rect, fonts: string[], pe: PlotEnv, seen = new Set<Axis>()) {
  const out: SlideElement[] = [], plots: SlideElement[] = [];
  const once = (view: AxisView): AxisView => {
    if (seen.has(view.axis)) return { ...view, axis: { ...view.axis, del: true, title: null, majorGrid: null } };
    seen.add(view.axis); return view;
  };
  for (const { group, x, y } of axes) {
    const xy = makeXY(rect, x, y);
    out.push(...renderAxes(m, { rect, hAxis: once(x), vAxis: once(y),
      hPos: i => xy.x(x.ticks[i] ?? 0), vPos: i => xy.y(y.ticks[i] ?? 0),
      hEdge: null, hEdgeCount: 0, vEdge: null, vEdgeCount: 0,
      hLineAt: xy.y(xy.clampY(0)), vLineAt: xy.x(xy.clampX(0)), hWrap: false, hBand: 0, depth: null }, fonts));
    plots.push(...(group.kind === 'bubble'
      ? renderBubbles(group, xy, pe) : renderScatter(group, xy, pe)));
  }
  return { axes: out, plots };
}
