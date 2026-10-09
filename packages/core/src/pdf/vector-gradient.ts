import type {LiteElement} from '../xml-lite';
import {VectorDocument,pdfNumber as n} from './vector-document';
import {pdfColor,type VectorPaint} from './vector-paint';
import {pathBounds} from './vector-bounds';
import {type Matrix} from './vector-matrix';
import type {VectorResources} from './vector-resources';

interface Stop {pos:number; color:number[]; alpha:number}
interface Shading {name:string; object:number; alpha?:number}
const coordinate = (value:string | null,fallback:number):number => value === null ? fallback : Number(value.replace('%','')) / (value.endsWith('%') ? 100 : 1);
/** 文字渐变只支持水平轴：颜色只依赖 x，而 x 由字形推进精确得出；
 *  垂直与斜向轴依赖 y 的字形墨迹包围盒，近似误差会直接变成颜色偏差，仍走栅格回退。 */
export class VectorGradient {
  private shadings = new Map<string,Shading>();
  private masks = new Map<string,number>();
  private textPatterns = new Map<string,string>();
  constructor(private pdf:VectorDocument,private paint:VectorPaint,private resources:VectorResources) {}
  /**
   * 文字渐变：把 Shading 包成 Pattern（PatternType 2），经 Pattern colorspace 填充字形。
   *
   * PDF 文字的填充只能是色彩空间值，不能像路径那样先 W n 再 sh。坐标口径经
   * 三实现实测（MuPDF / poppler / CoreGraphics）：PatternMatrix 在文字填充下
   * **不生效**（非恒等矩阵整段取末端色），正确表达是矩阵保持恒等、把局部
   * 端点经累计 CTM（ctm）换算成页面绝对坐标直接写进 Shading 的 Coords。
   *
   * objectBoundingBox 单位端点 (x1,y1)/(x2,y2) 经墨迹框（x..x+width、
   * inkTop..inkTop+inkHeight，局部坐标）映射后绝对化；轴不限方向，
   * 垂直 / 斜向的精度取决于墨迹框 y 的字形轮廓测量（VectorFonts.glyphBox）。
   */
  textPattern(reference:string, definitions:ReadonlyMap<string,LiteElement>, x:number, width:number, inkTop:number, inkHeight:number, ctm:Matrix):string {
    if (width <= 0 || inkHeight <= 0) throw new Error('PDF 文字渐变范围无效');
    const at = (px:number,py:number):[number,number] =>
      [ctm[0]*px + ctm[2]*py + ctm[4],ctm[1]*px + ctm[3]*py + ctm[5]];
    const bx = (u:number):number => x + u * width, by = (v:number):number => inkTop + v * inkHeight;
    const cacheKey = JSON.stringify([reference,bx(0),by(0),bx(1),by(1),ctm]);
    const cached = this.textPatterns.get(cacheKey);
    if (cached) return cached;
    const gid = /^url\(#([^)]*)\)$/.exec(reference)?.[1], gradient = gid && definitions.get(gid);
    if (!gradient || gradient.localName !== 'linearGradient') throw new Error('PDF 文字渐变定义无效');
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
    if (!stops.length) throw new Error('PDF 渐变色标无效');
    if (stops[0].pos > 0) stops.unshift({...stops[0],pos:0});
    if (stops[stops.length - 1].pos < 1) stops.push({...stops[stops.length - 1],pos:1});
    if (stops.some(s => s.alpha !== 1)) throw new Error('PDF 暂不支持文字渐变透明度');
    const attr = (key:string,fallback:number):number => coordinate(gradient.getAttribute(key),fallback);
    const x1 = attr('x1',0), y1 = attr('y1',0), x2 = attr('x2',1), y2 = attr('y2',0);
    if (y1 === y2 && x1 === x2) throw new Error('PDF 暂不支持文字渐变方向');
    // 端点换算成页面绝对坐标写进 Coords；PatternMatrix 恒等（文字填充下非恒等矩阵三实现均不生效）
    const [ax1,ay1] = at(bx(x1),by(y1)), [ax2,ay2] = at(bx(x2),by(y2));
    const key = JSON.stringify(['text',ax1,ay1,ax2,ay2,stops]);
    let shading = this.shadings.get(key);
    if (!shading) {
      if (this.shadings.size >= 4096) throw new Error('PDF 渐变资源超限');
      const functions:number[] = [], bounds:number[] = [];
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1], b = stops[i]; if (a.pos === b.pos) continue;
        functions.push(this.pdf.add(`<< /FunctionType 2 /Domain [0 1] /C0 [${a.color.map(n).join(' ')}] /C1 [${b.color.map(n).join(' ')}] /N 1 >>`));
        bounds.push(b.pos);
      }
      const functionId = this.pdf.add(`<< /FunctionType 3 /Domain [0 1] /Functions [${functions.map(id => `${id} 0 R`).join(' ')}] /Bounds [${bounds.slice(0,-1).map(n).join(' ')}] /Encode [${functions.map(() => '0 1').join(' ')}] >>`);
      const object = this.pdf.add(`<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${[ax1,ay1,ax2,ay2].map(n).join(' ')}] /Function ${functionId} 0 R /Extend [true true] >>`);
      shading = {name:`Sh${this.shadings.size + 1}`,object};
      this.shadings.set(key,shading);
    }
    const pattern = this.pdf.add(`<< /PatternType 2 /Shading ${shading.object} 0 R >>`);
    const name = `Pt${pattern}`;
    this.resources.use('Pattern',{name,object:pattern});
    const command = `/Pattern cs /${name} scn`;
    this.textPatterns.set(cacheKey,command);
    return command;
  }

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
