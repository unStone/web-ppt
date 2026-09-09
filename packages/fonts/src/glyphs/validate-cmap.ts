import type {SfntFont} from './sfnt';
import {FontFault,invalidFont,resourceLimit} from './fault';
import type {FontValidationPause} from './validation-budget';

/** 只验证字符映射范围；实际选字仍交给整形器，避免两套 cmap 选择规则。 */
export async function validateCmap(bytes: Uint8Array, font: SfntFont, pause: FontValidationPause): Promise<void> {
  const table = font.tables.get('cmap')!;
  const view = new DataView(bytes.buffer,bytes.byteOffset + table.offset,table.length);
  const count = view.getUint16(2), header = 4 + count * 8;
  if (view.getUint16(0) || !count || header > view.byteLength) invalidFont();
  if (count > 256) resourceLimit();
  let unicode = false, remaining = 2_000_000;
  const seen = new Set<number>();
  const gid = (value: number) => { if (value >= font.info.glyphCount) invalidFont(); };
  const spend = (amount: number) => { remaining -= amount; if (remaining < 0) resourceLimit(); };
  for (let i = 0; i < count; i++) {
    const wait = pause(); if (wait) await wait;
    const at = 4 + i * 8, platform = view.getUint16(at), encoding = view.getUint16(at + 2);
    const start = view.getUint32(at + 4);
    if (start < header || start + 6 > view.byteLength) invalidFont();
    const format = view.getUint16(start);
    if ((platform === 0 && encoding !== 5 || platform === 3 && [1,10].includes(encoding)) &&
        [4,6,10,12,13].includes(format)) unicode = true;
    if (![0,4,6,10,12,13,14].includes(format)) throw new FontFault('cmap-not-supported');
    if (format >= 10 && format !== 14 && start + 12 > view.byteLength) invalidFont();
    const length = format === 14 ? view.getUint32(start + 2) : format >= 10 ? view.getUint32(start + 4) : view.getUint16(start + 2);
    if (length < 6 || start + length > view.byteLength) invalidFont();
    const sub = new DataView(bytes.buffer,bytes.byteOffset + table.offset + start,length);
    const need = (offset: number, size: number) => { if (offset < 0 || offset + size > length) invalidFont(); };
    // 非 Macintosh 子表的 language 必须为零；HarfBuzz 忽略它不代表浏览器会接受。
    if (platform !== 1 && format !== 14 && (format >= 10 ? sub.getUint32(8) : sub.getUint16(4))) invalidFont();
    if (seen.has(start)) continue;
    seen.add(start);
    if (format === 0) {
      need(6,256); spend(256);
      for (let j = 0; j < 256; j++) gid(sub.getUint8(6 + j));
    } else if (format === 4) {
      need(0,16);
      const doubled = sub.getUint16(6), segments = doubled / 2, arraysEnd = 16 + segments * 8;
      if (!doubled || doubled % 2) invalidFont();
      need(0,arraysEnd);
      if (sub.getUint16(14 + segments * 2)) invalidFont();
      let previous = -1;
      for (let j = 0; j < segments; j++) {
        const wait = pause(); if (wait) await wait;
        const end = sub.getUint16(14 + j * 2), begin = sub.getUint16(16 + segments * 2 + j * 2);
        const delta = sub.getInt16(16 + segments * 4 + j * 2), pos = 16 + segments * 6 + j * 2;
        const offset = sub.getUint16(pos);
        if (begin > end || begin <= previous || offset % 2 ||
            (j === segments - 1 && (begin !== 65535 || end !== 65535))) invalidFont();
        previous = end; spend(end - begin + 1);
        if (offset && pos + offset < arraysEnd) invalidFont();
        if (offset) need(pos + offset,(end - begin + 1) * 2);
        for (let code = begin; code <= end; code++) {
          const value = offset ? sub.getUint16(pos + offset + (code - begin) * 2) : code;
          gid(offset && !value ? 0 : (value + delta) & 65535);
        }
      }
    } else if (format === 6 || format === 10) {
      const wide = format === 10, base = wide ? 20 : 10;
      need(0,base);
      const begin = wide ? sub.getUint32(12) : sub.getUint16(6), entries = wide ? sub.getUint32(16) : sub.getUint16(8);
      if (begin + entries > (wide ? 0x110000 : 0x10000) || wide && sub.getUint16(2)) invalidFont();
      need(base,entries * 2); spend(entries);
      for (let j = 0; j < entries; j++) {
        if (j % 256 === 0) { const wait = pause(); if (wait) await wait; }
        gid(sub.getUint16(base + j * 2));
      }
    } else if (format === 12 || format === 13) {
      need(0,16);
      const groups = sub.getUint32(12);
      if (sub.getUint16(2)) invalidFont();
      need(16,groups * 12); spend(groups);
      let previous = -1;
      for (let j = 0; j < groups; j++) {
        if (j % 256 === 0) { const wait = pause(); if (wait) await wait; }
        const pos = 16 + j * 12, begin = sub.getUint32(pos), end = sub.getUint32(pos + 4), first = sub.getUint32(pos + 8);
        if (begin > end || begin <= previous || end > 0x10ffff) invalidFont();
        gid(first); gid(first + (format === 12 ? end - begin : 0)); previous = end;
      }
    } else {
      need(0,10);
      const records = sub.getUint32(6), endRecords = 10 + records * 11;
      need(0,endRecords); spend(records);
      const uint24 = (pos: number) => sub.getUint16(pos) * 256 + sub.getUint8(pos + 2);
      let lastSelector = -1;
      for (let j = 0; j < records; j++) {
        const wait = pause(); if (wait) await wait;
        const pos = 10 + j * 11, selector = uint24(pos);
        if (selector <= lastSelector || !((selector >= 0xfe00 && selector <= 0xfe0f) ||
            (selector >= 0xe0100 && selector <= 0xe01ef))) invalidFont();
        lastSelector = selector;
        for (const kind of [0,1]) {
          const offset = sub.getUint32(pos + 3 + kind * 4);
          if (!offset) continue;
          if (offset < endRecords) invalidFont();
          need(offset,4);
          const entries = sub.getUint32(offset), stride = kind ? 5 : 4;
          need(offset + 4,entries * stride); spend(entries);
          let previous = -1;
          for (let k = 0; k < entries; k++) {
            if (k % 256 === 0) { const wait = pause(); if (wait) await wait; }
            const at = offset + 4 + k * stride, begin = uint24(at), end = begin + (kind ? 0 : sub.getUint8(at + 3));
            if (begin <= previous || end > 0x10ffff || begin <= 0xdfff && end >= 0xd800) invalidFont();
            if (kind) gid(sub.getUint16(at + 3));
            previous = end;
          }
        }
      }
    }
  }
  if (!unicode) throw new FontFault('cmap-not-supported');
}
