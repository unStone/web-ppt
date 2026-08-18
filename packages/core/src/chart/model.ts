/**
 * chart*.xml（c:chartSpace）→ 中间模型。只做数据/样式提取，不涉及布局与几何。
 */
import { ColorCtx, childColor } from '../pptx/color';
import type { Fill } from '../types';
import { attr, boolAttr, kid, kids, numAttr, walk } from '../xml';
import { EMPTY_LN, LnSpec, accentColor, formatNumber, parseFill, parseLn, px, themeColor } from './util';

export type PlotKind =
  | 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter' | 'radar'
  | 'bubble' | 'stock' | 'ofPie' | 'surface' | 'other';

const GROUP_TAGS: Record<string, PlotKind> = {
  barChart: 'bar', bar3DChart: 'bar',
  lineChart: 'line', line3DChart: 'line',
  stockChart: 'stock',
  pieChart: 'pie', pie3DChart: 'pie',
  ofPieChart: 'ofPie',
  doughnutChart: 'doughnut',
  areaChart: 'area', area3DChart: 'area',
  scatterChart: 'scatter', bubbleChart: 'bubble',
  radarChart: 'radar',
  surfaceChart: 'surface', surface3DChart: 'surface',
};

/** 值 × 值 坐标系（xVal/yVal）的图种 */
export const isXY = (kind: PlotKind): boolean => kind === 'scatter' || kind === 'bubble';

export const CHART_TAGS = Object.keys(GROUP_TAGS);

// ---------- 小工具 ----------

const boolChild = (parent: Element | null, name: string, dflt: boolean): boolean => {
  const el = kid(parent, name);
  return el ? boolAttr(el, 'val', true) : dflt;
};

const numChild = (parent: Element | null, name: string): number | null => numAttr(kid(parent, name), 'val');

const strChild = (parent: Element | null, name: string): string | null => attr(kid(parent, name), 'val');

/** 取 c:val / c:cat / c:xVal 等的数据容器（cache 或 lit） */
function dataNode(el: Element | null): Element | null {
  if (!el) return null;
  for (const name of ['numRef', 'strRef', 'multiLvlStrRef']) {
    const ref = kid(el, name);
    if (ref) return kid(ref, 'numCache') ?? kid(ref, 'strCache') ?? kid(ref, 'multiLvlStrCache');
  }
  return kid(el, 'numLit') ?? kid(el, 'strLit') ?? null;
}

function ptMap(container: Element, count: number): string[] {
  const out: string[] = new Array(Math.max(0, Math.min(count, 20000))).fill('');
  for (const p of kids(container, 'pt')) {
    const i = numAttr(p, 'idx') ?? -1;
    if (i < 0 || i > 20000) continue;
    while (out.length <= i) out.push('');
    out[i] = kid(p, 'v')?.textContent ?? '';
  }
  return out;
}

export function readNums(el: Element | null): { vals: (number | null)[]; fmt: string | null } {
  const c = dataNode(el);
  if (!c) return { vals: [], fmt: null };
  const fmt = kid(c, 'formatCode')?.textContent ?? null;
  const raw = ptMap(c, numAttr(kid(c, 'ptCount'), 'val') ?? 0);
  const vals = raw.map((s) => {
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  });
  return { vals, fmt };
}

export function readCats(el: Element | null): string[] {
  const c = dataNode(el);
  if (!c) return [];
  if (c.localName === 'numCache' || c.localName === 'numLit') {
    const { vals, fmt } = readNums(el);
    return vals.map((v) => (v === null ? '' : formatNumber(v, fmt)));
  }
  const lvls = kids(c, 'lvl');
  const src = lvls.length ? lvls[0] : c;
  return ptMap(src, numAttr(kid(c, 'ptCount'), 'val') ?? 0);
}

export function richText(holder: Element | null): string {
  const rich = kid(holder, 'rich');
  if (rich) {
    const paras = kids(rich, 'p').map((p) => {
      let s = '';
      for (let n = p.firstElementChild; n; n = n.nextElementSibling) {
        if (n.localName === 'r' || n.localName === 'fld') s += kid(n, 't')?.textContent ?? '';
        else if (n.localName === 'br') s += ' ';
      }
      return s;
    });
    return paras.join(' ').trim();
  }
  const strRef = kid(holder, 'strRef');
  if (strRef) {
    const cache = kid(strRef, 'strCache');
    const first = kids(cache, 'pt')[0];
    return (kid(first, 'v')?.textContent ?? '').trim();
  }
  const v = kid(holder, 'v');
  return (v?.textContent ?? '').trim();
}

/** 从 c:txPr / c:rich 里取默认字号与颜色 */
function textStyle(holder: Element | null, ctx: ColorCtx): { size: number | null; color: string | null; bold: boolean } {
  const rPr = walk(holder, 'p', 'pPr', 'defRPr') ?? walk(holder, 'rich', 'p', 'pPr', 'defRPr');
  const r0 = walk(holder, 'rich', 'p', 'r', 'rPr');
  const src = rPr ?? r0;
  if (!src) return { size: null, color: null, bold: false };
  const sz = numAttr(src, 'sz');
  return {
    size: sz !== null ? px(sz / 100) : null,
    color: childColor(kid(src, 'solidFill'), ctx),
    bold: boolAttr(src, 'b', false),
  };
}

// ---------- 数据标签 ----------

export interface DLblSpec {
  del: boolean;
  showVal: boolean;
  showCat: boolean;
  showSer: boolean;
  showPercent: boolean;
  /** c:showBubbleSize，气泡图专用 */
  showSize: boolean;
  fmt: string | null;
  pos: string | null;
  size: number | null;
  color: string | null;
}

const NO_LBL: DLblSpec = {
  del: true, showVal: false, showCat: false, showSer: false, showPercent: false, showSize: false,
  fmt: null, pos: null, size: null, color: null,
};

function parseDLbls(el: Element | null, ctx: ColorCtx, parent: DLblSpec): DLblSpec {
  if (!el) return parent;
  const del = boolChild(el, 'delete', false);
  const ts = textStyle(kid(el, 'txPr'), ctx);
  const spec: DLblSpec = {
    del,
    showVal: boolChild(el, 'showVal', parent.showVal),
    showCat: boolChild(el, 'showCatName', parent.showCat),
    showSer: boolChild(el, 'showSerName', parent.showSer),
    showPercent: boolChild(el, 'showPercent', parent.showPercent),
    showSize: boolChild(el, 'showBubbleSize', parent.showSize),
    fmt: attr(kid(el, 'numFmt'), 'formatCode') ?? parent.fmt,
    pos: strChild(el, 'dLblPos') ?? parent.pos,
    size: ts.size ?? parent.size,
    color: ts.color ?? parent.color,
  };
  if (del) return { ...NO_LBL, fmt: spec.fmt };
  return spec;
}

export const labelVisible = (l: DLblSpec): boolean =>
  !l.del && (l.showVal || l.showCat || l.showSer || l.showPercent || l.showSize);

// ---------- 系列 ----------

export interface MarkerSpec {
  symbol: string;
  size: number;
  fill: Fill | null;
  ln: LnSpec;
}

export interface Series {
  idx: number;
  order: number;
  name: string;
  cats: string[];
  vals: (number | null)[];
  xs: (number | null)[] | null;
  /** 气泡大小（c:bubbleSize），仅气泡图有 */
  sizes: (number | null)[] | null;
  /** 气泡大小自己的数字格式，与 y 值的格式不同 */
  sizeFmt: string | null;
  fill: Fill | null;
  ln: LnSpec;
  marker: MarkerSpec | null;
  smooth: boolean;
  fmt: string | null;
  dLbls: DLblSpec;
  dPts: Map<number, { fill: Fill | null; ln: LnSpec; explosion: number }>;
  /** 解析后的主色（图例 / 自动着色用） */
  color: string;
}

function parseMarker(el: Element | null, ctx: ColorCtx): MarkerSpec | null {
  if (!el) return null;
  const spPr = kid(el, 'spPr');
  return {
    symbol: strChild(el, 'symbol') ?? 'auto',
    size: numChild(el, 'size') ?? 5,
    fill: parseFill(spPr, ctx),
    ln: parseLn(kid(spPr, 'ln'), ctx),
  };
}

function parseSer(ser: Element, kind: PlotKind, ctx: ColorCtx, autoIdx: number, groupLbls: DLblSpec): Series {
  const spPr = kid(ser, 'spPr');
  const fill = parseFill(spPr, ctx);
  const ln = parseLn(kid(spPr, 'ln'), ctx);
  const xy = isXY(kind);
  const valNode = kid(ser, 'val') ?? kid(ser, 'yVal') ?? kid(ser, 'bubbleSize');
  const { vals, fmt } = readNums(valNode);
  const xNode = kid(ser, 'xVal');
  const xs = xy && xNode ? readNums(xNode).vals : null;
  const sizeNode = kind === 'bubble' ? kid(ser, 'bubbleSize') : null;
  const sizeData = sizeNode ? readNums(sizeNode) : null;
  const cats = readCats(kid(ser, 'cat') ?? (xy ? xNode : null));

  const dPts = new Map<number, { fill: Fill | null; ln: LnSpec; explosion: number }>();
  for (const dPt of kids(ser, 'dPt')) {
    const i = numChild(dPt, 'idx');
    if (i === null || i < 0) continue;
    const p = kid(dPt, 'spPr');
    dPts.set(i, { fill: parseFill(p, ctx), ln: parseLn(kid(p, 'ln'), ctx), explosion: numChild(dPt, 'explosion') ?? 0 });
  }

  const lineLike = kind === 'line' || kind === 'scatter' || kind === 'radar' || kind === 'stock';
  let color: string;
  if (fill && fill.type === 'solid') color = fill.color;
  else if (lineLike && ln.color) color = ln.color;
  else color = accentColor(ctx, autoIdx);

  return {
    idx: numChild(ser, 'idx') ?? autoIdx,
    order: numChild(ser, 'order') ?? autoIdx,
    name: richText(kid(ser, 'tx')) || `系列 ${autoIdx + 1}`,
    cats,
    vals,
    xs,
    sizes: sizeData ? sizeData.vals : null,
    sizeFmt: sizeData ? sizeData.fmt : null,
    fill,
    ln,
    marker: parseMarker(kid(ser, 'marker'), ctx),
    smooth: boolChild(ser, 'smooth', false),
    fmt,
    dLbls: parseDLbls(kid(ser, 'dLbls'), ctx, groupLbls),
    dPts,
    color,
  };
}

// ---------- 图组 ----------

/** 股价图的涨跌柱样式（c:upDownBars） */
export interface UpDownBars {
  gapWidth: number;
  upFill: Fill | null;
  downFill: Fill | null;
  upLn: LnSpec;
  downLn: LnSpec;
}

/** 复合饼图的次绘图区配置 */
export interface OfPieSpec {
  /** 次图形态：饼 或 堆叠条 */
  type: 'pie' | 'bar';
  /** 拆分依据：pos / val / percent / custom / auto */
  splitType: string;
  splitPos: number | null;
  /** splitType=custom 时进入次图的点下标 */
  custSplit: number[];
  /** 次图相对主饼的大小（%） */
  secondSize: number;
  /** 是否画主次之间的连接线 */
  serLines: boolean;
}

export interface PlotGroup {
  kind: PlotKind;
  tag: string;
  /** 来自 *3DChart 标签，走等轴测伪 3D 渲染 */
  is3D: boolean;
  grouping: string;
  barDir: 'bar' | 'col';
  gapWidth: number;
  overlap: number;
  holeSize: number;
  firstSliceAng: number;
  varyColors: boolean;
  showMarker: boolean;
  radarStyle: string;
  scatterStyle: string;
  axIds: string[];
  series: Series[];
  dLbls: DLblSpec;
  /** 气泡：c:bubbleScale（%）与 c:sizeRepresents（area / w） */
  bubbleScale: number;
  bubbleSizeBy: string;
  /** 股价图的涨跌柱；无则画 OHLC 竖线 */
  upDown: UpDownBars | null;
  /** 股价 / 折线的高低点连线 */
  hiLowLines: LnSpec | null;
  /** 复合饼图配置 */
  ofPie: OfPieSpec | null;
  /** 曲面图：线框模式只画网格线 */
  wireframe: boolean;
  /** 曲面图的色带填充（c:bandFmts），按下标取 */
  bandFills: Map<number, Fill>;
}

export const isStacked = (g: PlotGroup): boolean =>
  g.grouping === 'stacked' || g.grouping === 'percentStacked';

function parseUpDown(el: Element | null, ctx: ColorCtx): UpDownBars | null {
  if (!el) return null;
  const up = kid(el, 'upBars');
  const down = kid(el, 'downBars');
  return {
    gapWidth: numChild(el, 'gapWidth') ?? 150,
    upFill: parseFill(kid(up, 'spPr'), ctx),
    downFill: parseFill(kid(down, 'spPr'), ctx),
    upLn: parseLn(walk(up, 'spPr', 'ln'), ctx),
    downLn: parseLn(walk(down, 'spPr', 'ln'), ctx),
  };
}

function parseOfPie(el: Element): OfPieSpec {
  return {
    type: (strChild(el, 'ofPieType') ?? 'pie') === 'bar' ? 'bar' : 'pie',
    splitType: strChild(el, 'splitType') ?? 'auto',
    splitPos: numChild(el, 'splitPos'),
    custSplit: kids(kid(el, 'custSplit'), 'secondPiePt')
      .map((p) => numAttr(p, 'val') ?? -1)
      .filter((i) => i >= 0),
    secondSize: numChild(el, 'secondPieSize') ?? 75,
    serLines: kid(el, 'serLines') !== null,
  };
}

function parseGroup(el: Element, kind: PlotKind, ctx: ColorCtx, autoStart: number): PlotGroup {
  const grouping = strChild(el, 'grouping') ?? (kind === 'bar' ? 'clustered' : 'standard');
  const dLbls = parseDLbls(kid(el, 'dLbls'), ctx, NO_LBL);
  const serEls = kids(el, 'ser');
  const series = serEls.map((s, i) => parseSer(s, kind, ctx, autoStart + i, dLbls));
  series.sort((a, b) => a.order - b.order);
  const bandFills = new Map<number, Fill>();
  for (const bf of kids(kid(el, 'bandFmts'), 'bandFmt')) {
    const i = numChild(bf, 'idx');
    const f = parseFill(kid(bf, 'spPr'), ctx);
    if (i !== null && i >= 0 && f) bandFills.set(i, f);
  }
  return {
    kind,
    tag: el.localName,
    is3D: el.localName.endsWith('3DChart'),
    grouping,
    barDir: (strChild(el, 'barDir') ?? 'col') === 'bar' ? 'bar' : 'col',
    gapWidth: numChild(el, 'gapWidth') ?? 150,
    overlap: numChild(el, 'overlap') ?? (grouping === 'stacked' || grouping === 'percentStacked' ? 100 : 0),
    holeSize: numChild(el, 'holeSize') ?? 50,
    firstSliceAng: numChild(el, 'firstSliceAng') ?? 0,
    varyColors: boolChild(el, 'varyColors', kind === 'pie' || kind === 'doughnut' || kind === 'ofPie'),
    showMarker: boolChild(el, 'marker', false),
    radarStyle: strChild(el, 'radarStyle') ?? 'marker',
    scatterStyle: strChild(el, 'scatterStyle') ?? 'lineMarker',
    axIds: kids(el, 'axId').map((a) => attr(a, 'val') ?? ''),
    series,
    dLbls,
    bubbleScale: numChild(el, 'bubbleScale') ?? 100,
    bubbleSizeBy: strChild(el, 'sizeRepresents') ?? 'area',
    upDown: parseUpDown(kid(el, 'upDownBars'), ctx),
    hiLowLines: kid(el, 'hiLowLines') ? parseLn(walk(kid(el, 'hiLowLines'), 'spPr', 'ln'), ctx) : null,
    ofPie: kind === 'ofPie' ? parseOfPie(el) : null,
    wireframe: boolChild(el, 'wireframe', false),
    bandFills,
  };
}

// ---------- 坐标轴 ----------

export interface Axis {
  id: string;
  kind: 'cat' | 'val' | 'date' | 'ser';
  del: boolean;
  pos: string | null;
  /** c:crosses（autoZero / max / min）；次值轴通常为 max */
  crosses: string | null;
  /** c:crossAx，配对轴的 axId */
  crossAx: string;
  crossBetween: string;
  min: number | null;
  max: number | null;
  majorUnit: number | null;
  reversed: boolean;
  fmt: string | null;
  majorGrid: LnSpec | null;
  line: LnSpec;
  tickLblPos: string;
  majorTick: string;
  lblSize: number | null;
  lblColor: string | null;
  title: string | null;
}

const AXIS_TAGS: Record<string, Axis['kind']> = {
  catAx: 'cat', valAx: 'val', dateAx: 'date', serAx: 'ser',
};

export function defaultAxis(kind: Axis['kind']): Axis {
  return {
    id: '', kind, del: false, pos: null, crosses: null, crossAx: '', crossBetween: 'between',
    min: null, max: null, majorUnit: null, reversed: false, fmt: null,
    majorGrid: null, line: { ...EMPTY_LN }, tickLblPos: 'nextTo', majorTick: 'out',
    lblSize: null, lblColor: null, title: null,
  };
}

function parseAxis(el: Element, kind: Axis['kind'], ctx: ColorCtx): Axis {
  const scaling = kid(el, 'scaling');
  const grid = kid(el, 'majorGridlines');
  const ts = textStyle(kid(el, 'txPr'), ctx);
  return {
    id: strChild(el, 'axId') ?? '',
    kind,
    del: boolChild(el, 'delete', false),
    pos: strChild(el, 'axPos'),
    crosses: strChild(el, 'crosses'),
    crossAx: strChild(el, 'crossAx') ?? '',
    crossBetween: strChild(el, 'crossBetween') ?? 'between',
    min: numChild(scaling, 'min'),
    max: numChild(scaling, 'max'),
    majorUnit: numChild(el, 'majorUnit'),
    reversed: strChild(scaling, 'orientation') === 'maxMin',
    fmt: attr(kid(el, 'numFmt'), 'formatCode'),
    majorGrid: grid ? parseLn(walk(grid, 'spPr', 'ln'), ctx) : null,
    line: parseLn(walk(el, 'spPr', 'ln'), ctx),
    tickLblPos: strChild(el, 'tickLblPos') ?? 'nextTo',
    majorTick: strChild(el, 'majorTickMark') ?? 'out',
    lblSize: ts.size,
    lblColor: ts.color,
    title: (() => {
      const t = kid(el, 'title');
      if (!t || boolChild(el, 'delete', false)) return null;
      const s = richText(kid(t, 'tx'));
      return s || null;
    })(),
  };
}

// ---------- 手动布局 ----------

export interface ManualLayout {
  target: string;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

function parseLayout(el: Element | null): ManualLayout | null {
  const man = kid(el, 'manualLayout');
  if (!man) return null;
  const get = (name: string): number | null => numChild(man, name);
  const out: ManualLayout = {
    target: strChild(man, 'layoutTarget') ?? 'outer',
    x: get('x'), y: get('y'), w: get('w'), h: get('h'),
  };
  if (out.x === null && out.y === null && out.w === null && out.h === null) return null;
  return out;
}

// ---------- 3D 视角 ----------

/** c:view3D。只用于等轴测伪 3D 的偏移方向/幅度近似，不做真实投影。 */
export interface View3D {
  rotX: number;
  rotY: number;
  depthPercent: number;
}

function parseView3D(el: Element | null): View3D | null {
  if (!el) return null;
  return {
    rotX: numChild(el, 'rotX') ?? 15,
    rotY: numChild(el, 'rotY') ?? 20,
    depthPercent: numChild(el, 'depthPercent') ?? 100,
  };
}

// ---------- 顶层模型 ----------

export interface ChartModel {
  title: string | null;
  titleSize: number;
  titleColor: string | null;
  titleBold: boolean;
  legendPos: string | null;
  legendOverlay: boolean;
  legendDeleted: Set<number>;
  groups: PlotGroup[];
  axes: Axis[];
  view3D: View3D | null;
  fill: Fill | null;
  ln: LnSpec;
  plotFill: Fill | null;
  plotLn: LnSpec;
  plotLayout: ManualLayout | null;
  textSize: number;
  textColor: string;
  /** 出现但未实现的图表类型标签 */
  unsupported: string[];
}

export function parseModel(root: Element, ctx: ColorCtx): ChartModel {
  const chart = kid(root, 'chart');
  const plotArea = kid(chart, 'plotArea');
  const spaceStyle = textStyle(kid(root, 'txPr'), ctx);

  const groups: PlotGroup[] = [];
  const unsupported: string[] = [];
  let autoIdx = 0;
  if (plotArea) {
    for (let n = plotArea.firstElementChild; n; n = n.nextElementSibling) {
      const kind = GROUP_TAGS[n.localName];
      if (!kind) continue;
      if (kind === 'other') {
        unsupported.push(n.localName);
        continue;
      }
      const g = parseGroup(n, kind, ctx, autoIdx);
      autoIdx += g.series.length;
      groups.push(g);
    }
  }

  const axes: Axis[] = [];
  if (plotArea) {
    for (let n = plotArea.firstElementChild; n; n = n.nextElementSibling) {
      const k = AXIS_TAGS[n.localName];
      if (k) axes.push(parseAxis(n, k, ctx));
    }
  }

  const titleEl = kid(chart, 'title');
  const autoDeleted = boolChild(chart, 'autoTitleDeleted', false);
  const titleTx = kid(titleEl, 'tx');
  const rawTitle = titleEl && !boolChild(titleEl, 'delete', false) ? richText(titleTx) : '';
  const titleStyle = textStyle(titleTx ?? kid(titleEl, 'txPr'), ctx);
  const titleTxPr = textStyle(kid(titleEl, 'txPr'), ctx);

  const legend = kid(chart, 'legend');
  const legendDeleted = new Set<number>();
  for (const e of kids(legend, 'legendEntry')) {
    const i = numChild(e, 'idx');
    if (i !== null && boolChild(e, 'delete', false)) legendDeleted.add(i);
  }

  const spPr = kid(root, 'spPr');
  const plotSp = kid(plotArea, 'spPr');

  return {
    title: rawTitle && !autoDeleted ? rawTitle : null,
    titleSize: titleStyle.size ?? titleTxPr.size ?? px(14),
    titleColor: titleStyle.color ?? titleTxPr.color,
    titleBold: titleStyle.bold || titleTxPr.bold,
    legendPos: legend ? strChild(legend, 'legendPos') ?? 'r' : null,
    legendOverlay: boolChild(legend, 'overlay', false),
    legendDeleted,
    groups,
    axes,
    view3D: parseView3D(kid(chart, 'view3D')),
    fill: parseFill(spPr, ctx),
    ln: parseLn(kid(spPr, 'ln'), ctx),
    plotFill: parseFill(plotSp, ctx),
    plotLn: parseLn(kid(plotSp, 'ln'), ctx),
    plotLayout: parseLayout(kid(plotArea, 'layout')),
    textSize: spaceStyle.size ?? px(10),
    textColor: spaceStyle.color ?? themeColor(ctx, 'tx1'),
    unsupported,
  };
}
