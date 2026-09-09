export type Matrix = readonly [number,number,number,number,number,number];
export const identity:Matrix = [1,0,0,1,0,0];
export function multiply(a:Matrix,b:Matrix):Matrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function inverse(m:Matrix):Matrix {
  const det = m[0]*m[3]-m[1]*m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('PDF 对象变换不可逆');
  return [m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det];
}
export function svgMatrix(value:string):Matrix {
  let result = identity, consumed = '';
  for (const match of value.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const a = match[2].trim() ? match[2].trim().split(/[\s,]+/).map(Number) : [];
    consumed += match[0]; let matrix:Matrix;
    if (match[1] === 'translate' && (a.length === 1 || a.length === 2)) matrix = [1,0,0,1,a[0],a[1] ?? 0];
    else if (match[1] === 'scale' && (a.length === 1 || a.length === 2)) matrix = [a[0],0,0,a[1] ?? a[0],0,0];
    else if (match[1] === 'matrix' && a.length === 6) matrix = [a[0],a[1],a[2],a[3],a[4],a[5]];
    else if (match[1] === 'rotate' && (a.length === 1 || a.length === 3)) {
      const cos = Math.cos(a[0] * Math.PI / 180), sin = Math.sin(a[0] * Math.PI / 180), x = a[1] ?? 0, y = a[2] ?? 0;
      matrix = [cos,sin,-sin,cos,x - cos * x + sin * y,y - sin * x - cos * y];
    } else throw new Error(`PDF 暂不支持变换：${match[1]}`);
    if (!matrix.every(Number.isFinite)) throw new Error('PDF 变换无效');
    result = multiply(result,matrix);
  }
  if (consumed.replace(/[\s,]/g,'') !== value.replace(/[\s,]/g,'')) throw new Error('PDF 变换无效');
  return result;
}
