import type {LiteElement} from '../xml-lite';
import {pathEnds} from './vector-path-ends';
import {pdfNumber as n} from './vector-document';

/** 当前原生 SVG 的 marker 视口；不会继承被标记线条的虚线、端帽、连接或填充。 */
export async function drawMarkers(el:LiteElement,path:string,strokeWidth:number,definitions:ReadonlyMap<string,LiteElement>,draw:(el:LiteElement)=>Promise<string>):Promise<string> {
  if (!el.getAttribute('marker-start') && !el.getAttribute('marker-end')) return '';
  const ends = pathEnds(path); if (!ends) return '';
  const commands:string[] = [];
  for (const atStart of [true,false]) {
    const reference = el.getAttribute(atStart ? 'marker-start' : 'marker-end'); if (!reference || reference === 'none') continue;
    const id = /^url\(#([^)]*)\)$/.exec(reference)?.[1], marker = id && definitions.get(id);
    if (!marker || marker.localName !== 'marker') throw new Error('PDF 箭头定义无效');
    const width = Number(marker.getAttribute('markerWidth') ?? 3), height = Number(marker.getAttribute('markerHeight') ?? 3);
    const units = (marker.getAttribute('markerUnits') ?? 'strokeWidth') === 'strokeWidth' ? strokeWidth : 1;
    if (!width || !height || !units) continue;
    const box = marker.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number) ?? [0,0,width,height];
    if (box.length !== 4 || box[2] <= 0 || box[3] <= 0 || width < 0 || height < 0) throw new Error('PDF 箭头视口无效');
    const scale = Math.min(width/box[2],height/box[3]), dx = (width-box[2]*scale)/2-box[0]*scale, dy = (height-box[3]*scale)/2-box[1]*scale;
    const refX = Number(marker.getAttribute('refX') ?? 0)*scale+dx, refY = Number(marker.getAttribute('refY') ?? 0)*scale+dy;
    const end = atStart ? ends.start : ends.end, orient = marker.getAttribute('orient') ?? '0';
    const angle = orient === 'auto' || orient === 'auto-start-reverse'
      ? end.angle + (atStart && orient === 'auto-start-reverse' ? Math.PI : 0) : Number(orient)*Math.PI/180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    commands.push('q',`${[cos*units,sin*units,-sin*units,cos*units,...end.point].map(n).join(' ')} cm`,
      `1 0 0 1 ${n(-refX)} ${n(-refY)} cm`, `0 0 ${n(width)} ${n(height)} re W n`,
      `${n(scale)} 0 0 ${n(scale)} ${n(dx)} ${n(dy)} cm`, '[] 0 d 0 J 0 j 4 M 1 w');
    for (const child of marker.children) commands.push(await draw(child));
    commands.push('Q');
  }
  return commands.join('\n');
}
