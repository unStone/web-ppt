import type { SlideElement, TextBody } from '@web-ppt/core';
import { isDynamicSlideLink } from './dynamic-slide-fields';
import type { EditDoc, SlideId } from './types';

function resolvedSlideLink(
  doc: EditDoc,
  slideId: SlideId,
  link: string | undefined,
): string | undefined {
  if (!isDynamicSlideLink(link)) return link;
  const current = doc.slideOrder.indexOf(slideId);
  let target: number | undefined;
  if (link === 'slide:next') target = current + 2;
  else if (link === 'slide:previous') target = current;
  else if (link === 'slide:first') target = 1;
  else if (link === 'slide:last') target = doc.slideOrder.length;
  else if (link?.startsWith('slide-part:')) {
    try {
      const part = decodeURIComponent(link.slice('slide-part:'.length));
      const index = doc.slideOrder.findIndex((id) => doc.slides[id].origin?.part === part);
      if (index >= 0) target = index + 1;
    } catch { return link; }
  }
  return target === undefined ? link : `slide:${target}`;
}

function projectedText(doc: EditDoc, slideId: SlideId, text: TextBody | null): TextBody | null {
  if (!text) return null;
  const number = String(doc.slideOrder.indexOf(slideId) + 1);
  let changed = false;
  const paragraphs = text.paragraphs.map((paragraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => {
      const link = resolvedSlideLink(doc, slideId, run.link);
      const value = run.field?.toLowerCase() === 'slidenum' ? number : run.text;
      if (link === run.link && value === run.text) return run;
      changed = true;
      return { ...run, text: value, link };
    }),
  }));
  return changed ? { ...text, paragraphs } : text;
}

function project(
  doc: EditDoc,
  slideId: SlideId,
  element: SlideElement,
  deep: boolean,
): SlideElement {
  let out = element;
  const link = resolvedSlideLink(doc, slideId, out.link);
  if (link !== out.link) out = { ...out, link } as SlideElement;
  if (out.kind === 'shape') {
    const text = projectedText(doc, slideId, out.text);
    if (text !== out.text) out = { ...out, text };
  } else if (out.kind === 'table') {
    let changed = false;
    const rows = out.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => {
        const text = projectedText(doc, slideId, cell.text);
        if (text === cell.text) return cell;
        changed = true;
        return { ...cell, text };
      }),
    }));
    if (changed) out = { ...out, rows };
  } else if (deep && out.kind === 'group') {
    const group = out;
    const children = group.children.map((child) => project(doc, slideId, child, true));
    if (children.some((child, index) => child !== group.children[index])) out = { ...group, children };
  }
  return out;
}

/** 稳定模型元素的组后代会分别投影，因此这里只处理当前节点。 */
export const projectElementSlideFields = (
  doc: EditDoc, slideId: SlideId, element: SlideElement,
): SlideElement => project(doc, slideId, element, false);

/** 版式虚拟节点没有 ElementRecord，动态字段必须在值树内递归求值。 */
export const projectVirtualSlideFields = (
  doc: EditDoc, slideId: SlideId, element: SlideElement,
): SlideElement => project(doc, slideId, element, true);
