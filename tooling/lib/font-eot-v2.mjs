import {wrapEot} from './font.mjs';

/** 固定的未压缩 v2 容器；真实 MTX 另用带来源 hash 的语料验证。 */
export function eotV2(bytes,{version=0x20002,root='',codepage=10000}={}){
  const base=wrapEot(bytes),offset=base.length-bytes.length;
  const words=Array.from({length:root.length},(_,index)=>root.charCodeAt(index)).flatMap(code=>[code&255,code>>>8]);
  const extra=new Uint8Array(4+words.length+(version===0x20002?20:0)),view=new DataView(extra.buffer);
  view.setUint16(2,words.length,true);extra.set(words,4);
  if(version===0x20002){
    view.setUint32(4+words.length,words.reduce((sum,byte)=>sum+byte,0)^0x50475342,true);
    view.setUint32(8+words.length,codepage,true);
  }
  const output=new Uint8Array(base.length+extra.length);
  output.set(base.subarray(0,offset));output.set(extra,offset);output.set(bytes,offset+extra.length);
  const header=new DataView(output.buffer);header.setUint32(0,output.length,true);header.setUint32(8,version,true);
  return {bytes:output,extraOffset:offset};
}
