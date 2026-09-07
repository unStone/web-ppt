import type { Shape3D } from '../types';
import { CAMERA_PRESETS } from './presets';
export interface Vector { x: number; y: number; z: number }
export interface Camera {
  rotate: (p: Vector) => Vector;
  world: (x: number, y: number, z: number) => Vector;
  project: (x: number, y: number, z: number) => Vector;
  perspective: boolean;
  distance: number;
  view: Vector;
}

export function cameraAngles(scene: Shape3D): number[] {
  const preset = CAMERA_PRESETS[scene.camera ?? 'orthographicFront'] ?? CAMERA_PRESETS.orthographicFront;
  return [scene.rotX ?? preset[0], scene.rotY ?? preset[1], scene.rotZ ?? preset[2]];
}

export function createCamera(width: number, height: number, scene: Shape3D): Camera {
  const preset = CAMERA_PRESETS[scene.camera ?? 'orthographicFront'] ?? CAMERA_PRESETS.orthographicFront;
  const perspective = !!preset[3] || !scene.camera && !!scene.fieldOfView;
  const skewX = preset[4] * Math.cos(preset[5] * Math.PI / 180), skewY = -preset[4] * Math.sin(preset[5] * Math.PI / 180);
  const angles = cameraAngles(scene).map(a => -a * Math.PI / 180);
  const rotate = (p: Vector): Vector => {
    let { x, y, z } = p;
    const [a, b, c] = angles;
    // DrawingML 的观察变换在屏幕向下的 Y 坐标系中按 Y → X → Z 依次应用。
    [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
    [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
    return { x, y, z };
  };
  // Office 使用约 6.28 英寸的基准视锥；距离与形状边框无关，改尺寸不应改变相机。
  const distance = scene.fieldOfView !== undefined ? 602.88 / Math.tan(Math.max(0.5, Math.min(179.5, scene.fieldOfView)) * Math.PI / 360) : preset[10] || 1455;
  const world = (x: number, y: number, z: number) => rotate({ x: x - width / 2, y: y - height / 2, z: z + (scene.z ?? 0) });
  const project = (x: number, y: number, z: number): Vector => {
    const p = world(x, y, z);
    if (perspective && p.z >= distance - 0.001) throw new Error('三维对象越过相机近裁剪面');
    const scale = (scene.zoom ?? 1) * (perspective ? distance / (distance - p.z) : 1);
    const ox = perspective ? preset[8] * (1 - scale) : skewX * z, oy = perspective ? preset[9] * (1 - scale) : skewY * z;
    return { x: width / 2 + p.x * scale + ox, y: height / 2 + p.y * scale + oy, z: p.z };
  };
  return { rotate, world, project, perspective, distance, view: { x: -skewX, y: -skewY, z: 1 } };
}

export function normal(a: Vector, b: Vector, c: Vector): Vector {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const x = u.y * v.z - u.z * v.y, y = u.z * v.x - u.x * v.z, z = u.x * v.y - u.y * v.x, length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}
