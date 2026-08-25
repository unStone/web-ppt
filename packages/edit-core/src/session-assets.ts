import type { PresentationEditAsset, SlideElement } from '@web-ppt/core';
import { sha256 } from './clipboard-binary';
import type { ClipboardResource } from './commands/types';
import type { EditDoc, ElementInsertionResource } from './types';

const RESOURCE_TOKEN = 'web-ppt-resource:';

interface DocAsset {
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly sourcePart?: string;
  hash?: string;
}

const docAssets = new WeakMap<EditDoc, Map<string, DocAsset>>();
interface InsertionAssetIndex {
  readonly hashByDataUrl: ReadonlyMap<string, string>;
  readonly hashes: ReadonlySet<string>;
}

const insertionAssetIndexes = new WeakMap<object, InsertionAssetIndex>();
const insertionHydrators = new WeakMap<object, (source: SlideElement) => SlideElement>();

export const insertionResourceToken = (hash: string): string => `${RESOURCE_TOKEN}${hash}`;

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
export function registerSessionAssets(
  doc: EditDoc,
  editAssets: readonly PresentationEditAsset[] = [],
): void {
  const pkg = doc.package;
  const assets = new Map<string, DocAsset>(editAssets.map((asset) => [asset.url, { ...asset }]));
  const capture = (value: string): string => {
    if (!value.startsWith('blob:') && !value.startsWith('asset:')) return value;
    const asset = pkg?.assets?.[value];
    if (asset) assets.set(value, { ...asset });
    return value;
  };
  for (const record of Object.values(doc.elements)) walkStrings(record.src, capture, false);
  for (const record of Object.values(doc.slides)) walkStrings(record.src, capture, false);
  docAssets.set(doc, assets);
}

export function sessionAsset(doc: EditDoc, url: string): DocAsset | undefined {
  return docAssets.get(doc)?.get(url) ?? doc.package?.assets?.[url];
}

export function releaseSessionAssets(doc: EditDoc): void {
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
    inserted = {
      hashByDataUrl: new Map(insertionResources.map((resource) => [
        `data:${resource.mime};base64,${resource.bytes}`, resource.hash,
      ])),
      hashes: new Set(insertionResources.map((resource) => resource.hash)),
    };
    insertionAssetIndexes.set(insertionResources, inserted);
  }
  return walkStrings(clone, (value) => {
    if (value.startsWith(RESOURCE_TOKEN)) {
      const hash = value.slice(RESOURCE_TOKEN.length);
      if (!inserted!.hashes.has(hash)) throw new Error(`元素投影缺少插入资源：${hash}`);
      used.add(hash);
      return value;
    }
    const insertedHash = inserted!.hashByDataUrl.get(value);
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

/** EditDoc 保留小型资源 token；只有有效投影需要付出 data URI 的字符串成本。 */
export function hydrateElementInsertionAssets(
  source: SlideElement,
  resources: readonly ClipboardResource[],
): SlideElement {
  let hydrate = insertionHydrators.get(resources);
  if (!hydrate) {
    hydrate = createElementAssetHydrator(resources);
    insertionHydrators.set(resources, hydrate);
  }
  return hydrate(source);
}

export function hydrateInsertionResourceSource(
  source: string,
  resource: ElementInsertionResource,
): string {
  if (source !== insertionResourceToken(resource.hash)) {
    throw new Error(`图片资源 token 与资源哈希不一致：${resource.hash}`);
  }
  return `data:${resource.mime};base64,${resource.bytes}`;
}
