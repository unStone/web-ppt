import { inflateSync } from 'fflate';
import type { UnzipFileFilter, UnzipFileInfo } from 'fflate';

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const MAX_END_SEARCH = 22 + 0xffff;
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  readonly maxCompressionRatio: number;
}

export type ZipLimitOptions = Partial<ZipLimits>;

export type ZipSafetyReason =
  | 'zip-invalid-limit'
  | 'zip-invalid-structure'
  | 'zip64-unsupported'
  | 'zip-too-many-entries'
  | 'zip-entry-too-large'
  | 'zip-total-too-large'
  | 'zip-compression-ratio'
  | 'zip-invalid-name'
  | 'zip-duplicate-name'
  | 'zip-size-mismatch'
  | 'zip-output-too-large';

export class ZipSafetyError extends Error {
  constructor(
    readonly reason: ZipSafetyReason,
    message: string,
  ) {
    super(message);
    this.name = 'ZipSafetyError';
  }
}

export const DEFAULT_ZIP_LIMITS: Readonly<ZipLimits> = Object.freeze({
  maxEntries: 4096,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 1000,
});

export interface SafeUnzipOptions {
  readonly limits?: ZipLimitOptions;
  readonly filter?: UnzipFileFilter;
}

interface ZipEntry extends UnzipFileInfo {
  readonly flags: number;
  readonly payload: Uint8Array;
}

function fail(reason: ZipSafetyReason, message: string): never {
  throw new ZipSafetyError(reason, message);
}

function resolveLimits(options: ZipLimitOptions | undefined): ZipLimits {
  const limits = { ...DEFAULT_ZIP_LIMITS, ...options };
  for (const key of ['maxEntries', 'maxEntryBytes', 'maxTotalBytes'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      fail('zip-invalid-limit', `ZIP ${key} 必须是正安全整数，收到 ${limits[key]}`);
    }
  }
  if (!Number.isFinite(limits.maxCompressionRatio) || limits.maxCompressionRatio <= 0) {
    fail('zip-invalid-limit', `ZIP maxCompressionRatio 必须是正有限数，收到 ${limits.maxCompressionRatio}`);
  }
  return limits;
}

function normalizeName(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    fail('zip-invalid-name', `ZIP 条目名称不是安全的包内相对路径：${name}`);
  }
  const segments = normalized.split('/');
  const directory = normalized.endsWith('/');
  if (
    segments.some((segment, index) => segment === '.' || segment === '..' || (!segment && !(directory && index === segments.length - 1)))
  ) {
    fail('zip-invalid-name', `ZIP 条目包含路径穿越、当前目录或空路径段：${name}`);
  }
  return normalized;
}

function findEnd(source: Uint8Array): number {
  if (source.length < 22) fail('zip-invalid-structure', 'ZIP 长度不足，缺少 EOCD');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const lower = Math.max(0, source.length - MAX_END_SEARCH);
  for (let offset = source.length - 22; offset >= lower; offset--) {
    if (view.getUint32(offset, true) !== END_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === source.length) return offset;
    const tail = source.length - offset - 22;
    // 部分真实语料在零注释 EOCD 后多一个文本换行；只豁免 LF / CRLF，不接受其他尾随数据。
    if (
      commentLength === 0
      && ((tail === 1 && source[offset + 22] === 0x0a) || (tail === 2 && source[offset + 22] === 0x0d && source[offset + 23] === 0x0a))
    )
      return offset;
  }
  return fail('zip-invalid-structure', 'ZIP EOCD 或注释长度无效');
}

function ensureRange(source: Uint8Array, start: number, length: number, end: number, label: string): void {
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(length)
    || start < 0
    || length < 0
    || start + length > end
    || start + length > source.length
  ) {
    fail('zip-invalid-structure', `ZIP ${label} 超出允许边界`);
  }
}

function decodeName(source: Uint8Array, start: number, length: number): string {
  try {
    return normalizeName(decoder.decode(source.subarray(start, start + length)));
  } catch (error) {
    if (error instanceof ZipSafetyError) throw error;
    return fail('zip-invalid-name', 'ZIP 条目名称不是有效 UTF-8');
  }
}

/** 中央目录预检同时缓存压缩负载位置，惰性 part 补解无需重扫整个文件。 */
export class ZipReader {
  readonly limits: ZipLimits;
  private readonly entries = new Map<string, ZipEntry>();

  constructor(
    private readonly source: Uint8Array,
    limits?: ZipLimitOptions,
  ) {
    this.limits = resolveLimits(limits);
    this.inspectCentral();
  }

  private inspectCentral(): void {
    const end = findEnd(this.source);
    const view = new DataView(this.source.buffer, this.source.byteOffset, this.source.byteLength);
    if (
      (end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR_SIGNATURE)
      || view.getUint16(end + 8, true) === 0xffff
      || view.getUint16(end + 10, true) === 0xffff
      || view.getUint32(end + 12, true) === 0xffffffff
      || view.getUint32(end + 16, true) === 0xffffffff
    ) {
      fail('zip64-unsupported', 'ZIP64 当前不支持安全大小与边界校验');
    }
    const disk = view.getUint16(end + 4, true);
    const centralDisk = view.getUint16(end + 6, true);
    const diskEntries = view.getUint16(end + 8, true);
    const totalEntries = view.getUint16(end + 10, true);
    const centralSize = view.getUint32(end + 12, true);
    const centralOffset = view.getUint32(end + 16, true);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
      fail('zip-invalid-structure', 'ZIP 多磁盘或 EOCD 条目计数不一致');
    }
    if (centralOffset > end || centralSize !== end - centralOffset) {
      fail('zip-invalid-structure', 'ZIP 中央目录边界与 EOCD 不一致');
    }
    if (totalEntries > this.limits.maxEntries) {
      fail('zip-too-many-entries', `ZIP 条目数 ${totalEntries} 超过上限 ${this.limits.maxEntries}`);
    }

    const names = new Set<string>();
    let total = 0;
    let cursor = centralOffset;
    for (let index = 0; index < totalEntries; index++) {
      ensureRange(this.source, cursor, 46, end, `中央目录条目 ${index + 1}`);
      if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
        fail('zip-invalid-structure', `ZIP 中央目录条目 ${index + 1} 签名错误`);
      }
      const flags = view.getUint16(cursor + 8, true);
      const compression = view.getUint16(cursor + 10, true);
      const size = view.getUint32(cursor + 20, true);
      const originalSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const entryDisk = view.getUint16(cursor + 34, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const centralLength = 46 + nameLength + extraLength + commentLength;
      ensureRange(this.source, cursor, centralLength, end, `中央目录条目 ${index + 1}`);
      if (entryDisk !== 0 || flags & 1) {
        fail('zip-invalid-structure', `ZIP 条目 ${index + 1} 跨磁盘或已加密`);
      }
      if (compression !== 0 && compression !== 8) {
        fail('zip-invalid-structure', `ZIP 条目 ${index + 1} 使用不支持的压缩方法 ${compression}`);
      }
      const name = decodeName(this.source, cursor + 46, nameLength);
      const canonical = name.toLowerCase();
      if (names.has(canonical)) fail('zip-duplicate-name', `ZIP 存在重复或等价条目名称：${name}`);
      names.add(canonical);
      if (originalSize > this.limits.maxEntryBytes) {
        fail('zip-entry-too-large', `ZIP 条目 ${name} 声明 ${originalSize} 字节，超过上限 ${this.limits.maxEntryBytes}`);
      }
      total += originalSize;
      if (total > this.limits.maxTotalBytes) {
        fail('zip-total-too-large', `ZIP 声明解压总量 ${total} 字节，超过上限 ${this.limits.maxTotalBytes}`);
      }
      if (originalSize > 0 && originalSize / Math.max(1, size) > this.limits.maxCompressionRatio) {
        fail('zip-compression-ratio', `ZIP 条目 ${name} 压缩比超过上限 ${this.limits.maxCompressionRatio}`);
      }

      ensureRange(this.source, localOffset, 30, centralOffset, `本地头 ${name}`);
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
        fail('zip-invalid-structure', `ZIP 本地头签名错误：${name}`);
      }
      const localFlags = view.getUint16(localOffset + 6, true);
      const localCompression = view.getUint16(localOffset + 8, true);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const payloadOffset = localOffset + 30 + localNameLength + localExtraLength;
      ensureRange(this.source, localOffset, 30 + localNameLength + localExtraLength, centralOffset, `本地头 ${name}`);
      const localName = decodeName(this.source, localOffset + 30, localNameLength);
      if (localName !== name || localCompression !== compression || localFlags !== flags) {
        fail('zip-invalid-structure', `ZIP 本地头与中央目录元数据不一致：${name}`);
      }
      if (!(flags & 8) && (view.getUint32(localOffset + 18, true) !== size || view.getUint32(localOffset + 22, true) !== originalSize)) {
        fail('zip-invalid-structure', `ZIP 本地头与中央目录大小不一致：${name}`);
      }
      ensureRange(this.source, payloadOffset, size, centralOffset, `压缩数据 ${name}`);
      this.entries.set(name, {
        name,
        size,
        originalSize,
        compression,
        flags,
        payload: this.source.subarray(payloadOffset, payloadOffset + size),
      });
      cursor += centralLength;
    }
    if (cursor !== end) fail('zip-invalid-structure', 'ZIP 中央目录包含未识别记录');
  }

  unzip(filter?: UnzipFileFilter): Record<string, Uint8Array> {
    const output: Record<string, Uint8Array> = {};
    let actualTotal = 0;
    for (const entry of this.entries.values()) {
      const info: UnzipFileInfo = {
        name: entry.name,
        size: entry.size,
        originalSize: entry.originalSize,
        compression: entry.compression,
      };
      if (filter && !filter(info)) continue;
      let data: Uint8Array;
      try {
        if (entry.compression === 0) {
          data = entry.payload;
        } else {
          // 多出的一个字节让“实际输出大于声明”可被观测，而不是被定长 out 静默截断。
          data = inflateSync(entry.payload, { out: new Uint8Array(entry.originalSize + 1) });
        }
      } catch (error) {
        if (error instanceof ZipSafetyError) throw error;
        fail('zip-invalid-structure', `ZIP 条目 ${entry.name} 解压失败：${error instanceof Error ? error.message : String(error)}`);
      }
      if (data.length !== entry.originalSize) {
        fail('zip-size-mismatch', `ZIP 条目 ${entry.name} 实际输出 ${data.length} 字节，声明 ${entry.originalSize} 字节`);
      }
      actualTotal += data.length;
      if (data.length > this.limits.maxEntryBytes || actualTotal > this.limits.maxTotalBytes) {
        fail('zip-output-too-large', `ZIP 条目 ${entry.name} 实际输出超过配置上限`);
      }
      Object.defineProperty(output, entry.name, {
        value: data,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  }
}

export function validateZipArchive(source: Uint8Array, limits?: ZipLimitOptions): void {
  new ZipReader(source, limits);
}

export function safeUnzipSync(source: Uint8Array, options: SafeUnzipOptions = {}): Record<string, Uint8Array> {
  return new ZipReader(source, options.limits).unzip(options.filter);
}
