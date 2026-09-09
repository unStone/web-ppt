import type {FontFaceInfo} from './types';
import {embeddingRights} from './permissions';
import {FontFault,invalidFont,resourceLimit} from './fault';

export interface FontTable {offset: number; length: number}
export interface SfntFont {
  tables: ReadonlyMap<string, FontTable>;
  info: Omit<FontFaceInfo, 'id' | 'family' | 'origin'>;
}

export function inspectSfnt(bytes: Uint8Array): SfntFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = invalidFont;
  if (bytes.length < 4) fail();
  const magic = view.getUint32(0);
  if ([0x774f4646,0x774f4632].includes(magic)) throw new FontFault('needs-container-decoder');
  if (magic === 0x74746366) throw new FontFault('collection-not-supported');
  if (bytes.length < 12 || ![0x10000,0x74727565,0x4f54544f].includes(magic)) fail();
  const count = view.getUint16(4), directoryEnd = 12 + count * 16;
  if (!count || count > 256 || directoryEnd > bytes.length) fail();
  const tables = new Map<string, FontTable>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16, tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    if (tables.has(tag) || offset < directoryEnd || offset % 4 || offset + length > bytes.length) fail();
    tables.set(tag, {offset, length});
  }
  const occupied = [...tables.values()].filter(table => table.length).sort((a,b) => a.offset - b.offset);
  if (occupied.some((table,i) => i > 0 && occupied[i - 1].offset + occupied[i - 1].length > table.offset)) fail();
  const required = (name: string, length: number): number => {
    const table = tables.get(name);
    if (!table || table.length < length) return fail();
    return table.offset;
  };
  if (tables.has('fvar')) throw new FontFault('variable-not-supported');
  if (tables.has('CFF ') || tables.has('CFF2')) throw new FontFault('cff-not-supported');
  if (['COLR','CPAL','CBDT','CBLC','sbix','SVG '].some(tag => tables.has(tag))) throw new FontFault('color-font-not-supported');
  if (magic === 0x4f54544f) fail();
  required('glyf', 0); required('loca', 4); required('cmap', 4); required('hmtx', 4);
  const head = required('head', 54), os2 = required('OS/2', 78), maxp = required('maxp', 32);
  const os2Version = view.getUint16(os2);
  required('OS/2',os2Version === 0 ? 78 : os2Version === 1 ? 86 : os2Version < 5 ? 96 : 100);
  required('hhea', 36);
  const unitsPerEm = view.getUint16(head + 18), glyphCount = view.getUint16(maxp + 4);
  const weight = view.getUint16(os2 + 4), fsType = view.getUint16(os2 + 8);
  if (view.getUint32(head + 12) !== 0x5f0f3cf5 || unitsPerEm < 16 || unitsPerEm > 16384 ||
      !glyphCount || weight < 1 || weight > 1000 || view.getUint32(maxp) !== 0x10000) fail();
  const name = required('name', 6), length = tables.get('name')!.length;
  const names = view.getUint16(name + 2), strings = view.getUint16(name + 4);
  if (6 + names * 12 > length || strings < 6 + names * 12 || strings > length) fail();
  if (names > 1024) resourceLimit();
  const familyNames: Array<{value: string; rank: number}> = [];
  let remainingNameBytes = 65536;
  for (let i = 0; i < names; i++) {
    const at = name + 6 + i * 12;
    const platform = view.getUint16(at), language = view.getUint16(at + 4), id = view.getUint16(at + 6);
    const size = view.getUint16(at + 8), start = strings + view.getUint16(at + 10);
    if (start + size > length) fail();
    if ((id !== 16 && id !== 1) || ![0,3].includes(platform) || size % 2) continue;
    // 重复记录可以共用字符串存储；解码预算必须按工作量计，不能只看表字节数。
    if (size > 512) continue;
    remainingNameBytes -= size;
    if (remainingNameBytes < 0) resourceLimit();
    const value = new TextDecoder('utf-16be', {fatal:true}).decode(bytes.subarray(name + start, name + start + size)).trim();
    if (value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)) {
      familyNames.push({value, rank:(id === 16 ? 10 : 0) + (language === 0x409 ? 2 : 0)});
    }
  }
  const sourceFamily = familyNames.sort((a,b) => b.rank - a.rank)[0]?.value;
  if (!sourceFamily) fail();
  return {tables, info:{sourceFamily, weight, italic:!!(view.getUint16(os2 + 62) & 1), format:'ttf-glyf',
    unitsPerEm, glyphCount, bbox:[36,38,40,42].map(at => view.getInt16(head + at)) as [number,number,number,number],
    fsType, os2Version:view.getUint16(os2), embedding:embeddingRights(fsType,view.getUint16(os2)), byteLength:bytes.length}};
}
