/**
 * SmartArt 布局回退。
 *
 * PowerPoint 存 SmartArt 时会连带写一份「画好的」drawing part，直接读它最保真，
 * 那条路在 parser.ts 里。本文件处理**没有** drawing part 的情况——
 * python-pptx / Google Slides / LibreOffice 导出的文件常常只写数据与版式定义。
 * 在此之前这类文件只会得到一个灰色占位框。
 *
 * 说明清楚做到哪一步：DiagramML 的完整语义是一套约束求解器
 * （constrLst / ruleLst / forEach / presOf 联立），本文件**不**实现它。
 * 这里读的是数据模型的点树 + 版式定义的顶层算法类型，按算法族手工排布。
 * 结果是「结构与排布对得上」，不是「与 PowerPoint 逐像素一致」。
 */

import type { Fill, GroupElement, ShapeElement, SlideElement, TextBody } from '../types';
import { attr, kid, kids, numAttr } from '../xml';
import { presetGeom } from '../geometry';

/** 数据模型里的一个节点 */
export interface DiagramPoint {
  id: string;
  text: TextBody | null;
  children: DiagramPoint[];
  /** 层级深度，0 为根的直接子节点 */
  depth: number;
}

export type LayoutFamily = 'linear' | 'cycle' | 'pyramid' | 'hierarchy' | 'snake' | 'radial';

/**
 * 由版式定义判断布局族。
 *
 * 优先看 dgm:alg@type（规范枚举，最可靠），其次看 uniqueId 里的关键词——
 * 微软内置版式的 uniqueId 形如 .../layout/cycle2、.../layout/orgChart1，
 * 这个命名比算法树好读得多，且对内置版式一定存在。
 */
export function layoutFamily(layoutRoot: Element | null): LayoutFamily {
  const uid = (attr(layoutRoot, 'uniqueId') ?? '').toLowerCase();
  if (/orgchart|hierarchy/.test(uid)) return 'hierarchy';
  if (/pyramid/.test(uid)) return 'pyramid';
  if (/radial|cycle.*matrix/.test(uid)) return 'radial';
  if (/cycle|gear/.test(uid)) return 'cycle';
  if (/matrix|grid/.test(uid)) return 'snake';

  const algs = new Set<string>();
  const walk = (el: Element | null, depth: number): void => {
    if (!el || depth < 0) return;
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === 'alg') {
        const t = attr(c, 'type');
        if (t) algs.add(t);
      }
      walk(c, depth - 1);
    }
  };
  walk(layoutRoot, 12);

  if (algs.has('hierRoot') || algs.has('hierChild')) return 'hierarchy';
  if (algs.has('pyra')) return 'pyramid';
  if (algs.has('cycle')) return 'cycle';
  if (algs.has('snake')) return 'snake';
  if (algs.has('sp') && !algs.has('lin')) return 'radial';
  return 'linear';
}

/** 线性布局的方向：版式里 linDir=fromT 表示竖排 */
export function isVertical(layoutRoot: Element | null): boolean {
  const uid = (attr(layoutRoot, 'uniqueId') ?? '').toLowerCase();
  if (/vlist|vertical|^.*\/list1$/.test(uid)) return true;
  const found = layoutRoot?.getElementsByTagName('*');
  for (let i = 0; found && i < found.length; i++) {
    if (found[i].localName === 'param' && attr(found[i], 'type') === 'linDir') {
      return attr(found[i], 'val') === 'fromT' || attr(found[i], 'val') === 'fromB';
    }
  }
  return false;
}

/**
 * 数据模型 → 点树。
 *
 * dgm:cxnLst 里 type 缺省或为 parOf 的连接构成父子关系，按 srcOrd 排序。
 * type="presOf" / "presParOf" 是「表现层」连接，指向版式生成的形状而非数据节点，
 * 混进来会让树多出一倍的幽灵节点。
 */
export function parseDataModel(dataRoot: Element | null): DiagramPoint[] {
  if (!dataRoot) return [];
  const dm = dataRoot.localName === 'dataModel' ? dataRoot : kid(dataRoot, 'dataModel');
  const ptLst = kid(dm, 'ptLst');
  const cxnLst = kid(dm, 'cxnLst');
  if (!ptLst) return [];

  const nodes = new Map<string, { id: string; txBody: Element | null; kids: { id: string; ord: number }[] }>();
  let rootId: string | null = null;
  for (const pt of kids(ptLst, 'pt')) {
    const id = attr(pt, 'modelId');
    if (!id) continue;
    const type = attr(pt, 'type') ?? 'node';
    // parTrans / sibTrans 是连接线与间隔，不是内容节点
    if (type === 'parTrans' || type === 'sibTrans' || type === 'pres') continue;
    if (type === 'doc') rootId = id;
    nodes.set(id, { id, txBody: kid(pt, 't'), kids: [] });
  }

  for (const cxn of kids(cxnLst, 'cxn')) {
    const type = attr(cxn, 'type') ?? 'parOf';
    if (type !== 'parOf') continue;
    const src = attr(cxn, 'srcId');
    const dest = attr(cxn, 'destId');
    if (!src || !dest) continue;
    const parent = nodes.get(src);
    if (!parent || !nodes.has(dest)) continue;
    parent.kids.push({ id: dest, ord: numAttr(cxn, 'srcOrd') ?? 0 });
  }

  const seen = new Set<string>();
  const build = (id: string, depth: number): DiagramPoint | null => {
    // 数据模型里出现环是文件损坏，但不能因此栈溢出
    if (seen.has(id) || depth > 12) return null;
    seen.add(id);
    const n = nodes.get(id);
    if (!n) return null;
    n.kids.sort((a, b) => a.ord - b.ord);
    return {
      id,
      text: null,
      children: n.kids.map((k) => build(k.id, depth + 1)).filter((x): x is DiagramPoint => x !== null),
      depth,
    };
  };

  if (rootId) {
    const root = build(rootId, -1);
    return root ? root.children : [];
  }
  // 没有 doc 节点时把所有没被别人指向的点当根
  const hasParent = new Set<string>();
  for (const n of nodes.values()) for (const k of n.kids) hasParent.add(k.id);
  return [...nodes.keys()].filter((id) => !hasParent.has(id))
    .map((id) => build(id, 0)).filter((x): x is DiagramPoint => x !== null);
}

/** 取点的 txBody 元素，供调用方用自己的文本解析器处理 */
export function pointTxBody(dataRoot: Element | null, id: string): Element | null {
  const dm = dataRoot?.localName === 'dataModel' ? dataRoot : kid(dataRoot, 'dataModel');
  for (const pt of kids(kid(dm, 'ptLst'), 'pt')) {
    if (attr(pt, 'modelId') === id) return kid(pt, 't');
  }
  return null;
}

/** 从 colors1.xml 取一组填充色；取不到时返回空数组，由调用方回退到主题强调色 */
export function parseDiagramColors(colorsRoot: Element | null): string[] {
  if (!colorsRoot) return [];
  const out: string[] = [];
  const labels = kids(colorsRoot, 'styleLbl');
  const node = labels.find((l) => (attr(l, 'name') ?? '').startsWith('node')) ?? labels[0];
  const fill = kid(node ?? null, 'fillClrLst');
  for (let c = fill?.firstElementChild ?? null; c; c = c.nextElementSibling) {
    const v = attr(c, 'val');
    if (v) out.push(v);
  }
  return out;
}

// ---------------- 排布 ----------------

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  pt: DiagramPoint;
  /** 预设形状名 */
  prst: string;
  /** 用第几个配色 */
  colorIdx: number;
}

/** 铺平点树（层序），用于非层级类布局 */
function flatten(pts: DiagramPoint[]): DiagramPoint[] {
  const out: DiagramPoint[] = [];
  const walk = (list: DiagramPoint[]): void => {
    for (const p of list) { out.push(p); walk(p.children); }
  };
  walk(pts);
  return out;
}

function layoutLinear(pts: DiagramPoint[], w: number, h: number, vertical: boolean): Placed[] {
  const items = pts.length ? pts : [];
  if (!items.length) return [];
  const gap = (vertical ? h : w) * 0.04;
  const n = items.length;
  if (vertical) {
    const bh = (h - gap * (n - 1)) / n;
    // 限制长宽比：占满整幅宽度的横条不像 SmartArt，像表格行
    const bw = Math.min(w, bh * 5);
    return items.map((pt, i) => ({
      x: (w - bw) / 2, y: i * (bh + gap), w: bw, h: bh, pt, prst: 'roundRect', colorIdx: i,
    }));
  }
  const bw = (w - gap * (n - 1)) / n;
  // 同理：横向流程的盒子顶天立地会变成一根根柱子
  const bh = Math.min(h, bw * 0.8);
  return items.map((pt, i) => ({
    x: i * (bw + gap), y: (h - bh) / 2, w: bw, h: bh, pt, prst: 'roundRect', colorIdx: i,
  }));
}

function layoutCycle(pts: DiagramPoint[], w: number, h: number): Placed[] {
  const n = pts.length;
  if (!n) return [];
  // 圆周半径按「每个节点占的弧长要放得下自己」倒推，节点少时不至于挤在中心
  const bw = Math.min(w, h) * (n <= 4 ? 0.34 : 0.28);
  const bh = bw * 0.62;
  const rx = (w - bw) / 2;
  const ry = (h - bh) / 2;
  return pts.map((pt, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return {
      x: w / 2 + rx * Math.cos(a) - bw / 2,
      y: h / 2 + ry * Math.sin(a) - bh / 2,
      w: bw, h: bh, pt, prst: 'ellipse', colorIdx: i,
    };
  });
}

function layoutPyramid(pts: DiagramPoint[], w: number, h: number): Placed[] {
  const n = pts.length;
  if (!n) return [];
  const rowH = h / n;
  return pts.map((pt, i) => {
    // 自上而下逐层加宽，最上一层最窄
    const wide = ((i + 1) / n) * w;
    return { x: (w - wide) / 2, y: i * rowH, w: wide, h: rowH * 0.94, pt, prst: 'trapezoid', colorIdx: i };
  });
}

function layoutSnake(pts: DiagramPoint[], w: number, h: number): Placed[] {
  const n = pts.length;
  if (!n) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gx = w * 0.03, gy = h * 0.05;
  const bw = (w - gx * (cols - 1)) / cols;
  const bh = (h - gy * (rows - 1)) / rows;
  return pts.map((pt, i) => ({
    x: (i % cols) * (bw + gx),
    y: Math.floor(i / cols) * (bh + gy),
    w: bw, h: bh, pt, prst: 'roundRect', colorIdx: i,
  }));
}

function layoutRadial(pts: DiagramPoint[], w: number, h: number): Placed[] {
  if (!pts.length) return [];
  const [center, ...rest] = pts;
  const size = Math.min(w, h) * 0.3;
  const out: Placed[] = [{
    x: (w - size) / 2, y: (h - size) / 2, w: size, h: size, pt: center, prst: 'ellipse', colorIdx: 0,
  }];
  const n = rest.length;
  const bw = Math.min(w, h) * 0.26, bh = bw * 0.62;
  rest.forEach((pt, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
    out.push({
      x: w / 2 + ((w - bw) / 2) * Math.cos(a) - bw / 2,
      y: h / 2 + ((h - bh) / 2) * Math.sin(a) - bh / 2,
      w: bw, h: bh, pt, prst: 'ellipse', colorIdx: i + 1,
    });
  });
  return out;
}

function layoutHierarchy(pts: DiagramPoint[], w: number, h: number): Placed[] {
  // 按层分组，每层等分宽度；同层节点按父节点顺序排，够用且不会交叉
  const levels: DiagramPoint[][] = [];
  const walk = (list: DiagramPoint[], lvl: number): void => {
    if (!list.length) return;
    (levels[lvl] ??= []).push(...list);
    for (const p of list) walk(p.children, lvl + 1);
  };
  walk(pts, 0);
  if (!levels.length) return [];

  const rowH = h / levels.length;
  const bh = rowH * 0.62;
  const out: Placed[] = [];
  levels.forEach((row, lvl) => {
    const gap = w * 0.03;
    const bw = (w - gap * (row.length - 1)) / row.length;
    row.forEach((pt, i) => {
      out.push({
        x: i * (bw + gap), y: lvl * rowH + (rowH - bh) / 2,
        w: bw, h: bh, pt, prst: 'roundRect', colorIdx: lvl,
      });
    });
  });
  return out;
}

const LAYOUTS: Record<LayoutFamily, (p: DiagramPoint[], w: number, h: number, v: boolean) => Placed[]> = {
  linear: layoutLinear,
  cycle: (p, w, h) => layoutCycle(p, w, h),
  pyramid: (p, w, h) => layoutPyramid(p, w, h),
  hierarchy: (p, w, h) => layoutHierarchy(p, w, h),
  snake: (p, w, h) => layoutSnake(p, w, h),
  radial: (p, w, h) => layoutRadial(p, w, h),
};

export interface DiagramBuildOptions {
  family: LayoutFamily;
  vertical: boolean;
  /** 已解析好的填充色（CSS 颜色串），至少一个 */
  colors: string[];
  /** 由调用方注入：点 id → 文本 */
  textOf: (id: string) => TextBody | null;
}

/**
 * 排布并产出元素。层级布局额外画父子连线——组织结构图没有连线就读不出层级。
 */
export function buildDiagram(
  pts: DiagramPoint[], w: number, h: number, opts: DiagramBuildOptions,
): SlideElement[] {
  // 层级类要保留树形，其余按层序铺平
  const input = opts.family === 'hierarchy' ? pts : flatten(pts);
  const placed = LAYOUTS[opts.family](input, w, h, opts.vertical);
  if (!placed.length) return [];

  const out: SlideElement[] = [];

  if (opts.family === 'hierarchy') {
    const byId = new Map(placed.map((p) => [p.pt.id, p]));
    const line = (a: Placed, b: Placed): void => {
      const x1 = a.x + a.w / 2, y1 = a.y + a.h;
      const x2 = b.x + b.w / 2, y2 = b.y;
      const midY = (y1 + y2) / 2;
      const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
      const bw = Math.max(Math.abs(x2 - x1), 1), bh = Math.max(y2 - y1, 1);
      // 折线走「下 → 横 → 下」，与组织结构图的画法一致
      const d = `M ${x1 - minX} 0 L ${x1 - minX} ${midY - minY} L ${x2 - minX} ${midY - minY} L ${x2 - minX} ${bh}`;
      out.push({
        kind: 'shape', x: minX, y: minY, w: bw, h: bh, rot: 0, flipH: false, flipV: false,
        path: d, fill: null, stroke: { color: opts.colors[0] ?? 'rgb(68,114,196)', width: 1.5, dash: null },
        text: null, openGeom: true, name: 'SmartArt 连线',
      });
    };
    const walkLines = (list: DiagramPoint[]): void => {
      for (const p of list) {
        const pa = byId.get(p.id);
        for (const c of p.children) {
          const cb = byId.get(c.id);
          if (pa && cb) line(pa, cb);
        }
        walkLines(p.children);
      }
    };
    walkLines(pts);
  }

  for (const p of placed) {
    const color = opts.colors[p.colorIdx % Math.max(opts.colors.length, 1)] ?? 'rgb(68,114,196)';
    const fill: Fill = { type: 'solid', color };
    const geom = presetGeom(p.prst, p.w, p.h, {});
    const shape: ShapeElement = {
      kind: 'shape', x: p.x, y: p.y, w: p.w, h: p.h, rot: 0, flipH: false, flipV: false,
      path: geom.d, fill, stroke: null,
      text: opts.textOf(p.pt.id),
      name: 'SmartArt 节点',
    };
    out.push(shape);
  }
  return out;
}

/** 组装成一个 group，坐标系与 frame 对齐 */
export function wrapDiagram(children: SlideElement[], base: Omit<GroupElement,
  'kind' | 'childX' | 'childY' | 'scaleX' | 'scaleY' | 'children'>): GroupElement {
  return {
    kind: 'group', ...base,
    childX: 0, childY: 0, scaleX: 1, scaleY: 1,
    children,
    name: 'SmartArt',
  };
}
