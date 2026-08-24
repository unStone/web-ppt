import type { SlideElement } from '@web-ppt/core';
import { sha256 } from './clipboard-binary';
import type { ClipboardResource } from './commands/types';
import type { EditDoc } from './types';

const RESOURCE_TOKEN = 'web-ppt-resource:';

interface DocAsset {
  readonly mime: string;
  readonly bytes: Uint8Array;
  hash?: string;
}

const docAssets = new WeakMap<EditDoc, Map<string, DocAsset>>();
const insertionAssetIndexes = new WeakMap<object, ReadonlyMap<string, string>>();

function walkStrings(value: unknown, visit: (value: string) => string, mutate: boolean): unknown {
  if (typeof value === 'string') return visit(value);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const child = walkStrings(value[index], visit, mutate);
      if (mutate) value[index] = child;
    }
    return value;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = walkStrings(child, visit, mutate);
    if (mutate) (value as Record<string, unknown>)[key] = next;
  }
  return value;
}

/** 保存会替换 doc.package；解析期 URL 与字节的对应关系必须在建模时保留下来。 */
export function registerClipboardAssets(doc: EditDoc): void {
  const pkg = doc.package;
  if (!pkg) return;
  const assets = new Map<string, DocAsset>();
  const capture = (value: string): string => {
    if (!value.startsWith('blob:') && !value.startsWith('asset:')) return value;
    const asset = pkg.assets?.[value];
    if (asset) assets.set(value, { ...asset });
    return value;
  };
  for (const record of Object.values(doc.elements)) walkStrings(record.src, capture, false);
  docAssets.set(doc, assets);
}

export function releaseClipboardAssets(doc: EditDoc): void {
  docAssets.delete(doc);
}

export function tokenizeElementAssets(
  doc: EditDoc,
  source: SlideElement,
  used: Set<string>,
  insertionResources: readonly ClipboardResource[] = [],
): SlideElement {
  const clone = structuredClone(source);
  let inserted = insertionAssetIndexes.get(insertionResources);
  if (!inserted) {
    inserted = new Map(insertionResources.map((resource) => [
      `data:${resource.mime};base64,${resource.bytes}`, resource.hash,
    ]));
    insertionAssetIndexes.set(insertionResources, inserted);
  }
  return walkStrings(clone, (value) => {
    const insertedHash = inserted.get(value);
    if (insertedHash) {
      used.add(insertedHash);
      return `${RESOURCE_TOKEN}${insertedHash}`;
    }
    if (!value.startsWith('blob:') && !value.startsWith('asset:')) return value;
    const asset = docAssets.get(doc)?.get(value);
    if (!asset) throw new Error('元素包含无法跨编辑器传递的会话资源');
    const hash = asset.hash ??= sha256(asset.bytes);
    used.add(hash);
    return `${RESOURCE_TOKEN}${hash}`;
  }, true) as SlideElement;
}

export function createElementAssetHydrator(
  resources: readonly ClipboardResource[],
): (source: SlideElement) => SlideElement {
  const byHash = new Map(resources.map((resource) => [resource.hash, resource]));
  const urls = new Map<string, string>();
  return (source) => walkStrings(structuredClone(source), (value) => {
    if (!value.startsWith(RESOURCE_TOKEN)) return value;
    const hash = value.slice(RESOURCE_TOKEN.length);
    const resource = byHash.get(hash);
    if (!resource) throw new Error(`元素投影缺少剪贴板资源：${hash}`);
    let url = urls.get(hash);
    if (!url) {
      url = `data:${resource.mime};base64,${resource.bytes}`;
      urls.set(hash, url);
    }
    return url;
  }, true) as SlideElement;
}
