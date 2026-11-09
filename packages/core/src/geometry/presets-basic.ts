import {
  PathFn, Pt, n, rad, open, av, ang, poly, ep, arcSeg, arcFrom, seg, ellSeg, ell, regular, starFn,
  rectFamily, tabs, gear, bevelFrame,
} from './path-kit';

/** 矩形族、基本形与星形 */
export const BASIC_PRESETS: Record<string, PathFn> = {
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
};
