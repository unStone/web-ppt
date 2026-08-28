import { MAX_SAFE_EXTERNAL_HREF_LENGTH, parseSafeExternalUrl } from '@web-ppt/core';
import type { SlideElement } from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import type {
  EditDoc, ElementId, ElementLinkState, LinkOverride, LinkSourceValue, LinkTarget, SlideId,
} from './types';

export const MAX_EXTERNAL_LINK_LENGTH = MAX_SAFE_EXTERNAL_HREF_LENGTH;

export const supportsElementLink = (kind: SlideElement['kind']): boolean =>
  kind === 'shape' || kind === 'image' || kind === 'group';

export function normalizeExternalLinkTarget(href: string): LinkTarget | null {
  const url = parseSafeExternalUrl(href);
  if (!url) return null;
  return { kind: 'external', href: url.href };
}

export function assertLinkOverride(value: unknown, label: string): asserts value is LinkOverride {
  assertDataObject(value, ['kind', 'href', 'slideId'], label);
  const candidate = value as { kind?: unknown; href?: unknown; slideId?: unknown };
  if (candidate.kind === 'none') {
    assertDataObject(value, ['kind'], label);
    return;
  }
  if (candidate.kind === 'external') {
    assertDataObject(value, ['kind', 'href'], label);
    if (typeof candidate.href !== 'string' || !normalizeExternalLinkTarget(candidate.href)) {
      throw new Error(`${label}.href 必须是安全且不超过 ${MAX_EXTERNAL_LINK_LENGTH} 字符的 http、https 或 mailto 链接`);
    }
    return;
  }
  if (candidate.kind === 'slide') {
    assertDataObject(value, ['kind', 'slideId'], label);
    if (typeof candidate.slideId !== 'string' || !candidate.slideId) {
      throw new Error(`${label}.slideId 必须是非空页面身份`);
    }
    return;
  }
  throw new Error(`${label}.kind 不受支持：${String(candidate.kind)}`);
}

export function normalizeLinkTarget(doc: EditDoc, value: LinkOverride, label: string): LinkOverride {
  assertLinkOverride(value, label);
  if (value.kind === 'external') return normalizeExternalLinkTarget(value.href)!;
  if (value.kind === 'slide' && !doc.slides[value.slideId]) {
    throw new Error(`${label}.slideId 指向不存在的页面：${value.slideId}`);
  }
  return structuredClone(value);
}

function slideIdByPart(doc: EditDoc, part: string): SlideId | null {
  return doc.slideOrder.find((id) => doc.slides[id]?.origin?.part === part) ?? null;
}

export function sourceLinkValue(doc: EditDoc, link: string | undefined): LinkSourceValue | null {
  if (!link) return null;
  const relative = /^slide:(next|previous|first|last)$/.exec(link)?.[1] as
    | 'next' | 'previous' | 'first' | 'last' | undefined;
  if (relative) return { kind: 'relative', action: relative };
  if (link.startsWith('slide-part:')) {
    try {
      const id = slideIdByPart(doc, decodeURIComponent(link.slice('slide-part:'.length)));
      return id ? { kind: 'slide', slideId: id } : { kind: 'unsupported' };
    } catch { return { kind: 'unsupported' }; }
  }
  const page = /^slide:(\d+)$/.exec(link);
  if (page) {
    const id = doc.slideOrder[Number(page[1]) - 1];
    return id ? { kind: 'slide', slideId: id } : { kind: 'unsupported' };
  }
  return normalizeExternalLinkTarget(link) ?? { kind: 'unsupported' };
}

function elementSourceLinkValue(doc: EditDoc, id: ElementId): LinkSourceValue | null {
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  return record.meta.sourceLinkReadonly ? { kind: 'unsupported' }
    : sourceLinkValue(doc, record.src.link);
}

function effectiveLinkValue(doc: EditDoc, id: ElementId): LinkSourceValue | null {
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  if (!own(record.ovr, 'link')) return elementSourceLinkValue(doc, id);
  const override = record.ovr.link!;
  return override.kind === 'none' ? null : structuredClone(override);
}

export function renderLinkTarget(doc: EditDoc, target: LinkTarget): string | undefined {
  if (target.kind === 'external') return target.href;
  const index = doc.slideOrder.indexOf(target.slideId);
  return index < 0 ? undefined : `slide:${index + 1}`;
}

export function sourceLinkReadonly(value: LinkSourceValue | null): boolean {
  return value?.kind === 'relative' || value?.kind === 'unsupported';
}

export function linkValueFollowable(doc: EditDoc, value: LinkSourceValue | null): boolean {
  if (!value || value.kind === 'unsupported') return false;
  if (value.kind === 'slide') return !!doc.slides[value.slideId];
  return true;
}

export function queryElementLink(doc: EditDoc, ids: readonly ElementId[]): ElementLinkState {
  if (!ids.length) throw new Error('链接查询至少需要一个元素');
  const records = ids.map((id) => {
    const record = doc.elements[id];
    if (!record) throw new Error(`找不到元素：${id}`);
    if (!supportsElementLink(record.src.kind)) {
      throw new Error(`元素不支持链接：${id}`);
    }
    return record;
  });
  const values = ids.map((id) => effectiveLinkValue(doc, id));
  const sources = records.map((record) => elementSourceLinkValue(doc, record.id));
  const signature = JSON.stringify(values[0]);
  const sourceSignature = JSON.stringify(sources[0]);
  const mixed = values.some((value) => JSON.stringify(value) !== signature);
  return {
    value: structuredClone(values[0] ?? null),
    source: structuredClone(sources[0] ?? null),
    mixed,
    sourceMixed: sources.some((value) => JSON.stringify(value) !== sourceSignature),
    direct: records.some((record) => own(record.ovr, 'link')),
    sourceReadonly: sources.some(sourceLinkReadonly),
    followable: !mixed && linkValueFollowable(doc, values[0] ?? null),
  };
}
