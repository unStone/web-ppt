export const END = 0xfffffffe, FREE = 0xffffffff, LIMIT = 256 * 1024 * 1024;
export const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
export const isCompoundFile = (bytes: Uint8Array) => [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => bytes[i] === v);
export interface CompoundEntry { path: string; name: string; type: number; raw: Uint8Array; bytes?: Uint8Array }
export interface CompoundFile { entries: CompoundEntry[]; header: Uint8Array }

/** 写回需要保留目录索引、存储层级及 CLSID，不能复用只按流名读取的 PPT 解析器。 */
export function readCompoundFile(bytes: Uint8Array): CompoundFile {
  if (!isCompoundFile(bytes) || bytes.length < 512 || bytes.length > LIMIT) throw new Error('CFB 文件无效或超限');
  const header = bytes.slice(0, 512), h = view(header), version = h.getUint16(26, true), shift = h.getUint16(30, true);
  if (h.getUint16(28, true) !== 0xfffe || !(version === 3 && shift === 9 || version === 4 && shift === 12)
    || h.getUint16(32, true) !== 6 || h.getUint32(56, true) !== 4096) throw new Error('CFB 扇区格式无效');
  const size = 2 ** shift, count = Math.floor(bytes.length / size) - 1;
  if (bytes.length % size) throw new Error('CFB 扇区被截断');
  const sector = (id: number) => {
    if (id >= count) throw new Error('CFB 扇区越界');
    return bytes.subarray((id + 1) * size, (id + 2) * size);
  };
  const ids: number[] = [], visited = new Set<number>();
  for (let i = 0; i < 109; i++) { const id = h.getUint32(76 + i * 4, true); if (id !== FREE) ids.push(id); }
  let next = h.getUint32(68, true);
  const difatCount = h.getUint32(72, true);
  if (difatCount > count) throw new Error('CFB DIFAT 数量无效');
  for (let i = 0; i < difatCount; i++) {
    if (visited.has(next)) throw new Error('CFB DIFAT 循环'); visited.add(next);
    const s = view(sector(next));
    for (let j = 0; j < size / 4 - 1; j++) { const id = s.getUint32(j * 4, true); if (id !== FREE) ids.push(id); }
    next = s.getUint32(size - 4, true);
  }
  if (difatCount && next !== END || ids.length !== h.getUint32(44, true)) throw new Error('CFB FAT 数量无效');
  const fat: number[] = [];
  for (const id of ids) {
    if (visited.has(id)) throw new Error('CFB FAT 扇区重叠'); visited.add(id);
    const s = view(sector(id)); for (let i = 0; i < size; i += 4) fat.push(s.getUint32(i, true));
  }
  const chain = (start: number, table: number[], max: number) => {
    const result: number[] = [], seen = new Set<number>();
    for (let id = start; id !== END;) {
      if (id >= max || id >= table.length || seen.has(id)) throw new Error('CFB 链循环或越界');
      seen.add(id); result.push(id); id = table[id];
    }
    return result;
  };
  const read = (start: number, length?: number) => {
    if (length === 0) return new Uint8Array();
    const chainIds = chain(start, fat, count), capacity = chainIds.length * size;
    if (length !== undefined && (length > capacity || capacity - length >= size)) throw new Error('CFB 流长度与链不符');
    const result = new Uint8Array(length ?? capacity);
    chainIds.forEach((id, i) => result.set(sector(id).subarray(0, Math.min(size, result.length - i * size)), i * size));
    return result;
  };
  const directory = read(h.getUint32(48, true));
  if (directory.length > 16 * 1024 * 1024) throw new Error('CFB 目录超限');
  const entries: CompoundEntry[] = [];
  for (let i = 0; i < directory.length; i += 128) {
    const raw = directory.slice(i, i + 128), d = view(raw), type = raw[66], length = d.getUint16(64, true);
    if (type && (![1, 2, 5].includes(type) || length < 2 || length > 64 || length % 2 || d.getUint16(length - 2, true))) throw new Error('CFB 目录项无效');
    let name = ''; for (let j = 0; type && j < length - 2; j += 2) name += String.fromCharCode(d.getUint16(j, true));
    entries.push({ path: '', name, type, raw });
  }
  if (entries[0]?.type !== 5) throw new Error('CFB 缺少根存储');
  const reached = new Set<number>([0]);
  const pending = [{ id: view(entries[0].raw).getUint32(76, true), parent: '', depth: 0 }];
  while (pending.length) {
    const { id, parent, depth } = pending.pop()!; if (id === FREE) continue;
    const entry = entries[id];
    if (!entry || ![1, 2].includes(entry.type) || reached.has(id) || depth > 64 || /[\/\0]/.test(entry.name)) throw new Error('CFB 目录层级无效');
    reached.add(id); entry.path = parent + entry.name; const d = view(entry.raw);
    pending.push({ id: d.getUint32(68, true), parent, depth }, { id: d.getUint32(72, true), parent, depth });
    if (entry.type === 1) pending.push({ id: d.getUint32(76, true), parent: entry.path + '/', depth: depth + 1 });
  }
  if (entries.some((entry, i) => entry.type && !reached.has(i))) throw new Error('CFB 目录包含孤立节点');
  const length = (entry: CompoundEntry) => {
    const d = view(entry.raw), n = d.getUint32(120, true) + (version === 4 ? d.getUint32(124, true) * 2 ** 32 : 0);
    if (n > LIMIT) throw new Error('CFB 流超限'); return n;
  };
  const mini = read(view(entries[0].raw).getUint32(116, true), length(entries[0]));
  const miniTable = read(h.getUint32(60, true), h.getUint32(64, true) * size), miniFat: number[] = [];
  for (let i = 0; i < miniTable.length; i += 4) miniFat.push(view(miniTable).getUint32(i, true));
  let total = 0;
  for (const entry of entries) if (entry.type === 2) {
    const n = length(entry), start = view(entry.raw).getUint32(116, true);
    if ((total += n) > LIMIT) throw new Error('CFB 流总量超限');
    if (n >= 4096 || n === 0) entry.bytes = read(start, n);
    else {
      const chainIds = chain(start, miniFat, Math.ceil(mini.length / 64));
      if (chainIds.length !== Math.ceil(n / 64)) throw new Error('CFB 小流长度无效');
      entry.bytes = new Uint8Array(n);
      chainIds.forEach((id, i) => entry.bytes!.set(mini.subarray(id * 64, id * 64 + Math.min(64, n - i * 64)), i * 64));
    }
  }
  return { entries, header };
}
