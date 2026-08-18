/**
 * DrawingML 图表（ppt/charts/chart*.xml）→ 统一 Schema 元素。
 *
 * 输出坐标系是 graphicFrame 的局部坐标（0,0 到 w,h），调用方负责把结果放进
 * GroupElement / 平移到幻灯片坐标。除 types.ts 的必填字段外不依赖任何可选字段。
 */
import type { ColorCtx } from '../pptx/color';
import type { ThemeFonts } from '../pptx/text';
import type { Fill, ShapeElement, SlideElement, Stroke, UnsupportedElement } from '../types';
import type { Axis, ChartModel, ManualLayout, PlotGroup, Series } from './model';
import { defaultAxis, isStacked, isXY, parseModel } from './model';
import type { AxisView, Cartesian, Grid, Side } from './frame';
import {
  axisInsets, depthOf, floor3D, lineH, makeCartesian, makeCatView, makeValueView, makeXY, needWrap,
  renderAxes, renderSideAxis, reserveDepth, shrink, tickTarget, valueExtent, xExtent,
} from './frame';
import {
  BarSlot, PlotEnv, markerEl, markerSymbol, pointFill, renderAreas, renderBars, renderBubbles,
  renderLines, renderOfPie, renderPie, renderPie3D, renderRadar, renderRadarGrid, renderScatter,
  renderStock, renderSurface,
} from './plots';
import type { RadarFrame, SurfaceFrame } from './plots';
import { Depth3D, Rect, formatNumber, lineEl, measure, mix, niceScale, px, rectEl, solid, strokeFrom, textEl } from './util';

export interface ChartEnv {
  ctx: ColorCtx;
  fonts: ThemeFonts;
  rels: Record<string, { type: string; target: string }>;
}

/**
 * @param chartRoot  chart*.xml 根元素 <c:chartSpace>
 * @param w,h        graphicFrame 宽高（px）
 * @returns 图表局部坐标系（0,0 到 w,h）内的元素
 */
export function parseChart(chartRoot: Element, w: number, h: number, env: ChartEnv): SlideElement[] {
  const W = Math.max(Number.isFinite(w) ? w : 0, 1);
  const H = Math.max(Number.isFinite(h) ? h : 0, 1);
  try {
    return build(chartRoot, W, H, env);
  } catch {
    return [placeholder(W, H, '图表渲染失败')];
  }
}

// ---------- 占位 ----------

function placeholder(w: number, h: number, label: string): UnsupportedElement {
  return { kind: 'unsupported', x: 0, y: 0, w, h, rot: 0, flipH: false, flipV: false, label };
}

// ---------- 图例 ----------

interface LegendItem {
  label: string;
  fill: Fill;
  color: string;
  stroke: Stroke | null;
  marker: { sym: string; s: Series } | null;
  line: boolean;
}

function legendItems(m: ChartModel, groups: PlotGroup[], cats: string[], ctx: ColorCtx): LegendItem[] {
  const items: LegendItem[] = [];
  const pieOnly = groups.length > 0
    && groups.every((g) => g.kind === 'pie' || g.kind === 'doughnut' || g.kind === 'ofPie');
  if (pieOnly) {
    const g = groups[0];
    const s = g.series[0];
    if (!s) return items;
    const n = Math.max(s.vals.length, cats.length);
    for (let i = 0; i < n; i++) {
      if (m.legendDeleted.has(i)) continue;
      const { fill, color } = pointFill(g, s, i, ctx);
      items.push({ label: cats[i] ?? String(i + 1), fill, color, stroke: null, marker: null, line: false });
    }
    return items;
  }
  let k = 0;
  for (const g of groups) {
    g.series.forEach((s, si) => {
      const idx = k++;
      if (m.legendDeleted.has(idx)) return;
      const line = g.kind === 'line' || g.kind === 'scatter';
      items.push({
        label: s.name,
        fill: line ? solid(s.color) : s.fill ?? solid(s.color),
        color: s.color,
        stroke: line ? strokeFrom(s.ln, s.color, px(2)) : null,
        marker: line ? { sym: markerSymbol(g, s, si), s } : null,
        line,
      });
    });
  }
  return items;
}

interface LegendResult {
  els: SlideElement[];
  region: Rect;
}

function layoutLegend(m: ChartModel, items: LegendItem[], region: Rect, fonts: string[]): LegendResult {
  const els: SlideElement[] = [];
  if (!m.legendPos || !items.length) return { els, region };
  const size = m.textSize;
  const swW = size * 1.2;
  const swH = size * 0.72;
  const rowH = size * 1.75;
  const gapIn = size * 0.35;
  const gapOut = size * 0.9;
  const widths = items.map((it) => swW + gapIn + measure(it.label, size) + gapOut);
  const pos = m.legendPos;
  const horizontal = pos === 't' || pos === 'b';

  let band: Rect;
  let rest = region;
  const draw = (it: LegendItem, x: number, y: number, labelW: number): void => {
    const cy = y + rowH / 2;
    if (it.line) {
      const ln = lineEl(x, cy, x + swW, cy, it.stroke ?? { color: it.color, width: px(2), dash: null });
      if (ln) els.push(ln);
      if (it.marker && it.marker.sym !== 'none') {
        const mk = markerEl(x + swW / 2, cy, it.marker.sym, it.marker.s, it.color);
        if (mk) els.push(mk);
      }
    } else {
      els.push(rectEl({ x, y: cy - swH / 2, w: swW, h: swH }, it.fill, null));
    }
    els.push(
      textEl(x + swW + gapIn, y, labelW, rowH, it.label, {
        size,
        color: m.textColor,
        align: 'left',
        anchor: 'middle',
        fonts,
      }),
    );
  };

  if (horizontal) {
    const maxW = region.w;
    const rows: number[][] = [];
    let cur: number[] = [];
    let curW = 0;
    for (let i = 0; i < items.length; i++) {
      const wI = Math.min(widths[i], maxW);
      if (cur.length && curW + wI > maxW) {
        rows.push(cur);
        cur = [];
        curW = 0;
      }
      cur.push(i);
      curW += wI;
    }
    if (cur.length) rows.push(cur);
    const maxRows = Math.max(1, Math.floor((region.h * 0.4) / rowH));
    const shown = rows.slice(0, maxRows);
    const bandH = shown.length * rowH;
    band =
      pos === 't'
        ? { x: region.x, y: region.y, w: region.w, h: bandH }
        : { x: region.x, y: region.y + region.h - bandH, w: region.w, h: bandH };
    if (!m.legendOverlay) {
      rest =
        pos === 't'
          ? { x: region.x, y: region.y + bandH, w: region.w, h: region.h - bandH }
          : { x: region.x, y: region.y, w: region.w, h: region.h - bandH };
    }
    shown.forEach((row, ri) => {
      const total = row.reduce((a, i) => a + Math.min(widths[i], maxW), 0);
      let x = band.x + Math.max((band.w - total) / 2, 0);
      const y = band.y + ri * rowH;
      for (const i of row) {
        const wI = Math.min(widths[i], maxW);
        draw(items[i], x, y, Math.max(wI - swW - gapIn - gapOut * 0.5, size));
        x += wI;
      }
    });
  } else {
    const rowsPerCol = Math.max(1, Math.floor(region.h / rowH));
    const cols = Math.max(1, Math.ceil(items.length / rowsPerCol));
    const widest = widths.reduce((a, b) => (b > a ? b : a), 0);
    const bandW = Math.min(widest * cols, region.w * 0.45);
    const colW = bandW / cols;
    const rowsShown = Math.min(rowsPerCol, Math.ceil(items.length / cols));
    const right = pos !== 'l';
    band = {
      x: right ? region.x + region.w - bandW : region.x,
      y: region.y,
      w: bandW,
      h: region.h,
    };
    if (!m.legendOverlay) {
      rest = right
        ? { x: region.x, y: region.y, w: region.w - bandW, h: region.h }
        : { x: region.x + bandW, y: region.y, w: region.w - bandW, h: region.h };
    }
    const stackH = rowsShown * rowH;
    const top = pos === 'tr' ? band.y : band.y + Math.max((band.h - stackH) / 2, 0);
    for (let i = 0; i < items.length && i < rowsShown * cols; i++) {
      const col = Math.floor(i / rowsShown);
      const row = i % rowsShown;
      draw(items[i], band.x + col * colW, top + row * rowH, Math.max(colW - swW - gapIn - size * 0.2, size));
    }
  }
  return { els, region: rest };
}

// ---------- 类目 ----------

function categories(groups: PlotGroup[]): string[] {
  let best: string[] = [];
  let n = 0;
  for (const g of groups) {
    for (const s of g.series) {
      if (s.vals.length > n) n = s.vals.length;
      if (s.cats.length > best.length) best = s.cats;
    }
  }
  const len = Math.max(n, best.length);
  const out: string[] = [];
  for (let i = 0; i < len; i++) out.push(best[i] || String(i + 1));
  return out;
}

function applyLayout(base: Rect, ml: ManualLayout | null, W: number, H: number): Rect {
  if (!ml) return base;
  const x = ml.x !== null ? ml.x * W : base.x;
  const y = ml.y !== null ? ml.y * H : base.y;
  const w = ml.w !== null ? ml.w * W : base.w;
  const h = ml.h !== null ? ml.h * H : base.h;
  if (!(w > 4) || !(h > 4) || !Number.isFinite(x) || !Number.isFinite(y)) return base;
  return { x, y, w, h };
}

const firstFmt = (groups: PlotGroup[]): string | null => {
  for (const g of groups) for (const s of g.series) if (s.fmt) return s.fmt;
  return null;
};

// ---------- 主流程 ----------

function build(root: Element, W: number, H: number, env: ChartEnv): SlideElement[] {
  const m = parseModel(root, env.ctx);
  const fonts = [env.fonts.minor.latin, env.fonts.minor.ea].filter((f): f is string => !!f);
  const out: SlideElement[] = [];

  // 画布背景（chartSpace 未写 spPr 时按 OOXML 默认取白底）
  const bgFill: Fill = m.fill ?? solid('rgb(255,255,255)');
  const bgStroke = strokeFrom(m.ln, null, 0);
  if (bgFill.type !== 'none' || bgStroke) {
    out.push(rectEl({ x: 0, y: 0, w: W, h: H }, bgFill.type === 'none' ? null : bgFill, bgStroke));
  }

  const groups = m.groups.filter((g) => g.series.length > 0);
  const cartGroups = groups.filter(
    (g) => g.kind === 'bar' || g.kind === 'line' || g.kind === 'area' || g.kind === 'stock',
  );
  const xyGroups = groups.filter((g) => isXY(g.kind));
  const pieGroups = groups.filter((g) => g.kind === 'pie' || g.kind === 'doughnut');
  const ofPieGroups = groups.filter((g) => g.kind === 'ofPie');
  const radarGroups = groups.filter((g) => g.kind === 'radar');
  const surfaceGroups = groups.filter((g) => g.kind === 'surface');
  const badTags = m.unsupported.slice();

  if (!cartGroups.length && !xyGroups.length && !pieGroups.length && !radarGroups.length
    && !ofPieGroups.length && !surfaceGroups.length) {
    const what = badTags.length ? Array.from(new Set(badTags)).join('/') : '未知类型';
    return out.concat([placeholder(W, H, `不支持的图表类型: ${what}`)]);
  }

  const pad = Math.min(m.textSize * 0.55, Math.min(W, H) * 0.06);
  let region: Rect = { x: pad, y: pad, w: Math.max(W - pad * 2, 8), h: Math.max(H - pad * 2, 8) };

  // 标题
  if (m.title) {
    const ts = m.titleSize;
    const th = Math.min(lineH(ts) + m.textSize * 0.5, region.h * 0.3);
    out.push(
      textEl(region.x, region.y, region.w, th, m.title, {
        size: ts,
        bold: m.titleBold,
        color: m.titleColor ?? m.textColor,
        align: 'center',
        anchor: 'middle',
        fonts,
      }),
    );
    region = { x: region.x, y: region.y + th, w: region.w, h: Math.max(region.h - th, 8) };
  }

  // 图例
  const active = cartGroups.length ? cartGroups
    : xyGroups.length ? xyGroups
    : radarGroups.length ? radarGroups
    : surfaceGroups.length ? surfaceGroups
    : ofPieGroups.length ? ofPieGroups
    : pieGroups;
  const cats = categories(active);
  // 曲面图的图例是色带，由绘图本体自带，这里不再列系列
  const items = surfaceGroups.length && surfaceGroups.length === groups.length
    ? []
    : legendItems(m, active, cats, env.ctx);
  const legend = layoutLegend(m, items, region, fonts);
  region = legend.region;
  if (m.plotLayout && m.plotLayout.target !== 'inner') region = applyLayout(region, m.plotLayout, W, H);

  const pe: PlotEnv = { ctx: env.ctx, fonts, size: m.textSize, color: m.textColor, cats };
  const body: SlideElement[] = [];

  if (cartGroups.length) body.push(...cartesian(m, cartGroups, cats, region, W, H, fonts, pe));
  else if (xyGroups.length) body.push(...scatter(m, xyGroups, region, W, H, fonts, pe));
  else if (radarGroups.length) body.push(...radar(m, radarGroups, region, W, H, pe));
  else if (surfaceGroups.length) body.push(...surface(m, surfaceGroups, region, W, H, pe));
  else if (ofPieGroups.length) body.push(...compoundPie(m, ofPieGroups, region, W, H, pe));
  else body.push(...pie(m, pieGroups, region, W, H, pe));

  out.push(...body, ...legend.els);
  if (badTags.length) {
    const tag = Array.from(new Set(badTags)).join('/');
    const size = m.textSize * 0.9;
    out.push(
      textEl(region.x, region.y + region.h - lineH(size), region.w, lineH(size), `未渲染: ${tag}`, {
        size,
        color: m.textColor,
        align: 'right',
        anchor: 'middle',
        fonts,
      }),
    );
  }
  return out;
}

// ---------- 轴绑定 ----------

/** 一组「图表组 → 轴对」的绑定；一个 plotArea 里最多解析出主轴对 + 次轴对 */
interface Bind {
  cat: Axis;
  val: Axis;
  groups: PlotGroup[];
}

/** 次值轴的判定：crosses=max，或轴位置落在主轴的对侧 */
function looksSecondary(val: Axis, horizontal: boolean): boolean {
  if (val.crosses === 'max') return true;
  return horizontal ? val.pos === 't' : val.pos === 'r';
}

/**
 * 按 c:axId 把 plotArea 下的各图表组挂到自己的轴对上。
 * 同一个 valAx id 的组共用一套比例尺；出现两套时后者作为次轴（第三套及以后并入次轴）。
 */
function bindAxes(m: ChartModel, groups: PlotGroup[], horizontal: boolean): { primary: Bind; secondary: Bind | null } {
  const byId = new Map<string, Axis>();
  for (const a of m.axes) if (a.id) byId.set(a.id, a);
  const fbCat = m.axes.find((a) => a.kind === 'cat' || a.kind === 'date') ?? defaultAxis('cat');
  const fbVal = m.axes.find((a) => a.kind === 'val') ?? defaultAxis('val');

  const order: string[] = [];
  const buckets = new Map<string, Bind>();
  for (const g of groups) {
    let cat: Axis | null = null;
    let val: Axis | null = null;
    for (const id of g.axIds) {
      const a = byId.get(id);
      if (!a) continue;
      if (a.kind === 'val') {
        if (!val) val = a;
      } else if (a.kind === 'cat' || a.kind === 'date') {
        if (!cat) cat = a;
      }
      // serAx（3D 的深度轴）忽略
    }
    const key = val ? val.id || 'v#' : 'v#';
    let b = buckets.get(key);
    if (!b) {
      b = { cat: cat ?? fbCat, val: val ?? fbVal, groups: [] };
      buckets.set(key, b);
      order.push(key);
    }
    b.groups.push(g);
  }
  if (!order.length) return { primary: { cat: fbCat, val: fbVal, groups }, secondary: null };
  if (order.length === 1) return { primary: buckets.get(order[0]) as Bind, secondary: null };

  // 主轴 = 第一个未被标记为次轴的轴对
  let pi = order.findIndex((k) => !looksSecondary((buckets.get(k) as Bind).val, horizontal));
  if (pi < 0) pi = 0;
  const primary = buckets.get(order[pi]) as Bind;
  const rest = order.filter((_, i) => i !== pi).map((k) => buckets.get(k) as Bind);
  const secondary: Bind = { cat: rest[0].cat, val: rest[0].val, groups: rest.flatMap((b) => b.groups) };
  return { primary, secondary };
}

// ---------- 类目 × 数值 ----------

function cartesian(
  m: ChartModel,
  groups: PlotGroup[],
  cats: string[],
  region: Rect,
  W: number,
  H: number,
  fonts: string[],
  pe: PlotEnv,
): SlideElement[] {
  const horizontal = groups.some((g) => g.kind === 'bar' && g.barDir === 'bar');
  const { primary, secondary } = bindAxes(m, groups, horizontal);
  const catAxis = primary.cat;
  const catSide: Side = horizontal ? (catAxis.pos === 'r' ? 'r' : 'l') : catAxis.pos === 't' ? 't' : 'b';
  const valSide: Side = horizontal ? (primary.val.pos === 't' ? 't' : 'b') : primary.val.pos === 'r' ? 'r' : 'l';
  const secSide: Side = horizontal ? (valSide === 'b' ? 't' : 'b') : valSide === 'l' ? 'r' : 'l';

  const valLen = horizontal ? region.w : region.h;
  const target = tickTarget(valLen, m.textSize);
  const viewOf = (b: Bind, side: Side): AxisView => {
    const fmt = b.groups.some((g) => g.grouping === 'percentStacked') ? '0%' : firstFmt(b.groups);
    return makeValueView(b.val, side, valueExtent(b.groups), target, fmt, m);
  };
  const valView = viewOf(primary, valSide);
  const secView = secondary ? viewOf(secondary, secSide) : null;

  const hasBar = groups.some((g) => g.kind === 'bar');
  const allArea = groups.every((g) => g.kind === 'area');
  const between = hasBar ? true : allArea ? false : catAxis.crossBetween !== 'midCat';
  const catView = makeCatView(catAxis, catSide, cats, between, m);

  const hAxis = horizontal ? valView : catView;
  const vAxis = horizontal ? catView : valView;
  let rect = shrink(region, axisInsets(m, hAxis, vAxis, false, secView));
  let hWrap = false;
  if (!horizontal && cats.length) {
    const bandEst = between ? rect.w / Math.max(cats.length, 1) : rect.w / Math.max(cats.length - 1, 1);
    hWrap = needWrap(catView, bandEst);
    if (hWrap) rect = shrink(region, axisInsets(m, hAxis, vAxis, true, secView));
  }
  if (m.plotLayout && m.plotLayout.target === 'inner') rect = applyLayout(rect, m.plotLayout, W, H);

  // 伪 3D：绘图区退到「正面平面」，为深度方向让出空间
  const is3D = groups.some((g) => g.is3D);
  let depth: Depth3D | null = null;
  if (is3D) {
    depth = depthOf(m.view3D, rect);
    rect = reserveDepth(rect, depth);
  }

  const c = makeCartesian(rect, horizontal, catView, valView);
  const c2 = secView ? makeCartesian(rect, horizontal, catView, secView) : null;
  const edgeCount = between ? cats.length + 1 : cats.length;
  const grid: Grid = horizontal
    ? {
        rect,
        hAxis: valView,
        vAxis: catView,
        hPos: (i) => c.val(valView.ticks[i] ?? 0),
        vPos: (i) => c.cat(i),
        hEdge: null,
        hEdgeCount: 0,
        vEdge: (i) => c.edge(i),
        vEdgeCount: edgeCount,
        hLineAt: valSide === 't' ? rect.y : rect.y + rect.h,
        vLineAt: c.zero,
        hWrap: false,
        hBand: 0,
        depth,
      }
    : {
        rect,
        hAxis: catView,
        vAxis: valView,
        hPos: (i) => c.cat(i),
        vPos: (i) => c.val(valView.ticks[i] ?? 0),
        hEdge: (i) => c.edge(i),
        hEdgeCount: edgeCount,
        vEdge: null,
        vEdgeCount: 0,
        hLineAt: c.zero,
        vLineAt: valSide === 'r' ? rect.x + rect.w : rect.x,
        hWrap,
        hBand: c.band,
        depth,
      };

  const out: SlideElement[] = [];
  out.push(...plotBg(m, rect));
  if (depth) out.push(...floor3D(rect, depth, m.textColor));
  out.push(...renderAxes(m, grid, fonts));

  // 次值轴：画在主值轴的对侧；网格线默认只画主轴的
  if (secView && c2) {
    const vertical = secSide === 'l' || secSide === 'r';
    out.push(
      ...renderSideAxis(
        m,
        {
          rect,
          view: secView,
          pos: (i) => c2.val(secView.ticks[i] ?? 0),
          at: vertical
            ? secSide === 'r'
              ? rect.x + rect.w
              : rect.x
            : secSide === 't'
              ? rect.y
              : rect.y + rect.h,
          grid: !valView.axis.majorGrid && !!secView.axis.majorGrid,
          depth,
        },
        fonts,
      ),
    );
  }

  // 同轴的柱子共享一个簇：非堆叠每个系列一个槽位，堆叠整组一个槽位
  const slotsFor = (bg: PlotGroup[]): ((g: PlotGroup) => BarSlot) => {
    const base = new Map<PlotGroup, number>();
    let total = 0;
    for (const g of bg) {
      base.set(g, total);
      total += isStacked(g) ? 1 : g.series.length;
    }
    return (g) => ({ base: base.get(g) ?? 0, total: Math.max(total, 1) });
  };

  const paint = (b: Bind, cc: Cartesian): void => {
    const bars = b.groups.filter((g) => g.kind === 'bar');
    const slot = slotsFor(bars);
    for (const g of b.groups) if (g.kind === 'area') out.push(...renderAreas(g, cc, pe));
    for (const g of bars) out.push(...renderBars(g, cc, slot(g), pe, g.is3D ? depth : null));
    for (const g of b.groups) if (g.kind === 'line') out.push(...renderLines(g, cc, pe));
    for (const g of b.groups) if (g.kind === 'stock') out.push(...renderStock(g, cc, pe));
  };
  paint(primary, c);
  if (secondary && c2) paint(secondary, c2);
  return out;
}

// ---------- 数值 × 数值 ----------

function scatter(
  m: ChartModel,
  groups: PlotGroup[],
  region: Rect,
  W: number,
  H: number,
  fonts: string[],
  pe: PlotEnv,
): SlideElement[] {
  const axes = m.axes.filter((a) => a.kind !== 'ser');
  const xAxis = axes.find((a) => a.pos === 'b' || a.pos === 't') ?? axes[0] ?? defaultAxis('val');
  const yAxis = axes.find((a) => a !== xAxis) ?? defaultAxis('val');
  const xSide: Side = xAxis.pos === 't' ? 't' : 'b';
  const ySide: Side = yAxis.pos === 'r' ? 'r' : 'l';

  const xView = makeValueView(xAxis, xSide, xExtent(groups), tickTarget(region.w, m.textSize), null, m);
  const yView = makeValueView(yAxis, ySide, valueExtent(groups), tickTarget(region.h, m.textSize), firstFmt(groups), m);

  let rect = shrink(region, axisInsets(m, xView, yView, false));
  if (m.plotLayout && m.plotLayout.target === 'inner') rect = applyLayout(rect, m.plotLayout, W, H);
  const xy = makeXY(rect, xView, yView);

  const grid: Grid = {
    rect,
    hAxis: xView,
    vAxis: yView,
    hPos: (i) => xy.x(xView.ticks[i] ?? 0),
    vPos: (i) => xy.y(yView.ticks[i] ?? 0),
    hEdge: null,
    hEdgeCount: 0,
    vEdge: null,
    vEdgeCount: 0,
    hLineAt: xy.y(xy.clampY(0)),
    vLineAt: xy.x(xy.clampX(0)),
    hWrap: false,
    hBand: 0,
    depth: null,
  };

  const out: SlideElement[] = [];
  out.push(...plotBg(m, rect));
  out.push(...renderAxes(m, grid, fonts));
  for (const g of groups) {
    out.push(...(g.kind === 'bubble' ? renderBubbles(g, xy, pe) : renderScatter(g, xy, pe)));
  }
  return out;
}

// ---------- 曲面 / 复合饼 ----------

/** 曲面图退化为俯视等高线网格：色带级数复用数值轴的 nice-number 分级 */
function surface(m: ChartModel, groups: PlotGroup[], region: Rect, W: number, H: number, pe: PlotEnv): SlideElement[] {
  let rect = region;
  if (m.plotLayout) rect = applyLayout(rect, m.plotLayout, W, H);
  const ext = valueExtent(groups);
  const scale = niceScale(ext.lo, ext.hi, tickTarget(rect.h, m.textSize));
  const bands = Math.max(2, Math.min(Math.round((scale.max - scale.min) / scale.step), 12));
  const valAx = m.axes.find((a) => a.kind === 'val');
  const frame: SurfaceFrame = {
    rect,
    min: scale.min,
    max: scale.max,
    bands,
    fmt: valAx?.fmt ?? firstFmt(groups),
  };
  const out: SlideElement[] = plotBg(m, rect);
  for (const g of groups) out.push(...renderSurface(g, frame, pe));
  return out;
}

/** 复合饼图（子母饼 / 复合条饼） */
function compoundPie(m: ChartModel, groups: PlotGroup[], region: Rect, W: number, H: number, pe: PlotEnv): SlideElement[] {
  let rect = region;
  if (m.plotLayout) rect = applyLayout(rect, m.plotLayout, W, H);
  const out: SlideElement[] = plotBg(m, rect);
  for (const g of groups) out.push(...renderOfPie(g, rect, pe));
  return out;
}

// ---------- 饼 / 环 ----------

/**
 * 雷达图布局：正方形绘图区取内切圆，半径留出类目标签的空间。
 * 值域与分级复用直角坐标那套 nice-number，保证刻度读数一致。
 */
function radar(m: ChartModel, groups: PlotGroup[], region: Rect, W: number, H: number, pe: PlotEnv): SlideElement[] {
  let rect = region;
  if (m.plotLayout) rect = applyLayout(rect, m.plotLayout, W, H);

  const cats = categories(groups);
  const count = Math.max(cats.length, groups[0]?.series[0]?.vals.length ?? 0);
  if (count < 3) return [placeholder(W, H, '雷达图至少需要 3 个类目')];

  const ext = valueExtent(groups);
  const scale = niceScale(Math.min(ext.lo, 0), ext.hi, tickTarget(Math.min(rect.w, rect.h), m.textSize));
  const span = scale.max - scale.min || 1;

  // 外圈还要放类目标签，半径按标签宽度收一收
  const labelPad = m.textSize * 4;
  const side = Math.max(Math.min(rect.w, rect.h) - labelPad, 24);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;

  const frame: RadarFrame = {
    cx, cy,
    radius: side / 2,
    norm: (v) => clampUnit((v - scale.min) / span),
    angle: (i) => (i * Math.PI * 2) / count,
    count,
  };

  const ticks: number[] = [];
  for (let v = scale.min; v <= scale.max + scale.step * 0.5; v += scale.step) ticks.push(round12(v));

  const valAx = m.axes.find((a) => a.kind === 'val');
  const catAx = m.axes.find((a) => a.kind === 'cat');
  const gridColor = mix(m.textColor, 'rgb(255,255,255)', 0.72);
  const axisColor = mix(m.textColor, 'rgb(255,255,255)', 0.55);
  const gridStroke = strokeFrom(valAx?.majorGrid ?? null, gridColor, 1) ?? { color: gridColor, width: 1, dash: null };
  const axisStroke = strokeFrom(catAx?.line ?? null, axisColor, 1) ?? { color: axisColor, width: 1, dash: null };
  const fmt = valAx?.fmt ?? null;

  const out = renderRadarGrid(frame, ticks, pe, gridStroke, axisStroke, (v) => formatNumber(v, fmt));
  for (const g of groups) out.push(...renderRadar(g, frame, pe));
  return out;
}

const clampUnit = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const round12 = (v: number): number => Number(v.toPrecision(12));

function pie(m: ChartModel, groups: PlotGroup[], region: Rect, W: number, H: number, pe: PlotEnv): SlideElement[] {
  let rect = region;
  if (m.plotLayout) rect = applyLayout(rect, m.plotLayout, W, H);
  const side = Math.max(Math.min(rect.w, rect.h), 8);
  const box: Rect = {
    x: rect.x + (rect.w - side) / 2,
    y: rect.y + (rect.h - side) / 2,
    w: side,
    h: side,
  };
  const out: SlideElement[] = [];
  out.push(...plotBg(m, rect));
  // 3D 饼用整个绘图区（椭圆更宽），2D 用居中正方形
  for (const g of groups) out.push(...(g.is3D ? renderPie3D(g, rect, pe) : renderPie(g, box, pe)));
  return out;
}

function plotBg(m: ChartModel, rect: Rect): ShapeElement[] {
  const stroke = strokeFrom(m.plotLn, null, 0);
  const fill = m.plotFill && m.plotFill.type !== 'none' ? m.plotFill : null;
  if (!fill && !stroke) return [];
  return [rectEl(rect, fill, stroke)];
}
