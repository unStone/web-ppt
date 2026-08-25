import { resolveGeomPath } from '@web-ppt/core/geometry';
import type {
  GroupElement, ImageElement, ShapeElement, Slide, SlideElement, TableElement, TableRow, TextBody,
} from '@web-ppt/core';
import type { EditDoc, ElementId, ProjectionInvalidation, SlideId } from './types';
import { hydrateElementInsertionAssets } from './clipboard-assets';
import { own } from './data-validation';
import { isDynamicSlideLink } from './dynamic-slide-fields';
import { textBodyFromOverride } from './text-model';
import { tableCellOverrideKeyFromRowRef } from './table-cell';
import {
  orderedTableRowInsertions, tableRowHeightDelta, tableRowsWithoutTextOverrides,
} from './table-rows';

interface ProjectionCache {
  elements: Map<ElementId, SlideElement>;
  slides: Map<SlideId, Slide>;
}

const caches = new WeakMap<EditDoc, ProjectionCache>();

/** 最后一格吃掉浮点余量，保证即时网格与选择 frame 在 JS 数值上也严格闭合。 */
function scaledDimensions(values: readonly number[], total: number): number[] {
  const sourceTotal = values.reduce((sum, value) => sum + value, 0);
  if (!values.length || sourceTotal <= 0) return [...values];
  let remaining = total;
  return values.map((value, index) => {
    if (index === values.length - 1) return remaining;
    const scaled = value / sourceTotal * total;
    remaining -= scaled;
    return scaled;
  });
}

function scaledTableRow(row: TableRow, scale: number): TableRow {
  return scale === 1 ? row : { ...row, height: row.height * scale };
}

function scaledTableEditInfo(
  editInfo: TableElement['editInfo'], scale: number,
): TableElement['editInfo'] {
  const append = editInfo?.tableRowAppend;
  if (!append || scale === 1) return editInfo;
  return {
    ...editInfo,
    tableRowAppend: {
      ...(append.previousLast ? { previousLast: scaledTableRow(append.previousLast, scale) } : {}),
      regular: [scaledTableRow(append.regular[0], scale), scaledTableRow(append.regular[1], scale)],
      last: [scaledTableRow(append.last[0], scale), scaledTableRow(append.last[1], scale)],
    },
  };
}

function cacheOf(doc: EditDoc): ProjectionCache {
  let cache = caches.get(doc);
  if (!cache) {
    cache = { elements: new Map(), slides: new Map() };
    caches.set(doc, cache);
  }
  return cache;
}

function elementRecord(doc: EditDoc, id: ElementId) {
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  return record;
}

function dynamicSlideNumber(doc: EditDoc, id: ElementId, element: ShapeElement): ShapeElement {
  const record = elementRecord(doc, id);
  if (record.meta.ph?.type !== 'sldNum' || record.ovr.text || !element.text) return element;
  const number = doc.slideOrder.indexOf(slideOfElement(doc, id)) + 1;
  let changed = false;
  const paragraphs = element.text.paragraphs.map((paragraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => {
      if (run.field?.toLowerCase() !== 'slidenum') return run;
      changed = true;
      return { ...run, text: String(number) };
    }),
  }));
  if (!changed) return element;
  return {
    ...element,
    text: { ...element.text, paragraphs },
  };
}

function resolvedSlideLink(doc: EditDoc, id: ElementId, link: string | undefined): string | undefined {
  if (!isDynamicSlideLink(link)) return link;
  const current = doc.slideOrder.indexOf(slideOfElement(doc, id));
  let target: number | undefined;
  if (link === 'slide:next') target = current + 2;
  else if (link === 'slide:previous') target = current;
  else if (link === 'slide:first') target = 1;
  else if (link === 'slide:last') target = doc.slideOrder.length;
  else if (link?.startsWith('slide-part:')) {
    try {
      const part = decodeURIComponent(link.slice('slide-part:'.length));
      const index = doc.slideOrder.findIndex((slideId) => doc.slides[slideId].origin?.part === part);
      if (index >= 0) target = index + 1;
    } catch { return link; }
  }
  return target === undefined ? link : `slide:${target}`;
}

function projectedTextLinks(doc: EditDoc, id: ElementId, text: TextBody | null): TextBody | null {
  if (!text) return null;
  let changed = false;
  const paragraphs = text.paragraphs.map((paragraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => {
      const link = resolvedSlideLink(doc, id, run.link);
      if (link === run.link) return run;
      changed = true;
      return { ...run, link };
    }),
  }));
  return changed ? { ...text, paragraphs } : text;
}

function projectedSlideLinks(doc: EditDoc, id: ElementId, element: SlideElement): SlideElement {
  let out = element;
  const link = resolvedSlideLink(doc, id, out.link);
  if (link !== out.link) out = { ...out, link } as SlideElement;
  if (out.kind === 'shape') {
    const text = projectedTextLinks(doc, id, out.text);
    if (text !== out.text) out = { ...out, text };
  } else if (out.kind === 'table') {
    let changed = false;
    const rows = out.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => {
        const text = projectedTextLinks(doc, id, cell.text);
        if (text === cell.text) return cell;
        changed = true;
        return { ...cell, text };
      }),
    }));
    if (changed) out = { ...out, rows };
  }
  return out;
}

export function effectiveElement(doc: EditDoc, id: ElementId): SlideElement {
  const cache = cacheOf(doc);
  const cached = cache.elements.get(id);
  if (cached) return cached;

  const record = elementRecord(doc, id);
  const { tableCells, tableRows, ...overrides } = record.ovr;
  let out = { ...record.src, ...overrides } as unknown as SlideElement;
  if (record.meta.insertion?.resources?.length) {
    out = hydrateElementInsertionAssets(out, record.meta.insertion.resources);
  }
  if (out.kind === 'shape' && record.ovr.text?.kind === 'empty') {
    out = { ...out, text: null } as ShapeElement;
  } else if (out.kind === 'shape' && record.ovr.text?.kind === 'flat') {
    out = { ...out, text: textBodyFromOverride(record.ovr.text) } as ShapeElement;
  } else if (out.kind === 'table' && (tableCells || tableRows)) {
    if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 的表格投影来源无效`);
    const baseRows = tableRows ? tableRowsWithoutTextOverrides(record) : out.rows;
    const insertions = tableRows ? orderedTableRowInsertions(record) : [];
    const sourceRowCount = record.src.rows.length;
    const rows = baseRows.map((row, r) => {
      let changed = false;
      const cells = row.cells.map((cell, c) => {
        const rowRef = r < sourceRowCount ? r : insertions[r - sourceRowCount]?.id;
        const override = rowRef === undefined
          ? undefined : tableCells?.[tableCellOverrideKeyFromRowRef(rowRef, c)]?.text;
        if (!override) return cell;
        changed = true;
        return {
          ...cell,
          text: override.kind === 'empty' ? null : textBodyFromOverride(override),
        };
      });
      return changed ? { ...row, cells } : row;
    });
    out = { ...out, rows, h: out.h + tableRowHeightDelta(record) } as TableElement;
  }
  if (out.kind === 'table' && (own(record.ovr, 'w') || own(record.ovr, 'h'))) {
    const sourceHeight = out.rows.reduce((sum, row) => sum + row.height, 0);
    const heightScale = sourceHeight > 0 ? out.h / sourceHeight : 1;
    out = {
      ...out,
      ...(own(record.ovr, 'w')
        ? { colWidths: scaledDimensions(out.colWidths, out.w) } : {}),
      ...(own(record.ovr, 'h')
        ? { rows: (() => {
          const heights = scaledDimensions(out.rows.map((row) => row.height), out.h);
          return out.rows.map((row, index) => ({ ...row, height: heights[index] }));
        })(), editInfo: scaledTableEditInfo(out.editInfo, heightScale) } : {}),
    } as TableElement;
  }
  if (out.kind === 'group') {
    const source = record.src as GroupElement;
    // chExt 不进入覆盖层；组 ext 改变时必须由源比例反推出新 scale，才能与保存重开后的解析结果一致。
    const scaleX = source.w > 0 ? source.scaleX * out.w / source.w : source.scaleX;
    const scaleY = source.h > 0 ? source.scaleY * out.h / source.h : source.scaleY;
    out = {
      ...out, scaleX, scaleY,
      children: (record.children ?? []).map((childId) => effectiveElement(doc, childId)),
    } as GroupElement;
  } else if (out.kind === 'shape' && record.meta.geom) {
    const geom = resolveGeomPath(record.meta.geom, out.w, out.h);
    out = { ...out, path: geom.d, openGeom: geom.open || undefined } as ShapeElement;
  } else if (out.kind === 'image' && record.meta.geom) {
    const geom = resolveGeomPath(record.meta.geom, out.w, out.h);
    out = {
      ...out,
      clipPath: record.meta.geom.preset === 'rect' ? null : geom.d,
    } as ImageElement;
  }
  if (out.kind === 'shape') out = dynamicSlideNumber(doc, id, out);
  out = projectedSlideLinks(doc, id, out);
  cache.elements.set(id, out);
  return out;
}

export function toSlide(doc: EditDoc, id: SlideId): Slide {
  const cache = cacheOf(doc);
  const cached = cache.slides.get(id);
  if (cached) return cached;
  const record = doc.slides[id];
  if (!record) throw new Error(`找不到幻灯片：${id}`);
  const slide: Slide = {
    ...record.src,
    ...record.ovr,
    elements: record.children.map((elementId) => effectiveElement(doc, elementId)),
  };
  cache.slides.set(id, slide);
  return slide;
}

export function slideOfElement(doc: EditDoc, id: ElementId): SlideId {
  let current = elementRecord(doc, id);
  const seen = new Set<ElementId>();
  for (;;) {
    if (seen.has(current.id)) throw new Error(`元素父链成环：${current.id}`);
    seen.add(current.id);
    if (doc.slides[current.parent]) return current.parent as SlideId;
    current = elementRecord(doc, current.parent as ElementId);
  }
}

/** 元素变化会沿组祖先传播到所属页；无需扫描或比较整份文档。 */
export function invalidateElement(doc: EditDoc, id: ElementId): ProjectionInvalidation {
  const cache = cacheOf(doc);
  const dirtyElements = new Set<ElementId>();
  const dirtySlides = new Set<SlideId>();
  let current = elementRecord(doc, id);
  for (;;) {
    if (dirtyElements.has(current.id)) throw new Error(`元素父链成环：${current.id}`);
    dirtyElements.add(current.id);
    cache.elements.delete(current.id);
    if (doc.slides[current.parent]) {
      const slideId = current.parent as SlideId;
      dirtySlides.add(slideId);
      cache.slides.delete(slideId);
      break;
    }
    current = elementRecord(doc, current.parent as ElementId);
  }
  return { dirtyElements, dirtySlides };
}

export function invalidateSlide(doc: EditDoc, id: SlideId): ProjectionInvalidation {
  if (!doc.slides[id]) throw new Error(`找不到幻灯片：${id}`);
  cacheOf(doc).slides.delete(id);
  return { dirtyElements: new Set(), dirtySlides: new Set([id]) };
}

/** 页面树 patch 发生在页面存在性变化之前，不能要求目标页已经在模型中。 */
export function invalidateSlideStructure(
  doc: EditDoc,
  id: SlideId,
  elements: readonly ElementId[],
): ProjectionInvalidation {
  const cache = cacheOf(doc);
  cache.slides.delete(id);
  for (const element of elements) cache.elements.delete(element);
  return { dirtyElements: new Set(elements), dirtySlides: new Set([id]) };
}

/** 插页只改变页码字段；沿字段父链失效，避免框架订阅者收到整段页尾的元素更新。 */
export function invalidateSlideSequence(doc: EditDoc, start: number): ProjectionInvalidation {
  const cache = cacheOf(doc);
  const dirtyElements = new Set<ElementId>();
  const dirtySlides = new Set<SlideId>();
  const invalidate = (slideId: SlideId, id: ElementId): void => {
    let current = doc.elements[id];
    if (!current) return;
    dirtySlides.add(slideId);
    cache.slides.delete(slideId);
    for (;;) {
      dirtyElements.add(current.id);
      cache.elements.delete(current.id);
      if (doc.slides[current.parent]) break;
      current = doc.elements[current.parent as ElementId];
      if (!current) break;
    }
  };
  for (const slideId of doc.slideOrder.slice(Math.max(0, start))) {
    const slide = doc.slides[slideId];
    for (const id of slide?.dynamicSlideNumbers ?? []) {
      if (!doc.elements[id]?.ovr.text) invalidate(slideId, id);
    }
  }
  for (const slideId of doc.slideOrder) {
    for (const id of doc.slides[slideId]?.dynamicSlideLinks ?? []) invalidate(slideId, id);
  }
  return { dirtyElements, dirtySlides };
}

/** 结构 patch 的根可能尚不存在；以外部父节点失效并清掉整棵树的旧投影缓存。 */
export function invalidateElementStructure(
  doc: EditDoc,
  ids: readonly ElementId[],
  parent: SlideId | ElementId,
): ProjectionInvalidation {
  const cache = cacheOf(doc);
  for (const id of ids) cache.elements.delete(id);
  const dirty = doc.slides[parent]
    ? invalidateSlide(doc, parent as SlideId)
    : invalidateElement(doc, parent as ElementId);
  for (const id of ids) dirty.dirtyElements.add(id);
  return dirty;
}

export function invalidateAll(doc: EditDoc): ProjectionInvalidation {
  caches.delete(doc);
  return {
    dirtyElements: new Set(Object.keys(doc.elements)),
    dirtySlides: new Set(doc.slideOrder),
  };
}
