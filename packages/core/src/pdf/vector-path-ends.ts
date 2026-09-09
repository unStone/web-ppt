import {pdfPathCommands} from './vector-path-data';
type Point = readonly [number,number];
export interface PathEnd {point:Point; angle:number}

/** 端点切线不能用整条路径的首尾连线代替；重合控制点须继续检查同一曲线的控制多边形。 */
export function pathEnds(path:string):{start:PathEnd; end:PathEnd} | undefined {
  interface Subpath {start:Point; end:Point; segments:number; closed:boolean; first?:Point; last?:Point}
  const subpaths:Subpath[] = []; let current:Point = [0,0], subpath:Subpath | undefined;
  const direction = (from:Point,points:Point[]):Point | undefined => {
    for (const p of points) {const delta:Point = [p[0]-from[0],p[1]-from[1]]; if (delta[0] || delta[1]) return delta;}
  };
  for (const {op,values:v} of pdfPathCommands(path)) {
    if (op === 'm') {current = [v[0],v[1]]; subpath = {start:current,end:current,segments:0,closed:false}; subpaths.push(subpath); continue;}
    if (!subpath) throw new Error('PDF 路径缺少起点');
    let end:Point, first:Point | undefined, last:Point | undefined;
    if (op === 'c') {
      end = [v[4],v[5]];
      first = direction(current,[[v[0],v[1]],[v[2],v[3]],end]);
      const back = direction(end,[[v[2],v[3]],[v[0],v[1]],current]); if (back) last = [-back[0],-back[1]];
    } else if (op === 'l' || op === 'h') {
      end = op === 'h' ? subpath.start : [v[0],v[1]]; first = last = direction(current,[end]);
    } else throw new Error('PDF 箭头路径类型无效');
    // 当前 Chrome 原生 SVG 对显式零长端段保留本地 +x 方向；不能跨段借用下一条线的方向。
    if (subpath.segments++ === 0) subpath.first = first;
    subpath.last = last; subpath.closed = op === 'h';
    subpath.end = current = end;
  }
  const first = subpaths[0], last = subpaths[subpaths.length-1]; if (!first) return;
  const angle = (p?:Point):number => p ? Math.atan2(p[1],p[0]) : 0;
  const closedAngle = (s:Subpath):number => {
    let a = angle(s.first), b = angle(s.last);
    if (Math.abs(a-b) > Math.PI) {if (a < b) a += 2*Math.PI; else b += 2*Math.PI;}
    return (a+b)/2;
  };
  return {start:{point:first.start,angle:first.closed ? closedAngle(first) : angle(first.first)},
    end:{point:last.end,angle:last.closed ? closedAngle(last) : angle(last.last)}};
}
