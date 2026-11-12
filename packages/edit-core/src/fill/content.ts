import { findPlaceholderByIdentity } from '@web-ppt/core';
import type { Editor, EditDoc, ElementId } from '@web-ppt/edit-core';
import { effectiveElement } from '@web-ppt/edit-core';
import { textTargetContextForRecord } from '../commands/text-target';
import { color } from '../lint/color';
import type { FillSlidePlan, FillSlot } from './layouts';
import type { PreparedFillImage } from './validation';
import type { TemplateFillParagraph, TemplateFillSlide } from './types';
import { TemplateFillError, requireActive } from './errors';

export interface FilledPage {
  readonly slideId: string;
  readonly slidePart: string;
  readonly plan: FillSlidePlan;
  readonly type: TemplateFillSlide['type'];
}

export function pageSlot(doc: EditDoc, slideId: string, slot: FillSlot): ElementId {
  const id = findPlaceholderByIdentity(doc.slides[slideId].children, (candidate) => doc.elements[candidate].meta.ph, {
    type: slot.type,
    idx: slot.index,
  });
  if (!id) throw new TemplateFillError('placeholder-not-found', `新页 ${slideId} 缺少占位符 ${slot.type}/${slot.index}`);
  return id;
}

function text(editor: Editor, id: string, paragraphs: readonly TemplateFillParagraph[]): void {
  const source = textTargetContextForRecord(editor.doc.elements[id], { id });
  if (!source.empty) throw new TemplateFillError('invalid-template', `新页占位符 ${id} 应为空，实际含页面直设文字`, null, null, id);
  const values = paragraphs.length
    ? paragraphs.flatMap((paragraph) => paragraph.text.split('\n').map((line) => ({ ...paragraph, text: line })))
    : [{ text: '' }];
  editor.exec({
    type: 'EditText',
    id,
    ops: [
      {
        type: 'replaceFragment',
        from: { p: 0, r: 0, off: 0 },
        to: { p: 0, r: 0, off: 0 },
        fragment: {
          paragraphs: values.map((paragraph) => ({
            text: paragraph.text,
            marks: paragraph.text.length ? [{ from: 0, to: paragraph.text.length, props: {} }] : [],
          })),
        },
      },
    ],
  });
  values.forEach((paragraph, p) =>
    editor.exec({
      type: 'SetParaProps',
      id,
      range: { from: { p, r: 0, off: 0 }, to: { p, r: 0, off: paragraph.text.length } },
      props: {
        level: paragraph.level ?? 0,
        ...(paragraph.bullet === undefined ? {} : { bullet: paragraph.bullet ? { kind: 'char', char: '•' } : { kind: 'none' } }),
      },
    }),
  );
  editor.exec({ type: 'SetBodyProps', id, props: { autoFit: 'normal' } });
}

function image(
  editor: Editor,
  slideId: string,
  slot: FillSlot,
  slide: Extract<TemplateFillSlide, { type: 'image' }>,
  prepared: PreparedFillImage,
): void {
  const placeholderId = pageSlot(editor.doc, slideId, slot);
  const sourceRatio = prepared.metadata.width / prepared.metadata.height;
  const targetRatio = slot.rect.w / slot.rect.h;
  let rect = { ...slot.rect };
  if ((slide.image.fit ?? 'contain') === 'contain') {
    const w = sourceRatio > targetRatio ? rect.w : rect.h * sourceRatio;
    const h = sourceRatio > targetRatio ? rect.w / sourceRatio : rect.h;
    rect = { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
  }
  const previous = new Set(editor.doc.slides[slideId].children);
  if (slot.type !== 'pic') editor.exec({ type: 'RemoveElement', id: placeholderId });
  editor.exec({
    type: 'AddImage',
    slideId,
    rect,
    bytes: prepared.bytes,
    mime: slide.image.mime,
    ...(slot.type === 'pic' ? { placeholderId } : {}),
  });
  const id = editor.doc.slides[slideId].children.find((candidate) => !previous.has(candidate));
  if (!id) throw new TemplateFillError('invalid-result', `页面 ${slideId} 新增图片后未取得原生图片身份`);
  if (slot.rot) editor.exec({ type: 'SetXfrm', id, rot: slot.rot });
  if (slot.flipH || slot.flipV) editor.exec({ type: 'SetFlip', id, h: slot.flipH, v: slot.flipV });
  if (slide.image.fit === 'cover') {
    const horizontal = sourceRatio > targetRatio;
    const total = Math.round((1 - (horizontal ? targetRatio / sourceRatio : sourceRatio / targetRatio)) * 100000);
    if (total >= 100000) {
      throw new TemplateFillError(
        'image-crop-unrepresentable',
        'cover 裁剪后的面积小于 OOXML 十万分之一精度，不能无失真表示',
        null,
        'image.fit',
      );
    }
    // 两边分别四舍五入会把仅余一个原生单位的可见区域裁空。
    const leading = Math.floor(total / 2) / 100000,
      trailing = (total - Math.floor(total / 2)) / 100000;
    editor.exec({
      type: 'SetCrop',
      id,
      crop: { l: horizontal ? leading : 0, r: horizontal ? trailing : 0, t: horizontal ? 0 : leading, b: horizontal ? 0 : trailing },
    });
  }
  if (slide.image.altText !== undefined) editor.exec({ type: 'SetAltText', id, title: null, descr: slide.image.altText });
}

export function materializeOutline(
  editor: Editor,
  slides: readonly TemplateFillSlide[],
  plans: readonly FillSlidePlan[],
  images: ReadonlyMap<number, PreparedFillImage>,
  signal?: AbortSignal,
): readonly FilledPage[] {
  const originals = [...editor.doc.slideOrder];
  const pages: FilledPage[] = [];
  slides.forEach((slide, index) => {
    requireActive(signal);
    const plan = plans[index];
    const result = editor.exec({
      type: 'AddSlide',
      layoutId: plan.layoutId,
      at: { after: editor.doc.slideOrder[editor.doc.slideOrder.length - 1] ?? null },
    });
    const slideId = [...result.createdSlides][0];
    if (!slideId) throw new TemplateFillError('invalid-result', `第 ${index + 1} 页未取得新页身份`, index + 1);
    const titleId = pageSlot(editor.doc, slideId, plan.title);
    text(editor, titleId, [{ text: slide.title, bullet: false }]);
    if (slide.type === 'title' && plan.subtitle && slide.subtitle !== undefined) {
      text(editor, pageSlot(editor.doc, slideId, plan.subtitle), [{ text: slide.subtitle, bullet: false }]);
    }
    if ((slide.type === 'section' || slide.type === 'image') && slide.body?.length) {
      text(editor, pageSlot(editor.doc, slideId, plan.bodies[0]), slide.body);
    }
    if (slide.type === 'content') text(editor, pageSlot(editor.doc, slideId, plan.bodies[0]), slide.body);
    if (slide.type === 'two-column')
      slide.columns.forEach((column, at) => text(editor, pageSlot(editor.doc, slideId, plan.bodies[at]), column));
    if (slide.type === 'image') image(editor, slideId, plan.object!, slide, images.get(index)!);
    if (slide.type === 'chart') editor.exec({ type: 'RemoveElement', id: pageSlot(editor.doc, slideId, plan.object!) });
    if (slide.notes !== undefined) editor.exec({ type: 'SetNotes', id: slideId, text: slide.notes });
    for (const id of editor.doc.slides[slideId].children) {
      const record = editor.doc.elements[id];
      if (record.src.kind === 'shape' && record.meta.ph && ['dt', 'sldNum', 'ftr', 'hdr'].includes(record.meta.ph.type)) {
        editor.exec({ type: 'SetBodyProps', id, props: { autoFit: 'normal' } });
      }
    }
    const slidePart = editor.doc.slides[slideId].origin?.part;
    if (!slidePart) throw new TemplateFillError('invalid-result', `第 ${index + 1} 页缺少原生保存锚点`, index + 1);
    pages.push({ slideId, slidePart, plan, type: slide.type });
  });
  for (const id of originals) editor.exec({ type: 'RemoveSlide', id });
  return pages;
}

export function chartSlotStyle(doc: EditDoc, slot: FillSlot): { textColor?: string; fontFamily?: string } {
  const record = doc.elements[slot.id];
  const element = effectiveElement(doc, slot.id);
  const body = element.kind === 'shape' ? (element.text ?? record.meta.textTemplate) : undefined;
  const run = body?.paragraphs[0]?.runs[0];
  if (!run) return {};
  const rgb = color(run.color);
  const textColor = rgb
    .slice(0, 3)
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
  return { textColor, ...(run.fonts[0] ? { fontFamily: run.fonts[0] } : {}) };
}
