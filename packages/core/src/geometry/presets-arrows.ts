import { PathFn, n, av, poly, arrow, arrowCallout, curvedArrow } from './path-kit';

/** 箭头族：直箭头、折弯 / 弯曲 / 环形箭头与箭头标注 */
export const ARROW_PRESETS: Record<string, PathFn> = {
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
};
