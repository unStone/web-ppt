import type { ShapeElement, Shape3D } from '../types';
import type { Shape3DContext } from '../render/shape-3d';
import { createCamera, normal } from './camera';
import type { Vector } from './camera';
import { flattenPath, inset } from './path';
import { number, polygon, warpFront } from './warp';

function shade(color: string, normal: Vector, scene: Shape3D): string {
  const hex = color.replace('#', ''), channels = color.startsWith('#')
    ? (hex.length === 3 ? hex.split('').map(c => parseInt(c + c, 16)) : [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16)))
    : (color.match(/[\d.]+/g) ?? ['128', '128', '128']).map(Number);
  const dir = scene.lightDirection ?? 'tl';
  const x = dir.includes('l') ? -0.5 : dir.includes('r') ? 0.5 : 0, y = dir.includes('t') ? -0.5 : dir.includes('b') ? 0.5 : 0;
  const length = Math.hypot(x, y, 0.8), diffuse = Math.max(0, (normal.x * x + normal.y * y + normal.z * 0.8) / length);
  const flat = scene.material === 'flat', shine = /metal|plastic/i.test(scene.material ?? '') ? Math.pow(diffuse, 16) * 0.35 : 0;
  const factor = flat ? 1 : 0.35 + diffuse * 0.65;
  return `rgba(${channels.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v * factor + 255 * shine)))).join(',')},${channels[3] ?? 1})`;
}

export function renderShape3D(el: ShapeElement, front: string, ctx: Shape3DContext, surface?: string): string {
  const scene = el.scene3d;
  if (!scene || !el.path || el.w <= 0 || el.h <= 0) return front;
  const camera = createCamera(el.w, el.h, scene), depth = scene.extrusion ?? 0;
  const topH = scene.bevelTop ?? 0, bottomH = scene.bevelBottom ?? 0;
  const widthLimit = Math.min(el.w, el.h) / 4, topW = Math.min(scene.bevelTopWidth ?? topH, widthLimit), bottomW = Math.min(scene.bevelBottomWidth ?? bottomH, widthLimit);
  const contours = flattenPath(el.path), rings = contours.filter(r => r.closed || !el.openGeom);
  const base = scene.extrusionColor ?? (el.fill?.type === 'solid' ? el.fill.color : el.fill?.type === 'gradient' ? el.fill.stops[0]?.color : undefined) ?? '#808080';
  const faces: { z: number; svg: string }[] = [], frontPaths: string[] = [], projectedFront: string[] = [], backPaths: string[] = [];
  const flip = (p: { x: number; y: number }) => ({ x: el.flipH ? el.w - p.x : p.x, y: el.flipV ? el.h - p.y : p.y });
  const world = (p: { x: number; y: number; z: number }) => { const q = flip(p); return camera.world(q.x, q.y, p.z); };
  const project = (p: { x: number; y: number; z: number }) => { const q = flip(p); return camera.project(q.x, q.y, p.z); };
  const face = (vertices: Vector[]) => {
    const rotated = vertices.map(world), p = vertices.map(project), faceNormal = normal(rotated[0], rotated[1], rotated[2]);
    const center = rotated.reduce((sum, v) => ({ x: sum.x + v.x / 4, y: sum.y + v.y / 4, z: sum.z + v.z / 4 }), { x: 0, y: 0, z: 0 });
    const dot = camera.perspective ? faceNormal.z * (camera.distance - center.z) - faceNormal.x * center.x - faceNormal.y * center.y
      : faceNormal.x * camera.view.x + faceNormal.y * camera.view.y + faceNormal.z;
    const flipNormal = !!el.flipH !== !!el.flipV ? -1 : 1;
    if (dot * flipNormal <= 0) return;
    const light = { x: faceNormal.x * flipNormal, y: faceNormal.y * flipNormal, z: faceNormal.z * flipNormal };
    const color = shade(base, light, scene);
    faces.push({ z: center.z, svg: `<path d="${polygon(p)}" fill="${scene.material === 'legacyWireframe' ? 'none' : color}" stroke="${color}" stroke-width="${scene.material === 'legacyWireframe' ? 1 : 0.6}" stroke-linejoin="round"/>` });
  };
  for (const ring of rings) {
    const points = ring.points, top = inset(points, topW), back = inset(points, bottomW);
    frontPaths.push(polygon(top.map(flip))); backPaths.push(polygon(back.map(p => project({ ...p, z: -depth - bottomH }))));
    projectedFront.push(polygon(top.map(p => project({ ...p, z: topH }))));
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length, a = points[i], b = points[j];
      if (depth) face([{ ...a, z: 0 }, { ...a, z: -depth }, { ...b, z: -depth }, { ...b, z: 0 }]);
      if (topW || topH) face([{ ...top[i], z: topH }, { ...a, z: 0 }, { ...b, z: 0 }, { ...top[j], z: topH }]);
      if (bottomW || bottomH) face([{ ...a, z: -depth }, { ...back[i], z: -depth - bottomH }, { ...back[j], z: -depth - bottomH }, { ...b, z: -depth }]);
    }
  }
  const forward = camera.rotate({ x: 0, y: 0, z: 1 });
  if (forward.z >= 0) {
    let projected = '';
    // SVG 的三角裁剪在设计工具中仍会抗锯齿；轮廓直接投影，整片填充只合成一次。
    if (camera.perspective && surface && (!el.fill || el.fill.type === 'solid' || el.fill.type === 'none')) {
      const path = contours.map(ring => {
        const d = polygon(ring.points.map(p => project({ ...p, z: topH })));
        return ring.closed || !el.openGeom ? d : d.slice(0, -1);
      }).join('');
      projected = surface.replace(/d="[^"]*"/, `d="${path}"`);
      front = front.replace(surface, '');
      if (topW) {
        const clip = ctx.nextId('d3surface');
        ctx.defs.push(`<clipPath id="${clip}"><path d="${projectedFront.join('')}"/></clipPath>`);
        projected = `<g clip-path="url(#${clip})">${projected}</g>`;
      }
    }
    if (topW) {
      const clip = ctx.nextId('d3bevel'); ctx.defs.push(`<clipPath id="${clip}"><path d="${frontPaths.join('')}" fill-rule="nonzero"/></clipPath>`);
      front = `<g clip-path="url(#${clip})">${front}</g>`;
    }
    faces.push({ z: camera.world(el.w / 2, el.h / 2, topH).z, svg: projected + warpFront(front, el.w, el.h, topH, camera, ctx) });
  } else faces.push({ z: camera.world(el.w / 2, el.h / 2, -depth - bottomH).z, svg: `<path d="${backPaths.join('')}" fill="${shade(base, { x: -forward.x, y: -forward.y, z: -forward.z }, scene)}" fill-rule="nonzero"/>` });
  return `<g data-projection="${camera.perspective ? 'perspective' : 'orthographic'}" data-depth="${number(depth)}">${faces.sort((a, b) => a.z - b.z).map(f => f.svg).join('')}</g>`;
}
