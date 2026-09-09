import {readFileSync} from 'node:fs';

export const fontSample = name => new Uint8Array(readFileSync(new URL(`../font-glyph-samples/${name}`,import.meta.url)));

/** 固件修改只定位公开 sfnt 表；验收始终通过 Provider 的注册结果。 */
export function fontTable(bytes, tag) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let i=0;i<view.getUint16(4);i++){
    const record=12+i*16;
    if(String.fromCharCode(...bytes.subarray(record,record+4))!==tag)continue;
    return {offset:view.getUint32(record+8),length:view.getUint32(record+12),record};
  }
  throw new Error(`固件缺少 ${tag}`);
}

export function fontWithPermissions(fsType, version=4) {
  const bytes=fontSample('latin.ttf'),os2=fontTable(bytes,'OS/2');
  const view=new DataView(bytes.buffer);view.setUint16(os2.offset,version);view.setUint16(os2.offset+8,fsType);
  return bytes;
}
