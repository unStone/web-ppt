import { END, FREE, LIMIT, view } from './read';
import type { CompoundFile } from './read';

/** 统一输出 v3；重排扇区但保留目录身份、树指针、CLSID 和未知元数据。 */
export function writeCompoundFile(file: CompoundFile): Uint8Array {
  const entries = file.entries.map((entry) => ({ ...entry, raw: entry.raw.slice() }));
  if (entries[0]?.type !== 5) throw new Error('CFB 缺少根存储');
  const miniData: Uint8Array[] = [], miniFat: number[] = [], fat: number[] = [], sectors: Uint8Array[] = [];
  let total = 0;
  const allocate = (bytes: Uint8Array) => {
    const first = bytes.length ? sectors.length : END;
    for (let i = 0; i < bytes.length; i += 512) {
      if ((total += 512) > LIMIT) throw new Error('CFB 写入超限');
      const block = new Uint8Array(512); block.set(bytes.subarray(i, i + 512));
      sectors.push(block); fat.push(i + 512 < bytes.length ? sectors.length : END);
    }
    return first;
  };
  for (const entry of entries) if (entry.type === 2) {
    const bytes = entry.bytes ?? new Uint8Array(), d = view(entry.raw);
    d.setUint32(120, bytes.length, true); d.setUint32(124, 0, true);
    if (bytes.length >= 4096 || !bytes.length) d.setUint32(116, allocate(bytes), true);
    else {
      d.setUint32(116, miniData.length, true);
      for (let i = 0; i < bytes.length; i += 64) {
        const block = new Uint8Array(64); block.set(bytes.subarray(i, i + 64));
        miniData.push(block); miniFat.push(i + 64 < bytes.length ? miniData.length : END);
      }
    }
  }
  const miniStream = new Uint8Array(miniData.length * 64); miniData.forEach((b, i) => miniStream.set(b, i * 64));
  const root = view(entries[0].raw); root.setUint32(116, allocate(miniStream), true); root.setUint32(120, miniStream.length, true); root.setUint32(124, 0, true);
  const miniTable = new Uint8Array(Math.ceil(miniFat.length / 128) * 512).fill(255);
  miniFat.forEach((id, i) => view(miniTable).setUint32(i * 4, id, true));
  const miniStart = allocate(miniTable);
  const directory = new Uint8Array(Math.ceil(entries.length / 4) * 512);
  entries.forEach((entry, i) => directory.set(entry.raw, i * 128));
  const directoryStart = allocate(directory), dataCount = sectors.length;
  let fatCount = 0, difatCount = 0;
  for (;;) {
    const f = Math.ceil((dataCount + fatCount + difatCount) / 128), d = Math.max(0, Math.ceil((f - 109) / 127));
    if (f === fatCount && d === difatCount) break;
    fatCount = f; difatCount = d;
  }
  const result = new Uint8Array((1 + dataCount + fatCount + difatCount) * 512);
  if (result.length > LIMIT) throw new Error('CFB 写入超限');
  result.set(file.header.subarray(0, 512)); const h = view(result.subarray(0, 512));
  result.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  h.setUint16(24, 0x3e, true); h.setUint16(26, 3, true); h.setUint16(28, 0xfffe, true);
  h.setUint16(30, 9, true); h.setUint16(32, 6, true); result.fill(0, 34, 44);
  h.setUint32(44, fatCount, true); h.setUint32(48, directoryStart, true); h.setUint32(56, 4096, true);
  h.setUint32(60, miniStart, true); h.setUint32(64, miniTable.length / 512, true);
  h.setUint32(68, difatCount ? dataCount + fatCount : END, true); h.setUint32(72, difatCount, true);
  for (let i = 0; i < 109; i++) h.setUint32(76 + i * 4, i < fatCount ? dataCount + i : FREE, true);
  sectors.forEach((b, i) => result.set(b, (i + 1) * 512));
  for (let i = 0; i < fatCount; i++) fat.push(0xfffffffd);
  for (let i = 0; i < difatCount; i++) fat.push(0xfffffffc);
  result.fill(255, (dataCount + 1) * 512);
  fat.forEach((id, i) => view(result).setUint32((dataCount + 1) * 512 + i * 4, id, true));
  for (let i = 0; i < difatCount; i++) {
    const block = view(result.subarray((dataCount + fatCount + i + 1) * 512));
    for (let j = 0; j < 127; j++) {
      const id = 109 + i * 127 + j; block.setUint32(j * 4, id < fatCount ? dataCount + id : FREE, true);
    }
    block.setUint32(508, i + 1 < difatCount ? dataCount + fatCount + i + 1 : END, true);
  }
  return result;
}
