/**
 * 预设形状几何 —— 与文件格式无关的纯计算。
 *
 * ECMA-376 全部 187 个 DrawingML 预设形状的 path 求值，不依赖 XML、DOM 或任何解析器：
 * .pptx 与 .ppt 两条链路都用它（ppt 侧把 MSO 的调节值换算成 100000 制后传入）。
 * 读 OOXML 的那部分（avLst / custGeom）留在 pptx/geometry.ts。
 *
 * Geom.open = true 表示开放路径（只描边不填充，如括号 / 弧线 / 连接线）
 */
import type { Adj, Geom, GeomSpec, PathFn } from './path-kit';
import { BASIC_PRESETS } from './presets-basic';
import { ARROW_PRESETS } from './presets-arrows';
import { SYMBOL_PRESETS } from './presets-symbols';
import { DIAGRAM_PRESETS } from './presets-diagrams';

export type {
  CubicArcSegment,
  CustomGeometry,
  CustomGeometryArcCommand,
  CustomGeometryCloseCommand,
  CustomGeometryCommand,
  CustomGeometryCubicCommand,
  CustomGeometryGuide,
  CustomGeometryLineCommand,
  CustomGeometryMoveCommand,
  CustomGeometryPath,
  CustomGeometryPoint,
  CustomGeometryPointRole,
  CustomGeometryQuadraticCommand,
  CustomGeometryScalar,
} from './custom';
export { arcToCubicSegments, materializeCustomGeometryArcs, resolveCustomGeometry } from './custom';
export type { Adj, Geom, GeomSpec, Pt } from './path-kit';
export { ep, n, rad } from './path-kit';

// ---------------- 预设表 ----------------

const PRESETS: Record<string, PathFn> = {
  ...BASIC_PRESETS,
  ...ARROW_PRESETS,
  ...SYMBOL_PRESETS,
  ...DIAGRAM_PRESETS,
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

/** 按当前尺寸求值编辑态几何，避免复用解析期已经烘焙的 path。 */
export function resolveGeomPath(geom: GeomSpec, w: number, h: number): Geom {
  return presetGeom(geom.preset, w, h, geom.adj);
}

export function isKnownPreset(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRESETS, name);
}
