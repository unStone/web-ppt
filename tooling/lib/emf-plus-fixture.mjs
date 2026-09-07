export class Buf {
  data = [];
  u8(n) { this.data.push(n & 255); return this; }
  u16(n) { return this.u8(n).u8(n >> 8); }
  u32(n) { return this.u16(n).u16(n >>> 16); }
  f(n) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, n, true); return this.raw(b); }
  raw(bytes) { for (const n of bytes) this.data.push(n); return this; }
  text(s) { for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i)); return this; }
  rect(x,y,w,h) { return this.f(x).f(y).f(w).f(h); }
  get bytes() { return Uint8Array.from(this.data); }
}
export const cat = (...parts) => new Buf().raw(parts.flatMap(p => Array.from(p))).bytes;
const aligned = b => { const out = new Buf().raw(b); while (out.data.length % 4) out.u8(0); return out.bytes; };
export function plus(type, flags = 0, build = () => {}) {
  const b = new Buf(); build(b); const payload = b.bytes, padded = aligned(payload);
  return new Buf().u16(type).u16(flags).u32(padded.length + 12).u32(payload.length).raw(padded).bytes;
}
export function emf(type, payload) { const b = aligned(payload); return new Buf().u32(type).u32(b.length + 8).raw(b).bytes; }
export const comment = (...records) => { const b = new Buf().u32(0x2b464d45).raw(cat(...records)); return emf(70, new Buf().u32(b.data.length).raw(b.bytes).bytes); };
export const version = 0xdbc01002;
export const header = dual => plus(0x4001,dual ? 1 : 0,b=>b.u32(version).u32(1).u32(96).u32(96));
export const eof = () => plus(0x4002);
export const solidBrush = argb => new Buf().u32(version).u32(0).u32(argb).bytes;
export const object = (type,id,bytes) => plus(0x4008,(type<<8)|id,b=>b.raw(bytes));
export function file(records) {
  const body = cat(...records,emf(14,new Buf().u32(0).u32(0).u32(20).bytes));
  const h = new Buf().u32(1).u32(88).u32(0).u32(0).u32(399).u32(299).u32(0).u32(0).u32(10583).u32(7938)
    .u32(0x464d4520).u32(0x10000).u32(88+body.length).u32(records.length+2).u16(64).u16(0).u32(0).u32(0).u32(0)
    .u32(960).u32(960).u32(254).u32(254);
  return cat(h.bytes,body);
}
export function example({ dual = false, unknown = false } = {}) {
  const path = new Buf().u32(version).u32(4).u32(0).f(20).f(100).f(80).f(10).f(120).f(200).f(180).f(100).raw([0,3,3,3]).bytes;
  const pen = new Buf().u32(version).u32(0).u32(0x3e).u32(0).f(4).u32(2).u32(2).u32(2).f(10).u32(1).raw(solidBrush(0xff203040)).bytes;
  const gradient = new Buf().u32(version).u32(4).u32(0).u32(4).rect(200,20,150,80).u32(0xffff7f00).u32(0xff2055ff).u32(0).u32(0).bytes;
  const font = new Buf().u32(version).f(24).u32(2).u32(1).u32(0).u32(5).text('Arial').bytes;
  const image = new Buf().u32(version).u32(1).u32(2).u32(2).u32(8).u32(0x26200a).u32(0).raw([0,0,255,255,0,255,0,255,255,0,0,255,0,0,0,0]).bytes;
  const records = [comment(header(dual),object(1,0,solidBrush(0x804477cc)),object(2,1,pen),object(3,2,path),object(1,3,gradient),object(6,4,font),object(5,5,image),
    plus(0x400a,0,b=>b.u32(0).u32(1).rect(10,10,170,65)),plus(0x4015,2,b=>b.u32(1)),
    plus(0x400e,0,b=>b.u32(3).rect(200,20,150,80)),
    plus(0x4025,0,b=>b.u32(10)),plus(0x402d,0,b=>b.f(20).f(20)),plus(0x4032,0,b=>b.rect(180,90,160,65)),
    plus(0x4010,0x8000,b=>b.u32(0xff00aa66).f(0).f(270).rect(180,90,160,110)),plus(0x4026,0,b=>b.u32(10)),
    plus(0x401a,5,b=>b.u32(0xffffffff).u32(2).rect(0,0,2,2).rect(20,160,60,60)),
    plus(0x401c,0x8004,b=>b.u32(0xff222222).u32(0xffffffff).u32(12).rect(100,200,250,45).text('EMF+ 中文 text')),
    ...(unknown?[plus(0x4013,0,b=>b.u32(0))]:[]))];
  if(dual)records.push(emf(39,new Buf().u32(1).u32(0).u32(0x0000ff00).u32(0).bytes),emf(37,new Buf().u32(1).bytes),emf(43,new Buf().u32(0).u32(0).u32(400).u32(300).bytes));
  records.push(comment(eof())); return file(records);
}
