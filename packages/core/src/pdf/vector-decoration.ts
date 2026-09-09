import type {LiteElement} from '../xml-lite';
import type {VectorFontResource} from './vector-font-resource';
import type {VectorPaint} from './vector-paint';
import {pdfNumber as n} from './vector-document';
import {svgStyle} from './vector-style';

export interface Decoration {line:'underline'|'line-through'; color:string; style:string}
export function textDecorations(el:LiteElement,parent:readonly Decoration[],color:string):readonly Decoration[] {
  const css = svgStyle(el);
  const lines = css.get('text-decoration-line') ?? css.get('text-decoration'); if (!lines) return parent;
  return [...parent,...lines.split(/\s+/).map((line):Decoration => {
    if (line !== 'underline' && line !== 'line-through') throw new Error(`PDF 文字装饰尚未支持：${line}`);
    return {line,color:css.get('text-decoration-color') ?? color,style:css.get('text-decoration-style') ?? 'solid'};
  })];
}
export function drawDecorations(decorations:readonly Decoration[],font:VectorFontResource,paint:VectorPaint,x:number,y:number,end:number,size:number):string {
  return decorations.map(decoration => {
    if (decoration.style !== 'solid') throw new Error(`PDF 文字装饰线型尚未支持：${decoration.style}`);
    const metrics = font.decoration(decoration.line,size), position = y + metrics.offset + metrics.thickness / 2;
    return `q ${paint.solid('none',decoration.color)} ${n(metrics.thickness)} w ${n(x)} ${n(position)} m ${n(end)} ${n(position)} l S Q`;
  }).join('\n');
}
