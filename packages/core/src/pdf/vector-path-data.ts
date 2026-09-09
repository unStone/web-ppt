const counts:Record<string,number> = {m:2,l:2,c:6,h:0,re:4};
/** 只读取本模块已经归一化的 PDF 几何操作；边界和切线共享相同的段边界。 */
export function* pdfPathCommands(path:string):Generator<{op:string; values:number[]}> {
  let values:number[] = [];
  for (const match of path.matchAll(/\S+/g)) {
    const token = match[0], number = Number(token);
    if (Number.isFinite(number)) {values.push(number); continue;}
    if (!Object.prototype.hasOwnProperty.call(counts,token) || values.length !== counts[token]) throw new Error('PDF 归一化路径无效');
    yield {op:token,values}; values = [];
  }
  if (values.length) throw new Error('PDF 归一化路径无效');
}
