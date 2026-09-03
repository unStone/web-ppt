import { resolveCustomGeometry, resolveGeomPath } from '@web-ppt/core/geometry';
import type {
  GroupElement, ImageElement, ShapeElement, Slide, SlideElement, TableElement,
} from '@web-ppt/core';
import type { EditDoc, ElementId, ProjectionInvalidation, SlideId } from './types';
import { hydrateElementInsertionAssets, hydrateInsertionResourceSource } from './session-assets';
import { own } from './data-validation';
import { renderLinkTarget } from './hyperlink';
import { hasDynamicSlideNumber } from './dynamic-slide-fields';
import { projectElementSlideFields, projectVirtualSlideFields } from './dynamic-projection';
import { textBodyFromOverride } from './text-model';
import { tableCellOverrideKeyFromRefs } from './table-cell';
import { orderedTableColumns, orderedTableRows, tableCellMergeRole } from './table-grid';
import {
  hasComplexTableStructureOverrides, hasTableStructureOverrides, projectTableStructure,
} from './table-grid-projection';
import {
  tableRowHeightDelta, tableRowsWithoutTextOverrides,
} from './table-rows';
import {
  changedLayout, projectedLayoutElements, projectionContentIds, rebasedElementBase,
  rebasedTextBase, resolvedLayoutElementSource, resolvedLayoutSlide,
} from './layout-projection';
import { projectAnimationSteps } from './slide-animation';
import { projectTableStyle } from './table-style';
import { scaledDimensions, scaledTableEditInfo } from './table-scale';
import { canvasTargetOfElement } from './design-target';
import { slidesForLayout } from './design-dependencies';

interface ProjectionCache {
  elements: Map<ElementId, SlideElement>;
  slides: Map<SlideId, Slide>;
}

const caches = new WeakMap<EditDoc, ProjectionCache>();

/** 文档换包或释放后，投影不能继续持有旧资源 URL 与整页 Schema。 */
export function releaseProjectionCache(doc: EditDoc): void {
  caches.delete(doc);
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

export function effectiveElement(doc: EditDoc, id: ElementId): SlideElement {
  const cache = cacheOf(doc);
  const cached = cache.elements.get(id);
  if (cached) return cached;

  const record = elementRecord(doc, id);
  const target = canvasTargetOfElement(doc, id);
  const layoutBase = target.kind === 'slide'
    ? rebasedElementBase(doc, target.id, record, (layoutId) => effectiveElement(doc, layoutId))
    : {
      base: resolvedLayoutElementSource(doc, target.id, record) ?? record.src,
      ...(record.meta.geom ? { geom: record.meta.geom } : {}),
    };
  const {
    tableCells, tableRows, tableColumns, tableRemovedRows, tableRemovedColumns,
    tableRowHeights, tableColumnWidths, tableMerges, tableStyle,
    link: linkOverride, geometry: geometryOverride, presetGeometry: presetGeometryOverride, ...overrides
  } = record.ovr;
  let out = { ...layoutBase.base, ...overrides } as unknown as SlideElement;
  let complexTableStructure = false;
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
  const bulletHashes = new Set<string>();
  const collectBulletResources = (text: import('./types').TextOverride | undefined): void => {
    if (text?.kind !== 'flat') return;
    for (const paragraph of text.paragraphs) {
      if (paragraph.bulletImageOverride) bulletHashes.add(paragraph.bulletImageOverride.resourceHash);
    }
  };
  collectBulletResources(record.ovr.text);
  for (const cell of Object.values(record.ovr.tableCells ?? {})) collectBulletResources(cell.text);
  const bulletResources = [...bulletHashes].map((hash) => doc.imageResources[hash]);
  if (bulletResources.some((resource) => !resource)) {
    throw new Error(`图片项目符号资源不存在：${[...bulletHashes].find((hash) => !doc.imageResources[hash])}`);
  }
  const resources = [
    ...(record.meta.insertion?.resources ?? []),
    ...(replacementResource ? [replacementResource] : []),
    ...bulletResources,
  ];
  if (resources.length) {
    out = hydrateElementInsertionAssets(out, resources);
  }
  if (out.kind === 'shape' && record.ovr.text?.kind === 'empty') {
    out = { ...out, text: null } as ShapeElement;
  } else if (out.kind === 'shape' && record.ovr.text?.kind === 'flat') {
    const baseText = layoutBase.base.kind === 'shape'
      ? layoutBase.base.text ?? (target.kind === 'slide'
        ? rebasedTextBase(doc, target.id, id, (layoutId) => effectiveElement(doc, layoutId))
        : record.meta.textTemplate ?? null)
      : null;
    out = {
      ...out,
      text: textBodyFromOverride(record.ovr.text, baseText, (target) => renderLinkTarget(doc, target)),
    } as ShapeElement;
  } else if (out.kind === 'table' && (tableCells || hasTableStructureOverrides(record))) {
    if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 的表格投影来源无效`);
    complexTableStructure = hasComplexTableStructureOverrides(record);
    if (complexTableStructure) out = projectTableStructure(record, out);
    else if (tableRows) out = { ...out, rows: tableRowsWithoutTextOverrides(record) };
    const baseRows = out.rows;
    const gridRows = orderedTableRows(record);
    const gridColumns = orderedTableColumns(record);
    const rows = baseRows.map((row, r) => {
      let changed = false;
      const cells = row.cells.map((cell, c) => {
        const gridRow = gridRows[r];
        const gridColumn = gridColumns[c];
        const rowRef = gridRow?.rowRef;
        const columnRef = gridColumn?.columnRef;
        if (gridRow && gridColumn && tableCellMergeRole(record, {
          row: gridRow.id, column: gridColumn.id,
        }) === 'placeholder') return cell;
        const override = rowRef === undefined || columnRef === undefined
          ? undefined : tableCells?.[tableCellOverrideKeyFromRefs(rowRef, columnRef)]?.text;
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
    out = {
      ...out, rows,
      ...(!complexTableStructure && tableRows
        ? { h: out.h + tableRowHeightDelta(record) } : {}),
    } as TableElement;
  }
  if (bulletResources.length) {
    out = hydrateElementInsertionAssets(out, bulletResources);
  }
  const effectiveTableStyle = tableStyle ?? (complexTableStructure && record.src.kind === 'table'
    ? record.src.editInfo?.tableStyle : undefined);
  if (out.kind === 'table' && effectiveTableStyle) {
    out = projectTableStyle(doc, target, out, effectiveTableStyle);
  }
  if (out.kind === 'table' && tableCells) {
    const gridRows = orderedTableRows(record);
    const gridColumns = orderedTableColumns(record);
    let changed = false;
    const rows = out.rows.map((row, r) => ({
      ...row,
      cells: row.cells.map((cell, c) => {
        const gridRow = gridRows[r];
        const gridColumn = gridColumns[c];
        const rowRef = gridRow?.rowRef;
        const columnRef = gridColumn?.columnRef;
        if (rowRef === undefined || columnRef === undefined) return cell;
        if (tableCellMergeRole(record, {
          row: gridRow.id, column: gridColumn.id,
        }) === 'placeholder') return cell;
        const cellOverride = tableCells[tableCellOverrideKeyFromRefs(rowRef, columnRef)];
        if (!cellOverride) return cell;
        const { text: _text, ...appearance } = cellOverride;
        if (!Reflect.ownKeys(appearance).length) return cell;
        changed = true;
        return { ...cell, ...appearance };
      }),
    }));
    if (changed) out = { ...out, rows };
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
  } else if (out.kind === 'shape' && presetGeometryOverride) {
    const geom = resolveGeomPath(presetGeometryOverride, out.w, out.h);
    out = { ...out, path: geom.d, openGeom: geom.open || undefined } as ShapeElement;
  } else if (out.kind === 'shape' && (geometryOverride || record.meta.customGeometry)) {
    const geometry = resolveCustomGeometry(geometryOverride ?? record.meta.customGeometry!, out.w, out.h);
    out = { ...out, path: geometry.d, openGeom: geometry.open || undefined } as ShapeElement;
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
  if (target.kind === 'slide') {
    out = projectElementSlideFields(doc, target.id, out);
  }
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
  const resolved = resolvedLayoutSlide(doc, id);
  const contentIds = projectionContentIds(doc, id);
  const layoutSource = layout ? {
    background: structuredClone(record.sourceDirectBackground
      ? resolved?.background ?? record.src.background
      : own(layout.ovr, 'background')
        ? layout.ovr.background! : resolved?.background ?? layout.background),
    layoutName: layout.name,
    transition: structuredClone(record.sourceDirectTransition
      ? resolved?.transition ?? record.src.transition
      : own(layout.ovr, 'transition')
        ? layout.ovr.transition! : resolved?.transition ?? layout.transition),
  } : resolved ? {
    background: structuredClone(resolved.background),
    layoutName: resolved.layoutName ?? (record.layoutId ? doc.layouts[record.layoutId]?.name : undefined),
    transition: structuredClone(resolved.transition),
  } : {};
  const { animations: animationOverride, ...slideOverrides } = record.ovr;
  let slide: Slide = {
    ...record.src,
    ...layoutSource,
    ...slideOverrides,
    elements: [
      ...(layout ? projectedLayoutElements(doc, id, (layoutId) => effectiveElement(doc, layoutId))
        .filter((element) => !element.editInfo?.placeholder)
        .map((element) => projectVirtualSlideFields(doc, id, element)) : []),
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
  const target = canvasTargetOfElement(doc, id);
  if (target.kind !== 'slide') throw new Error(`元素不属于普通幻灯片：${id}`);
  return target.id;
}

function invalidateLayoutDependents(
  doc: EditDoc,
  layoutId: string,
  cache: ProjectionCache,
  dirtyElements: Set<ElementId>,
): Set<SlideId> {
  const dirtySlides = new Set(slidesForLayout(doc, layoutId));
  for (const slideId of dirtySlides) {
    cache.slides.delete(slideId);
    invalidateSlideElementCaches(doc, slideId, cache, dirtyElements);
  }
  return dirtySlides;
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
    if (doc.layouts[current.parent]) {
      for (const slideId of invalidateLayoutDependents(
        doc, current.parent, cache, dirtyElements,
      )) dirtySlides.add(slideId);
      break;
    }
    current = elementRecord(doc, current.parent as ElementId);
  }
  return { dirtyElements, dirtySlides };
}

function invalidateSlideElementCaches(
  doc: EditDoc,
  slideId: SlideId,
  cache: ProjectionCache,
  dirtyElements: Set<ElementId>,
): void {
  const visit = (elementId: ElementId): void => {
    dirtyElements.add(elementId);
    cache.elements.delete(elementId);
    for (const child of doc.elements[elementId]?.children ?? []) visit(child);
  };
  for (const elementId of doc.slides[slideId]?.children ?? []) visit(elementId);
}

/** 主题变化只清使用该主题的设计画布；不能破坏无关页面的投影引用稳定性。 */
export function invalidateLayoutElementCaches(
  doc: EditDoc,
  layoutIds: readonly string[],
): Set<ElementId> {
  const cache = cacheOf(doc);
  const dirty = new Set<ElementId>();
  const visit = (id: ElementId): void => {
    if (dirty.has(id)) return;
    dirty.add(id);
    cache.elements.delete(id);
    for (const child of doc.elements[id]?.children ?? []) visit(child);
  };
  for (const layoutId of layoutIds) {
    for (const id of doc.layouts[layoutId]?.children ?? []) visit(id);
  }
  return dirty;
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
    : doc.layouts[parent]
      ? (() => {
        const dirtyElements = new Set<ElementId>();
        const dirtySlides = invalidateLayoutDependents(doc, parent, cache, dirtyElements);
        return { dirtyElements, dirtySlides };
      })()
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
