import { deflateSync } from 'fflate';
import { equalBytes } from './bytes';
import { crc32 } from './crc32';
import type { OpcFallbackReason } from './types';

const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const ALREADY_COMPRESSED = new Set([
  '7z', 'aac', 'avi', 'eot', 'gif', 'gz', 'jpeg', 'jpg', 'm4a', 'm4v', 'mov', 'mp3', 'mp4',
  'mpeg', 'mpg', 'ogg', 'otf', 'png', 'ttf', 'webm', 'webp', 'woff', 'woff2', 'zip',
]);
const compareNames = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly localRaw: Uint8Array;
  readonly centralRaw: Uint8Array;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
}

export interface RewrittenZip {
  readonly bytes: Uint8Array;
  readonly preservedEntries: number;
  readonly rewrittenEntries: number;
}

export class ZipPassthroughUnsupported extends Error {
  constructor(readonly reason: OpcFallbackReason, message: string) {
    super(message);
    this.name = 'ZipPassthroughUnsupported';
  }
}

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function ensureRange(bytes: Uint8Array, start: number, length: number, label: string): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0
    || start + length > bytes.length) {
    throw new Error(`ZIP ${label} 超出文件边界`);
  }
}

function findEnd(bytes: Uint8Array): number {
  if (bytes.length < 22) throw new Error('ZIP 缺少 EOCD');
  const view = viewOf(bytes);
  const lower = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= lower; offset--) {
    if (view.getUint32(offset, true) !== END_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error('ZIP 缺少有效 EOCD');
}

function decodeName(bytes: Uint8Array, flags: number): string {
  if (!(flags & 0x0800) && bytes.some((value) => value >= 0x80)) {
    throw new ZipPassthroughUnsupported('legacy-filename', 'ZIP 使用非 UTF-8 文件名，不能安全映射 OPC part');
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error('ZIP 文件名不是有效 UTF-8');
  }
}

function hasExtraField(
  bytes: Uint8Array,
  start: number,
  length: number,
  wantedId: number,
  label: string,
): boolean {
  ensureRange(bytes, start, length, label);
  const view = viewOf(bytes);
  const end = start + length;
  let cursor = start;
  while (cursor < end) {
    if (cursor + 4 > end) throw new Error(`ZIP ${label} 字段头不完整`);
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    if (cursor + 4 + size > end) throw new Error(`ZIP ${label} 字段超出 extra 边界`);
    if (id === wantedId) return true;
    cursor += 4 + size;
  }
  return false;
}

/** 读取标准单磁盘中央目录；不支持的特性后续由上层选择整包重压。 */
export function parseZipArchive(bytes: Uint8Array): ZipArchive {
  const end = findEnd(bytes);
  const view = viewOf(bytes);
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const diskEntries = view.getUint16(end + 8, true);
  const totalEntries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  const commentLength = view.getUint16(end + 20, true);
  if (end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR_SIGNATURE) {
    throw new ZipPassthroughUnsupported('zip64', 'ZIP64 定位器不支持直通');
  }
  if (disk || centralDisk || diskEntries !== totalEntries) {
    throw new ZipPassthroughUnsupported('multi-disk', 'ZIP 多磁盘格式不支持直通');
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ZipPassthroughUnsupported('zip64', 'ZIP64 不支持直通');
  }
  if (commentLength) {
    throw new ZipPassthroughUnsupported('archive-comment', '带存档注释的 ZIP 不支持直通');
  }
  ensureRange(bytes, centralOffset, centralSize, '中央目录');

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    ensureRange(bytes, cursor, 46, '中央目录条目');
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) throw new Error('ZIP 中央目录签名错误');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const entryDisk = view.getUint16(cursor + 34, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const centralLength = 46 + nameLength + extraLength + entryCommentLength;
    ensureRange(bytes, cursor, centralLength, '中央目录条目');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff || entryDisk === 0xffff) {
      throw new ZipPassthroughUnsupported('zip64', 'ZIP64 条目不支持直通');
    }
    if (entryDisk) throw new ZipPassthroughUnsupported('multi-disk', '跨磁盘 ZIP 条目不支持直通');
    if (flags & 1) throw new ZipPassthroughUnsupported('encrypted-entry', 'ZIP 加密条目不支持直通');
    if (flags & 8) {
      throw new ZipPassthroughUnsupported('data-descriptor', 'ZIP 数据描述符不支持直通');
    }
    if (method !== 0 && method !== 8) {
      throw new ZipPassthroughUnsupported('unsupported-compression', `ZIP 压缩方法 ${method} 不支持直通`);
    }
    const centralName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if (hasExtraField(bytes, cursor + 46 + nameLength, extraLength, ZIP64_EXTRA_ID,
      `中央目录 extra ${index + 1}`)) {
      throw new ZipPassthroughUnsupported('zip64', 'ZIP64 中央目录 extra 不支持直通');
    }
    const name = decodeName(centralName, flags);
    if (names.has(name)) throw new Error(`ZIP 存在重复条目：${name}`);
    names.add(name);

    ensureRange(bytes, localOffset, 30, `本地头 ${name}`);
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error(`ZIP 本地头签名错误：${name}`);
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    if (localFlags & 1) {
      throw new ZipPassthroughUnsupported('encrypted-entry', 'ZIP 本地头声明加密，不支持直通');
    }
    if (localFlags & 8) {
      throw new ZipPassthroughUnsupported('data-descriptor', 'ZIP 本地头使用数据描述符，不支持直通');
    }
    if (localMethod !== 0 && localMethod !== 8) {
      throw new ZipPassthroughUnsupported('unsupported-compression',
        `ZIP 本地头压缩方法 ${localMethod} 不支持直通`);
    }
    if (localFlags !== flags || localMethod !== method
      || view.getUint32(localOffset + 14, true) !== view.getUint32(cursor + 16, true)
      || view.getUint32(localOffset + 18, true) !== compressedSize
      || view.getUint32(localOffset + 22, true) !== uncompressedSize) {
      throw new Error(`ZIP 本地头与中央目录元数据不一致：${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    if (hasExtraField(bytes, localOffset + 30 + localNameLength, localExtraLength, ZIP64_EXTRA_ID,
      `本地头 extra ${name}`)) {
      throw new ZipPassthroughUnsupported('zip64', 'ZIP64 本地头 extra 不支持直通');
    }
    const localLength = 30 + localNameLength + localExtraLength + compressedSize;
    ensureRange(bytes, localOffset, localLength, `本地条目 ${name}`);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (!equalBytes(localName, centralName)) throw new Error(`ZIP 本地头与中央目录名称不一致：${name}`);
    entries.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      localRaw: bytes.subarray(localOffset, localOffset + localLength),
      centralRaw: bytes.subarray(cursor, cursor + centralLength),
    });
    cursor += centralLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('ZIP 中央目录包含未识别记录');
  if (cursor !== end) {
    if (cursor + 4 <= bytes.length && view.getUint32(cursor, true) === ZIP64_END_SIGNATURE) {
      throw new ZipPassthroughUnsupported('zip64', 'ZIP64 EOCD 记录不支持直通');
    }
    throw new Error('ZIP 中央目录与 EOCD 之间存在未识别记录');
  }
  return { entries };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

interface DirtyLocal {
  readonly bytes: Uint8Array;
  readonly checksum: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

function rewriteLocal(entry: ZipEntry, data: Uint8Array): DirtyLocal {
  if (data.length > 0xffffffff) throw new Error(`OPC part 过大，需要 ZIP64：${entry.name}`);
  const payload = entry.method === 8 ? deflateSync(data, { level: 6 }) : data;
  if (payload.length > 0xffffffff) throw new Error(`OPC part 压缩后过大，需要 ZIP64：${entry.name}`);
  const headerLength = entry.localRaw.length - entry.compressedSize;
  const output = new Uint8Array(headerLength + payload.length);
  output.set(entry.localRaw.subarray(0, headerLength));
  output.set(payload, headerLength);
  const view = viewOf(output);
  const checksum = crc32(data);
  view.setUint32(14, checksum, true);
  view.setUint32(18, payload.length, true);
  view.setUint32(22, data.length, true);
  return { bytes: output, checksum, compressedSize: payload.length, uncompressedSize: data.length };
}

function rewriteCentral(
  entry: ZipEntry,
  dirty: DirtyLocal | null,
  localOffset: number,
): Uint8Array {
  const output = entry.centralRaw.slice();
  const view = viewOf(output);
  if (dirty) {
    view.setUint32(16, dirty.checksum, true);
    view.setUint32(20, dirty.compressedSize, true);
    view.setUint32(24, dirty.uncompressedSize, true);
  }
  view.setUint32(42, localOffset, true);
  return output;
}

export function rewriteZipArchive(
  archive: ZipArchive,
  changes: ReadonlyMap<string, Uint8Array | null>,
): RewrittenZip {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  let preservedEntries = 0;
  let rewrittenEntries = 0;
  const existing = new Set(archive.entries.map((entry) => entry.name));
  for (const entry of archive.entries) {
    const replacement = changes.get(entry.name);
    if (replacement === null) {
      rewrittenEntries++;
      continue;
    }
    const dirty = replacement ? rewriteLocal(entry, replacement) : null;
    const local = dirty?.bytes ?? entry.localRaw;
    locals.push(local);
    centrals.push(rewriteCentral(entry, dirty, offset));
    offset += local.length;
    if (replacement) rewrittenEntries++;
    else preservedEntries++;
  }
  const additions = [...changes]
    .filter(([name, bytes]) => !existing.has(name) && bytes !== null)
    .sort(([left], [right]) => compareNames(left, right));
  for (const [name, data] of additions) {
    const created = createEntry(name, data!, offset);
    locals.push(created.local);
    centrals.push(created.central);
    offset += created.local.length;
    rewrittenEntries++;
  }
  const entryCount = locals.length;
  if (entryCount > 0xffff) throw new Error('保存结果需要 ZIP64 条目计数，当前不支持');
  const centralOffset = offset;
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  if (centralOffset > 0xffffffff || centralSize > 0xffffffff) {
    throw new Error('保存结果需要 ZIP64 偏移，当前不支持');
  }
  const end = new Uint8Array(22);
  const endView = viewOf(end);
  endView.setUint32(0, END_SIGNATURE, true);
  endView.setUint16(8, entryCount, true);
  endView.setUint16(10, entryCount, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return { bytes: concat([...locals, ...centrals, end]), preservedEntries, rewrittenEntries };
}

/** 不支持直通时从已解压 part 确定性重建；不复用任何可能含不兼容语义的 ZIP 元数据。 */
export function repackZipParts(
  parts: Readonly<Record<string, Uint8Array>>,
  changes: ReadonlyMap<string, Uint8Array | null>,
): RewrittenZip {
  const sourceNames = Object.keys(parts);
  const sourceSet = new Set(sourceNames);
  const names = sourceNames.filter((name) => changes.get(name) !== null);
  names.push(...[...changes]
    .filter(([name, data]) => !sourceSet.has(name) && data !== null)
    .map(([name]) => name)
    .sort(compareNames));
  if (names.length > 0xffff) throw new Error('重压结果需要 ZIP64 条目计数，当前不支持');
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const name of names) {
    const data = changes.get(name) ?? parts[name];
    if (!data) throw new Error(`重压时缺少 OPC part：${name}`);
    const created = createEntry(name, data, offset);
    locals.push(created.local);
    centrals.push(created.central);
    offset += created.local.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  if (offset > 0xffffffff || centralSize > 0xffffffff) throw new Error('重压结果需要 ZIP64 偏移，当前不支持');
  const end = new Uint8Array(22);
  const view = viewOf(end);
  view.setUint32(0, END_SIGNATURE, true);
  view.setUint16(8, names.length, true);
  view.setUint16(10, names.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  return {
    bytes: concat([...locals, ...centrals, end]),
    preservedEntries: 0,
    rewrittenEntries: names.length,
  };
}

function createEntry(name: string, data: Uint8Array, localOffset: number): {
  local: Uint8Array;
  central: Uint8Array;
} {
  if (data.length > 0xffffffff) throw new Error(`OPC part 过大，需要 ZIP64：${name}`);
  const nameBytes = encoder.encode(name);
  if (nameBytes.length > 0xffff) throw new Error(`OPC part 路径过长：${name.slice(0, 80)}`);
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const deflated = ALREADY_COMPRESSED.has(extension) ? null : deflateSync(data, { level: 6 });
  const useDeflate = deflated !== null && deflated.length < data.length;
  const method = useDeflate ? 8 : 0;
  const payload = useDeflate ? deflated : data;
  if (payload.length > 0xffffffff) throw new Error(`OPC part 压缩后过大，需要 ZIP64：${name}`);
  const checksum = crc32(data);
  const local = new Uint8Array(30 + nameBytes.length + payload.length);
  const localView = viewOf(local);
  localView.setUint32(0, LOCAL_SIGNATURE, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0x0800, true);
  localView.setUint16(8, method, true);
  localView.setUint16(12, 0x0021, true);
  localView.setUint32(14, checksum, true);
  localView.setUint32(18, payload.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(payload, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = viewOf(central);
  centralView.setUint32(0, CENTRAL_SIGNATURE, true);
  centralView.setUint16(4, 0x031e, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0x0800, true);
  centralView.setUint16(10, method, true);
  centralView.setUint16(14, 0x0021, true);
  centralView.setUint32(16, checksum, true);
  centralView.setUint32(20, payload.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint32(42, localOffset, true);
  central.set(nameBytes, 46);
  return { local, central };
}
