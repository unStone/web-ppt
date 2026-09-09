import {parseXmlLite,type LiteElement} from '../xml-lite';
import type {SlideComment} from '../types';
import {VectorDocument,pdfNumber as n} from './vector-document';
import {VectorFonts,type PdfShapedPart,type PdfTextStyle} from './vector-fonts';
import {VectorFontResource,pdfHex,unicodeHex} from './vector-font-resource';
import {vectorGeometry} from './vector-geometry';
import {VectorImages} from './vector-images';
import {VectorFallback} from './vector-fallback';
import {VectorPaint} from './vector-paint';
import {VectorGradient} from './vector-gradient';
import {textDecorations,drawDecorations,type Decoration} from './vector-decoration';
import type {VectorPdfIssue,VectorPdfOptions} from './vector-types';
import {locateVectorError} from './vector-error';
import {svgStyle,svgLength} from './vector-style';
import {drawMarkers} from './vector-markers';
import {VectorPattern} from './vector-pattern';
import {VectorResources} from './vector-resources';

interface Style extends PdfTextStyle {size:number; fill:string; stroke:string; strokeWidth:number; spacing:number; decorations:readonly Decoration[]}
interface Span {text:string; style:Style; dx:number[]; dy:number; parts:PdfShapedPart[]}
const initialStyle:Style = {fonts:[],size:16,fill:'#000000',stroke:'none',strokeWidth:1,spacing:0,decorations:[]};
const numbers = (s:string):number[] => s.trim() ? s.trim().split(/[\s,]+/).map(Number) : [];
function families(value:string):string[] {
  return (value.match(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|[^,]+/g) ?? []).map(s => s.trim().replace(/^['"]|['"]$/g,'')
    .replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi,(_,hex:string,char:string) => hex ? String.fromCodePoint(parseInt(hex,16)) : char));
}
function inherit(el:LiteElement,parent:Style):Style {
  const style = {...parent}, css = svgStyle(el);
  const attribute = (name:string):string | null => css.get(name) ?? el.getAttribute(name);
  for (const [attr,key] of [['fill','fill'],['stroke','stroke']] as const) {
    const value = attribute(attr); if (value !== null) style[key] = value;
  }
  for (const [attr,key] of [['font-size','size'],['stroke-width','strokeWidth'],['letter-spacing','spacing']] as const) {
    const value = attribute(attr); if (value !== null) style[key] = svgLength(value);
  }
  const font = attribute('font-family'); if (font) style.fonts = families(font);
  const weight = attribute('font-weight'); if (weight) style.b = weight === '700' || weight === 'bold';
  const italic = attribute('font-style'); if (italic) style.i = italic === 'italic';
  style.decorations = textDecorations(el,parent.decorations,style.fill);
  return style;
}
function transform(value:string):string {
  const commands:string[] = []; let consumed = '';
  for (const match of value.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const a = numbers(match[2]); consumed += match[0]; let matrix:number[];
    if (match[1] === 'translate' && (a.length === 1 || a.length === 2)) matrix = [1,0,0,1,a[0],a[1] ?? 0];
    else if (match[1] === 'scale' && (a.length === 1 || a.length === 2)) matrix = [a[0],0,0,a[1] ?? a[0],0,0];
    else if (match[1] === 'matrix' && a.length === 6) matrix = a;
    else if (match[1] === 'rotate' && (a.length === 1 || a.length === 3)) {
      const cos = Math.cos(a[0] * Math.PI / 180), sin = Math.sin(a[0] * Math.PI / 180), x = a[1] ?? 0, y = a[2] ?? 0;
      matrix = [cos,sin,-sin,cos,x - cos * x + sin * y,y - sin * x - cos * y];
    } else throw new Error(`PDF 暂不支持变换：${match[1]}`);
    commands.push(`${matrix.map(n).join(' ')} cm`);
  }
  if (consumed.replace(/\s/g,'') !== value.replace(/\s/g,'')) throw new Error('PDF 变换无效');
  return commands.join('\n');
}
/** 只消费本引擎的原生 SVG 方言，不承担通用 SVG 导入。 */
export class VectorSvg {
  private resources = new Map<string,VectorFontResource>();
  private references = new VectorResources();
  private definitions = new Map<string,LiteElement>();
  private images:VectorImages;
  private paint:VectorPaint;
  private gradient:VectorGradient;
  private pattern:VectorPattern;
  private fallback?:VectorFallback;
  private slideNumber = 0;
  private anonymous:ReadonlyMap<number,number[]> = new Map();
  constructor(private pdf:VectorDocument,private fonts:VectorFonts,private options:VectorPdfOptions,private issues:VectorPdfIssue[]) {
    this.images = new VectorImages(pdf,this.references,options.signal,options.normalizeImage);
    this.paint = new VectorPaint(pdf,this.references);
    this.gradient = new VectorGradient(pdf,this.paint,this.references);
    this.pattern = new VectorPattern(pdf,this.references);
  }
  async page(svg:string,slideNumber:number,comments?:readonly SlideComment[],anonymous:ReadonlyMap<number,number[]> = new Map()):Promise<void> {
    const root = parseXmlLite(svg);
    this.slideNumber = slideNumber; this.anonymous = anonymous;
    this.definitions.clear();
    const index = (el:LiteElement):void => {
      const id = el.getAttribute('id'); if (id) this.definitions.set(id,el);
      for (const child of el.children) index(child);
    };
    index(root);
    this.fallback = new VectorFallback(root,this.images,this.options,slideNumber,this.issues,anonymous,this.definitions);
    const {commands,resources} = await this.references.capture(() => this.element(root,initialStyle));
    this.pdf.page(commands,resources,comments);
  }
  finish():void {for (const font of this.resources.values()) font.finish();}
  private async rasterFontStyle(el:LiteElement,parent:Style):Promise<string> {
    const parts:PdfShapedPart[] = [];
    const collect = async (el:LiteElement,parent:Style,inText = false):Promise<void> => {
      if (el.localName === 'defs' || el.localName === 'style') return;
      const style = inherit(el,parent), text = inText || el.localName === 'text';
      for (const child of el.childNodes) {
        if (typeof child === 'string') {if (text && child) parts.push(...await this.fonts.shape(child,style));}
        else await collect(child,style,text);
      }
    };
    await collect(el,parent); return this.fonts.styleTag(parts);
  }
  private clip(reference:string):string {
    const id = /^url\(#([^)]*)\)$/.exec(reference)?.[1], clip = id && this.definitions.get(id);
    if (!clip || clip.localName !== 'clipPath' || clip.getAttribute('clipPathUnits') === 'objectBoundingBox') throw new Error('PDF 裁剪定义无效');
    const paths = clip.children.map(child => {
      if (child.getAttribute('transform')) throw new Error('PDF 暂不支持裁剪变换');
      const path = vectorGeometry(child); if (path !== undefined) return path;
      throw new Error(`PDF 暂不支持裁剪节点：${child.localName}`);
    });
    return paths.join('\n') + (clip.getAttribute('clip-rule') === 'evenodd' ? '\nW* n' : '\nW n');
  }
  private async resource(part:PdfShapedPart):Promise<VectorFontResource> {
    let font = this.resources.get(part.face.id);
    if (!font) {
      font = new VectorFontResource(this.pdf,`F${this.resources.size + 1}`,part.face,await this.fonts.embedding(part));
      this.resources.set(part.face.id,font);
    }
    this.references.use('Font',font);
    return font;
  }
  private async text(el:LiteElement,style:Style):Promise<string> {
    const spans:Span[] = [];
    const collect = async (node:LiteElement,parent:Style):Promise<void> => {
      const style = inherit(node,parent); let dx = numbers(node.getAttribute('dx') ?? ''), dy = Number(node.getAttribute('dy') ?? 0);
      for (const child of node.childNodes) {
        if (typeof child === 'string') {
          spans.push({text:child,style,dx,dy,parts:await this.fonts.shape(child,style)}); dx = []; dy = 0;
        } else if (child.localName === 'tspan' || child.localName === 'a') await collect(child,style);
        else throw new Error(`PDF 暂不支持文字节点：${child.localName}`);
      }
      if (dy) spans.push({text:'',style,dx:[],dy,parts:[]});
    };
    if (el.getAttribute('direction') === 'rtl') throw new Error('PDF 字体：unsupported-direction');
    await collect(el,style);
    let x = Number(el.getAttribute('x') ?? 0), y = Number(el.getAttribute('y') ?? 0);
    const width = spans.reduce((sum,s) => sum + s.parts.reduce((sum,p) => sum + p.run.xAdvance / p.run.unitsPerEm * s.style.size,0)
      + s.style.spacing * s.text.length + s.dx.reduce((a,b) => a + b,0),0);
    const anchor = el.getAttribute('text-anchor'); if (anchor === 'middle') x -= width / 2; else if (anchor === 'end') x -= width;
    const commands:string[] = [], underlines:string[] = [], strikes:string[] = [];
    for (const span of spans) {
      y += span.dy; let character = 0;
      if (span.style.stroke !== 'none') throw new Error('PDF 暂不支持文字描边');
      commands.push(this.paint.solid(span.style.fill));
      for (const part of span.parts) {
        const startX = x, startY = y;
        const font = await this.resource(part), scale = span.style.size / part.run.unitsPerEm;
        for (const cluster of part.run.clusters) {
          const points = [...cluster.text];
          x += span.dx.slice(character,character + points.length).reduce((a,b) => a + b,0); character += points.length;
          commands.push(`/Span << /ActualText <feff${unicodeHex(cluster.text)}> >> BDC`);
          for (let i = cluster.glyphStart; i < cluster.glyphEnd; i++) {
            const glyph = part.run.glyphs[i], cid = font.cid(glyph.id,i === cluster.glyphStart ? cluster.text : '');
            commands.push(`BT /${font.name} ${n(span.style.size)} Tf 1 0 0 -1 ${n(x + glyph.xOffset * scale)} ${n(y - glyph.yOffset * scale)} Tm <${pdfHex(cid)}> Tj ET`);
            x += glyph.xAdvance * scale; y -= glyph.yAdvance * scale;
          }
          commands.push('EMC'); x += span.style.spacing * cluster.text.length;
        }
        underlines.push(drawDecorations(span.style.decorations.filter(d => d.line === 'underline'),font,this.paint,startX,startY,x,span.style.size));
        strikes.push(drawDecorations(span.style.decorations.filter(d => d.line === 'line-through'),font,this.paint,startX,startY,x,span.style.size));
      }
    }
    // SVG 下划线先于字形、删除线后于字形；整个 text 统一顺序，避免相邻字形的悬出部被后续线段盖住。
    return [...underlines,...commands,...strikes].filter(Boolean).join('\n');
  }
  private async element(el:LiteElement,parent:Style,ancestors:readonly LiteElement[] = []):Promise<string> {
    try {return await this.drawElement(el,parent,ancestors);}
    catch (error) {
      const id = el.getAttribute('data-el');
      if (id === null && ancestors.length) throw error;
      locateVectorError(error,this.slideNumber,id === null ? undefined : Number(id),this.anonymous);
    }
  }
  private async drawElement(el:LiteElement,parent:Style,ancestors:readonly LiteElement[]):Promise<string> {
    this.fonts.abort();
    if (['defs','style','title','desc'].includes(el.localName) || el.getAttribute('visibility') === 'hidden'
      || /(?:^|;)\s*visibility\s*:\s*hidden(?:;|$)/.test(el.getAttribute('style') ?? '')) return '';
    if (el.getAttribute('data-render-error')) throw new Error('PDF 原生 SVG 渲染失败');
    const fallback = await this.fallback?.render(el,ancestors,() => this.rasterFontStyle(el,parent)); if (fallback !== undefined) return fallback;
    for (const attr of ['filter','mask','opacity','fill-opacity','stroke-opacity']) {
      if (attr === 'opacity' && el.localName === 'image') continue;
      if (el.getAttribute(attr) !== null) throw new Error(`PDF 暂不支持效果：${attr}`);
    }
    const style = inherit(el,parent), commands = ['q',transform(el.getAttribute('transform') ?? '')];
    const clip = el.getAttribute('clip-path'); if (clip) commands.push(this.clip(clip));
    if (el.localName === 'text') commands.push(await this.text(el,style));
    else if (el.localName === 'image') {
      if (el.getAttribute('preserveAspectRatio') !== 'none') throw new Error('PDF 暂不支持图片宽高比模式');
      commands.push(this.paint.alpha(Math.max(0,Math.min(1,Number(el.getAttribute('opacity') ?? 1))),1));
      commands.push(await this.images.draw(el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '',
        Number(el.getAttribute('x') ?? 0),Number(el.getAttribute('y') ?? 0),Number(el.getAttribute('width')),Number(el.getAttribute('height'))));
    }
    else if (['svg','g','a'].includes(el.localName)) {
      if (el.localName === 'svg' && ancestors.length) {
        const width = Number(el.getAttribute('width')), height = Number(el.getAttribute('height'));
        if (!width || !height) return '';
        // 平铺图片的 srcRect 可超出单元；视口裁剪必须随本格移动，否则会覆盖相邻翻转格。
        commands.push(`1 0 0 1 ${n(Number(el.getAttribute('x') ?? 0))} ${n(Number(el.getAttribute('y') ?? 0))} cm`,
          `0 0 ${n(width)} ${n(height)} re W n`);
      }
      for (const child of el.children) commands.push(await this.element(child,style,[...ancestors,el]));
    } else if (['rect','path','line','circle','ellipse'].includes(el.localName)) {
      const fill = el.localName === 'line' ? 'none' : style.fill, reference = fill.startsWith('url(');
      const stroke = style.strokeWidth === 0 ? 'none' : style.stroke;
      commands.push(this.paint.solid(reference ? 'none' : fill,stroke));
      if (stroke !== 'none') {
        commands.push(`${n(style.strokeWidth)} w`);
        const cap = el.getAttribute('stroke-linecap'), join = el.getAttribute('stroke-linejoin'), dash = el.getAttribute('stroke-dasharray');
        if (cap) commands.push(`${['butt','round','square'].indexOf(cap)} J`);
        if (join) commands.push(`${['miter','round','bevel'].indexOf(join)} j`);
        if (dash && dash !== 'none' && numbers(dash).some(value => value !== 0)) commands.push(`[${numbers(dash).map(n).join(' ')}] 0 d`);
      }
      const path = vectorGeometry(el)!;
      // SVG 先合成填充再合成描边；PDF 的 B 将两者作为同一对象，透明交叠处不会得到相同颜色。
      const definition = reference ? this.definitions.get(/^url\(#([^)]*)\)$/.exec(fill)?.[1] ?? '') : undefined;
      if (definition?.localName === 'pattern') commands.push(await this.pattern.fill(path,definition,el.getAttribute('fill-rule') === 'evenodd',
        child => this.element(child,initialStyle,[...ancestors,el])));
      else if (reference) commands.push(this.gradient.fill(path,fill,this.definitions,el.getAttribute('fill-rule') === 'evenodd'));
      else if (fill !== 'none') commands.push(path,el.getAttribute('fill-rule') === 'evenodd' ? 'f*' : 'f');
      if (stroke !== 'none') commands.push(path,'S');
      commands.push(await drawMarkers(el,path,style.strokeWidth,this.definitions,child => this.element(child,initialStyle,[...ancestors,el])));
    } else throw new Error(`PDF 暂不支持 SVG 节点：${el.localName}`);
    commands.push('Q'); return commands.filter(Boolean).join('\n');
  }
}
