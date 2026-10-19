import type { GroupElement, SlideElement } from '../types';
import { scalePathData } from './path-scale';

/**
 * PowerPoint 只把 chOff/chExt 映射到子元素外框：描边、字号、内边距与效果半径保持物理尺寸。
 * 对子树整体 `scale()` 会把这些绝对量一起放大，WPS 的归一化组合（chExt 约 1px）因此出现千像素描边。
 */
function swapsAxes(rot: number): boolean {
  const angle = ((rot % 360) + 360) % 360;
  // 落在 45°–135° / 225°–315° 的子元素以旋转后的方向承接组缩放，宽高互换（LibreOffice 同样如此）。
  return (angle >= 45 && angle < 135) || (angle >= 225 && angle < 315);
}

function groupScale(value: number, axis: string, group: GroupElement): number {
  // 解析期遇到零尺寸 chExt 时给出 0；历史渲染一直按 1 处理，这里保持同一语义。
  const scale = value || 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`组合 ${group.name ?? group.id ?? ''} 的 ${axis} 缩放无效：${value}`);
  }
  return scale;
}

export interface GroupChildFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 子元素自身局部坐标（未旋转）各轴承接的缩放 */
  kx: number;
  ky: number;
}

/** 子元素外框在组合局部坐标中的位置；中心点按组映射，宽高按子元素自身方向缩放，保持刚体。 */
export function placeGroupFrame(group: GroupElement, child: SlideElement): GroupChildFrame {
  const sx = groupScale(group.scaleX, 'scaleX', group);
  const sy = groupScale(group.scaleY, 'scaleY', group);
  const swap = swapsAxes(child.rot);
  const kx = swap ? sy : sx;
  const ky = swap ? sx : sy;
  const w = child.w * kx;
  const h = child.h * ky;
  return {
    x: (child.x + child.w / 2 - group.childX) * sx - w / 2,
    y: (child.y + child.h / 2 - group.childY) * sy - h / 2,
    w, h, kx, ky,
  };
}

/**
 * placeGroupFrame 的逆运算：组合局部坐标里的刚体外框 → 子坐标外框。旋转角不变，宽高按同一象限规则除回去，
 * 编辑器在渲染外框上完成手势后用它写回模型。
 */
export function unplaceGroupFrame(
  group: GroupElement,
  frame: { x: number; y: number; w: number; h: number; rot: number },
): { x: number; y: number; w: number; h: number } {
  const sx = groupScale(group.scaleX, 'scaleX', group);
  const sy = groupScale(group.scaleY, 'scaleY', group);
  const swap = swapsAxes(frame.rot);
  const w = frame.w / (swap ? sy : sx);
  const h = frame.h / (swap ? sx : sy);
  return {
    x: (frame.x + frame.w / 2) / sx + group.childX - w / 2,
    y: (frame.y + frame.h / 2) / sy + group.childY - h / 2,
    w, h,
  };
}

/**
 * 把组合的直接子元素换算到组合自身的局部坐标（原点为组合外框左上角，翻转与旋转仍由组合承担）。
 * 结果中的嵌套组合携带折算后的 scaleX/scaleY，再次调用即可逐层展开。
 */
export function placeGroupChild(group: GroupElement, child: SlideElement): SlideElement {
  const { kx, ky, ...placed } = placeGroupFrame(group, child);
  if (kx === 1 && ky === 1) return { ...child, ...placed };
  switch (child.kind) {
    case 'shape':
      return { ...child, ...placed, path: child.path && scalePathData(child.path, kx, ky) };
    case 'image':
      return { ...child, ...placed, ...(child.clipPath ? { clipPath: scalePathData(child.clipPath, kx, ky) } : {}) };
    case 'group':
      return { ...child, ...placed, scaleX: (child.scaleX || 1) * kx, scaleY: (child.scaleY || 1) * ky };
    case 'table':
      return {
        ...child, ...placed,
        colWidths: child.colWidths.map((width) => width * kx),
        rows: child.rows.map((row) => ({ ...row, height: row.height * ky })),
      };
    case 'unsupported':
      return { ...child, ...placed };
  }
}
