import type { ImageElement, Shape3D } from '@web-ppt/core';
import { assertDataObject } from '../data-validation';
import { assertDrawingColor, normalizeDrawingColor } from '../shape-fill';
import type { PictureFx } from './types';

export const SCENE_MATERIALS = ['legacyMatte', 'legacyPlastic', 'legacyMetal', 'legacyWireframe',
  'matte', 'plastic', 'metal', 'warmMatte', 'translucentPowder', 'powder', 'dkEdge', 'softEdge',
  'clear', 'flat', 'softmetal'] as const;
// core 的等轴测近似把材质映射到可见深度，写回必须反解，避免每次重开继续变厚。
const depth: Record<string, number> = {
  metal: 1.15, translucentPowder: .9, powder: .95, dkEdge: 1.1, softEdge: .9, clear: .8, flat: .85, softmetal: 1.1,
};
const lengths = ['extrusion', 'bevelTop', 'bevelBottom', 'contourWidth'] as const;
const colors = ['extrusionColor', 'contourColor'] as const;
const angles = ['rotX', 'rotY'] as const;
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function normalizePicture(value: unknown): PictureFx {
  assertDataObject(value, ['alpha', 'grayscale', 'duotone'], '图片效果');
  const input = value as PictureFx;
  const out: { alpha?: number; grayscale?: boolean; duotone?: [string, string] } = {};
  if ('alpha' in input) {
    if (!finite(input.alpha, 0, 1)) throw new Error('图片不透明度必须在 0–1 之间');
    out.alpha = Math.round(input.alpha * 100000) / 100000;
  }
  if ('grayscale' in input) {
    if (typeof input.grayscale !== 'boolean') throw new Error('图片灰度开关必须是布尔值');
    out.grayscale = input.grayscale;
  }
  if ('duotone' in input) {
    if (!Array.isArray(input.duotone) || input.duotone.length !== 2) throw new Error('双色调需要暗部和亮部两种颜色');
    out.duotone = input.duotone.map((color) => {
      assertDrawingColor(color, '双色调颜色');
      const normalized = normalizeDrawingColor(color);
      if (normalized.startsWith('rgba')) throw new Error('双色调颜色必须不透明');
      return normalized;
    }) as [string, string];
  }
  return out;
}

export function normalizeScene(value: unknown): Shape3D {
  assertDataObject(value, [...lengths, ...colors, ...angles, 'material'], '立体效果');
  const input = value as Shape3D;
  const out: Shape3D = {};
  for (const key of lengths) if (key in input) {
    if (!finite(input[key], 0, 2147483647 / 9525)) throw new Error('立体尺寸超出 DrawingML 范围');
    out[key] = Math.round(input[key]! * 9525) / 9525;
  }
  for (const key of angles) if (key in input) {
    if (!finite(input[key], -360, 360)) throw new Error('立体旋转必须在 ±360° 之间');
    out[key] = ((Math.round(input[key]! * 60000) % 21600000) + 21600000) % 21600000 / 60000;
  }
  for (const key of colors) if (key in input) {
    assertDrawingColor(input[key], '立体颜色');
    out[key] = normalizeDrawingColor(input[key]!);
  }
  if ('material' in input) {
    if (!SCENE_MATERIALS.includes(input.material as typeof SCENE_MATERIALS[number])) throw new Error('未知立体材质');
    out.material = input.material;
  }
  return out;
}

export function sceneProjection(scene: Shape3D): Shape3D | undefined {
  if (!Object.keys(scene).length) return undefined;
  const extrusion = scene.extrusion ?? (scene.bevelTop || scene.bevelBottom ? 6 : undefined);
  return { ...scene,
    ...(extrusion !== undefined ? { extrusion: extrusion * (depth[scene.material ?? ''] ?? 1) } : {}),
    ...('rotX' in scene || 'rotY' in scene ? { rotX: scene.rotX ?? 0, rotY: scene.rotY ?? 0 } : {}),
  };
}

export function sourceScene(scene: Shape3D | undefined): Shape3D {
  return { ...scene, ...(scene?.extrusion !== undefined
    ? { extrusion: scene.extrusion / (depth[scene.material ?? ''] ?? 1) } : {}) };
}

export function pictureProjection(element: ImageElement, effects: PictureFx): ImageElement {
  const filter = element.filter?.replace(/grayscale\(1\)(?: contrast\(1\.1\))?\s*/g, '').trim();
  return { ...element, alpha: effects.alpha ?? 1, duotone: effects.duotone ? [...effects.duotone] : undefined,
    filter: [effects.grayscale ? 'grayscale(1)' : '', filter].filter(Boolean).join(' ') || undefined };
}

export function sourcePicture(element: ImageElement): PictureFx {
  return { ...(element.alpha !== undefined ? { alpha: element.alpha } : {}),
    ...(element.filter?.includes('grayscale(1)') ? { grayscale: true } : {}),
    ...(element.duotone ? { duotone: element.duotone } : {}) };
}
