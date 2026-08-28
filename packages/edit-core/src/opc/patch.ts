import type { OpcPackage } from '@web-ppt/core';
import { equalBytes } from './bytes';
import { createOwnedPackage, releaseOwnedPackage } from './package-owner';
import type { OpcPartChanges, OpcPatchResult } from './types';
import {
  parseZipArchive, repackZipParts, rewriteZipArchive, ZipPassthroughUnsupported,
} from './zip';

function effectiveReplacements(
  source: OpcPackage,
  changes: OpcPartChanges,
): Map<string, Uint8Array | null> {
  const replacements = new Map<string, Uint8Array | null>();
  for (const [name, bytes] of Object.entries(changes)) {
    validatePartName(name);
    const current = source.parts[name];
    if (bytes === null) {
      if (current) replacements.set(name, null);
    } else if (!current || !equalBytes(current, bytes)) {
      // 调用方常复用序列化缓冲；保存边界必须拍快照，不能让包内容与 ZIP 字节随后分叉。
      replacements.set(name, bytes.slice());
    }
  }
  return replacements;
}

function validatePartName(name: string): void {
  const segments = name.split('/');
  if (!name || name.startsWith('/') || name.endsWith('/') || name.includes('\\')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`非法 OPC part 路径：${name}`);
  }
}

/** 生成保存从已解压 part 构造全新包；输入和结果都拍快照，调用方不能随后改写。 */
export function createOpcPackage(parts: Readonly<Record<string, Uint8Array>>): OpcPatchResult {
  const snapshots: Record<string, Uint8Array> = Object.create(null);
  const changes = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(parts)) {
    validatePartName(name);
    const snapshot = bytes.slice();
    snapshots[name] = snapshot;
    changes.set(name, snapshot);
  }
  const rewritten = repackZipParts(Object.create(null), changes);
  const frozen = Object.freeze(snapshots);
  return {
    ...rewritten,
    bytes: rewritten.bytes,
    package: createOwnedPackage(rewritten.bytes, frozen),
    mode: 'repacked',
    fallbackReason: null,
  };
}

function nextPackage(
  source: OpcPackage,
  bytes: Uint8Array,
  replacements: ReadonlyMap<string, Uint8Array | null>,
): OpcPackage {
  const parts: Record<string, Uint8Array> = Object.create(null);
  for (const [name, part] of Object.entries(source.parts)) {
    if (replacements.get(name) !== null) parts[name] = replacements.get(name) ?? part;
  }
  for (const [name, part] of replacements) if (part !== null) parts[name] = part;
  Object.freeze(parts);
  // replacements 已排除逐字相同的 part；没变的媒体可直接沿用 URL，不再同步扫描大字节。
  const assets = Object.freeze(Object.fromEntries(Object.entries(source.assets ?? {}).filter(([, asset]) =>
    !!asset.sourcePart && !!parts[asset.sourcePart] && !replacements.has(asset.sourcePart))));
  return createOwnedPackage(bytes, parts, assets);
}

/** 释放脱离 EditDoc 单独持有的保存结果；原始解析包仍由 Presentation.dispose() 释放。 */
export function disposeOpcPackage(pkg: OpcPackage): void {
  releaseOwnedPackage(pkg);
}

/** 在原 OPC 包上应用 part 级修改；空修改必须保持整包字节身份。 */
export function patchOpcPackage(source: OpcPackage, changes: OpcPartChanges): OpcPatchResult {
  if (source.disposed) throw new Error('OPC 原包已释放，不能保存');
  const replacements = effectiveReplacements(source, changes);
  if (replacements.size) {
    let rewritten;
    let fallbackReason = null;
    try {
      rewritten = rewriteZipArchive(parseZipArchive(source.bytes), replacements);
    } catch (error) {
      if (!(error instanceof ZipPassthroughUnsupported)) throw error;
      fallbackReason = error.reason;
      rewritten = repackZipParts(source.parts, replacements);
    }
    return {
      ...rewritten,
      package: nextPackage(source, rewritten.bytes, replacements),
      mode: fallbackReason ? 'repacked' : 'passthrough',
      fallbackReason,
    };
  }
  return {
    bytes: source.bytes,
    package: source,
    mode: 'identity',
    fallbackReason: null,
    preservedEntries: Object.keys(source.parts).length,
    rewrittenEntries: 0,
  };
}
