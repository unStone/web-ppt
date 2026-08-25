import type {
  Fill, Slide, SlideElement, TableCell, TableCreationDefaults, TableRow, TextBody,
} from '@web-ppt/core';
import { bytesToBase64 } from './clipboard-binary';
import type { EditDoc } from './types';

const LAYOUT_ASSET_TOKEN = 'layout-asset:';

interface LayoutAsset {
  readonly mime: string;
  readonly data: Uint8Array;
}

interface LayoutAssetCache {
  readonly package: EditDoc['package'];
  readonly urls: WeakMap<Uint8Array, string>;
}

const caches = new WeakMap<EditDoc, LayoutAssetCache>();

function cacheOf(doc: EditDoc): LayoutAssetCache {
  const current = caches.get(doc);
  if (current?.package === doc.package) return current;
  const created = { package: doc.package, urls: new WeakMap<Uint8Array, string>() };
  caches.set(doc, created);
  return created;
}

function hydrateSource(doc: EditDoc, source: string, assets: readonly LayoutAsset[]): string {
  if (!source.startsWith(LAYOUT_ASSET_TOKEN)) return source;
  const index = Number(source.slice(LAYOUT_ASSET_TOKEN.length));
  const asset = Number.isInteger(index) ? assets[index] : undefined;
  if (!asset) throw new Error(`版式重解析资源不存在：${source}`);
  const cache = cacheOf(doc);
  let url = cache.urls.get(asset.data);
  if (!url) {
    url = `data:${asset.mime};base64,${bytesToBase64(asset.data)}`;
    cache.urls.set(asset.data, url);
  }
  return url;
}

function hydrateFill(doc: EditDoc, fill: Fill | null | undefined, assets: readonly LayoutAsset[]): void {
  if (fill?.type === 'image') fill.src = hydrateSource(doc, fill.src, assets);
}

function hydrateText(doc: EditDoc, text: TextBody | null | undefined, assets: readonly LayoutAsset[]): void {
  for (const paragraph of text?.paragraphs ?? []) {
    if (paragraph.bulletImage) {
      paragraph.bulletImage = hydrateSource(doc, paragraph.bulletImage, assets);
    }
  }
}

function hydrateCell(doc: EditDoc, cell: TableCell, assets: readonly LayoutAsset[]): void {
  hydrateFill(doc, cell.fill, assets);
  hydrateText(doc, cell.text, assets);
  hydrateText(doc, cell.editInfo?.textTemplate, assets);
}

function hydrateRows(doc: EditDoc, rows: readonly TableRow[], assets: readonly LayoutAsset[]): void {
  for (const row of rows) for (const cell of row.cells) hydrateCell(doc, cell, assets);
}

function hydrateTableDefaults(
  doc: EditDoc,
  defaults: TableCreationDefaults | undefined,
  assets: readonly LayoutAsset[],
): void {
  if (!defaults) return;
  hydrateCell(doc, defaults.firstRow, assets);
  for (const cell of defaults.bandRows) hydrateCell(doc, cell, assets);
}

function hydrateElement(doc: EditDoc, element: SlideElement, assets: readonly LayoutAsset[]): void {
  hydrateText(doc, element.editInfo?.textTemplate, assets);
  hydrateText(doc, element.editInfo?.textLevelTemplate, assets);
  if (element.kind === 'shape') {
    hydrateFill(doc, element.fill, assets);
    hydrateText(doc, element.text, assets);
  } else if (element.kind === 'image') {
    element.src = hydrateSource(doc, element.src, assets);
    if (element.media?.src && !element.media.external) {
      element.media.src = hydrateSource(doc, element.media.src, assets);
    }
  } else if (element.kind === 'group') {
    for (const child of element.children) hydrateElement(doc, child, assets);
  } else if (element.kind === 'table') {
    hydrateRows(doc, element.rows, assets);
    const append = element.editInfo?.tableRowAppend;
    if (append?.previousLast) hydrateRows(doc, [append.previousLast], assets);
    if (append) hydrateRows(doc, [...append.regular, ...append.last], assets);
  }
}

/** 只兑现 Schema 的资源槽；普通字符串即使形似内部 token 也必须逐字保留。 */
export function hydrateLayoutSlideAssets(
  doc: EditDoc,
  slide: Slide,
  assets: readonly LayoutAsset[],
): Slide {
  hydrateFill(doc, slide.background, assets);
  for (const element of slide.elements) hydrateElement(doc, element, assets);
  const defaults = slide.editInfo?.defaultShape;
  hydrateFill(doc, defaults?.fill, assets);
  hydrateText(doc, defaults?.textTemplate, assets);
  hydrateTableDefaults(doc, slide.editInfo?.defaultTable, assets);
  return slide;
}

export function releaseLayoutAssetCache(doc: EditDoc): void {
  caches.delete(doc);
}
