import type { OpcPackage } from '@web-ppt/core';
import { materializeThemePart } from './theme-xml';
import { themeHasOverrides } from './theme';
import type { EditDoc } from './types';

interface ThemeProjectionCache {
  readonly source: OpcPackage;
  readonly package: OpcPackage;
}

const caches = new WeakMap<EditDoc, ThemeProjectionCache>();

/**
 * 重解析器只看 OpcPackage；把主题覆盖收进内存 part 视图后，解析/继承/文字排版仍走 core 唯一真相。
 * 保存后的原始来源由 baseline 覆盖回来，撤销因此不会被已经写入的新 package 污染。
 */
export function themeProjectionPackage(doc: EditDoc): OpcPackage | null {
  const source = doc.package;
  if (!source) return null;
  const cached = caches.get(doc);
  if (cached?.source === source) return cached.package;
  let parts: Record<string, Uint8Array> | null = null;
  for (const id of doc.themeOrder) {
    const record = doc.themes[id];
    const baseline = doc.saveState.baselines[id];
    if (!baseline && !themeHasOverrides(record)) continue;
    const sourceBytes = baseline ?? source.parts[id];
    if (!sourceBytes) throw new Error(`主题 part 不存在：${id}`);
    const bytes = materializeThemePart(sourceBytes, record);
    (parts ??= { ...source.parts })[id] = bytes;
  }
  if (!parts) return source;
  const overlay: OpcPackage = {
    format: 'pptx', bytes: source.bytes, parts,
    ...(source.assets ? { assets: source.assets } : {}),
    disposed: source.disposed,
  };
  caches.set(doc, { source, package: overlay });
  return overlay;
}

export function releaseThemeProjectionPackage(doc: EditDoc): void {
  caches.delete(doc);
}
