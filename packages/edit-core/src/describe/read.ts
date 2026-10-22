import { findPlaceholderByIdentity } from '@web-ppt/core';
import type { Paragraph, SlideElement, TextBody } from '@web-ppt/core';
import {
  effectiveElement, elementWorldBounds, queryElementAltText, querySelectionPane,
  sectionOfSlide, toSlide,
} from '@web-ppt/edit-core';
import type { EditDoc, ElementId } from '@web-ppt/edit-core';
import { canvasTargetOfElement } from '../design-target';
import { DescribeError } from './types';
import type {
  DescriptionElement, DescriptionParagraph, DescriptionPlaceholder, DescriptionSlide, PresentationDescription,
} from './types';

function paragraphs(element: SlideElement, includeChildren = false): DescriptionParagraph[] {
  const readBody = (body: TextBody | null, cell: DescriptionParagraph['cell']): DescriptionParagraph[] =>
    (body?.paragraphs ?? []).map((p: Paragraph) => {
      const numbering = p.editInfo?.autoNumbering;
      return {
        text: p.runs.map((run) => run.text).join(''), level: p.lvl, cell,
        bullet: {
          kind: p.bulletImage ? 'image' : p.bullet !== null ? 'text' : 'none',
          text: p.bullet,
          numbering: numbering ? { type: numbering.scheme, startAt: numbering.startAt } : null,
        },
      };
    });
  if (element.kind === 'shape') return readBody(element.text, null);
  if (element.kind === 'group' && includeChildren) return element.children.flatMap((child) => paragraphs(child, true));
  if (element.kind !== 'table') return [];
  return element.rows.flatMap((row, r) => row.cells.flatMap((cell, c) =>
    cell.merged ? [] : readBody(cell.text, { row: r, column: c })));
}

function placeholder(doc: EditDoc, slideId: string, id: ElementId): DescriptionPlaceholder | null {
  const ph = doc.elements[id].meta.ph;
  if (!ph) return null;
  const layout = doc.layouts[doc.slides[slideId].layoutId ?? ''];
  const master = layout ? doc.masters[layout.origin.masterPart] : undefined;
  const match = (ids: readonly string[], query: typeof ph) => findPlaceholderByIdentity(
    ids, (candidate) => doc.elements[candidate].meta.ph, query,
  );
  const layoutElement = layout ? match(layout.children, ph) : undefined;
  const masterQuery = layoutElement ? doc.elements[layoutElement].meta.ph! : ph;
  const masterElement = master ? match(master.children, masterQuery) : undefined;
  return {
    type: ph.type, index: ph.idx ?? null,
    layout: layoutElement ? { id: layout.id, elementId: layoutElement } : null,
    master: masterElement ? { id: master!.id, elementId: masterElement } : null,
  };
}

function readSlide(doc: EditDoc, slideId: string, number: number): DescriptionSlide {
  const slide = toSlide(doc, slideId), record = doc.slides[slideId];
  const layout = doc.layouts[record.layoutId ?? ''];
  const master = layout ? doc.masters[layout.origin.masterPart] : undefined;
  const sectionId = sectionOfSlide(doc, slideId);
  const section = sectionId ? doc.sections.records[sectionId] : null;
  const pane = querySelectionPane(doc, slideId);
  const roots = pane.filter((item) => item.parentId === null).reverse().map((item) => item.id);
  const states = new Map(pane.map((item) => [item.id, item]));
  const designRoots = [...(master?.children ?? []), ...(layout?.children ?? [])];
  const elements: DescriptionElement[] = [];

  const visit = (element: SlideElement, id: string, path: readonly string[], hidden: boolean, locked: boolean): void => {
    const host = doc.elements[id];
    if (!host || path.includes(id)) {
      throw new DescribeError('unaddressable-element', `页面 ${number} 元素 ${id} 缺少有效的无环编辑身份`, number, id);
    }
    const bounds = elementWorldBounds(doc, id);
    if (!Object.values(bounds).every(Number.isFinite)) {
      throw new DescribeError('invalid-geometry', `页面 ${number} 元素 ${id} 的包围盒必须为有限数值`, number, id);
    }
    const alt = queryElementAltText(doc, id), state = states.get(id);
    const nextPath = [...path, id];
    const ownHidden = hidden || state?.hidden === true || host.meta.hiddenByUser === true;
    const ownLocked = locked || state?.locked === true || host.meta.locked === true || host.meta.moveLocked === true;
    const frameObject = element.kind === 'group'
      && (host.meta.editable === 'frame' || element.editInfo?.editable === 'frame');
    elements.push({
      id, kind: element.kind, name: state?.name ?? element.name ?? '',
      altText: { title: alt.title, description: alt.descr }, path: nextPath,
      canvas: canvasTargetOfElement(doc, id),
      bounds: { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top },
      editable: host.meta.editable, hidden: ownHidden, locked: ownLocked,
      placeholder: placeholder(doc, slideId, id), paragraphs: paragraphs(element, frameObject),
    });
    if (element.kind === 'group' && !frameObject) {
      const ids = host.children ?? [];
      if (ids.length !== element.children.length) {
        throw new DescribeError('unaddressable-element', `页面 ${number} 组合 ${id} 的投影后代与编辑记录数量不符`, number, id);
      }
      element.children.forEach((child, index) => visit(child, ids[index], nextPath, ownHidden, ownLocked));
    }
  };

  const virtualCount = slide.elements.length - roots.length;
  if (virtualCount < 0) throw new DescribeError('invalid-document', `页面 ${number} 的投影根数量小于编辑根数量`, number);
  slide.elements.forEach((element, index) => {
    let id = roots[index - virtualCount];
    if (index < virtualCount) {
      const origin = element.editInfo?.origin;
      const matches = designRoots.filter((candidate) => {
        // 尚未保存的设计新增节点没有解析器 editInfo，当前投影对象本身仍保留真实记录身份。
        if (effectiveElement(doc, candidate) === element) return true;
        const source = doc.elements[candidate].meta.origin;
        return !!origin && source?.part === origin.part && source.spid === origin.spid;
      });
      if (matches.length !== 1) {
        throw new DescribeError('unaddressable-element', `页面 ${number} 设计投影 ${element.name ?? index} 必须对应唯一编辑记录，实际 ${matches.length} 个`, number);
      }
      id = matches[0];
    }
    visit(element, id, [], false, false);
  });
  return {
    id: slideId, number, hidden: slide.hidden === true,
    layout: layout ? { id: layout.id, name: layout.name } : slide.layoutName ? { id: '', name: slide.layoutName } : null,
    master: master ? { id: master.id, name: master.name } : null,
    section: section ? { id: section.id, name: section.name } : null,
    notes: slide.notes ?? '', elements,
  };
}

export function readDescription(doc: EditDoc): PresentationDescription {
  if (!doc || !doc.meta || !Number.isFinite(doc.meta.width) || !Number.isFinite(doc.meta.height)
    || doc.meta.width <= 0 || doc.meta.height <= 0 || !['pptx', 'ppt'].includes(doc.meta.source)) {
    throw new DescribeError('invalid-document', 'describe 要求尺寸为正有限数值、来源为 pptx/ppt 的 EditDoc');
  }
  const slides = doc.slideOrder.map((id, index) => {
    try { return readSlide(doc, id, index + 1); }
    catch (error) {
      if (error instanceof DescribeError) throw error;
      throw new DescribeError('invalid-document', `页面 ${index + 1}（${id}）读取失败：${error instanceof Error ? error.message : String(error)}`, index + 1);
    }
  });
  return {
    version: 1, source: doc.meta.source, width: doc.meta.width, height: doc.meta.height,
    totalSlides: slides.length, totalElements: slides.reduce((sum, slide) => sum + slide.elements.length, 0), slides,
    truncation: { reason: null, omittedSlides: 0, omittedElements: 0, next: null },
  };
}
