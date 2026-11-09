/**
 * 预设几何共用的 path 构造件：数值格式、调节值换算、多边形 / 椭圆弧，以及箭头、标注、
 * 装饰片等多个预设族共享的形状模板。坐标系与角度约定同 DrawingML（0° = 右，顺时针为正）。
 */

export interface Geom {
  d: string;
  open: boolean;
}

export type Adj = Record<string, number>;

/** 可跨文件格式重算的预设几何语义；调节值保持 OOXML 的原始计量口径。 */
export interface GeomSpec {
  preset: string;
  adj: Adj;
}

export type PathFn = (w: number, h: number, a: Adj) => string | Geom;
export type Pt = [number, number];

export const n = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0');
export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const open = (d: string): Geom => ({ d, open: true });

/** 取调节值：dflt 为 100000 制，返回 0-1 比例 */
export const av = (a: Adj, key: string, dflt: number): number => (a[key] ?? dflt) / 100000;
/** 取角度调节值（60000 分之一度），返回度 */
export const ang = (a: Adj, key: string, dflt: number): number => (a[key] ?? dflt) / 60000;

export function poly(pts: Pt[], close = true): string {
  if (!pts.length) return '';
  return 'M ' + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ') + (close ? ' Z' : '');
}

/** 椭圆上按角度取点（0° = 右，顺时针为正，与 DrawingML 一致） */
export function ep(cx: number, cy: number, rx: number, ry: number, deg: number): Pt {
  return [cx + rx * Math.cos(rad(deg)), cy + ry * Math.sin(rad(deg))];
}

/** 椭圆弧段（承接当前点），sweep 为正表示顺时针 */
export function arcSeg(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number): string {
  const sw = Math.max(-359.99, Math.min(359.99, sweep));
  const [ex, ey] = ep(cx, cy, rx, ry, start + sw);
  return `A ${n(rx)} ${n(ry)} 0 ${Math.abs(sw) > 180 ? 1 : 0} ${sw >= 0 ? 1 : 0} ${n(ex)} ${n(ey)}`;
}

export function arcFrom(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number): string {
  const [sx, sy] = ep(cx, cy, rx, ry, start);
  return `M ${n(sx)} ${n(sy)} ${arcSeg(cx, cy, rx, ry, start, sweep)}`;
}

/**
 * 零面积描线：正向走一遍再反向走回来。
 * 在 fill-rule="evenodd" 下不改变填充（穿越数 +2），但描边可见——
 * 用于立方体棱线、流程图分隔线等装饰，避免把主体挖出空洞。
 */
export function seg(pts: Pt[]): string {
  if (pts.length < 2) return '';
  const back = pts.slice(0, -1).reverse();
  return 'M ' + [...pts, ...back].map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ');
}

/** 零面积椭圆描线（同上，用于圆柱顶盖等） */
export function ellSeg(cx: number, cy: number, rx: number, ry: number): string {
  return ell(cx, cy, rx, ry) + ' ' + ell(cx, cy, rx, ry, true);
}

export function ell(cx: number, cy: number, rx: number, ry: number, reverse = false): string {
  const s = reverse ? -180 : 180;
  return `M ${n(cx - rx)} ${n(cy)} ${arcSeg(cx, cy, rx, ry, 180, s)} ${arcSeg(cx, cy, rx, ry, 180 + s, s)} Z`;
}

/** 正 n 边形（内接于 w×h 椭圆） */
export function regular(sides: number, rotDeg: number): PathFn {
  return (w, h) => {
    const pts: Pt[] = [];
    for (let i = 0; i < sides; i++) pts.push(ep(w / 2, h / 2, w / 2, h / 2, rotDeg + (360 * i) / sides));
    return poly(pts);
  };
}

export function starFn(points: number, defaultInner: number): PathFn {
  return (w, h, a) => {
    const raw = a.adj !== undefined ? a.adj / 100000 : defaultInner;
    const inner = Math.min(0.95, Math.max(0.05, raw));
    const pts: Pt[] = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? 1 : inner;
      pts.push(ep(w / 2, h / 2, (w / 2) * r, (h / 2) * r, -90 + (i * 180) / points));
    }
    return poly(pts);
  };
}

// ---------------- 矩形族 ----------------

/** 四角处理，顺序 左上,右上,右下,左下；kind: 'r' 圆角 / 's' 切角 / 'n' 直角 */
export function shapedRect(w: number, h: number, radii: number[], kinds: string[]): string {
  const corners: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const outDir: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const seg: string[] = [];
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i];
    const r = Math.max(0, radii[i]);
    const prev = outDir[(i + 3) % 4];
    const out = outDir[i];
    const entry: Pt = [cx - prev[0] * r, cy - prev[1] * r];
    const exit: Pt = [cx + out[0] * r, cy + out[1] * r];
    seg.push(`${i === 0 ? 'M' : 'L'} ${n(entry[0])} ${n(entry[1])}`);
    if (r > 0) {
      seg.push(kinds[i] === 'r' ? `A ${n(r)} ${n(r)} 0 0 1 ${n(exit[0])} ${n(exit[1])}` : `L ${n(exit[0])} ${n(exit[1])}`);
    }
  }
  return seg.join(' ') + ' Z';
}

export const rectFamily = (kinds: string[], keys: (string | null)[], dflts: number[]): PathFn =>
  (w, h, a) => {
    const radii = keys.map((k, i) => (k ? Math.min(w, h) * Math.min(av(a, k, dflts[i]), 0.5) : 0));
    return shapedRect(w, h, radii, kinds);
  };

// ---------------- 箭头 ----------------

const remap: Record<string, (p: Pt, w: number, h: number) => Pt> = {
  r: ([x, y]) => [x, y],
  l: ([x, y], w) => [w - x, y],
  d: ([x, y]) => [y, x],
  u: ([x, y], _w, h) => [y, h - x],
};

export function arrow(dir: 'r' | 'l' | 'u' | 'd'): PathFn {
  return (w, h, a) => {
    const horiz = dir === 'r' || dir === 'l';
    const len = horiz ? w : h;
    const across = horiz ? h : w;
    const shaft = (across * Math.min(av(a, 'adj1', 50000), 1)) / 2;
    const head = Math.min(len, across * av(a, 'adj2', 50000));
    const c = across / 2;
    const pts: Pt[] = [
      [0, c - shaft], [len - head, c - shaft], [len - head, 0],
      [len, c], [len - head, across], [len - head, c + shaft], [0, c + shaft],
    ];
    return poly(pts.map((p) => remap[dir](p, w, h)));
  };
}

export function arrowCallout(dir: 'r' | 'l' | 'u' | 'd'): PathFn {
  return (w, h, a) => {
    const horiz = dir === 'r' || dir === 'l';
    const len = horiz ? w : h;
    const across = horiz ? h : w;
    const shaft = (across * av(a, 'adj1', 18515)) / 2;
    const head = Math.min(len / 2, across * av(a, 'adj2', 18515));
    const boxEdge = Math.max(0, len - Math.max(head, len * (1 - av(a, 'adj4', 66667))));
    const c = across / 2;
    const pts: Pt[] = [
      [0, 0], [boxEdge, 0], [boxEdge, c - shaft], [len - head, c - shaft], [len - head, 0],
      [len, c], [len - head, across], [len - head, c + shaft], [boxEdge, c + shaft], [boxEdge, across], [0, across],
    ];
    return poly(pts.map((p) => remap[dir](p, w, h)));
  };
}

// ---------------- 其它辅助 ----------------

export function wedgeTail(w: number, h: number, a: Adj): Pt {
  return [w / 2 + w * av(a, 'adj1', -20833), h / 2 + h * av(a, 'adj2', 62500)];
}

/**
 * wedgeRectCallout / wedgeRoundRectCallout 的规范 guide（dz / xg1 / t1…t8）：
 * 尾尖相对中心更偏竖直就从上下边出尾巴，否则从左右边；底座占该边 2/12–5/12
 * 或 7/12–10/12，取靠近尾尖的一段。不出尾巴的三条边上，尖端退化成边上的点。
 * 底座固定画在下边时，尾尖朝上会穿过整个框，只剩一条细线。
 */
export function wedgeEdges(w: number, h: number, a: Adj): {
  x1: number; x2: number; y1: number; y2: number; top: Pt; right: Pt; bottom: Pt; left: Pt;
} {
  const tip = wedgeTail(w, h, a);
  const dxPos = tip[0] - w / 2;
  const dyPos = tip[1] - h / 2;
  const dq = w === 0 ? 0 : dxPos * h / w;
  const vertical = Math.abs(dyPos) - Math.abs(dq) > 0;
  const x1 = w * (dxPos > 0 ? 7 : 2) / 12;
  const y1 = h * (dyPos > 0 ? 7 : 2) / 12;
  return {
    x1, x2: w * (dxPos > 0 ? 10 : 5) / 12, y1, y2: h * (dyPos > 0 ? 10 : 5) / 12,
    top: vertical && dyPos <= 0 ? tip : [x1, 0],
    right: !vertical && dxPos > 0 ? tip : [w, y1],
    bottom: vertical && dyPos > 0 ? tip : [x1, h],
    left: !vertical && dxPos <= 0 ? tip : [0, y1],
  };
}

/**
 * 标注引线：文本框底边出发的 1-3 段折线。段数即形状名末尾的数字。
 *
 * 注意 accent* / 无 border 的变体在规范里文本框是「只填充不描边」的，
 * 我们的路径统一描边，做不到分段区分——callout1 一直复用 borderCallout1 就是这个原因，
 * 这里沿用同一处理，只保证段数与重音竖线正确。
 */
function calloutLeader(w: number, h: number, a: Adj, segs: number): string {
  const pts: Pt[] = [[w * 0.15, h]];
  if (segs === 1) {
    pts.push([w * av(a, 'adj2', -8333), h + h * av(a, 'adj1', 18750)]);
  } else {
    pts.push([w * 0.05, h * 1.2]);
    pts.push([w * av(a, 'adj4', -16667), h + h * av(a, 'adj3', 44444)]);
    // 三段标注末段水平延伸，与 PowerPoint 一致
    if (segs >= 3) pts.push([w * av(a, 'adj6', -16667) - w * 0.12, h + h * av(a, 'adj5', 44444)]);
  }
  // 折线必须走零面积描线：3 点以上的开放子路径会被 fill 补成实心楔形
  return ' ' + seg(pts);
}

/** 标注：文本框 + 引线，accent 时在左边缘补一条重音竖线（规范里它就压在框的左边） */
export function callout(segs: number, accent: boolean): PathFn {
  return (w, h, a) =>
    poly([[0, 0], [w, 0], [w, h], [0, h]]) +
    (accent ? ' ' + seg([[0, 0], [0, h]]) : '') +
    calloutLeader(w, h, a, segs);
}

/** 四角装饰片：每个角一片，kind 决定圆角朝向（'q' 凸 / 'c' 凹 / 's' 方） */
export function tabs(kind: 'q' | 'c' | 's'): PathFn {
  return (w, h) => {
    // 规范用对角线长度的 1/20 定尺寸，与 w/h 比例无关
    const d = Math.min(Math.hypot(w, h) / 20, Math.min(w, h) / 2);
    const corner = (cx: number, cy: number, sx: number, sy: number): string => {
      const [ax, ay] = [cx + sx * d, cy];
      const [bx, by] = [cx, cy + sy * d];
      if (kind === 's') return poly([[cx, cy], [ax, ay], [ax, by], [bx, by]]);
      // 凸（cornerTabs）弧心在角点，凹（plaqueTabs）弧心在对角
      const sweep = kind === 'q' ? (sx * sy > 0 ? 1 : 0) : (sx * sy > 0 ? 0 : 1);
      return `M ${n(cx)} ${n(cy)} L ${n(ax)} ${n(ay)} A ${n(d)} ${n(d)} 0 0 ${sweep} ${n(bx)} ${n(by)} Z`;
    };
    return [
      corner(0, 0, 1, 1), corner(w, 0, -1, 1),
      corner(w, h, -1, -1), corner(0, h, 1, -1),
    ].join(' ');
  };
}

export function waveEdge(y: number, w: number, amp: number, reverse: boolean): string {
  const q = w / 4;
  return reverse
    ? `C ${n(w - q)} ${n(y + amp)} ${n(q)} ${n(y - amp)} 0 ${n(y)}`
    : `C ${n(q)} ${n(y - amp)} ${n(q * 3)} ${n(y + amp)} ${n(w)} ${n(y)}`;
}

/**
 * 弯曲箭头：环形扇区band + 端部箭头。
 * 角度按 DrawingML 约定（0°=右，顺时针为正）；sign 为 +1/-1 表示扫掠方向。
 * both=true 时起点也长一个箭头（leftRightCircularArrow），此时两端各让出更少的角度，
 * 否则短弧上两个箭头会啃到一起。
 */
export function curvedArrow(
  cx: number, cy: number, rx: number, ry: number,
  t: number, head: number, startAng: number, endAng: number, both = false,
): string {
  const sign = endAng >= startAng ? 1 : -1;
  // 箭头不能吃穿环带内侧，否则路径自交
  const hd = Math.max(1, Math.min(head, Math.min(rx, ry) - t - 1));
  const rMid = (rx + ry) / 2 - t / 2;
  const headAng = Math.min(Math.abs(endAng - startAng) * (both ? 0.35 : 0.6), (hd / Math.max(rMid, 1)) * (180 / Math.PI));
  const baseAng = endAng - sign * headAng;
  const startBase = both ? startAng + sign * headAng : startAng;
  const sweepOuter = baseAng - startBase;

  const [ox, oy] = ep(cx, cy, rx, ry, startBase);
  const [aOutX, aOutY] = ep(cx, cy, rx + hd, ry + hd, baseAng);
  const [tipX, tipY] = ep(cx, cy, rx - t / 2, ry - t / 2, endAng);
  const [aInX, aInY] = ep(cx, cy, rx - t - hd, ry - t - hd, baseAng);
  const [inX, inY] = ep(cx, cy, rx - t, ry - t, baseAng);

  let tail = '';
  if (both) {
    const [bInX, bInY] = ep(cx, cy, rx - t - hd, ry - t - hd, startBase);
    const [bTipX, bTipY] = ep(cx, cy, rx - t / 2, ry - t / 2, startAng);
    const [bOutX, bOutY] = ep(cx, cy, rx + hd, ry + hd, startBase);
    tail = `L ${n(bInX)} ${n(bInY)} L ${n(bTipX)} ${n(bTipY)} L ${n(bOutX)} ${n(bOutY)} `;
  }

  return (
    `M ${n(ox)} ${n(oy)} ${arcSeg(cx, cy, rx, ry, startBase, sweepOuter)} ` +
    `L ${n(aOutX)} ${n(aOutY)} L ${n(tipX)} ${n(tipY)} L ${n(aInX)} ${n(aInY)} ` +
    `L ${n(inX)} ${n(inY)} ${arcSeg(cx, cy, rx - t, ry - t, baseAng, -sweepOuter)} ${tail}Z`
  );
}

export function gear(w: number, h: number, teeth: number): string {
  const cx = w / 2, cy = h / 2;
  const outer = Math.min(w, h) / 2;
  const inner = outer * 0.78;
  const step = 360 / teeth;
  const pts: Pt[] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    pts.push(ep(cx, cy, inner, inner, a0 - step * 0.28));
    pts.push(ep(cx, cy, outer, outer, a0 - step * 0.16));
    pts.push(ep(cx, cy, outer, outer, a0 + step * 0.16));
    pts.push(ep(cx, cy, inner, inner, a0 + step * 0.28));
  }
  return poly(pts) + ' ' + ell(cx, cy, outer * 0.36, outer * 0.36, true);
}

export function bevelFrame(w: number, h: number, t: number): string {
  return poly([[0, 0], [w, 0], [w, h], [0, h]]) +
    ' ' + seg([[t, t], [w - t, t], [w - t, h - t], [t, h - t], [t, t]]);
}

export function actionButton(w: number, h: number, sym: (s: number, cx: number, cy: number) => string): string {
  const t = Math.min(w, h) * 0.125;
  return bevelFrame(w, h, t) + ' ' + sym(Math.min(w, h) * 0.24, w / 2, h / 2);
}
