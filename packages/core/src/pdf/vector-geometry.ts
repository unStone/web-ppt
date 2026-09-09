import type {LiteElement} from '../xml-lite';
import {vectorPath} from './vector-path';
import {pdfNumber as n} from './vector-document';

/** 统一普通图元和裁剪图元，避免表格边线及媒体按钮在两个入口得到不同几何。 */
export function vectorGeometry(el:LiteElement):string | undefined {
  const number = (name:string,fallback = 0):number => Number(el.getAttribute(name) ?? fallback);
  if (el.localName === 'path') return vectorPath(el.getAttribute('d') ?? '');
  if (el.localName === 'rect') return ['x','y','width','height'].map(a => n(number(a))).join(' ') + ' re';
  if (el.localName === 'line') return `${n(number('x1'))} ${n(number('y1'))} m ${n(number('x2'))} ${n(number('y2'))} l`;
  if (el.localName !== 'circle' && el.localName !== 'ellipse') return;
  const cx = number('cx'), cy = number('cy'), rx = number(el.localName === 'circle' ? 'r' : 'rx'), ry = number(el.localName === 'circle' ? 'r' : 'ry');
  if (!rx || !ry) return '';
  if (rx < 0 || ry < 0) throw new Error('PDF 椭圆半径无效');
  return vectorPath(`M ${n(cx-rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 1 ${n(cx+rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 1 ${n(cx-rx)} ${n(cy)} Z`);
}
