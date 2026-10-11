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

/**
 * 多样式装饰线（CSS text-decoration-style 的 PDF 等价表达）：
 *  solid  — 实线（现状）
 *  dashed — PDF dash 模式 [2t 1t]，t 为线宽（与 CSS dashed 的等距断段近似）
 *  dotted — PDF dash 模式 [0 t] 配圆端帽（零长 on + round cap = 圆点序列）
 *  double — 上下平行两条线，间距 = 1.5t（与浏览器 double 的三分隔近似）
 *  wavy   — 一次正弦近似：半波长 = 3t、振幅 = 0.75t（与 CSS wavy 的 3px 波长等比缩放）
 * 粗细与位置仍由字体的 auto 度量决定，样式只改变绘制方式。
 */
function drawStyledDecoration(
  decoration: Decoration, metrics:{offset:number; thickness:number},
  x:number, y:number, end:number,
): string {
  const t = metrics.thickness, position = y + metrics.offset + t / 2, width = end - x;
  switch (decoration.style) {
    case 'solid':
      return `${n(t)} w ${n(x)} ${n(position)} m ${n(end)} ${n(position)} l S`;
    case 'dashed':
      return `[${n(t * 2)} ${n(t)}] 0 d ${n(t)} w ${n(x)} ${n(position)} m ${n(end)} ${n(position)} l S`;
    case 'dotted':
      return `[0 ${n(t)}] 0 d 1 J ${n(t)} w ${n(x)} ${n(position)} m ${n(end)} ${n(position)} l S`;
    case 'double': {
      const gap = t * 1.5;
      return `${n(t * 0.75)} w ${n(x)} ${n(position - gap / 2)} m ${n(end)} ${n(position - gap / 2)} l S `
        + `${n(x)} ${n(position + gap / 2)} m ${n(end)} ${n(position + gap / 2)} l S`;
    }
    case 'wavy': {
      // 半波长 = 3t、振幅 = 0.75t；用四分之一波长的三次贝塞尔近似正弦
      const halfWave = t * 3, amplitude = t * 0.75;
      const segments = Math.max(1, Math.ceil(width / halfWave));
      let path = `${n(t * 0.8)} w ${n(x)} ${n(position)} m`;
      for (let i = 0; i < segments; i++) {
        const startX = x + i * halfWave;
        // 上半波：从中心线到 +amplitude 再回到中心线
        path += ` ${n(startX + halfWave * 0.25)} ${n(position - amplitude)} `
          + `${n(startX + halfWave * 0.75)} ${n(position + amplitude)} `
          + `${n(startX + halfWave)} ${n(position)} c`;
      }
      return `${path} S`;
    }
    default:
      throw new Error(`PDF 文字装饰线型尚未支持：${decoration.style}`);
  }
}

export function drawDecorations(decorations:readonly Decoration[],font:VectorFontResource,paint:VectorPaint,x:number,y:number,end:number,size:number,gradientStroke?:string):string {
  return decorations.map(decoration => {
    const metrics = font.decoration(decoration.line,size);
    // 装饰色继承渐变 fill 时（浏览器语义：线参与同一渐变框）用描边色彩空间的 Pattern
    const color = decoration.color.startsWith('url(') && gradientStroke ? gradientStroke : paint.solid('none',decoration.color);
    return `q ${color} ${drawStyledDecoration(decoration,metrics,x,y,end)} Q`;
  }).join('\n');
}
