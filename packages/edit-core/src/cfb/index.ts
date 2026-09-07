import { readCompoundFile, END, FREE, view } from './read';
import type { CompoundEntry } from './read';
import { writeCompoundFile } from './write';
export { isCompoundFile, readCompoundFile } from './read';
export type { CompoundFile, CompoundEntry } from './read';
export { writeCompoundFile } from './write';

export function patchCompoundFile(bytes: Uint8Array, streams: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const file = readCompoundFile(bytes);
  for (const [path, value] of Object.entries(streams)) {
    const entry = file.entries.find((entry) => entry.path === path && entry.type === 2);
    if (!entry) throw new Error(`CFB 流不存在：${path}`); entry.bytes = value;
  }
  return writeCompoundFile(file);
}

const upper = (name: string) => name.split('').map((c) => { const u = c.toUpperCase(); return u.length === 1 ? u : c; }).join('');
export function createCompoundFile(streams: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const entries: CompoundEntry[] = [], children = new Map<number, number[]>();
  const add = (name: string, path: string, type: number, bytes?: Uint8Array) => {
    if (!name || name.length > 31 || /[\\/:!\0]/.test(name)) throw new Error('CFB 流名称无效');
    const raw = new Uint8Array(128), d = view(raw);
    for (let i = 0; i < name.length; i++) d.setUint16(i * 2, name.charCodeAt(i), true);
    d.setUint16(64, (name.length + 1) * 2, true); raw[66] = type; raw[67] = 1;
    for (const offset of [68, 72, 76]) d.setUint32(offset, FREE, true);
    d.setUint32(116, type === 1 ? 0 : END, true);
    entries.push({ name, path, type, raw, bytes }); return entries.length - 1;
  };
  add('Root Entry', '', 5);
  for (const [path, bytes] of Object.entries(streams).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const names = path.split('/'); let parent = 0, prefix = '';
    names.forEach((name, i) => {
      const siblings = children.get(parent) ?? [], last = i === names.length - 1;
      const existing = siblings.find((id) => upper(entries[id].name) === upper(name));
      if (existing !== undefined) {
        if (last || entries[existing].type !== 1) throw new Error('CFB 路径冲突'); parent = existing;
      } else {
        const id = add(name, prefix + name, last ? 2 : 1, last ? bytes : undefined);
        siblings.push(id); children.set(parent, siblings); parent = id;
      }
      prefix += name + '/';
    });
  }
  for (const [parent, ids] of children) {
    ids.sort((a, b) => entries[a].name.length - entries[b].name.length || (upper(entries[a].name) < upper(entries[b].name) ? -1 : 1));
    // 最深的不完整层染红，使每条根到空叶子的路径拥有相同数量的黑节点。
    const redLevel = Math.floor(Math.log2(ids.length + 1));
    const tree = (lo: number, hi: number, depth = 0): number => {
      if (lo >= hi) return FREE; const mid = (lo + hi) >>> 1, id = ids[mid], d = view(entries[id].raw);
      entries[id].raw[67] = depth === redLevel ? 0 : 1;
      d.setUint32(68, tree(lo, mid, depth + 1), true); d.setUint32(72, tree(mid + 1, hi, depth + 1), true); return id;
    };
    view(entries[parent].raw).setUint32(76, tree(0, ids.length), true);
  }
  return writeCompoundFile({ entries, header: new Uint8Array(512) });
}
