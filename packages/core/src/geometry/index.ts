/**
 * 预设形状几何 —— 与文件格式无关的纯计算。
 *
 * ECMA-376 全部 187 个 DrawingML 预设形状的 path 求值，不依赖 XML、DOM 或任何解析器：
 * .pptx 与 .ppt 两条链路都用它（ppt 侧把 MSO 的调节值换算成 100000 制后传入）。
 * 读 OOXML 的那部分（avLst / custGeom）留在 pptx/geometry.ts。
 *
 * Geom.open = true 表示开放路径（只描边不填充，如括号 / 弧线 / 连接线）
 */

export interface Geom {
  d: string;
  open: boolean;
}

export type Adj = Record<string, number>;
type PathFn = (w: number, h: number, a: Adj) => string | Geom;
export type Pt = [number, number];

export const n = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0');
export const rad = (deg: number): number => (deg * Math.PI) / 180;
const open = (d: string): Geom => ({ d, open: true });

/** 取调节值：dflt 为 100000 制，返回 0-1 比例 */
const av = (a: Adj, key: string, dflt: number): number => (a[key] ?? dflt) / 100000;
/** 取角度调节值（60000 分之一度），返回度 */
const ang = (a: Adj, key: string, dflt: number): number => (a[key] ?? dflt) / 60000;

function poly(pts: Pt[], close = true): string {
  if (!pts.length) return '';
  return 'M ' + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ') + (close ? ' Z' : '');
}

/** 椭圆上按角度取点（0° = 右，顺时针为正，与 DrawingML 一致） */
export function ep(cx: number, cy: number, rx: number, ry: number, deg: number): Pt {
  return [cx + rx * Math.cos(rad(deg)), cy + ry * Math.sin(rad(deg))];
}

/** 椭圆弧段（承接当前点），sweep 为正表示顺时针 */
function arcSeg(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number): string {
  const sw = Math.max(-359.99, Math.min(359.99, sweep));
  const [ex, ey] = ep(cx, cy, rx, ry, start + sw);
  return `A ${n(rx)} ${n(ry)} 0 ${Math.abs(sw) > 180 ? 1 : 0} ${sw >= 0 ? 1 : 0} ${n(ex)} ${n(ey)}`;
}

function arcFrom(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number): string {
  const [sx, sy] = ep(cx, cy, rx, ry, start);
  return `M ${n(sx)} ${n(sy)} ${arcSeg(cx, cy, rx, ry, start, sweep)}`;
}

/**
 * 零面积描线：正向走一遍再反向走回来。
 * 在 fill-rule="evenodd" 下不改变填充（穿越数 +2），但描边可见——
 * 用于立方体棱线、流程图分隔线等装饰，避免把主体挖出空洞。
 */
function seg(pts: Pt[]): string {
  if (pts.length < 2) return '';
  const back = pts.slice(0, -1).reverse();
  return 'M ' + [...pts, ...back].map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ');
}

/** 零面积椭圆描线（同上，用于圆柱顶盖等） */
function ellSeg(cx: number, cy: number, rx: number, ry: number): string {
  return ell(cx, cy, rx, ry) + ' ' + ell(cx, cy, rx, ry, true);
}

function ell(cx: number, cy: number, rx: number, ry: number, reverse = false): string {
  const s = reverse ? -180 : 180;
  return `M ${n(cx - rx)} ${n(cy)} ${arcSeg(cx, cy, rx, ry, 180, s)} ${arcSeg(cx, cy, rx, ry, 180 + s, s)} Z`;
}

/** 正 n 边形（内接于 w×h 椭圆） */
function regular(sides: number, rotDeg: number): PathFn {
  return (w, h) => {
    const pts: Pt[] = [];
    for (let i = 0; i < sides; i++) pts.push(ep(w / 2, h / 2, w / 2, h / 2, rotDeg + (360 * i) / sides));
    return poly(pts);
  };
}

function starFn(points: number, defaultInner: number): PathFn {
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
function shapedRect(w: number, h: number, radii: number[], kinds: string[]): string {
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

const rectFamily = (kinds: string[], keys: (string | null)[], dflts: number[]): PathFn =>
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

function arrow(dir: 'r' | 'l' | 'u' | 'd'): PathFn {
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

function arrowCallout(dir: 'r' | 'l' | 'u' | 'd'): PathFn {
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

function wedgeTail(w: number, h: number, a: Adj): Pt {
  return [w / 2 + w * av(a, 'adj1', -20833), h / 2 + h * av(a, 'adj2', 62500)];
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
function callout(segs: number, accent: boolean): PathFn {
  return (w, h, a) =>
    poly([[0, 0], [w, 0], [w, h], [0, h]]) +
    (accent ? ' ' + seg([[0, 0], [0, h]]) : '') +
    calloutLeader(w, h, a, segs);
}

/** 四角装饰片：每个角一片，kind 决定圆角朝向（'q' 凸 / 'c' 凹 / 's' 方） */
function tabs(kind: 'q' | 'c' | 's'): PathFn {
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

function waveEdge(y: number, w: number, amp: number, reverse: boolean): string {
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
function curvedArrow(
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

function gear(w: number, h: number, teeth: number): string {
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

function bevelFrame(w: number, h: number, t: number): string {
  return poly([[0, 0], [w, 0], [w, h], [0, h]]) +
    ' ' + seg([[t, t], [w - t, t], [w - t, h - t], [t, h - t], [t, t]]);
}

function actionButton(w: number, h: number, sym: (s: number, cx: number, cy: number) => string): string {
  const t = Math.min(w, h) * 0.125;
  return bevelFrame(w, h, t) + ' ' + sym(Math.min(w, h) * 0.24, w / 2, h / 2);
}

// ---------------- 预设表 ----------------

const PRESETS: Record<string, PathFn> = {
  // 矩形族
  rect: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]),
  roundRect: rectFamily(['r', 'r', 'r', 'r'], ['adj', 'adj', 'adj', 'adj'], [16667, 16667, 16667, 16667]),
  round1Rect: rectFamily(['n', 'r', 'n', 'n'], [null, 'adj', null, null], [0, 16667, 0, 0]),
  round2SameRect: rectFamily(['r', 'r', 'r', 'r'], ['adj1', 'adj1', 'adj2', 'adj2'], [16667, 16667, 0, 0]),
  round2DiagRect: rectFamily(['r', 'r', 'r', 'r'], ['adj1', 'adj2', 'adj1', 'adj2'], [16667, 0, 16667, 0]),
  snip1Rect: rectFamily(['n', 's', 'n', 'n'], [null, 'adj', null, null], [0, 16667, 0, 0]),
  snip2SameRect: rectFamily(['s', 's', 's', 's'], ['adj1', 'adj1', 'adj2', 'adj2'], [16667, 16667, 0, 0]),
  snip2DiagRect: rectFamily(['s', 's', 's', 's'], ['adj1', 'adj2', 'adj1', 'adj2'], [0, 16667, 0, 16667]),
  snipRoundRect: rectFamily(['r', 's', 'n', 'n'], ['adj1', 'adj2', null, null], [16667, 16667, 0, 0]),
  plaque: (w, h, a) => {
    const c = Math.min(w, h) * Math.min(av(a, 'adj', 16667), 0.5);
    return (
      `M ${n(c)} 0 L ${n(w - c)} 0 A ${n(c)} ${n(c)} 0 0 0 ${n(w)} ${n(c)} L ${n(w)} ${n(h - c)} ` +
      `A ${n(c)} ${n(c)} 0 0 0 ${n(w - c)} ${n(h)} L ${n(c)} ${n(h)} A ${n(c)} ${n(c)} 0 0 0 0 ${n(h - c)} ` +
      `L 0 ${n(c)} A ${n(c)} ${n(c)} 0 0 0 ${n(c)} 0 Z`
    );
  },
  bevel: (w, h, a) => bevelFrame(w, h, Math.min(w, h) * Math.min(av(a, 'adj', 12500), 0.5)),
  // 四角装饰片：无调节值，尺寸由对角线长度决定
  cornerTabs: tabs('q'),
  squareTabs: tabs('s'),
  plaqueTabs: tabs('c'),
  frame: (w, h, a) => {
    const t = Math.min(w, h) * Math.min(av(a, 'adj1', 12500), 0.5);
    return poly([[0, 0], [w, 0], [w, h], [0, h]]) + ' ' + poly([[t, t], [t, h - t], [w - t, h - t], [w - t, t]]);
  },
  halfFrame: (w, h, a) => {
    const t1 = Math.min(w, h) * av(a, 'adj1', 33333);
    const t2 = Math.min(w, h) * av(a, 'adj2', 33333);
    return poly([[0, 0], [w, 0], [w - t2, t1], [t2, t1], [t2, h - t1], [0, h]]);
  },
  corner: (w, h, a) => {
    const t1 = Math.min(w, h) * av(a, 'adj1', 50000);
    const t2 = Math.min(w, h) * av(a, 'adj2', 50000);
    return poly([[0, 0], [t2, 0], [t2, h - t1], [w, h - t1], [w, h], [0, h]]);
  },
  diagStripe: (w, h, a) => {
    const p = Math.min(av(a, 'adj', 50000), 1);
    return poly([[0, h * (1 - p)], [w * (1 - p), 0], [w, 0], [0, h]]);
  },
  foldedCorner: (w, h, a) => {
    const c = Math.min(w, h) * av(a, 'adj', 16667);
    return (
      poly([[0, 0], [w, 0], [w, h - c], [w - c, h], [0, h]]) +
      ` M ${n(w - c)} ${n(h)} L ${n(w - c * 0.72)} ${n(h - c * 0.72)} L ${n(w)} ${n(h - c)} Z`
    );
  },

  // 基本形
  ellipse: (w, h) => ell(w / 2, h / 2, w / 2, h / 2),
  triangle: (w, h, a) => poly([[w * av(a, 'adj', 50000), 0], [w, h], [0, h]]),
  rtTriangle: (w, h) => poly([[0, 0], [w, h], [0, h]]),
  diamond: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  parallelogram: (w, h, a) => {
    const sk = Math.min(w, Math.min(w, h) * av(a, 'adj', 25000));
    return poly([[sk, 0], [w, 0], [w - sk, h], [0, h]]);
  },
  trapezoid: (w, h, a) => {
    const i = Math.min(w / 2, Math.min(w, h) * av(a, 'adj', 25000));
    return poly([[i, 0], [w - i, 0], [w, h], [0, h]]);
  },
  nonIsoscelesTrapezoid: (w, h, a) =>
    poly([[w * av(a, 'adj1', 25000), 0], [w - w * av(a, 'adj2', 25000), 0], [w, h], [0, h]]),
  pentagon: regular(5, -90),
  heptagon: regular(7, -90),
  decagon: regular(10, -90),
  dodecagon: regular(12, -90),
  hexagon: (w, h, a) => {
    const i = Math.min(w / 2, Math.min(w, h) * av(a, 'adj', 25000));
    return poly([[i, 0], [w - i, 0], [w, h / 2], [w - i, h], [i, h], [0, h / 2]]);
  },
  octagon: (w, h, a) => {
    const c = Math.min(Math.min(w, h) / 2, Math.min(w, h) * av(a, 'adj', 29289));
    return poly([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]);
  },
  homePlate: (w, h, a) => {
    const x = Math.min(w, Math.min(w, h) * av(a, 'adj', 50000));
    return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h]]);
  },
  chevron: (w, h, a) => {
    const x = Math.min(w, Math.min(w, h) * av(a, 'adj', 50000));
    return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]);
  },
  plus: (w, h, a) => {
    const t = Math.min(w, h) * Math.min(av(a, 'adj', 25000), 0.5);
    return poly([
      [t, 0], [w - t, 0], [w - t, t], [w, t], [w, h - t], [w - t, h - t],
      [w - t, h], [t, h], [t, h - t], [0, h - t], [0, t], [t, t],
    ]);
  },
  teardrop: (w, h, a) => {
    // adj=0 时尾尖落在圆周 45° 点（正圆），adj=100000 时落在右上角
    const f = Math.max(0, av(a, 'adj', 100000));
    const k = Math.SQRT1_2 + f * (1 - Math.SQRT1_2);
    const cx = w / 2, cy = h / 2;
    return (
      `M 0 ${n(cy)} ${arcSeg(cx, cy, w / 2, h / 2, 180, 90)} ` +
      `L ${n(cx + (w / 2) * k)} ${n(cy - (h / 2) * k)} L ${n(w)} ${n(cy)} ` +
      `${arcSeg(cx, cy, w / 2, h / 2, 0, 180)} Z`
    );
  },
  can: (w, h, a) => {
    const ry = Math.min(h / 2, (h * av(a, 'adj', 25000)) / 2);
    return (
      `M 0 ${n(ry)} ${arcSeg(w / 2, ry, w / 2, ry, 180, 180)} L ${n(w)} ${n(h - ry)} ` +
      `${arcSeg(w / 2, h - ry, w / 2, ry, 0, 180)} Z ` + ellSeg(w / 2, ry, w / 2, ry)
    );
  },
  cube: (w, h, a) => {
    const t = Math.min(w, h) * Math.min(av(a, 'adj', 25000), 0.5);
    return (
      poly([[0, t], [t, 0], [w, 0], [w, h - t], [w - t, h], [0, h]]) +
      ' ' + seg([[0, t], [w - t, t], [w, 0]]) +
      ' ' + seg([[w - t, t], [w - t, h]])
    );
  },
  donut: (w, h, a) => {
    const t = Math.min(w, h) * Math.min(av(a, 'adj', 25000), 0.5);
    return ell(w / 2, h / 2, w / 2, h / 2) + ' ' + ell(w / 2, h / 2, w / 2 - t, h / 2 - t, true);
  },
  noSmoking: (w, h, a) => {
    const t = Math.min(w, h) * Math.min(av(a, 'adj', 18750), 0.5);
    const rx = w / 2 - t, ry = h / 2 - t;
    const cx = w / 2, cy = h / 2;
    const hw = t / 2;
    const dx = Math.cos(rad(-45)), dy = Math.sin(rad(-45));
    const px = -dy, py = dx;
    const [ax, ay] = [cx - dx * rx, cy - dy * ry];
    const [bx, by] = [cx + dx * rx, cy + dy * ry];
    const bar = poly([
      [ax + px * hw, ay + py * hw], [bx + px * hw, by + py * hw],
      [bx - px * hw, by - py * hw], [ax - px * hw, ay - py * hw],
    ]);
    return ell(cx, cy, w / 2, h / 2) + ' ' + ell(cx, cy, rx, ry, true) + ' ' + bar;
  },
  pie: (w, h, a) => {
    const st = ang(a, 'adj1', 0);
    const sweep = ((ang(a, 'adj2', 270 * 60000) - st) % 360 + 360) % 360;
    const [sx, sy] = ep(w / 2, h / 2, w / 2, h / 2, st);
    return `M ${n(w / 2)} ${n(h / 2)} L ${n(sx)} ${n(sy)} ${arcSeg(w / 2, h / 2, w / 2, h / 2, st, sweep)} Z`;
  },
  // 固定 90° 扇形：圆心在右下角，从 180° 顺时针扫到 270°
  pieWedge: (w, h) => `M 0 ${n(h)} ${arcSeg(w, h, w, h, 180, 90)} L ${n(w)} ${n(h)} Z`,
  chord: (w, h, a) => {
    const st = ang(a, 'adj1', 45 * 60000);
    const sweep = ((ang(a, 'adj2', 270 * 60000) - st) % 360 + 360) % 360;
    return arcFrom(w / 2, h / 2, w / 2, h / 2, st, sweep) + ' Z';
  },
  arc: (w, h, a) => {
    const st = ang(a, 'adj1', 270 * 60000);
    const sweep = ((ang(a, 'adj2', 0) - st) % 360 + 360) % 360;
    return open(arcFrom(w / 2, h / 2, w / 2, h / 2, st, sweep));
  },
  blockArc: (w, h, a) => {
    const st = ang(a, 'adj1', 180 * 60000);
    const sweep = ((ang(a, 'adj2', 0) - st) % 360 + 360) % 360;
    const t = Math.min(w, h) * Math.min(av(a, 'adj3', 25000), 0.5);
    const [ix, iy] = ep(w / 2, h / 2, w / 2 - t, h / 2 - t, st + sweep);
    return (
      arcFrom(w / 2, h / 2, w / 2, h / 2, st, sweep) +
      ` L ${n(ix)} ${n(iy)} ${arcSeg(w / 2, h / 2, w / 2 - t, h / 2 - t, st + sweep, -sweep)} Z`
    );
  },
  cloud: (w, h) => {
    // 单条闭合轮廓，避免重叠椭圆在 evenodd 下互相挖空
    const x = (v: number): number => v * w;
    const y = (v: number): number => v * h;
    const C = (a: number, b: number, c: number, d: number, e: number, f: number): string =>
      `C ${n(x(a))} ${n(y(b))} ${n(x(c))} ${n(y(d))} ${n(x(e))} ${n(y(f))} `;
    return (
      `M ${n(x(0.2))} ${n(y(0.79))} ` +
      C(0.06, 0.79, 0.0, 0.66, 0.07, 0.55) +
      C(0.0, 0.43, 0.1, 0.31, 0.22, 0.34) +
      C(0.25, 0.16, 0.44, 0.09, 0.56, 0.19) +
      C(0.65, 0.05, 0.86, 0.09, 0.88, 0.26) +
      C(1.0, 0.3, 1.01, 0.48, 0.92, 0.56) +
      C(1.0, 0.69, 0.9, 0.83, 0.76, 0.79) +
      C(0.68, 0.91, 0.5, 0.93, 0.42, 0.84) +
      C(0.36, 0.91, 0.25, 0.89, 0.2, 0.79) +
      'Z'
    );
  },
  heart: (w, h) => {
    const x = (v: number): number => v * w;
    const y = (v: number): number => v * h;
    return (
      `M ${n(x(0.5))} ${n(y(1))} ` +
      `C ${n(x(-0.06))} ${n(y(0.53))} ${n(x(0.08))} ${n(y(-0.11))} ${n(x(0.5))} ${n(y(0.25))} ` +
      `C ${n(x(0.92))} ${n(y(-0.11))} ${n(x(1.06))} ${n(y(0.53))} ${n(x(0.5))} ${n(y(1))} Z`
    );
  },
  lightningBolt: (w, h) =>
    poly(([[0.55, 0], [1, 0.55], [0.68, 0.55], [0.8, 1], [0, 0.42], [0.42, 0.42]] as Pt[]).map(([x, y]) => [x * w, y * h] as Pt)),
  sun: (w, h, a) => {
    const inner = Math.min(av(a, 'adj', 25000), 0.45);
    const rx = w / 2, ry = h / 2;
    const crx = rx * (1 - inner * 1.4), cry = ry * (1 - inner * 1.4);
    const rays: string[] = [];
    for (let i = 0; i < 8; i++) {
      const a0 = i * 45;
      const [x1, y1] = ep(rx, ry, crx, cry, a0 - 9);
      const [x2, y2] = ep(rx, ry, rx, ry, a0);
      const [x3, y3] = ep(rx, ry, crx, cry, a0 + 9);
      rays.push(`M ${n(x1)} ${n(y1)} L ${n(x2)} ${n(y2)} L ${n(x3)} ${n(y3)} Z`);
    }
    return ell(rx, ry, crx, cry) + ' ' + rays.join(' ');
  },
  moon: (w, h, a) => {
    const f = av(a, 'adj', 50000);
    return (
      `M ${n(w)} 0 C ${n(w * (1 - f * 1.6))} ${n(h * 0.15)} ${n(w * (1 - f * 1.6))} ${n(h * 0.85)} ${n(w)} ${n(h)} ` +
      `C ${n(w * 0.1)} ${n(h * 0.92)} ${n(w * 0.1)} ${n(h * 0.08)} ${n(w)} 0 Z`
    );
  },
  smileyFace: (w, h, a) => {
    const dy = h * av(a, 'adj', 4653) * 2;
    return (
      ell(w / 2, h / 2, w / 2, h / 2) + ' ' +
      ell(w * 0.32, h * 0.35, w * 0.055, h * 0.08, true) + ' ' +
      ell(w * 0.68, h * 0.35, w * 0.055, h * 0.08, true) +
      ` M ${n(w * 0.26)} ${n(h * 0.63)} Q ${n(w * 0.5)} ${n(h * 0.85 + dy)} ${n(w * 0.74)} ${n(h * 0.63)}` +
      ` Q ${n(w * 0.5)} ${n(h * 0.85 + dy)} ${n(w * 0.26)} ${n(h * 0.63)}`
    );
  },
  irregularSeal1: (w, h) =>
    poly(([[0.09, 0.28], [0.24, 0.35], [0.13, 0.09], [0.35, 0.26], [0.42, 0], [0.53, 0.24], [0.72, 0.06],
      [0.7, 0.31], [0.93, 0.24], [0.81, 0.45], [1, 0.53], [0.83, 0.64], [0.96, 0.83], [0.73, 0.79],
      [0.75, 1], [0.56, 0.86], [0.45, 1], [0.38, 0.83], [0.19, 0.94], [0.23, 0.72], [0, 0.75],
      [0.16, 0.58], [0, 0.45]] as Pt[]).map(([x, y]) => [x * w, y * h] as Pt)),
  irregularSeal2: (w, h) =>
    poly(([[0.11, 0.32], [0.25, 0.28], [0.15, 0.11], [0.36, 0.2], [0.4, 0.02], [0.55, 0.17], [0.68, 0],
      [0.71, 0.2], [0.9, 0.14], [0.85, 0.36], [1, 0.42], [0.86, 0.55], [0.98, 0.72], [0.79, 0.72],
      [0.82, 0.93], [0.63, 0.82], [0.55, 1], [0.44, 0.85], [0.28, 0.96], [0.28, 0.76], [0.06, 0.8],
      [0.17, 0.62], [0, 0.5]] as Pt[]).map(([x, y]) => [x * w, y * h] as Pt)),
  gear6: (w, h) => gear(w, h, 6),
  gear9: (w, h) => gear(w, h, 9),
  funnel: (w, h) => {
    const ry = h * 0.1;
    return (
      `M 0 ${n(ry)} ${arcSeg(w / 2, ry, w / 2, ry, 180, 180)} ` +
      `L ${n(w * 0.56)} ${n(h * 0.72)} L ${n(w * 0.56)} ${n(h)} L ${n(w * 0.44)} ${n(h)} L ${n(w * 0.44)} ${n(h * 0.72)} Z`
    );
  },

  // 星形
  star4: starFn(4, 0.3),
  star5: starFn(5, 0.382),
  star6: starFn(6, 0.577),
  star7: starFn(7, 0.605),
  star8: starFn(8, 0.375),
  star10: starFn(10, 0.618),
  star12: starFn(12, 0.5),
  star16: starFn(16, 0.375),
  star24: starFn(24, 0.375),
  star32: starFn(32, 0.375),

  // 箭头
  rightArrow: arrow('r'),
  leftArrow: arrow('l'),
  upArrow: arrow('u'),
  downArrow: arrow('d'),
  leftRightArrow: (w, h, a) => {
    const shaft = (h * Math.min(av(a, 'adj1', 50000), 1)) / 2;
    const head = Math.min(w / 2, h * av(a, 'adj2', 50000));
    const c = h / 2;
    return poly([
      [0, c], [head, 0], [head, c - shaft], [w - head, c - shaft], [w - head, 0],
      [w, c], [w - head, h], [w - head, c + shaft], [head, c + shaft], [head, h],
    ]);
  },
  upDownArrow: (w, h, a) => {
    const shaft = (w * Math.min(av(a, 'adj1', 50000), 1)) / 2;
    const head = Math.min(h / 2, w * av(a, 'adj2', 50000));
    const c = w / 2;
    return poly([
      [c, 0], [w, head], [c + shaft, head], [c + shaft, h - head], [w, h - head],
      [c, h], [0, h - head], [c - shaft, h - head], [c - shaft, head], [0, head],
    ]);
  },
  quadArrow: (w, h, a) => {
    const s = (Math.min(w, h) * av(a, 'adj2', 22500)) / 2;
    const head = Math.min(w, h) * av(a, 'adj3', 25000);
    const cx = w / 2, cy = h / 2;
    return poly([
      [cx, 0], [cx + head, head], [cx + s, head], [cx + s, cy - s], [w - head, cy - s], [w - head, cy - head],
      [w, cy], [w - head, cy + head], [w - head, cy + s], [cx + s, cy + s], [cx + s, h - head], [cx + head, h - head],
      [cx, h], [cx - head, h - head], [cx - s, h - head], [cx - s, cy + s], [head, cy + s], [head, cy + head],
      [0, cy], [head, cy - head], [head, cy - s], [cx - s, cy - s], [cx - s, head], [cx - head, head],
    ]);
  },
  leftRightUpArrow: (w, h, a) => {
    const s = (Math.min(w, h) * av(a, 'adj2', 22500)) / 2;
    const head = Math.min(w, h) * av(a, 'adj3', 25000);
    const cx = w / 2;
    const yc = h - s;
    return poly([
      [cx, 0], [cx + head, head], [cx + s, head], [cx + s, yc - s], [w - head, yc - s], [w - head, yc - head],
      [w, yc], [w - head, yc + head], [w - head, h], [head, h], [head, yc + head], [0, yc],
      [head, yc - head], [head, yc - s], [cx - s, yc - s], [cx - s, head], [cx - head, head],
    ]);
  },
  bentUpArrow: (w, h, a) => {
    const t = Math.min(w, h) * Math.min(av(a, 'adj3', 25000), 0.6);
    // 箭头半宽必须大于杆半厚，否则箭头缩进杆里，路径自交
    const aw = Math.min(w / 2, Math.max(Math.min(w, h) * av(a, 'adj1', 25000), t * 0.6));
    const ah = Math.min(h, Math.min(w, h) * av(a, 'adj2', 25000));
    const cx = w - aw;
    return poly([
      [0, h], [cx + t / 2, h], [cx + t / 2, ah], [w, ah], [cx, 0], [cx - aw, ah],
      [cx - t / 2, ah], [cx - t / 2, h - t], [0, h - t],
    ]);
  },
  leftUpArrow: (w, h, a) => {
    const ss = Math.min(w, h);
    const t = ss * Math.min(av(a, 'adj1', 25000), 0.6);
    const aw = Math.min(ss / 2, Math.max(ss * av(a, 'adj2', 25000), t * 0.6));
    const ah = Math.min(ss, ss * av(a, 'adj3', 25000));
    return poly([
      [w - aw, 0], [w, ah], [w - aw + t / 2, ah], [w - aw + t / 2, h], [ah, h], [0, h - aw],
      [ah, h - 2 * aw], [ah, h - aw - t / 2], [w - aw - t / 2, h - aw - t / 2],
      [w - aw - t / 2, ah], [w - 2 * aw, ah],
    ]);
  },
  bentArrow: (w, h, a) => {
    const t = Math.min(w, h) * av(a, 'adj1', 25000);
    const head = Math.min(Math.min(w, h) * av(a, 'adj2', 25000), h / 2);
    const yc = head;
    return poly([
      [0, h], [0, yc - t / 2], [w - head, yc - t / 2], [w - head, yc - head], [w, yc],
      [w - head, yc + head], [w - head, yc + t / 2], [t, yc + t / 2], [t, h],
    ]);
  },
  uturnArrow: (w, h, a) => {
    const t = Math.min(w / 3, w * Math.max(av(a, 'adj1', 25000), 0.08));
    const ts = t / 2;
    const hw = Math.min(t * 1.1, w / 4);
    const headLen = Math.min(h / 3, hw * 1.6);
    const cxR = w - hw;
    const cx = (cxR + ts) / 2;
    const ry = Math.min(cx, h - headLen - 4);
    return (
      `M 0 ${n(h)} L 0 ${n(ry)} ` +
      `A ${n(cx)} ${n(ry)} 0 0 1 ${n(cx * 2)} ${n(ry)} ` +
      `L ${n(cxR + ts)} ${n(h - headLen)} L ${n(cxR + hw)} ${n(h - headLen)} ` +
      `L ${n(cxR)} ${n(h)} L ${n(cxR - hw)} ${n(h - headLen)} L ${n(cxR - ts)} ${n(h - headLen)} ` +
      `L ${n(cxR - ts)} ${n(ry)} ` +
      `A ${n(cx - t)} ${n(ry - t)} 0 0 0 ${n(t)} ${n(ry)} L ${n(t)} ${n(h)} Z`
    );
  },
  curvedRightArrow: (w, h, a) => {
    const t = h * Math.min(av(a, 'adj1', 25000), 0.5);
    const head = Math.min(w, h) * Math.min(av(a, 'adj3', 25000), 0.4);
    return curvedArrow(0, h, w - head, h - head, t, head, 270, 360);
  },
  curvedLeftArrow: (w, h, a) => {
    const t = h * Math.min(av(a, 'adj1', 25000), 0.5);
    const head = Math.min(w, h) * Math.min(av(a, 'adj3', 25000), 0.4);
    return curvedArrow(w, h, w - head, h - head, t, head, 270, 180);
  },
  curvedUpArrow: (w, h, a) => {
    const t = w * Math.min(av(a, 'adj1', 25000), 0.5);
    const head = Math.min(w, h) * Math.min(av(a, 'adj3', 25000), 0.4);
    return curvedArrow(w, h, w - head, h - head, t, head, 180, 270);
  },
  curvedDownArrow: (w, h, a) => {
    const t = w * Math.min(av(a, 'adj1', 25000), 0.5);
    const head = Math.min(w, h) * Math.min(av(a, 'adj3', 25000), 0.4);
    return curvedArrow(w, 0, w - head, h - head, t, head, 180, 90);
  },
  stripedRightArrow: (w, h, a) => {
    const shaft = (h * Math.min(av(a, 'adj1', 50000), 1)) / 2;
    const head = Math.min(w, h * av(a, 'adj2', 50000));
    const c = h / 2;
    const s = w * 0.05;
    return (
      poly([[s * 2.4, c - shaft], [w - head, c - shaft], [w - head, 0], [w, c], [w - head, h], [w - head, c + shaft], [s * 2.4, c + shaft]]) +
      ' ' + poly([[0, c - shaft], [s, c - shaft], [s, c + shaft], [0, c + shaft]]) +
      ' ' + poly([[s * 1.4, c - shaft], [s * 2, c - shaft], [s * 2, c + shaft], [s * 1.4, c + shaft]])
    );
  },
  notchedRightArrow: (w, h, a) => {
    const shaft = (h * Math.min(av(a, 'adj1', 50000), 1)) / 2;
    const head = Math.min(w, h * av(a, 'adj2', 50000));
    const c = h / 2;
    return poly([
      [0, c - shaft], [w - head, c - shaft], [w - head, 0], [w, c], [w - head, h],
      [w - head, c + shaft], [0, c + shaft], [head * 0.5, c],
    ]);
  },
  circularArrow: (w, h, a) => {
    // 用正圆环，避免宽高比失衡时箭头畸变
    const rad0 = Math.min(w, h) / 2;
    const t = rad0 * Math.min(Math.max(av(a, 'adj1', 12500), 0.06), 0.35);
    const head = t * 1.6;
    const rOut = rad0 - head;
    return curvedArrow(w / 2, h / 2, rOut, rOut, t, head, 200, 450);
  },
  leftCircularArrow: (w, h, a) => {
    // circularArrow 的水平镜像：角度按 180-θ 映射，扫掠方向随之反转
    const rad0 = Math.min(w, h) / 2;
    const t = rad0 * Math.min(Math.max(av(a, 'adj1', 12500), 0.06), 0.35);
    const head = t * 1.6;
    return curvedArrow(w / 2, h / 2, rad0 - head, rad0 - head, t, head, -20, -270);
  },
  leftRightCircularArrow: (w, h, a) => {
    const rad0 = Math.min(w, h) / 2;
    const t = rad0 * Math.min(Math.max(av(a, 'adj1', 12500), 0.06), 0.35);
    const head = t * 1.6;
    return curvedArrow(w / 2, h / 2, rad0 - head, rad0 - head, t, head, 200, 430, true);
  },
  swooshArrow: (w, h, a) => {
    // 甩尾箭头：外缘与内缘两条二次曲线共用尾点，天然收成尖尾
    const ss = Math.min(w, h);
    const t = ss * Math.min(Math.max(av(a, 'adj2', 16667), 0.04), 0.4);
    const head = ss * Math.min(Math.max(av(a, 'adj1', 25000), 0.08), 0.6);
    const k = t * 1.6;
    return (
      `M 0 ${n(h)} Q ${n(w * 0.65)} ${n(h * 0.95)} ${n(w - head * 1.2)} ${n(head * 0.1)} ` +
      `L ${n(w)} 0 L ${n(w - head * 0.1)} ${n(head * 1.2)} ` +
      `Q ${n(w * 0.65 - k)} ${n(h * 0.95 - k)} 0 ${n(h)} Z`
    );
  },
  rightArrowCallout: arrowCallout('r'),
  leftArrowCallout: arrowCallout('l'),
  upArrowCallout: arrowCallout('u'),
  downArrowCallout: arrowCallout('d'),
  leftRightArrowCallout: (w, h, a) => {
    const shaft = (h * av(a, 'adj1', 18515)) / 2;
    const head = Math.min(w / 3, h * av(a, 'adj2', 18515));
    const box = w * av(a, 'adj4', 48123);
    const c = h / 2;
    const bx1 = (w - box) / 2, bx2 = (w + box) / 2;
    return poly([
      [0, c], [head, 0], [head, c - shaft], [bx1, c - shaft], [bx1, 0], [bx2, 0], [bx2, c - shaft],
      [w - head, c - shaft], [w - head, 0], [w, c], [w - head, h], [w - head, c + shaft],
      [bx2, c + shaft], [bx2, h], [bx1, h], [bx1, c + shaft], [head, c + shaft], [head, h],
    ]);
  },

  upDownArrowCallout: (w, h, a) => {
    const shaft = (w * av(a, 'adj1', 18515)) / 2;
    const hw = Math.min(w / 2, shaft + w * av(a, 'adj2', 18515));
    const head = Math.min(h * 0.3, w * av(a, 'adj3', 18515));
    // 文本框横贯整宽，但不能盖住箭头根部，否则上下两截退化成一条直边
    const box = Math.max(0, Math.min(h * av(a, 'adj4', 48123), h - 2.4 * head));
    const c = w / 2;
    const by1 = (h - box) / 2, by2 = (h + box) / 2;
    return poly([
      [c, 0], [c + hw, head], [c + shaft, head], [c + shaft, by1], [w, by1], [w, by2],
      [c + shaft, by2], [c + shaft, h - head], [c + hw, h - head], [c, h],
      [c - hw, h - head], [c - shaft, h - head], [c - shaft, by2], [0, by2], [0, by1],
      [c - shaft, by1], [c - shaft, head], [c - hw, head],
    ]);
  },
  quadArrowCallout: (w, h, a) => {
    const ss = Math.min(w, h);
    const head = ss * av(a, 'adj3', 18515);
    const s2 = (ss * av(a, 'adj2', 18515)) / 2;
    // 中央方框必须包住箭杆又不能吃掉箭头，否则四条臂消失
    const box = Math.min(Math.max((ss * av(a, 'adj4', 48123)) / 2, s2 * 1.2), ss / 2 - head);
    const cx = w / 2, cy = h / 2;
    return poly([
      [cx, 0], [cx + head, head], [cx + s2, head], [cx + s2, cy - box], [cx + box, cy - box],
      [cx + box, cy - s2], [w - head, cy - s2], [w - head, cy - head], [w, cy],
      [w - head, cy + head], [w - head, cy + s2], [cx + box, cy + s2], [cx + box, cy + box],
      [cx + s2, cy + box], [cx + s2, h - head], [cx + head, h - head], [cx, h],
      [cx - head, h - head], [cx - s2, h - head], [cx - s2, cy + box], [cx - box, cy + box],
      [cx - box, cy + s2], [head, cy + s2], [head, cy + head], [0, cy],
      [head, cy - head], [head, cy - s2], [cx - box, cy - s2], [cx - box, cy - box],
      [cx - s2, cy - box], [cx - s2, head], [cx - head, head],
    ]);
  },

  // 数学符号
  mathPlus: (w, h, a) => {
    const t = (Math.min(w, h) * av(a, 'adj1', 23520)) / 2;
    const cx = w / 2, cy = h / 2;
    const ax = w * 0.45, ay = h * 0.45;
    return poly([
      [cx - t, cy - ay], [cx + t, cy - ay], [cx + t, cy - t], [cx + ax, cy - t], [cx + ax, cy + t],
      [cx + t, cy + t], [cx + t, cy + ay], [cx - t, cy + ay], [cx - t, cy + t], [cx - ax, cy + t],
      [cx - ax, cy - t], [cx - t, cy - t],
    ]);
  },
  mathMinus: (w, h, a) => {
    const t = (Math.min(w, h) * av(a, 'adj1', 23520)) / 2;
    return poly([[w * 0.05, h / 2 - t], [w * 0.95, h / 2 - t], [w * 0.95, h / 2 + t], [w * 0.05, h / 2 + t]]);
  },
  mathMultiply: (w, h, a) => {
    const t = (Math.min(w, h) * av(a, 'adj1', 23520)) / 2;
    const cx = w / 2, cy = h / 2;
    const d = Math.min(w, h) * 0.42;
    const k = t * Math.SQRT2;
    return poly([
      [cx - d, cy - d + k], [cx - d + k, cy - d], [cx, cy - k], [cx + d - k, cy - d], [cx + d, cy - d + k],
      [cx + k, cy], [cx + d, cy + d - k], [cx + d - k, cy + d], [cx, cy + k], [cx - d + k, cy + d],
      [cx - d, cy + d - k], [cx - k, cy],
    ]);
  },
  mathDivide: (w, h, a) => {
    const t = (Math.min(w, h) * av(a, 'adj1', 23520)) / 2;
    const r = Math.min(w, h) * 0.09;
    return (
      poly([[w * 0.08, h / 2 - t], [w * 0.92, h / 2 - t], [w * 0.92, h / 2 + t], [w * 0.08, h / 2 + t]]) +
      ' ' + ell(w / 2, h * 0.22, r, r) + ' ' + ell(w / 2, h * 0.78, r, r)
    );
  },
  mathEqual: (w, h, a) => {
    const t = (Math.min(w, h) * av(a, 'adj1', 23520)) / 2;
    const gap = h * av(a, 'adj2', 11760);
    return (
      poly([[w * 0.05, h / 2 - gap - t], [w * 0.95, h / 2 - gap - t], [w * 0.95, h / 2 - gap + t], [w * 0.05, h / 2 - gap + t]]) +
      ' ' + poly([[w * 0.05, h / 2 + gap - t], [w * 0.95, h / 2 + gap - t], [w * 0.95, h / 2 + gap + t], [w * 0.05, h / 2 + gap + t]])
    );
  },
  mathNotEqual: (w, h, a) => {
    const t = (Math.min(w, h) * av(a, 'adj1', 23520)) / 2;
    const gap = h * 0.16;
    return (
      poly([[w * 0.05, h / 2 - gap - t], [w * 0.95, h / 2 - gap - t], [w * 0.95, h / 2 - gap + t], [w * 0.05, h / 2 - gap + t]]) +
      ' ' + poly([[w * 0.05, h / 2 + gap - t], [w * 0.95, h / 2 + gap - t], [w * 0.95, h / 2 + gap + t], [w * 0.05, h / 2 + gap + t]]) +
      ' ' + poly([[w * 0.42, 0], [w * 0.56, 0], [w * 0.62, h], [w * 0.48, h]])
    );
  },

  // 括号
  leftBracket: (w, h, a) => {
    const c = Math.min(h / 2, h * av(a, 'adj', 8333));
    return open(`M ${n(w)} 0 L ${n(c)} 0 A ${n(c)} ${n(c)} 0 0 0 0 ${n(c)} L 0 ${n(h - c)} A ${n(c)} ${n(c)} 0 0 0 ${n(c)} ${n(h)} L ${n(w)} ${n(h)}`);
  },
  rightBracket: (w, h, a) => {
    const c = Math.min(h / 2, h * av(a, 'adj', 8333));
    return open(`M 0 0 L ${n(w - c)} 0 A ${n(c)} ${n(c)} 0 0 1 ${n(w)} ${n(c)} L ${n(w)} ${n(h - c)} A ${n(c)} ${n(c)} 0 0 1 ${n(w - c)} ${n(h)} L 0 ${n(h)}`);
  },
  bracketPair: (w, h, a) => {
    const c = Math.min(Math.min(w, h) / 2, Math.min(w, h) * av(a, 'adj', 16667));
    return open(
      `M ${n(c)} 0 A ${n(c)} ${n(c)} 0 0 0 0 ${n(c)} L 0 ${n(h - c)} A ${n(c)} ${n(c)} 0 0 0 ${n(c)} ${n(h)} ` +
      `M ${n(w - c)} 0 A ${n(c)} ${n(c)} 0 0 1 ${n(w)} ${n(c)} L ${n(w)} ${n(h - c)} A ${n(c)} ${n(c)} 0 0 1 ${n(w - c)} ${n(h)}`,
    );
  },
  leftBrace: (w, h, a) => {
    const c = Math.min(h / 4, h * av(a, 'adj1', 8333));
    const mid = h * av(a, 'adj2', 50000);
    return open(
      `M ${n(w)} 0 A ${n(w)} ${n(c)} 0 0 0 ${n(w / 2)} ${n(c)} L ${n(w / 2)} ${n(mid - c)} ` +
      `A ${n(w / 2)} ${n(c)} 0 0 1 0 ${n(mid)} A ${n(w / 2)} ${n(c)} 0 0 1 ${n(w / 2)} ${n(mid + c)} ` +
      `L ${n(w / 2)} ${n(h - c)} A ${n(w)} ${n(c)} 0 0 0 ${n(w)} ${n(h)}`,
    );
  },
  rightBrace: (w, h, a) => {
    const c = Math.min(h / 4, h * av(a, 'adj1', 8333));
    const mid = h * av(a, 'adj2', 50000);
    return open(
      `M 0 0 A ${n(w)} ${n(c)} 0 0 1 ${n(w / 2)} ${n(c)} L ${n(w / 2)} ${n(mid - c)} ` +
      `A ${n(w / 2)} ${n(c)} 0 0 0 ${n(w)} ${n(mid)} A ${n(w / 2)} ${n(c)} 0 0 0 ${n(w / 2)} ${n(mid + c)} ` +
      `L ${n(w / 2)} ${n(h - c)} A ${n(w)} ${n(c)} 0 0 1 0 ${n(h)}`,
    );
  },
  bracePair: (w, h, a) => {
    const c = Math.min(h / 4, h * av(a, 'adj', 8333));
    const q = w / 4;
    return open(
      `M ${n(q)} 0 A ${n(q)} ${n(c)} 0 0 0 ${n(q)} ${n(c)} L ${n(q)} ${n(h / 2 - c)} A ${n(q)} ${n(c)} 0 0 1 0 ${n(h / 2)} ` +
      `A ${n(q)} ${n(c)} 0 0 1 ${n(q)} ${n(h / 2 + c)} L ${n(q)} ${n(h - c)} A ${n(q)} ${n(c)} 0 0 0 ${n(q)} ${n(h)} ` +
      `M ${n(w - q)} 0 A ${n(q)} ${n(c)} 0 0 1 ${n(w - q)} ${n(c)} L ${n(w - q)} ${n(h / 2 - c)} A ${n(q)} ${n(c)} 0 0 0 ${n(w)} ${n(h / 2)} ` +
      `A ${n(q)} ${n(c)} 0 0 0 ${n(w - q)} ${n(h / 2 + c)} L ${n(w - q)} ${n(h - c)} A ${n(q)} ${n(c)} 0 0 1 ${n(w - q)} ${n(h)}`,
    );
  },

  // 缎带 / 卷轴 / 波浪
  ribbon: (w, h, a) => {
    const t = h * av(a, 'adj1', 16667);
    const wing = (w * av(a, 'adj2', 50000)) / 2;
    const cx = w / 2;
    const left: Pt[] = [[0, 0], [cx - wing, 0], [cx - wing + t, h * 0.5], [cx - wing, h], [0, h], [t, h * 0.5]];
    const right: Pt[] = [[w, 0], [cx + wing, 0], [cx + wing - t, h * 0.5], [cx + wing, h], [w, h], [w - t, h * 0.5]];
    const mid: Pt[] = [[cx - wing, 0], [cx + wing, 0], [cx + wing, h], [cx - wing, h]];
    return poly(left) + ' ' + poly(right) + ' ' + poly(mid);
  },
  ribbon2: (w, h, a) => {
    const t = h * av(a, 'adj1', 16667);
    const wing = (w * av(a, 'adj2', 50000)) / 2;
    const cx = w / 2;
    const mid: Pt[] = [[cx - wing, h], [cx + wing, h], [cx + wing, 0], [cx - wing, 0]];
    const left: Pt[] = [[0, h], [cx - wing, h], [cx - wing + t, h * 0.5], [cx - wing, 0], [0, 0], [t, h * 0.5]];
    const right: Pt[] = [[w, h], [cx + wing, h], [cx + wing - t, h * 0.5], [cx + wing, 0], [w, 0], [w - t, h * 0.5]];
    return poly(mid) + ' ' + poly(left) + ' ' + poly(right);
  },
  ellipseRibbon: (w, h, a) => {
    // 弧形缎带：主带两端下沉 sag，两侧尾翼垂到底边并开 V 口
    const t = h * Math.min(av(a, 'adj3', 12500) * 2, 0.5);
    const sag = h * Math.min(av(a, 'adj1', 25000), 0.35);
    const ww = w * Math.min(av(a, 'adj2', 50000) / 2, 0.3);
    const notch = h * 0.12;
    const band =
      `M 0 ${n(sag)} Q ${n(w / 2)} ${n(-sag)} ${n(w)} ${n(sag)} ` +
      `L ${n(w)} ${n(sag + t)} Q ${n(w / 2)} ${n(t - sag)} 0 ${n(sag + t)} Z`;
    const tail = (x0: number): string =>
      poly([[x0, sag + t * 0.2], [x0 + ww, sag + t * 0.2], [x0 + ww, h], [x0 + ww / 2, h - notch], [x0, h]]);
    return `${band} ${tail(0)} ${tail(w - ww)}`;
  },
  ellipseRibbon2: (w, h, a) => {
    // ellipseRibbon 的垂直镜像
    const t = h * Math.min(av(a, 'adj3', 12500) * 2, 0.5);
    const sag = h * Math.min(av(a, 'adj1', 25000), 0.35);
    const ww = w * Math.min(av(a, 'adj2', 50000) / 2, 0.3);
    const notch = h * 0.12;
    const band =
      `M 0 ${n(h - sag)} Q ${n(w / 2)} ${n(h + sag)} ${n(w)} ${n(h - sag)} ` +
      `L ${n(w)} ${n(h - sag - t)} Q ${n(w / 2)} ${n(h + sag - t)} 0 ${n(h - sag - t)} Z`;
    const tail = (x0: number): string =>
      poly([[x0, h - sag - t * 0.2], [x0 + ww, h - sag - t * 0.2], [x0 + ww, 0], [x0 + ww / 2, notch], [x0, 0]]);
    return `${band} ${tail(0)} ${tail(w - ww)}`;
  },
  leftRightRibbon: (w, h, a) => {
    // 中央块 + 两端箭头臂；箭头外翻量取 s，故 s 上限为 h/4
    const s = Math.min((h * Math.min(av(a, 'adj1', 50000), 1)) / 2, h / 4);
    const cw = (w * Math.min(av(a, 'adj2', 50000), 0.9)) / 2;
    // 箭头只能占臂长的一部分，否则中央块与箭头贴死、看不出是缎带
    const head = Math.min((w / 2 - cw) * 0.6, Math.max(h * av(a, 'adj3', 16667) * 2, 1));
    // 箭头外翻量必须小于中央块高度，否则两者顶边齐平、整体并成一个六边形
    const fl = s * 1.8;
    const cx = w / 2, cy = h / 2;
    return poly([
      [0, cy], [head, cy - fl], [head, cy - s], [cx - cw, cy - s], [cx - cw, 0], [cx + cw, 0],
      [cx + cw, cy - s], [w - head, cy - s], [w - head, cy - fl], [w, cy],
      [w - head, cy + fl], [w - head, cy + s], [cx + cw, cy + s], [cx + cw, h], [cx - cw, h],
      [cx - cw, cy + s], [head, cy + s], [head, cy + fl],
    ]);
  },
  verticalScroll: (w, h, a) => {
    const t = Math.min(w, h) * Math.min(av(a, 'adj', 12500), 0.25);
    return (
      `M ${n(t)} ${n(t)} L ${n(t)} ${n(h - t)} A ${n(t)} ${n(t)} 0 0 0 ${n(t * 2)} ${n(h)} L ${n(w)} ${n(h)} ` +
      `L ${n(w)} ${n(t)} A ${n(t)} ${n(t)} 0 0 0 ${n(w - t * 2)} ${n(t)} Z ` +
      `M ${n(t)} ${n(t)} A ${n(t)} ${n(t)} 0 0 1 ${n(t * 2)} 0 L ${n(w - t)} 0 A ${n(t)} ${n(t)} 0 0 1 ${n(w - t * 2)} ${n(t)} Z`
    );
  },
  horizontalScroll: (w, h, a) => {
    const t = Math.min(w, h) * Math.min(av(a, 'adj', 12500), 0.25);
    return (
      `M ${n(t)} ${n(t)} L ${n(w - t)} ${n(t)} A ${n(t)} ${n(t)} 0 0 1 ${n(w)} ${n(t * 2)} L ${n(w)} ${n(h)} ` +
      `L ${n(t * 2)} ${n(h)} A ${n(t)} ${n(t)} 0 0 1 ${n(t)} ${n(h - t * 2)} Z ` +
      `M ${n(t)} ${n(t)} A ${n(t)} ${n(t)} 0 0 0 0 ${n(t * 2)} L 0 ${n(h - t)} A ${n(t)} ${n(t)} 0 0 0 ${n(t)} ${n(h - t * 2)} Z`
    );
  },
  wave: (w, h, a) => {
    const amp = h * Math.min(av(a, 'adj1', 12500), 0.4);
    return `M 0 ${n(amp)} ${waveEdge(amp, w, amp, false)} L ${n(w)} ${n(h - amp)} ${waveEdge(h - amp, w, amp, true)} Z`;
  },
  doubleWave: (w, h, a) => {
    const amp = h * Math.min(av(a, 'adj1', 6250), 0.25);
    const q = w / 8;
    const top =
      `C ${n(q)} ${n(amp - amp * 2)} ${n(q * 3)} ${n(amp + amp * 2)} ${n(w / 2)} ${n(amp)} ` +
      `C ${n(w / 2 + q)} ${n(amp - amp * 2)} ${n(w / 2 + q * 3)} ${n(amp + amp * 2)} ${n(w)} ${n(amp)}`;
    const bot =
      `C ${n(w - q)} ${n(h - amp + amp * 2)} ${n(w - q * 3)} ${n(h - amp - amp * 2)} ${n(w / 2)} ${n(h - amp)} ` +
      `C ${n(w / 2 - q)} ${n(h - amp + amp * 2)} ${n(w / 2 - q * 3)} ${n(h - amp - amp * 2)} 0 ${n(h - amp)}`;
    return `M 0 ${n(amp)} ${top} L ${n(w)} ${n(h - amp)} ${bot} Z`;
  },

  // 标注
  wedgeRectCallout: (w, h, a) => {
    const [tx, ty] = wedgeTail(w, h, a);
    return poly([[0, 0], [w, 0], [w, h], [w * 0.6, h], [tx, ty], [w * 0.4, h], [0, h]]);
  },
  wedgeRoundRectCallout: (w, h, a) => {
    const [tx, ty] = wedgeTail(w, h, a);
    const c = Math.min(w, h) * 0.1667;
    return (
      `M ${n(c)} 0 L ${n(w - c)} 0 A ${n(c)} ${n(c)} 0 0 1 ${n(w)} ${n(c)} L ${n(w)} ${n(h - c)} ` +
      `A ${n(c)} ${n(c)} 0 0 1 ${n(w - c)} ${n(h)} L ${n(w * 0.6)} ${n(h)} L ${n(tx)} ${n(ty)} L ${n(w * 0.4)} ${n(h)} ` +
      `L ${n(c)} ${n(h)} A ${n(c)} ${n(c)} 0 0 1 0 ${n(h - c)} L 0 ${n(c)} A ${n(c)} ${n(c)} 0 0 1 ${n(c)} 0 Z`
    );
  },
  wedgeEllipseCallout: (w, h, a) => {
    const [tx, ty] = wedgeTail(w, h, a);
    const cx = w / 2, cy = h / 2;
    const deg = (Math.atan2(ty - cy, tx - cx) * 180) / Math.PI;
    const [p2x, p2y] = ep(cx, cy, w / 2, h / 2, deg + 8);
    return `M ${n(p2x)} ${n(p2y)} ${arcSeg(cx, cy, w / 2, h / 2, deg + 8, 344)} L ${n(tx)} ${n(ty)} Z`;
  },
  cloudCallout: (w, h, a) => {
    const [tx, ty] = wedgeTail(w, h, a);
    const cloud = (PRESETS.cloud as PathFn)(w, h * 0.8, {}) as string;
    return cloud + ' ' + ell(w * 0.36, h * 0.88, w * 0.045, h * 0.045) + ' ' + ell(tx, ty, w * 0.025, h * 0.025);
  },
  borderCallout1: callout(1, false),
  borderCallout2: callout(2, false),
  borderCallout3: callout(3, false),
  callout1: callout(1, false),
  callout2: callout(2, false),
  callout3: callout(3, false),
  accentCallout1: callout(1, true),
  accentCallout2: callout(2, true),
  accentCallout3: callout(3, true),
  accentBorderCallout1: callout(1, true),
  accentBorderCallout2: callout(2, true),
  accentBorderCallout3: callout(3, true),

  // 流程图
  flowChartProcess: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]),
  flowChartAlternateProcess: (w, h) => {
    const r = Math.min(w, h) * 0.1667;
    return shapedRect(w, h, [r, r, r, r], ['r', 'r', 'r', 'r']);
  },
  flowChartDecision: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  flowChartInputOutput: (w, h) => poly([[w * 0.2, 0], [w, 0], [w * 0.8, h], [0, h]]),
  flowChartPredefinedProcess: (w, h) =>
    poly([[0, 0], [w, 0], [w, h], [0, h]]) +
    ' ' + seg([[w / 8, 0], [w / 8, h]]) + ' ' + seg([[(w * 7) / 8, 0], [(w * 7) / 8, h]]),
  flowChartInternalStorage: (w, h) =>
    poly([[0, 0], [w, 0], [w, h], [0, h]]) +
    ' ' + seg([[w / 8, 0], [w / 8, h]]) + ' ' + seg([[0, h / 8], [w, h / 8]]),
  flowChartDocument: (w, h) =>
    `M 0 0 L ${n(w)} 0 L ${n(w)} ${n(h * 0.84)} C ${n(w * 0.75)} ${n(h * 1.06)} ${n(w * 0.25)} ${n(h * 0.62)} 0 ${n(h * 0.84)} Z`,
  flowChartMultidocument: (w, h) =>
    `M 0 ${n(h * 0.2)} L ${n(w * 0.9)} ${n(h * 0.2)} L ${n(w * 0.9)} ${n(h * 0.86)} ` +
    `C ${n(w * 0.68)} ${n(h * 1.04)} ${n(w * 0.22)} ${n(h * 0.66)} 0 ${n(h * 0.86)} Z ` +
    seg([[w * 0.05, h * 0.1], [w * 0.95, h * 0.1], [w * 0.95, h * 0.76]]) +
    ' ' + seg([[w * 0.1, 0], [w, 0], [w, h * 0.66]]),
  flowChartTerminator: (w, h) => {
    const r = Math.min(h / 2, w / 2);
    return `M ${n(r)} 0 L ${n(w - r)} 0 A ${n(r)} ${n(h / 2)} 0 0 1 ${n(w - r)} ${n(h)} L ${n(r)} ${n(h)} A ${n(r)} ${n(h / 2)} 0 0 1 ${n(r)} 0 Z`;
  },
  flowChartPreparation: (w, h) => poly([[w * 0.2, 0], [w * 0.8, 0], [w, h / 2], [w * 0.8, h], [w * 0.2, h], [0, h / 2]]),
  flowChartManualInput: (w, h) => poly([[0, h * 0.2], [w, 0], [w, h], [0, h]]),
  flowChartManualOperation: (w, h) => poly([[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]),
  flowChartConnector: (w, h) => ell(w / 2, h / 2, w / 2, h / 2),
  flowChartOffpageConnector: (w, h) => poly([[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]]),
  flowChartPunchedCard: (w, h) => poly([[w * 0.2, 0], [w, 0], [w, h], [0, h], [0, h * 0.2]]),
  flowChartPunchedTape: (w, h) =>
    `M 0 ${n(h * 0.11)} ${waveEdge(h * 0.11, w, h * 0.11, false)} L ${n(w)} ${n(h * 0.89)} ${waveEdge(h * 0.89, w, h * 0.11, true)} Z`,
  flowChartSummingJunction: (w, h) => {
    const k = 0.1464;
    return (
      ell(w / 2, h / 2, w / 2, h / 2) +
      ' ' + seg([[w * k, h * k], [w * (1 - k), h * (1 - k)]]) +
      ' ' + seg([[w * (1 - k), h * k], [w * k, h * (1 - k)]])
    );
  },
  flowChartOr: (w, h) =>
    ell(w / 2, h / 2, w / 2, h / 2) +
    ' ' + seg([[w / 2, 0], [w / 2, h]]) + ' ' + seg([[0, h / 2], [w, h / 2]]),
  flowChartCollate: (w, h) => poly([[0, 0], [w, 0], [w / 2, h / 2], [w, h], [0, h], [w / 2, h / 2]]),
  flowChartSort: (w, h) =>
    poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) + ' ' + seg([[0, h / 2], [w, h / 2]]),
  flowChartExtract: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]),
  flowChartMerge: (w, h) => poly([[0, 0], [w, 0], [w / 2, h]]),
  flowChartOnlineStorage: (w, h) =>
    `M ${n(w * 0.16)} 0 L ${n(w)} 0 A ${n(w * 0.16)} ${n(h / 2)} 0 0 0 ${n(w)} ${n(h)} L ${n(w * 0.16)} ${n(h)} ` +
    `A ${n(w * 0.16)} ${n(h / 2)} 0 0 1 ${n(w * 0.16)} 0 Z`,
  flowChartOfflineStorage: (w, h) =>
    poly([[0, 0], [w, 0], [w / 2, h]]) + ' ' + seg([[w * 0.1, h * 0.2], [w * 0.9, h * 0.2]]),
  flowChartMagneticTape: (w, h) =>
    ell(w / 2, h * 0.46, w / 2, h * 0.46) +
    ` M ${n(w * 0.5)} ${n(h * 0.92)} L ${n(w)} ${n(h * 0.92)} L ${n(w)} ${n(h)} L ${n(w * 0.5)} ${n(h)} Z`,
  flowChartMagneticDisk: (w, h) => (PRESETS.can as PathFn)(w, h, { adj: 25000 }),
  flowChartMagneticDrum: (w, h) => {
    const rx = Math.min(w / 2, w * 0.125);
    return (
      `M ${n(rx)} 0 L ${n(w - rx)} 0 ${arcSeg(w - rx, h / 2, rx, h / 2, -90, 180)} L ${n(rx)} ${n(h)} ` +
      `${arcSeg(rx, h / 2, rx, h / 2, 90, 180)} Z ` + ellSeg(w - rx, h / 2, rx, h / 2)
    );
  },
  flowChartDisplay: (w, h) =>
    `M ${n(w * 0.16)} 0 L ${n(w * 0.84)} 0 A ${n(w * 0.16)} ${n(h / 2)} 0 0 1 ${n(w * 0.84)} ${n(h)} ` +
    `L ${n(w * 0.16)} ${n(h)} L 0 ${n(h / 2)} Z`,
  flowChartDelay: (w, h) => `M 0 0 L ${n(w / 2)} 0 A ${n(w / 2)} ${n(h / 2)} 0 0 1 ${n(w / 2)} ${n(h)} L 0 ${n(h)} Z`,

  // 动作按钮
  actionButtonBlank: (w, h) => bevelFrame(w, h, Math.min(w, h) * 0.125),
  actionButtonHome: (w, h) => actionButton(w, h, (s, cx, cy) =>
    poly([[cx, cy - s], [cx + s, cy], [cx + s * 0.6, cy], [cx + s * 0.6, cy + s], [cx - s * 0.6, cy + s], [cx - s * 0.6, cy], [cx - s, cy]])),
  actionButtonForwardNext: (w, h) => actionButton(w, h, (s, cx, cy) => poly([[cx - s * 0.6, cy - s], [cx + s * 0.7, cy], [cx - s * 0.6, cy + s]])),
  actionButtonBackPrevious: (w, h) => actionButton(w, h, (s, cx, cy) => poly([[cx + s * 0.6, cy - s], [cx - s * 0.7, cy], [cx + s * 0.6, cy + s]])),
  actionButtonBeginning: (w, h) => actionButton(w, h, (s, cx, cy) =>
    poly([[cx + s * 0.7, cy - s], [cx - s * 0.3, cy], [cx + s * 0.7, cy + s]]) + ' ' +
    poly([[cx - s * 0.7, cy - s], [cx - s * 0.45, cy - s], [cx - s * 0.45, cy + s], [cx - s * 0.7, cy + s]])),
  actionButtonEnd: (w, h) => actionButton(w, h, (s, cx, cy) =>
    poly([[cx - s * 0.7, cy - s], [cx + s * 0.3, cy], [cx - s * 0.7, cy + s]]) + ' ' +
    poly([[cx + s * 0.45, cy - s], [cx + s * 0.7, cy - s], [cx + s * 0.7, cy + s], [cx + s * 0.45, cy + s]])),
  actionButtonInformation: (w, h) => actionButton(w, h, (s, cx, cy) =>
    ell(cx, cy, s, s) + ' ' + ell(cx, cy - s * 0.45, s * 0.16, s * 0.16) + ' ' +
    poly([[cx - s * 0.16, cy - s * 0.15], [cx + s * 0.16, cy - s * 0.15], [cx + s * 0.16, cy + s * 0.6], [cx - s * 0.16, cy + s * 0.6]])),
  actionButtonReturn: (w, h) => actionButton(w, h, (s, cx, cy) =>
    `M ${n(cx - s * 0.6)} ${n(cy + s * 0.7)} L ${n(cx + s * 0.2)} ${n(cy + s * 0.7)} ` +
    `A ${n(s * 0.5)} ${n(s * 0.5)} 0 0 0 ${n(cx + s * 0.2)} ${n(cy - s * 0.3)} L ${n(cx - s * 0.2)} ${n(cy - s * 0.3)} ` +
    `M ${n(cx - s * 0.2)} ${n(cy - s * 0.6)} L ${n(cx - s * 0.6)} ${n(cy - s * 0.3)} L ${n(cx - s * 0.2)} ${n(cy)} Z`),
  actionButtonDocument: (w, h) => actionButton(w, h, (s, cx, cy) =>
    poly([[cx - s * 0.55, cy - s * 0.8], [cx + s * 0.2, cy - s * 0.8], [cx + s * 0.55, cy - s * 0.45], [cx + s * 0.55, cy + s * 0.8], [cx - s * 0.55, cy + s * 0.8]])),
  actionButtonSound: (w, h) => actionButton(w, h, (s, cx, cy) =>
    poly([[cx - s * 0.7, cy - s * 0.3], [cx - s * 0.3, cy - s * 0.3], [cx + s * 0.1, cy - s * 0.8], [cx + s * 0.1, cy + s * 0.8], [cx - s * 0.3, cy + s * 0.3], [cx - s * 0.7, cy + s * 0.3]]) +
    ' ' + seg([[cx + s * 0.35, cy - s * 0.4], [cx + s * 0.75, cy - s * 0.6]]) +
    ' ' + seg([[cx + s * 0.35, cy], [cx + s * 0.8, cy]]) +
    ' ' + seg([[cx + s * 0.35, cy + s * 0.4], [cx + s * 0.75, cy + s * 0.6]])),
  actionButtonMovie: (w, h) => actionButton(w, h, (s, cx, cy) =>
    poly([[cx - s * 0.8, cy - s * 0.5], [cx + s * 0.35, cy - s * 0.5], [cx + s * 0.35, cy - s * 0.15], [cx + s * 0.8, cy - s * 0.45],
      [cx + s * 0.8, cy + s * 0.45], [cx + s * 0.35, cy + s * 0.15], [cx + s * 0.35, cy + s * 0.5], [cx - s * 0.8, cy + s * 0.5]])),
  actionButtonHelp: (w, h) => actionButton(w, h, (s, cx, cy) =>
    `M ${n(cx - s * 0.35)} ${n(cy - s * 0.3)} A ${n(s * 0.35)} ${n(s * 0.35)} 0 1 1 ${n(cx)} ${n(cy + s * 0.1)} L ${n(cx)} ${n(cy + s * 0.35)} ` +
    ell(cx, cy + s * 0.68, s * 0.13, s * 0.13)),

  // 符号 / 连接线
  chartX: (w, h) => open(`M 0 0 L ${n(w)} ${n(h)} M ${n(w)} 0 L 0 ${n(h)}`),
  chartPlus: (w, h) => open(`M ${n(w / 2)} 0 L ${n(w / 2)} ${n(h)} M 0 ${n(h / 2)} L ${n(w)} ${n(h / 2)}`),
  chartStar: (w, h) => open(`M 0 0 L ${n(w)} ${n(h)} M ${n(w)} 0 L 0 ${n(h)} M ${n(w / 2)} 0 L ${n(w / 2)} ${n(h)}`),
  line: (w, h) => open(`M 0 0 L ${n(w)} ${n(h)}`),
  lineInv: (w, h) => open(`M 0 ${n(h)} L ${n(w)} 0`),
  straightConnector1: (w, h) => open(`M 0 0 L ${n(w)} ${n(h)}`),
  bentConnector2: (w, h) => open(`M 0 0 L ${n(w)} 0 L ${n(w)} ${n(h)}`),
  bentConnector3: (w, h, a) => {
    const x = w * av(a, 'adj1', 50000);
    return open(`M 0 0 L ${n(x)} 0 L ${n(x)} ${n(h)} L ${n(w)} ${n(h)}`);
  },
  bentConnector4: (w, h, a) => {
    const x = w * av(a, 'adj1', 50000);
    const y = h * av(a, 'adj2', 50000);
    return open(`M 0 0 L ${n(x)} 0 L ${n(x)} ${n(y)} L ${n(w)} ${n(y)} L ${n(w)} ${n(h)}`);
  },
  bentConnector5: (w, h, a) => {
    const x1 = w * av(a, 'adj1', 50000);
    const y = h * av(a, 'adj2', 50000);
    const x2 = w * av(a, 'adj3', 50000);
    return open(`M 0 0 L ${n(x1)} 0 L ${n(x1)} ${n(y)} L ${n(x2)} ${n(y)} L ${n(x2)} ${n(h)} L ${n(w)} ${n(h)}`);
  },
  curvedConnector2: (w, h) => open(`M 0 0 Q ${n(w)} 0 ${n(w)} ${n(h)}`),
  curvedConnector3: (w, h, a) => {
    const x = w * av(a, 'adj1', 50000);
    return open(`M 0 0 C ${n(x)} 0 ${n(x)} ${n(h)} ${n(w)} ${n(h)}`);
  },
  curvedConnector4: (w, h) =>
    open(`M 0 0 C ${n(w * 0.5)} 0 ${n(w * 0.5)} ${n(h * 0.5)} ${n(w * 0.75)} ${n(h * 0.5)} S ${n(w)} ${n(h * 0.75)} ${n(w)} ${n(h)}`),
  curvedConnector5: (w, h) =>
    open(`M 0 0 C ${n(w * 0.4)} 0 ${n(w * 0.4)} ${n(h * 0.5)} ${n(w * 0.5)} ${n(h * 0.5)} S ${n(w * 0.6)} ${n(h)} ${n(w)} ${n(h)}`),
};

// ---------------- 公开 API ----------------

export function presetGeom(name: string, w: number, h: number, adj: Adj): Geom {
  const fn = PRESETS[name] ?? PRESETS.rect;
  const ww = Math.max(w, 0);
  const hh = Math.max(h, 0);
  let geom: Geom;
  try {
    const out = fn(ww, hh, adj);
    geom = typeof out === 'string' ? { d: out, open: false } : out;
  } catch {
    return { d: (PRESETS.rect as PathFn)(ww, hh, {}) as string, open: false };
  }
  // 安全网：异常调节值可能让路径远超包围盒，退回矩形而不是画出飞线
  const limit = Math.max(ww, hh) * 20 + 1000;
  for (const m of geom.d.match(/-?\d+(?:\.\d+)?/g) ?? []) {
    if (Math.abs(Number(m)) > limit) {
      return { d: (PRESETS.rect as PathFn)(ww, hh, {}) as string, open: false };
    }
  }
  return geom;
}

export function isKnownPreset(name: string): boolean {
  return name in PRESETS;
}
