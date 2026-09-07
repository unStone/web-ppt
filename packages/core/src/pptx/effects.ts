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

/** scene3d / sp3d 保留实际相机、尺寸和光照；材质不会改变几何深度。 */
export function parse3D(spPr: Element | null, ctx: ColorCtx): Shape3D | undefined {
  if (!spPr) return undefined;
  const sp3d = kid(spPr, 'sp3d');
  const scene3d = kid(spPr, 'scene3d');
  if (!sp3d && !scene3d) return undefined;

  const out: Shape3D = {};

  const extrusionH = numAttr(sp3d, 'extrusionH');
  if (extrusionH !== null) out.extrusion = emu(extrusionH);

  const bevelT = kid(sp3d, 'bevelT');
  if (bevelT) out.bevelTop = emu(numAttr(bevelT, 'h') ?? 38100);
  const bevelB = kid(sp3d, 'bevelB');
  if (bevelB) out.bevelBottom = emu(numAttr(bevelB, 'h') ?? 38100);

  const contourW = numAttr(sp3d, 'contourW');
  if (contourW !== null) out.contourWidth = emu(contourW);
  for (const [tag, key] of [['extrusionClr', 'extrusionColor'], ['contourClr', 'contourColor']] as const) {
    const color = childColor(kid(sp3d, tag), ctx);
    if (color) out[key] = color;
  }

  const material = attr(sp3d, 'prstMaterial');
  if (material) out.material = material;

  // camera 的 rot 决定观察角，进而决定挤出偏移方向
  const camera = kid(scene3d, 'camera');
  const preset = attr(camera, 'prst');
  if (preset) out.camera = preset;
  const fov = numAttr(camera, 'fov'), zoom = numAttr(camera, 'zoom');
  if (fov !== null) out.fieldOfView = fov / 60000;
  if (zoom !== null) out.zoom = zoom / 100000;
  const z = numAttr(sp3d, 'z');
  if (z !== null) out.z = emu(z);
  const rig = kid(scene3d, 'lightRig'), light = attr(rig, 'rig'), direction = attr(rig, 'dir');
  if (light) out.lightRig = light;
  if (direction) out.lightDirection = direction;
  if (bevelT) out.bevelTopWidth = emu(numAttr(bevelT, 'w') ?? 76200);
  if (bevelB) out.bevelBottomWidth = emu(numAttr(bevelB, 'w') ?? 76200);
  const rot = kid(camera, 'rot');
  if (rot) {
    out.rotX = (numAttr(rot, 'lat') ?? 0) / 60000;
    out.rotY = (numAttr(rot, 'lon') ?? 0) / 60000;
    out.rotZ = (numAttr(rot, 'rev') ?? 0) / 60000;
  }


  return Object.keys(out).length ? out : undefined;
}
