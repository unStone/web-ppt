import type {FontEmbeddingRights} from './types';
import {embeddingRights} from './permissions';
import {FontFault,invalidFont} from './fault';

export interface EotContainer {offset: number; size: number; flags: number; rights: FontEmbeddingRights}

export function isEot(bytes: Uint8Array): boolean {
  if (bytes.length < 36 || bytes[34] !== 0x4c || bytes[35] !== 0x50) return false;
  const magic = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
  return ![0x10000,0x74727565,0x4f54544f,0x74746366,0x774f4646,0x774f4632].includes(magic);
}

export function inspectEot(bytes: Uint8Array): EotContainer {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (bytes.length < 96 || !isEot(bytes) || view.getUint32(0,true) !== bytes.length) invalidFont();
  const version = view.getUint32(8,true), flags = view.getUint32(12,true), size = view.getUint32(4,true);
  if (![0x10000,0x20001,0x20002].includes(version) || flags & ~0x100000f5) throw new FontFault('eot-feature-not-supported');
  if (!size || size > bytes.length - 96) invalidFont();
  const end = bytes.length - size;
  let cursor = 80;
  const need = (length: number) => { if (cursor + length > end) invalidFont(); };
  const word = () => { need(2); const value = view.getUint16(cursor,true); cursor += 2; return value; };
  const long = () => { need(4); const value = view.getUint32(cursor,true); cursor += 4; return value; };
  const string = () => {
    if (word()) invalidFont();
    const length = word(); if (length % 2) invalidFont();
    need(length);
    const value = new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(cursor,cursor + length));
    cursor += length; return value;
  };
  for (let i = 64; i < 80; i += 4) if (view.getUint32(i,true)) invalidFont();
  for (let i = 0; i < 4; i++) string();
  if (version !== 0x10000) {
    const roots = string();
    // RootString 绑定网页地址。离线文稿不能把域名许可自动扩展为任意导出文件。
    if (roots.replace(/\0/g,'')) throw new FontFault('eot-root-restricted');
    if (version === 0x20002) {
      const checksum = long(); long();
      if (checksum !== 0x50475342) invalidFont();
      if (word()) invalidFont();
      const signature = word(); need(signature); cursor += signature;
      const eudcFlags = long(), eudcSize = long(); need(eudcSize); cursor += eudcSize;
      // Office 会给没有 EUDC 载荷的字体写入默认 codepage；只有载荷和标志要求额外处理。
      if (signature || eudcFlags || eudcSize) throw new FontFault('eot-feature-not-supported');
    }
  }
  if (cursor !== end) invalidFont();
  if (flags & 0x20) throw new FontFault('eot-feature-not-supported');
  // EOT 没有 OS/2 版本字段，按容器规范允许旧字体的混合使用位，并保留高位限制。
  const rights = embeddingRights(view.getUint16(32,true),2);
  if (flags & 1 && !rights.subsetAllowed) throw new FontFault('subset-not-permitted');
  return {offset:end,size,flags,rights};
}

export function unpackPlainEot(bytes: Uint8Array, eot: EotContainer): Uint8Array {
  const data = bytes.slice(eot.offset);
  if (eot.flags & 0x10000000) for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  return data;
}
