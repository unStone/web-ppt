import type { Effects, LineEnd, LineEndType, Shape3D } from '../types';
import { attr, emu, kid, numAttr } from '../xml';
import { ColorCtx, childColor } from './color';

/** effectLst → Effects。角度 dir 为 60000 分之一度，距离 dist 为 EMU。 */
export function parseEffects(effectLst: Element | null, ctx: ColorCtx): Effects | undefined {
  if (!effectLst) return undefined;
  const out: Effects = {};

  const outer = kid(effectLst, 'outerShdw');
  const inner = kid(effectLst, 'innerShdw');
  const shdw = outer ?? inner;
  if (shdw) {
    const dist = emu(numAttr(shdw, 'dist') ?? 0);
    const dir = ((numAttr(shdw, 'dir') ?? 0) / 60000) * (Math.PI / 180);
    out.shadow = {
      dx: dist * Math.cos(dir),
      dy: dist * Math.sin(dir),
      blur: emu(numAttr(shdw, 'blurRad') ?? 0),
      color: childColor(shdw, ctx) ?? 'rgba(0,0,0,0.4)',
      inner: shdw === inner,
    };
  }

  const glow = kid(effectLst, 'glow');
  if (glow) {
    out.glow = {
      radius: emu(numAttr(glow, 'rad') ?? 0),
      color: childColor(glow, ctx) ?? 'rgba(0,0,0,0.4)',
    };
  }

  const soft = kid(effectLst, 'softEdge');
  if (soft) out.softEdge = emu(numAttr(soft, 'rad') ?? 0);

  const refl = kid(effectLst, 'reflection');
  if (refl) {
    out.reflection = {
      alpha: (numAttr(refl, 'stA') ?? 50000) / 100000,
      size: (numAttr(refl, 'endPos') ?? 35000) / 100000,
      distance: emu(numAttr(refl, 'dist') ?? 0),
    };
  }

  // 显式空 effectLst 会屏蔽主题 effectRef；缺失与空列表的继承语义不同。
  return Object.keys(out).length || effectLst.localName === 'effectLst' ? out : undefined;
}

const END_TYPES: Record<string, LineEndType> = {
  none: 'none', triangle: 'triangle', stealth: 'stealth',
  diamond: 'diamond', oval: 'oval', arrow: 'arrow',
};

const END_SIZE: Record<string, number> = { sm: 2, med: 3, lg: 5 };

/** headEnd / tailEnd → LineEnd */
export function parseLineEnd(el: Element | null): LineEnd | undefined {
  if (!el) return undefined;
  const type = END_TYPES[attr(el, 'type') ?? 'none'];
  if (!type) return undefined;
  return {
    type,
    w: END_SIZE[attr(el, 'w') ?? 'med'] ?? 3,
    h: END_SIZE[attr(el, 'len') ?? 'med'] ?? 3,
  };
}

const MATERIAL_DEPTH: Record<string, number> = {
  matte: 1, plastic: 1, metal: 1.15, warmMatte: 1, translucentPowder: 0.9,
  powder: 0.95, dkEdge: 1.1, softEdge: 0.9, clear: 0.8, flat: 0.85, softmetal: 1.1,
};

/**
 * scene3d / sp3d → 立体参数。
 * 渲染层按等轴测风格近似：挤出方向由场景旋转角决定，不做真实三维投影。
 */
export function parse3D(spPr: Element | null, ctx: ColorCtx): Shape3D | undefined {
  if (!spPr) return undefined;
  const sp3d = kid(spPr, 'sp3d');
  const scene3d = kid(spPr, 'scene3d');
  if (!sp3d && !scene3d) return undefined;

  const out: Shape3D = {};

  const extrusionH = numAttr(sp3d, 'extrusionH');
  if (extrusionH) out.extrusion = emu(extrusionH);
  const extClr = childColor(kid(sp3d, 'extrusionClr'), ctx);
  if (extClr) out.extrusionColor = extClr;

  const bevelT = kid(sp3d, 'bevelT');
  if (bevelT) out.bevelTop = emu(numAttr(bevelT, 'h') ?? 38100);
  const bevelB = kid(sp3d, 'bevelB');
  if (bevelB) out.bevelBottom = emu(numAttr(bevelB, 'h') ?? 38100);

  const contourW = numAttr(sp3d, 'contourW');
  if (contourW) {
    out.contourWidth = emu(contourW);
    out.contourColor = childColor(kid(sp3d, 'contourClr'), ctx) ?? undefined;
  }

  const material = attr(sp3d, 'prstMaterial');
  if (material) out.material = material;

  // camera 的 rot 决定观察角，进而决定挤出偏移方向
  const rot = kid(kid(scene3d, 'camera'), 'rot');
  if (rot) {
    out.rotX = (numAttr(rot, 'rev') ?? 0) / 60000;
    out.rotY = (numAttr(rot, 'lat') ?? 0) / 60000;
  }

  // 没写挤出高度但有斜角时给一个可见的默认厚度
  if (!out.extrusion && (out.bevelTop || out.bevelBottom)) out.extrusion = 6;
  if (out.extrusion && material) out.extrusion *= MATERIAL_DEPTH[material] ?? 1;

  return Object.keys(out).length ? out : undefined;
}
