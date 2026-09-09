import {arcToCubicSegments} from '../geometry/custom';
import {pdfNumber as n} from './vector-document';

type Point = readonly [number,number];
function arc(from:Point,to:Point,rx:number,ry:number,rotation:number,large:number,sweep:number):string {
  if (![0,1].includes(large) || ![0,1].includes(sweep)) throw new Error('PDF 圆弧标志无效');
  if (from[0] === to[0] && from[1] === to[1]) return '';
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return `${to.map(n).join(' ')} l`;
  // SVG 端点形式 → 椭圆中心形式，使用 W3C B.2.4/B.2.5 的半径修正。
  // https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes
  const phi = rotation * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2, dy = (from[1] - to[1]) / 2;
  const x = cos * dx + sin * dy, y = -sin * dx + cos * dy;
  const correction = Math.sqrt(Math.max(1,x * x / (rx * rx) + y * y / (ry * ry)));
  rx *= correction; ry *= correction;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0,
    (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x)));
  const cx = k * rx * y / ry, cy = -k * ry * x / rx;
  const start = Math.atan2((y - cy) / ry,(x - cx) / rx);
  let delta = Math.atan2((-y - cy) / ry,(-x - cx) / rx) - start;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  const segments = arcToCubicSegments(x,y,rx,ry,start * 180 / Math.PI,delta * 180 / Math.PI);
  return segments.map(segment => segment.map(p => [cos * p[0] - sin * p[1] + (from[0] + to[0]) / 2,
    sin * p[0] + cos * p[1] + (from[1] + to[1]) / 2].map(n).join(' ')).join(' ') + ' c').join('\n');
}

export function vectorPath(value:string):string {
  const tokens = value.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  if (tokens.join('') !== value.replace(/[\s,]/g,'') || tokens.length && tokens[0]?.toUpperCase() !== 'M') throw new Error('PDF 路径无效');
  if (tokens.length > 200000) throw new Error('PDF 路径复杂度超限');
  const commands:string[] = []; let at = 0, current:Point = [0,0], start:Point = current, control:Point = current;
  let command = '', previous = '';
  const read = (flag = false):number => {
    const token = tokens[at]; if (token === undefined) throw new Error('PDF 路径无效');
    // SVG 圆弧的两个单字符标志可与彼此及后续坐标紧邻，不能按普通数字一次吃掉。
    if (flag) {
      if (token[0] !== '0' && token[0] !== '1') throw new Error('PDF 圆弧标志无效');
      if (token.length === 1) at++; else tokens[at] = token.slice(1);
      return Number(token[0]);
    }
    at++; const value = Number(token); if (!Number.isFinite(value)) throw new Error('PDF 路径无效'); return value;
  };
  while (at < tokens.length) {
    if (/^[a-z]$/i.test(tokens[at])) command = tokens[at++];
    const type = command.toUpperCase(), relative = command !== type;
    if (type === 'Z') {commands.push('h'); current = start; previous = type; command = ''; continue;}
    const count = type === 'M' || type === 'L' || type === 'T' ? 2 : type === 'C' ? 6 : type === 'A' ? 7
      : type === 'Q' || type === 'S' ? 4 : type === 'H' || type === 'V' ? 1 : 0;
    if (!count) throw new Error(`PDF 暂不支持路径指令：${command}`);
    let values = Array.from({length:count},(_,i) => read(type === 'A' && (i === 3 || i === 4)));
    if (relative) values = values.map((value,i) => type === 'A' && i < 5 ? value : value + current[type === 'V' ? 1 : type === 'A' ? (i-5)%2 : i%2]);
    const reflected:Point = (type === 'S' && ['C','S'].includes(previous) || type === 'T' && ['Q','T'].includes(previous))
      ? [2*current[0]-control[0],2*current[1]-control[1]] : current;
    if (type === 'S' || type === 'T') values.unshift(...reflected);
    const end:Point = type === 'H' ? [values[0],current[1]] : type === 'V' ? [current[0],values[0]] : [values[values.length-2],values[values.length-1]];
    if (type === 'A') commands.push(arc(current,end,values[0],values[1],values[2],values[3],values[4]));
    else if (type === 'Q' || type === 'T') commands.push([
      current[0] + (values[0]-current[0])*2/3,current[1] + (values[1]-current[1])*2/3,
      end[0] + (values[0]-end[0])*2/3,end[1] + (values[1]-end[1])*2/3,...end,
    ].map(n).join(' ') + ' c');
    else if (type === 'H' || type === 'V') commands.push(`${end.map(n).join(' ')} l`);
    else commands.push(`${values.map(n).join(' ')} ${type === 'M' ? 'm' : type === 'L' ? 'l' : 'c'}`);
    control = type === 'Q' || type === 'T' ? [values[0],values[1]] : [values[values.length-4],values[values.length-3]];
    current = end; previous = type;
    if (type === 'M') {start = end; command = relative ? 'l' : 'L';}
  }
  return commands.join('\n');
}
