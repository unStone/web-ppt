import { resolveGeomPath } from '@web-ppt/core/geometry';
import type {
  GroupElement, ImageElement, ShapeElement, Slide, SlideElement, TableElement, TableRow, TextBody,
} from '@web-ppt/core';
import type { EditDoc, ElementId, ProjectionInvalidation, SlideId } from './types';
import { hydrateElementInsertionAssets, hydrateInsertionResourceSource } from './session-assets';
import { own } from './data-validation';
import { renderLinkTarget } from './hyperlink';
import { hasDynamicSlideNumber, isDynamicSlideLink } from './dynamic-slide-fields';
import { textBodyFromOverride } from './text-model';
import { tableCellOverrideKeyFromRowRef } from './table-cell';
import {
  orderedTableRowInsertions, tableRowHeightDelta, tableRowsWithoutTextOverrides,
} from './table-rows';
import {
  changedLayout, projectedLayoutElements, projectionContentIds, rebasedElementBase,
  rebasedTextBase, resolvedLayoutSlide,
} from './layout-projection';
import { projectAnimationSteps } from './slide-animation';

interface ProjectionCache {
  elements: Map<ElementId, SlideElement>;
  slides: Map<SlideId, Slide>;
}

const caches = new WeakMap<EditDoc, ProjectionCache>();

/** 文档换包或释放后，投影不能继续持有旧资源 URL 与整页 Schema。 */
export function releaseProjectionCache(doc: EditDoc): void {
  caches.delete(doc);
}

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

function projectedSlideNumberText(text: TextBody | null, value: string): TextBody | null {
  if (!text) return text;
  let changed = false;
  const paragraphs = text.paragraphs.map((paragraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => {
      if (run.field?.toLowerCase() !== 'slidenum') return run;
      changed = true;
      return { ...run, text: value };
    }),
  }));
  return changed ? { ...text, paragraphs } : text;
}

function dynamicSlideNumber(doc: EditDoc, id: ElementId, element: SlideElement): SlideElement {
  if (!hasDynamicSlideNumber(element)) return element;
  const value = String(doc.slideOrder.indexOf(slideOfElement(doc, id)) + 1);
  if (element.kind === 'shape') {
    const text = projectedSlideNumberText(element.text, value);
    return text === element.text ? element : { ...element, text };
  }
  if (element.kind !== 'table') return element;
  let changed = false;
  const rows = element.rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const text = projectedSlideNumberText(cell.text, value);
      if (text === cell.text) return cell;
      changed = true;
      return { ...cell, text };
    }),
  }));
  return changed ? { ...element, rows } : element;
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
  const layoutBase = rebasedElementBase(doc, slideOfElement(doc, id), record);
  const { tableCells, tableRows, link: linkOverride, ...overrides } = record.ovr;
  let out = { ...layoutBase.base, ...overrides } as unknown as SlideElement;
  if (own(record.ovr, 'link')) {
    const link = linkOverride?.kind === 'none' ? undefined : renderLinkTarget(doc, linkOverride!);
    out = { ...out, link } as SlideElement;
  }
  if (record.meta.imageReplacement && out.kind === 'image') {
    out = { ...out, src: record.meta.imageReplacement.src };
  }
  const replacementResource = record.meta.imageReplacement
    ? doc.imageResources[record.meta.imageReplacement.resourceHash] : undefined;
  if (record.meta.imageReplacement && !replacementResource) {
    throw new Error(`图片替换资源不存在：${record.meta.imageReplacement.resourceHash}`);
  }
  const resources = [
    ...(record.meta.insertion?.resources ?? []),
    ...(replacementResource ? [replacementResource] : []),
  ];
  if (resources.length) {
    out = hydrateElementInsertionAssets(out, resources);
  }
  if (out.kind === 'shape' && record.ovr.text?.kind === 'empty') {
    out = { ...out, text: null } as ShapeElement;
  } else if (out.kind === 'shape' && record.ovr.text?.kind === 'flat') {
    const baseText = layoutBase.base.kind === 'shape'
      ? layoutBase.base.text ?? rebasedTextBase(doc, slideOfElement(doc, id), id)
      : null;
    out = {
      ...out,
      text: textBodyFromOverride(record.ovr.text, baseText, (target) => renderLinkTarget(doc, target)),
    } as ShapeElement;
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
          text: override.kind === 'empty' ? null
            : textBodyFromOverride(override, cell.text, (target) => renderLinkTarget(doc, target)),
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
  } else if (out.kind === 'shape' && layoutBase.geom) {
    const geom = resolveGeomPath(layoutBase.geom, out.w, out.h);
    out = { ...out, path: geom.d, openGeom: geom.open || undefined } as ShapeElement;
  } else if (out.kind === 'image' && layoutBase.geom) {
    const geom = resolveGeomPath(layoutBase.geom, out.w, out.h);
    out = {
      ...out,
      clipPath: layoutBase.geom.preset === 'rect' ? null : geom.d,
    } as ImageElement;
  }
  out = dynamicSlideNumber(doc, id, out);
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
  const layout = changedLayout(doc, id);
  const resolved = layout ? resolvedLayoutSlide(doc, id) : null;
  const contentIds = projectionContentIds(doc, id);
  const layoutSource = layout ? {
    background: structuredClone(resolved?.background ?? layout.background),
    layoutName: layout.name,
    transition: structuredClone(resolved?.transition ?? layout.transition),
  } : {};
  const { animations: animationOverride, ...slideOverrides } = record.ovr;
  let slide: Slide = {
    ...record.src,
    ...layoutSource,
    ...slideOverrides,
    elements: [
      ...(layout ? projectedLayoutElements(doc, id)
        .filter((element) => !element.editInfo?.placeholder) : []),
      ...contentIds.map((elementId) => effectiveElement(doc, elementId)),
    ],
  };
  if (own(record.ovr, 'animations')) {
    const animations = projectAnimationSteps(doc, animationOverride!);
    if (animations) slide.animations = animations;
    else delete slide.animations;
  } else if (record.sourceAnimations?.some((step) => !doc.elements[step.target])) {
    const animations = projectAnimationSteps(
      doc, record.sourceAnimations.filter((step) => !!doc.elements[step.target]),
    );
    if (animations) slide.animations = animations;
    else delete slide.animations;
  }
  if (record.backgroundImage) {
    const resource = doc.imageResources[record.backgroundImage.resourceHash];
    if (!resource || slide.background?.type !== 'image') {
      throw new Error(`幻灯片 ${id} 的图片背景资源不存在`);
    }
    slide = {
      ...slide,
      background: {
        ...slide.background,
        src: hydrateInsertionResourceSource(slide.background.src, resource),
      },
    };
  }
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

/** 备注属于页面数据但不参与 SVG；只清投影缓存，不把画布视图列为脏页。 */
export function invalidateSlideData(doc: EditDoc, id: SlideId): ProjectionInvalidation {
  if (!doc.slides[id]) throw new Error(`找不到幻灯片：${id}`);
  cacheOf(doc).slides.delete(id);
  return { dirtyElements: new Set(), dirtySlides: new Set() };
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

function indexedSlideNumberStillEffective(doc: EditDoc, id: ElementId): boolean {
  const record = doc.elements[id];
  if (!record) return false;
  const contentChanged = record.src.kind === 'shape'
    ? own(record.ovr, 'text')
    : record.src.kind === 'table'
      ? own(record.ovr, 'tableCells') || own(record.ovr, 'tableRows')
      : false;
  // 动态字段索引来自来源内容；只有内容覆盖可能把字段真正删掉，普通换页序不应重算整套版式继承。
  return !contentChanged || hasDynamicSlideNumber(effectiveElement(doc, id));
}

/** 页序变化只改变动态字段；沿字段父链失效，避免框架订阅者收到整段页尾的元素更新。 */
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
      if (indexedSlideNumberStillEffective(doc, id)) invalidate(slideId, id);
    }
  }
  for (const slideId of doc.slideOrder) {
    for (const id of doc.slides[slideId]?.dynamicSlideLinks ?? []) invalidate(slideId, id);
  }
  // 稳定 SlideId 覆盖不会进入来源字段索引；页序与目标存在性变化时仍只扫描稀疏覆盖。
  for (const record of Object.values(doc.elements)) {
    const textLink = (text: import('./types').TextOverride | undefined): boolean => text?.kind === 'flat'
      && text.paragraphs.some((paragraph) => paragraph.marks.some((mark) =>
        mark.runOverrides?.link?.kind === 'slide'));
    if (record.ovr.link?.kind === 'slide' || textLink(record.ovr.text)
      || Object.values(record.ovr.tableCells ?? {}).some((cell) => textLink(cell.text))) {
      invalidate(slideOfElement(doc, record.id), record.id);
    }
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
  releaseProjectionCache(doc);
  return {
    dirtyElements: new Set(Object.keys(doc.elements)),
    dirtySlides: new Set(doc.slideOrder),
  };
}
