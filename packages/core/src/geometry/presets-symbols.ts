import { PathFn, Pt, n, open, av, poly, ell, waveEdge } from './path-kit';

/** 数学符号、括号与缎带 / 卷轴 / 波浪 */
export const SYMBOL_PRESETS: Record<string, PathFn> = {
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
};
