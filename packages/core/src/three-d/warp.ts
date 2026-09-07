import type { Shape3DContext } from '../render/shape-3d';
import type { Camera } from './camera';
import type { Point } from './path';
export const number = (n: number): string => String(Math.round(n * 10000) / 10000);
export const polygon = (points: Point[]): string => points.map((p, i) => `${i ? 'L' : 'M'}${number(p.x)} ${number(p.y)}`).join('') + 'Z';

/** 正投影精确仿射；透视把同一个矢量正面切为三角形，独立 SVG 仍保留原生 text。 */
export function warpFront(front: string, width: number, height: number, z: number, camera: Camera, ctx: Shape3DContext): string {
  if (!front) return '';
  const project = (p: Point) => camera.project(p.x, p.y, z);
  const affine = (a: Point, b: Point, c: Point): string => {
    const pa = project(a), pb = project(b), pc = project(c), ux = b.x - a.x, uy = b.y - a.y, vx = c.x - a.x, vy = c.y - a.y;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-10) throw new Error('三维投影网格退化');
    const aa = ((pb.x - pa.x) * vy - (pc.x - pa.x) * uy) / det, bb = ((pb.y - pa.y) * vy - (pc.y - pa.y) * uy) / det;
    const cc = ((pc.x - pa.x) * ux - (pb.x - pa.x) * vx) / det, dd = ((pc.y - pa.y) * ux - (pb.y - pa.y) * vx) / det;
    return `matrix(${[aa, bb, cc, dd, pa.x - aa * a.x - cc * a.y, pa.y - bb * a.x - dd * a.y].map(number).join(' ')})`;
  };
  if (!camera.perspective) return `<g transform="${affine({ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height })}">${front}</g>`;
  const id = ctx.nextId('d3front'); ctx.defs.push(`<g id="${id}">${front}</g>`);
  const cells = 12, result: string[] = [];
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const a = { x: x * width / cells, y: y * height / cells }, b = { x: (x + 1) * width / cells, y: a.y };
    const c = { x: b.x, y: (y + 1) * height / cells }, d = { x: a.x, y: c.y };
    for (const triangle of [[a, b, c], [a, c, d]]) {
      // 共边必须只归属一个三角形，避免半透明颜色在重叠区重复合成。
      const points = triangle.map(project), xs = points.map(p => p.x), ys = points.map(p => p.y);
      const clip = ctx.nextId('d3tile'); ctx.defs.push(`<mask id="${clip}" maskUnits="userSpaceOnUse" x="${number(Math.min(...xs)-1)}" y="${number(Math.min(...ys)-1)}" width="${number(Math.max(...xs)-Math.min(...xs)+2)}" height="${number(Math.max(...ys)-Math.min(...ys)+2)}"><path d="${polygon(points)}" fill="#fff" shape-rendering="crispEdges"/></mask>`);
      result.push(`<g mask="url(#${clip})"><use href="#${id}" xlink:href="#${id}" transform="${affine(triangle[0], triangle[1], triangle[2])}"/></g>`);
    }
  }
  return result.join('');
}
