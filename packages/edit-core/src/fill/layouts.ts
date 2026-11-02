import { findPlaceholderByIdentity } from '@web-ppt/core';
import { effectiveElement } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { parseXmlTree } from '../xml/tree';
import { findXmlAttribute } from '../xml/query';
import type { TemplateFillSlide } from './types';
import { TemplateFillError } from './errors';

export interface FillSlot {
  readonly id: string;
  readonly type: string;
  readonly index: string | null;
  readonly rot: number;
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface FillSlidePlan {
  readonly layoutId: string;
  readonly title: FillSlot;
  readonly subtitle?: FillSlot;
  readonly bodies: readonly FillSlot[];
  readonly object?: FillSlot;
}

function slots(doc: EditDoc, layoutId: string): FillSlot[] {
  return doc.layouts[layoutId].children.flatMap(id => {
    const record = doc.elements[id];
    const ph = record.meta.ph;
    if (!ph || ['dt', 'sldNum', 'ftr', 'hdr'].includes(ph.type)) return [];
    const element = effectiveElement(doc, id);
    if (element.kind !== 'shape' || ![element.x, element.y, element.w, element.h, element.rot].every(Number.isFinite)
      || element.w <= 0 || element.h <= 0) return [];
    return [{ id, type: ph.type, index: ph.idx ?? null, rot: element.rot, flipH: element.flipH, flipV: element.flipV,
      rect: { x: element.x, y: element.y, w: element.w, h: element.h } }];
  });
}

function layoutType(doc: EditDoc, id: string): string | null {
  const part = doc.layouts[id].origin.part;
  const bytes = doc.package?.parts[part];
  if (!bytes) throw new TemplateFillError('invalid-template', `版式 ${id} 缺少可读的来源部件 ${part}`);
  return findXmlAttribute(parseXmlTree(bytes).root, { localName: 'type', namespaceUri: null })?.value ?? null;
}

function candidate(doc: EditDoc, id: string, slide: TemplateFillSlide): { plan: FillSlidePlan; score: number } | null {
  const all = slots(doc, id);
  const find = (type: string) => findPlaceholderByIdentity(all, slot => ({ type: slot.type, idx: slot.index }), { type });
  const title = find('title');
  if (!title) return null;
  const bodies = all.filter(slot => slot.type === 'body' || slot.type === 'obj')
    .sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sourceType = layoutType(doc, id);
  if (slide.type === 'title') {
    const subtitle = all.find(slot => slot.type === 'subTitle');
    if (slide.subtitle !== undefined && !subtitle) return null;
    return { plan: { layoutId: id, title, subtitle, bodies: [] },
      score: (sourceType === 'title' || title.type === 'ctrTitle' ? 0 : 20) + bodies.length };
  }
  if (slide.type === 'section') {
    if (!slide.layoutId && sourceType !== 'secHead') return null;
    if (slide.body?.length && !bodies.length) return null;
    return { plan: { layoutId: id, title, bodies: bodies.slice(0, 1) }, score: bodies.length };
  }
  if (slide.type === 'content' || slide.type === 'two-column') {
    const count = slide.type === 'two-column' ? 2 : 1;
    if (bodies.length < count || sourceType === 'title' || sourceType === 'secHead') return null;
    return { plan: { layoutId: id, title, bodies: bodies.slice(0, count) }, score: bodies.length - count };
  }
  const types = slide.type === 'image' ? ['pic', 'obj', 'body'] : ['chart', 'obj', 'body'];
  const caption = slide.type === 'image' && !!slide.body?.length;
  for (let rank = 0; rank < types.length; rank++) {
    for (const object of all.filter(slot => slot.type === types[rank])) {
      const remaining = bodies.filter(slot => slot.id !== object.id);
      if (caption && !remaining.length) continue;
      if (sourceType === 'title' || sourceType === 'secHead') continue;
      return { plan: { layoutId: id, title, object, bodies: caption ? remaining.slice(0, 1) : [] },
        score: rank * 10 + Math.max(0, remaining.length - Number(caption)) };
    }
  }
  return null;
}

export function planTemplateSlides(doc: EditDoc, slides: readonly TemplateFillSlide[]): readonly FillSlidePlan[] {
  return slides.map((slide, index) => {
    if (slide.layoutId !== undefined && !doc.layouts[slide.layoutId]) {
      throw new TemplateFillError('layout-not-found', `第 ${index + 1} 页指定的版式不存在：${slide.layoutId}`,
        index + 1, 'layoutId');
    }
    const matches = (slide.layoutId ? [slide.layoutId] : doc.layoutOrder).flatMap((id, order) => {
      const result = candidate(doc, id, slide);
      return result ? [{ ...result, order }] : [];
    }).sort((a, b) => a.score - b.score || a.order - b.order);
    if (!matches.length) {
      throw new TemplateFillError('layout-role-mismatch',
        `第 ${index + 1} 页 ${slide.type} 没有匹配的占位符版式；可用版式：${doc.layoutOrder.join(', ')}`,
        index + 1, 'type');
    }
    return matches[0].plan;
  });
}
