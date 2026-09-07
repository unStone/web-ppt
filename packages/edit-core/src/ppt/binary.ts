/** [MS-PPT]/[MS-ODRAW] 记录头是共享协议，长度始终只计算记录体。 */
export const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size=parts.reduce((sum,part)=>sum+part.length,0);
  if(size>256*1024*1024)throw new Error('PPT 文件超过浏览器保存大小限制');
  const result=new Uint8Array(size);let at=0;for(const part of parts){result.set(part,at);at+=part.length;}return result;
}
export function u16(value: number): Uint8Array {const bytes=new Uint8Array(2);view(bytes).setUint16(0,value,true);return bytes;}
export function u32(value: number): Uint8Array {const bytes=new Uint8Array(4);view(bytes).setUint32(0,value,true);return bytes;}
export function utf16(text: string, terminate = false): Uint8Array {
  if(text.length>1000000)throw new Error('PPT 文字长度超限');
  const bytes=new Uint8Array((text.length+Number(terminate))*2),data=view(bytes);
  for(let i=0;i<text.length;i++)data.setUint16(i*2,text.charCodeAt(i),true);return bytes;
}
export function atom(type: number, body: Uint8Array = new Uint8Array(), version = 0, instance = 0): Uint8Array {
  if(!Number.isInteger(instance)||instance<0||instance>0xfff)throw new Error('PPT 记录实例超限');
  const header=new Uint8Array(8),data=view(header);data.setUint16(0,(instance<<4)|version,true);data.setUint16(2,type,true);data.setUint32(4,body.length,true);return concat([header,body]);
}
export function container(type: number, children: readonly Uint8Array[], instance = 0): Uint8Array {return atom(type,concat(children),15,instance);}
export interface Property {id:number;value:number|Uint8Array;blip?:boolean}
export function properties(input: readonly Property[]): Uint8Array {
  const sorted=[...input].sort((a,b)=>a.id-b.id);
  if(new Set(sorted.map(p=>p.id)).size!==sorted.length)throw new Error('PPT 形状属性重复');
  const entries=new Uint8Array(sorted.length*6),data=view(entries),complex:Uint8Array[]=[];
  sorted.forEach((p,i)=>{const isComplex=p.value instanceof Uint8Array;data.setUint16(i*6,p.id|(isComplex?0x8000:0)|(p.blip?0x4000:0),true);data.setUint32(i*6+2,isComplex?(p.value as Uint8Array).length:p.value as number,true);if(isComplex)complex.push(p.value as Uint8Array);});
  return atom(0xf00b,concat([entries,...complex]),3,sorted.length);
}
export function signed(value:number,label:string):number {if(!Number.isFinite(value)||value<-0x80000000||value>0x7fffffff)throw new Error(`PPT ${label} 超出坐标范围`);return Math.round(value);}
export function color(value:string):number {
  const {rgb}=rgba(value);return rgb;
}
export function rgba(value:string):{rgb:number;alpha:number} {
  value=value.replace(/^#([0-9a-f]{3})$/i,(_,hex:string)=>'#'+hex.split('').map(c=>c+c).join(''));
  const hex=/^#?([0-9a-f]{6})$/i.exec(value);
  if(hex){const n=parseInt(hex[1],16);return {rgb:((n&255)<<16)|(n&0xff00)|((n>>>16)&255),alpha:1};}
  const match=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/i.exec(value);
  if(!match||match.slice(1,4).some(v=>Number(v)>255))throw new Error(`PPT 不支持此颜色：${value}`);
  return {rgb:Number(match[1])|(Number(match[2])<<8)|(Number(match[3])<<16),alpha:Number(match[4]??1)};
}
