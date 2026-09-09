import type {LiteElement} from '../xml-lite';
import {svgStyle,svgLength} from './vector-style';
import {vectorGeometry} from './vector-geometry';
import {svgMatrix} from './vector-matrix';
import {pdfColor} from './vector-paint';

const common = new Set('id style fill stroke stroke-width font-family font-size font-weight font-style letter-spacing'.split(' '));
const metadata = new Set('role tabindex target rel pointer-events'.split(' '));
const nodes:Record<string,string> = {
  svg:'xmlns xmlns:xlink viewBox x y width height overflow', g:'transform clip-path', a:'href transform clip-path',
  path:'d transform clip-path fill-rule stroke-dasharray stroke-linecap stroke-linejoin marker-start marker-end',
  rect:'x y width height transform clip-path fill-rule stroke-dasharray stroke-linecap stroke-linejoin',
  line:'x1 y1 x2 y2 transform clip-path stroke-dasharray stroke-linecap stroke-linejoin marker-start marker-end',
  circle:'cx cy r transform clip-path fill-rule stroke-dasharray stroke-linecap stroke-linejoin',
  ellipse:'cx cy rx ry transform clip-path fill-rule stroke-dasharray stroke-linecap stroke-linejoin',
  image:'href xlink:href x y width height opacity preserveAspectRatio transform clip-path',
  text:'x y text-anchor xml:space transform direction unicode-bidi', tspan:'dx dy xml:space', title:'', desc:'',
};
const definitions:Record<string,string> = {
  linearGradient:'id x1 y1 x2 y2 gradientUnits', radialGradient:'id cx cy r fx fy gradientUnits',
  stop:'offset stop-color stop-opacity', clipPath:'id clip-rule clipPathUnits',
  marker:'id viewBox refX refY markerWidth markerHeight markerUnits orient',
  pattern:'id x y width height patternUnits',
};
const css = new Set('fill stroke stroke-width font-family font-size font-weight font-style letter-spacing text-decoration text-decoration-line text-decoration-color text-decoration-style'.split(' '));
const enums:Record<string,readonly string[]> = {
  'text-anchor':['start','middle','end'], 'fill-rule':['nonzero','evenodd'], 'clip-rule':['nonzero','evenodd'],
  'stroke-linecap':['butt','round','square'], 'stroke-linejoin':['miter','round','bevel'],
  'gradientUnits':['userSpaceOnUse','objectBoundingBox'], 'clipPathUnits':['userSpaceOnUse','objectBoundingBox'],
  'direction':['ltr','rtl'], 'unicode-bidi':['normal','embed'], 'xml:space':['preserve'],
  'markerUnits':['strokeWidth','userSpaceOnUse'],
};

/** 未覆盖的视觉声明必须显式回退；增加渲染特性时不能再因 PDF 遍历器忽略属性而悄悄丢失。 */
export class VectorCoverage {
  constructor(private definitions:ReadonlyMap<string,LiteElement>,private root:LiteElement) {}
  reason(owner:LiteElement):string | undefined {return this.visit(owner,owner,false,new Set());}
  private visit(el:LiteElement,owner:LiteElement,inText:boolean,seen:Set<string>,definition = false):string | undefined {
    if (el.localName === 'defs' || el.localName === 'style' || el !== owner && el.getAttribute('data-el') !== null) return;
    if (el.getAttribute('data-render-error') !== null) return 'svg-render-error';
    for (const attr of ['filter','mask']) if (el.getAttribute(attr) !== null) return `svg-${attr}`;
    const tag = el.localName, native = Object.prototype.hasOwnProperty.call(nodes,tag) ? nodes[tag] : undefined;
    const defined = Object.prototype.hasOwnProperty.call(definitions,tag) ? definitions[tag] : undefined, extra = definition ? defined ?? native : native;
    if (extra === undefined) return `svg-node-${tag}`;
    if (tag === 'svg' && el !== this.root) {
      if (el.getAttribute('viewBox') !== null) return 'svg-viewport-viewbox';
      if (el.getAttribute('overflow') !== 'hidden') return 'svg-viewport-overflow';
      if (el.getAttribute('width') === null || el.getAttribute('height') === null) return 'svg-viewport-size';
    }
    const allowed = new Set(extra.split(' '));
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') || attr.name.startsWith('aria-') || metadata.has(attr.name)) continue;
      if (!(definition ? allowed.has(attr.name) || defined === undefined && common.has(attr.name) : allowed.has(attr.name) || common.has(attr.name))) return `svg-attribute-${attr.name}`;
      if (inText && attr.name === 'transform') return 'svg-text-transform';
    }
    let style:Map<string,string>;
    try {style = svgStyle(el);} catch {return 'svg-css-syntax';}
    for (const [key,value] of style) {
      if (key === 'filter' && value === 'none') continue;
      if (key === 'cursor' || key === 'transform-box' && value === 'fill-box' || key === 'transform-origin' && value === 'center') continue;
      if (!css.has(key)) return `svg-css-${key}`;
      if ((key === 'text-decoration' || key === 'text-decoration-line') && !/^(underline|line-through)$/.test(value)) return `svg-css-${key}`;
      if (key === 'text-decoration-style' && value !== 'solid') return 'svg-css-text-decoration-style';
    }
    for (const [key,values] of Object.entries(enums)) {
      const value = el.getAttribute(key); if (value !== null && !values.includes(value)) return `svg-value-${key}`;
    }
    for (const key of ['x','y','width','height','x1','y1','x2','y2','cx','cy','r','rx','ry','dy','opacity']) {
      const value = el.getAttribute(key); if (value === null || tag.endsWith('Gradient')) continue;
      if (!value.trim() || !Number.isFinite(Number(value)) || ['width','height','r','rx','ry'].includes(key) && Number(value) < 0) return `svg-value-${key}`;
    }
    for (const key of ['dx','stroke-dasharray']) {
      const value = el.getAttribute(key); if (!value || key === 'stroke-dasharray' && value === 'none') continue;
      const values = value.trim().split(/[\s,]+/).map(Number);
      if (values.some(n => !Number.isFinite(n) || key === 'stroke-dasharray' && n < 0)) return `svg-value-${key}`;
    }
    if ((inText || tag === 'text' || tag === 'tspan') && (style.get('stroke') ?? el.getAttribute('stroke') ?? 'none') !== 'none') return 'svg-text-stroke';
    for (const key of ['font-size','stroke-width','letter-spacing']) {
      const value = style.get(key) ?? el.getAttribute(key);
      if (value !== null && value !== undefined && (!Number.isFinite(svgLength(value)) || key !== 'letter-spacing' && svgLength(value) < 0)) return `svg-value-${key}`;
    }
    const weight = style.get('font-weight') ?? el.getAttribute('font-weight');
    if (weight && !['400','700','normal','bold'].includes(weight)) return 'svg-value-font-weight';
    const italic = style.get('font-style') ?? el.getAttribute('font-style');
    if (italic && !['normal','italic'].includes(italic)) return 'svg-value-font-style';
    if (el.getAttribute('direction') === 'rtl') return 'svg-direction';
    if (tag === 'marker') {
      const orient = el.getAttribute('orient');
      if (orient && !['auto','auto-start-reverse'].includes(orient) && !Number.isFinite(Number(orient))) return 'svg-marker-orient';
      for (const key of ['refX','refY','markerWidth','markerHeight']) {
        const value = el.getAttribute(key); if (value !== null && (!Number.isFinite(Number(value)) || key.startsWith('marker') && Number(value) < 0)) return `svg-value-${key}`;
      }
      const box = el.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      if (box && (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0)) return 'svg-marker-viewbox';
    }
    if (tag === 'image' && el.getAttribute('preserveAspectRatio') !== 'none') return 'svg-image-aspect-ratio';
    if (tag === 'pattern' && el.getAttribute('patternUnits') !== 'userSpaceOnUse') return 'svg-pattern-units';
    for (const key of ['fill','stroke','clip-path','marker-start','marker-end']) {
      const value = style.get(key) ?? el.getAttribute(key); if (!value || value === 'none') continue;
      if (!value.startsWith('url(')) {if (key === 'clip-path') return 'svg-value-clip-path'; try {pdfColor(value);} catch {return `svg-value-${key}`;} continue;}
      if (key === 'stroke' || (inText || tag === 'text' || tag === 'tspan') && key === 'fill') return 'svg-text-paint';
      const id = /^url\(#([^)]*)\)$/.exec(value)?.[1], target = id && this.definitions.get(id);
      if (!target || !id) return 'svg-reference';
      if (seen.has(id)) return 'svg-reference-cycle';
      if (key === 'fill' && !['linearGradient','radialGradient','pattern'].includes(target.localName)) return `svg-paint-${target.localName}`;
      if (key === 'clip-path' && target.localName !== 'clipPath') return 'svg-clip-path';
      if (key.startsWith('marker-') && target.localName !== 'marker') return 'svg-marker-reference';
      if (target.getAttribute('clipPathUnits') === 'objectBoundingBox') return 'svg-clip-units';
      seen.add(id); const reason = this.visit(target,target,false,seen,true); seen.delete(id); if (reason) return reason;
    }
    try {
      if (el.getAttribute('transform')) svgMatrix(el.getAttribute('transform')!);
      vectorGeometry(el);
    } catch {return 'svg-geometry';}
    for (const child of el.children) {
      if (tag === 'clipPath' && child.getAttribute('transform')) return 'svg-clip-transform';
      const reason = this.visit(child,owner,inText || tag === 'text',seen,definition); if (reason) return reason;
    }
  }
}
