/**
 * 嵌入字体命令：登记 / 移除 EditDoc.fontResources 的条目。
 *
 * patch 形态与 imageResources 同型（path `['fontResources', hash]`，value 是
 * 完整资源；历史是内存结构，携带字节不进协同补丁传输面）。写入许可在命令
 * 生成 patch 时检查——restricted / bitmap-only / 非 sfnt 在这里 fast-fail，
 * 不让无效字体进入历史。
 */
import type { FontEmbedResource } from '../types';
import type { EditDoc } from '../types';
import type { Patch } from './types';
import { sfntEmbeddingRights } from '@web-ppt/core';
import { base64ToBytes, sha256 } from '../clipboard-binary';
import type { FontResourcePatch } from './types';

export interface SetEmbeddedFontCommand {
  readonly type: 'SetEmbeddedFont';
  readonly family: string;
  /** 本条目覆盖的样式槽；至少一个 */
  readonly styles: readonly { bold: boolean; italic: boolean }[];
  /** base64 编码的 sfnt 字节（还原后的 TTF / OTF） */
  readonly bytes: string;
  readonly mime: 'font/ttf' | 'font/otf';
}

export interface RemoveEmbeddedFontCommand {
  readonly type: 'RemoveEmbeddedFont';
  /** 登记时返回的资源哈希 */
  readonly hash: string;
}

const MAX_FONT_BYTES = 32 * 1024 * 1024;

export function isFontResourcePatch(patch: Patch): patch is FontResourcePatch {
  return patch.path.length === 2 && patch.path[0] === 'fontResources';
}

function assertStyles(styles: unknown, label: string): { bold: boolean; italic: boolean }[] {
  if (!Array.isArray(styles) || !styles.length || styles.length > 4) {
    throw new Error(`${label} 的 styles 必须是 1–4 个槽位`);
  }
  const seen = new Set<string>();
  for (const style of styles) {
    if (!style || typeof style !== 'object') throw new Error(`${label} 的样式槽无效`);
    const { bold, italic } = style as { bold?: unknown; italic?: unknown };
    if (typeof bold !== 'boolean' || typeof italic !== 'boolean') throw new Error(`${label} 的样式槽必须带 bold / italic 布尔`);
    const key = `${bold ? 1 : 0}${italic ? 1 : 0}`;
    if (seen.has(key)) throw new Error(`${label} 的样式槽重复：${key}`);
    seen.add(key);
  }
  return styles as { bold: boolean; italic: boolean }[];
}

function decodeSfnt(bytesBase64: string, label: string): Uint8Array {
  if (typeof bytesBase64 !== 'string' || !bytesBase64) throw new Error(`${label} 缺少字体字节`);
  const bytes = base64ToBytes(bytesBase64);
  if (bytes.length > MAX_FONT_BYTES) throw new Error(`${label} 的字体超过 32 MiB 输入预算：${bytes.length}B`);
  const rights = sfntEmbeddingRights(bytes);
  if (!rights.ok) throw new Error(`${label} 不允许嵌入：${rights.reason}`);
  return bytes;
}

export function setEmbeddedFontPatches(
  doc: EditDoc,
  command: SetEmbeddedFontCommand,
  origin: string,
): { forward: Patch[]; inverse: Patch[] } {
  if (doc.meta.readonly || doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('只读或非 OOXML 编辑文档不能嵌入字体');
  }
  const family = command.family;
  if (typeof family !== 'string' || !family.trim() || family.length > 256 || /[\u0000-\u001f\u007f]/.test(family)) {
    throw new Error(`嵌入字体的家族名不合法：${JSON.stringify(String(family).slice(0, 32))}`);
  }
  const styles = assertStyles(command.styles, 'SetEmbeddedFont');
  const bytes = decodeSfnt(command.bytes, 'SetEmbeddedFont');
  const mime = command.mime === 'font/otf' ? 'font/otf' : 'font/ttf';
  const hash = `fnt-${sha256(bytes).slice(0, 24)}`;
  const resource: FontEmbedResource = {
    family: family.trim(),
    hash,
    mime,
    styles: styles.map((style) => ({ ...style })),
    bytes: command.bytes,
    fsType: (() => {
      const rights = sfntEmbeddingRights(bytes);
      return rights.ok ? (rights.rights.usage === 'installable' ? 0 : rights.rights.usage === 'editable' ? 8 : 4) : 0;
    })(),
  };
  const previous = doc.fontResources?.[hash];
  const forward: FontResourcePatch = { op: 'set', path: ['fontResources', hash], value: resource, origin };
  const inverse: FontResourcePatch = previous
    ? { op: 'set', path: ['fontResources', hash], value: previous, origin }
    : { op: 'del', path: ['fontResources', hash], origin };
  return { forward: [forward], inverse: [inverse] };
}

export function removeEmbeddedFontPatches(
  doc: EditDoc,
  command: RemoveEmbeddedFontCommand,
  origin: string,
): { forward: Patch[]; inverse: Patch[] } {
  if (typeof command.hash !== 'string' || !command.hash) throw new Error('RemoveEmbeddedFont 缺少资源哈希');
  const previous = doc.fontResources?.[command.hash];
  if (!previous) throw new Error(`找不到要移除的嵌入字体资源：${command.hash}`);
  const forward: FontResourcePatch = { op: 'del', path: ['fontResources', command.hash], origin };
  const inverse: FontResourcePatch = { op: 'set', path: ['fontResources', command.hash], value: previous, origin };
  return { forward: [forward], inverse: [inverse] };
}

export function applyFontResourcePatch(doc: EditDoc, patch: FontResourcePatch): void {
  if (!doc.fontResources) doc.fontResources = {};
  if (patch.op === 'set') doc.fontResources[patch.path[1]] = patch.value as FontEmbedResource;
  else delete doc.fontResources[patch.path[1]];
}

export function validateFontResourcePatch(patch: FontResourcePatch, index: number): void {
  if (patch.op === 'set') {
    const resource = patch.value as Partial<FontEmbedResource> | undefined;
    if (!resource || typeof resource !== 'object') throw new Error(`Patch ${index} 的字体资源无效`);
    if (resource.hash !== patch.path[1]) throw new Error(`Patch ${index} 的资源 key 与哈希不一致`);
    for (const field of ['family', 'hash', 'mime', 'styles', 'bytes', 'fsType'] as const) {
      if (resource[field] === undefined) throw new Error(`Patch ${index} 的字体资源缺少 ${field}`);
    }
  }
}
