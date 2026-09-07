import type { ImageElement, Shape3D } from '@web-ppt/core';
import { assertDataObject } from '../data-validation';
import { assertDrawingColor, normalizeDrawingColor } from '../shape-fill';
import type { PictureFx } from './types';

export const SCENE_MATERIALS = ['legacyMatte', 'legacyPlastic', 'legacyMetal', 'legacyWireframe',
  'matte', 'plastic', 'metal', 'warmMatte', 'translucentPowder', 'powder', 'dkEdge', 'softEdge',
  'clear', 'flat', 'softmetal'] as const;
const lengths = ['extrusion', 'bevelTop', 'bevelBottom', 'bevelTopWidth', 'bevelBottomWidth', 'contourWidth'] as const;
const colors = ['extrusionColor', 'contourColor'] as const;
const angles = ['rotX', 'rotY', 'rotZ'] as const;
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
  assertDataObject(value, [...lengths, ...colors, ...angles, 'material', 'camera', 'fieldOfView', 'zoom', 'z', 'lightRig', 'lightDirection'], '立体效果');
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
  for (const key of ['camera', 'lightRig', 'lightDirection'] as const) if (key in input) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(input[key]!)) throw new Error('三维场景预设名称无效');
    out[key] = input[key];
  }
  for (const [key, min, max, precision] of [['fieldOfView', 0, 180, 60000], ['zoom', 0.00001, 1000, 100000], ['z', -2147483647 / 9525, 2147483647 / 9525, 9525]] as const) if (key in input) {
    if (!finite(input[key], min, max)) throw new Error('三维相机参数超出范围');
    out[key] = Math.round(input[key]! * precision) / precision;
  }
  return out;
}

export function sceneProjection(scene: Shape3D): Shape3D | undefined {
  if (!Object.keys(scene).length) return undefined;
  return { camera: 'orthographicFront', lightRig: 'threePt', lightDirection: 't', ...scene,
    ...(scene.bevelTop !== undefined ? { bevelTopWidth: scene.bevelTopWidth ?? scene.bevelTop } : {}),
    ...(scene.bevelBottom !== undefined ? { bevelBottomWidth: scene.bevelBottomWidth ?? scene.bevelBottom } : {}),
    ...(scene.bevelTopWidth !== undefined && scene.bevelTop === undefined ? { bevelTop: 4 } : {}),
    ...(scene.bevelBottomWidth !== undefined && scene.bevelBottom === undefined ? { bevelBottom: 4 } : {}),
    ...(angles.some(key => key in scene) ? { rotX: scene.rotX ?? 0, rotY: scene.rotY ?? 0, rotZ: scene.rotZ ?? 0 } : {}),
  };
}

export function sourceScene(scene: Shape3D | undefined): Shape3D {
  return { ...scene };
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
