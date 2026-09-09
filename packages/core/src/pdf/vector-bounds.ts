import {pdfPathCommands} from './vector-path-data';

/** PDF 已物化路径的几何边界；渐变使用实际曲线极值，不把控制点当作边界。 */
export function pathBounds(path:string):readonly [number,number,number,number] {
  let x = 0, y = 0, sx = 0, sy = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const point = (px:number,py:number):void => {left = Math.min(left,px); top = Math.min(top,py); right = Math.max(right,px); bottom = Math.max(bottom,py);};
  const roots = (p:number,a:number,b:number,q:number):number[] => {
    const aa = -p+3*a-3*b+q, bb = 2*(p-2*a+b), cc = a-p;
    if (Math.abs(aa) < 1e-12) return Math.abs(bb) < 1e-12 ? [] : [-cc/bb];
    const det = bb*bb-4*aa*cc; if (det < 0) return [];
    return [(-bb+Math.sqrt(det))/(2*aa),(-bb-Math.sqrt(det))/(2*aa)];
  };
  const cubic = (t:number,p:number,a:number,b:number,q:number):number => (1-t)**3*p+3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3*q;
  for (const {op:token,values} of pdfPathCommands(path)) {
    if (token === 'm') {[x,y] = values; sx = x; sy = y;}
    else if (token === 'l') {point(x,y); [x,y] = values; point(x,y);}
    else if (token === 'c') {
      const [ax,ay,bx,by,qx,qy] = values;
      point(x,y); point(qx,qy);
      for (const t of [...roots(x,ax,bx,qx),...roots(y,ay,by,qy)]) if (t > 0 && t < 1) point(cubic(t,x,ax,bx,qx),cubic(t,y,ay,by,qy));
      x = qx; y = qy;
    } else if (token === 'h') {point(x,y); point(sx,sy); x = sx; y = sy;}
    else if (token === 're') {const [rx,ry,w,h] = values; point(rx,ry); point(rx+w,ry+h); x = sx = rx; y = sy = ry;}
    else throw new Error('PDF 路径边界无法计算');
  }
  return Number.isFinite(left) ? [left,top,right-left,bottom-top] : [0,0,0,0];
}
