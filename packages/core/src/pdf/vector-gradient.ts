import type {LiteElement} from '../xml-lite';
import {VectorDocument,pdfNumber as n} from './vector-document';
import {pdfColor,type VectorPaint} from './vector-paint';
import {pathBounds} from './vector-bounds';
import type {VectorResources} from './vector-resources';

interface Stop {pos:number; color:number[]; alpha:number}
interface Shading {name:string; object:number; alpha?:number}
const coordinate = (value:string | null,fallback:number):number => value === null ? fallback : Number(value.replace('%','')) / (value.endsWith('%') ? 100 : 1);
export class VectorGradient {
  private shadings = new Map<string,Shading>();
  private masks = new Map<string,number>();
  constructor(private pdf:VectorDocument,private paint:VectorPaint,private resources:VectorResources) {}
  fill(path:string,reference:string,definitions:ReadonlyMap<string,LiteElement>,evenOdd:boolean):string {
    const id = /^url\(#([^)]*)\)$/.exec(reference)?.[1], gradient = id && definitions.get(id);
    if (!gradient || !['linearGradient','radialGradient'].includes(gradient.localName)) throw new Error('PDF 渐变定义无效');
    if (gradient.getAttribute('gradientTransform') || (gradient.getAttribute('spreadMethod') ?? 'pad') !== 'pad') throw new Error('PDF 渐变变换或延伸方式尚未支持');
    const stops:Stop[] = [];
    for (const child of gradient.children) {
      if (child.localName !== 'stop' || stops.length >= 4096) throw new Error('PDF 渐变色标无效');
      const pos = Math.max(stops[stops.length - 1]?.pos ?? 0,Math.min(1,coordinate(child.getAttribute('offset'),0)));
      const color = pdfColor(child.getAttribute('stop-color') ?? '#000');
      const alpha = color.alpha * Number(child.getAttribute('stop-opacity') ?? 1);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('PDF 渐变透明度无效');
      stops.push({pos,color:color.rgb,alpha});
    }
    if (!stops.length) return '';
    if (stops[0].pos > 0) stops.unshift({...stops[0],pos:0});
    if (stops[stops.length - 1].pos < 1) stops.push({...stops[stops.length - 1],pos:1});
    const attr = (key:string,fallback:number):number => coordinate(gradient.getAttribute(key),fallback);
    const radial = gradient.localName === 'radialGradient';
    const cx = attr('cx',.5), cy = attr('cy',.5);
    const coords = radial ? [attr('fx',cx),attr('fy',cy),0,cx,cy,attr('r',.5)] : [attr('x1',0),attr('y1',0),attr('x2',1),attr('y2',0)];
    const key = JSON.stringify([radial,coords,stops]); let resource = this.shadings.get(key);
    if (!resource) {
      if (this.shadings.size >= 4096) throw new Error('PDF 渐变资源超限');
      const shade = (alpha:boolean):number => {
        const functions:number[] = [], bounds:number[] = [];
        for (let i = 1; i < stops.length; i++) {
          const a = stops[i - 1], b = stops[i]; if (a.pos === b.pos) continue;
          const start = alpha ? [a.alpha] : a.color, end = alpha ? [b.alpha] : b.color;
          functions.push(this.pdf.add(`<< /FunctionType 2 /Domain [0 1] /C0 [${start.map(n).join(' ')}] /C1 [${end.map(n).join(' ')}] /N 1 >>`));
          bounds.push(b.pos);
        }
        const functionId = this.pdf.add(`<< /FunctionType 3 /Domain [0 1] /Functions [${functions.map(id => `${id} 0 R`).join(' ')}] /Bounds [${bounds.slice(0,-1).map(n).join(' ')}] /Encode [${functions.map(() => '0 1').join(' ')}] >>`);
        return this.pdf.add(`<< /ShadingType ${radial ? 3 : 2} /ColorSpace /${alpha ? 'DeviceGray' : 'DeviceRGB'} /Coords [${coords.map(n).join(' ')}] /Function ${functionId} 0 R /Extend [true true] >>`);
      };
      resource = {name:`Sh${this.shadings.size + 1}`,object:shade(false),...(stops.some(s => s.alpha !== 1) ? {alpha:shade(true)} : {})};
      this.shadings.set(key,resource);
    }
    const [x,y,w,h] = pathBounds(path); if (!w || !h) return '';
    this.resources.use('Shading',resource);
    const userSpace = gradient.getAttribute('gradientUnits') === 'userSpaceOnUse';
    const matrix = userSpace ? '' : `${[w,0,0,h,x,y].map(n).join(' ')} cm`;
    let mask = '';
    if (resource.alpha) {
      const bbox = userSpace ? [x,y,x+w,y+h] : [0,0,1,1], key = JSON.stringify([resource.alpha,bbox]);
      let object = this.masks.get(key);
      if (!object) {
        object = this.pdf.stream('/A sh',`/Type /XObject /Subtype /Form /BBox [${bbox.map(n).join(' ')}] /Group << /S /Transparency /CS /DeviceGray /I true >> /Resources << /Shading << /A ${resource.alpha} 0 R >> >>`);
        this.masks.set(key,object);
      }
      mask = this.paint.alpha(1,1,object);
    }
    return `q ${path} ${evenOdd ? 'W*' : 'W'} n ${matrix} ${mask} /${resource.name} sh Q`;
  }
}
