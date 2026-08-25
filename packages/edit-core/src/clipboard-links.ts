import type { SlideElement, TextBody, TextRun } from '@web-ppt/core';
import { packageTargetIdentity, resolvePackageTarget } from './clipboard-source';
import { assertDataObject } from './data-validation';
import { assertLinkOverride } from './hyperlink';
import { flattenTextBody } from './text-model';
import { textRunEditLength } from './text-position';
import type {
  ClipboardPortableLink, ClipboardTextLink, ElementClipboardRecordMeta, TextRange,
} from './commands/types';
import type {
  EditDoc, ElementOverrides, LinkOverride, LinkSourceValue, TableCellOverrides,
} from './types';
import { queryElementLink } from './hyperlink';
import { queryRunLink } from './run-links';

function portableTarget(doc: EditDoc, value: LinkSourceValue | null): ClipboardPortableLink | null {
  if (!value) return null;
  if (value.kind !== 'slide') return structuredClone(value);
  const part = doc.slides[value.slideId]?.origin?.part;
  const packageTarget = part && doc.package?.parts[part]
    ? packageTargetIdentity(doc.package, part) : undefined;
  return {
    kind: 'slide', sourceSlideId: value.slideId,
    ...(packageTarget ? { packageTarget } : {}),
  };
}

function exactRunRange(paragraph: number, run: number, value: TextRun): TextRange {
  return {
    from: { p: paragraph, r: run, off: 0 },
    to: { p: paragraph, r: run, off: textRunEditLength(value) },
  };
}

function bodyLinks(
  doc: EditDoc,
  id: string,
  body: TextBody | null,
  cell?: { r: number; c: number },
): ClipboardTextLink[] {
  if (!body) return [];
  return body.paragraphs.flatMap((paragraph, p) => paragraph.runs.flatMap((run, r) => {
    const state = queryRunLink(doc, id, exactRunRange(p, r, run), cell);
    const value = state.value ? portableTarget(doc, state.value)
      : state.direct ? { kind: 'none' as const } : null;
    return value ? [{ paragraph: p, run: r, ...(cell ? { cell: { ...cell } } : {}), value }] : [];
  }));
}

export function copiedLinkMeta(
  doc: EditDoc,
  id: string,
  element: SlideElement,
): Pick<ElementClipboardRecordMeta, 'link' | 'textLinks'> {
  const editableText = doc.elements[id]?.meta.editable === 'full';
  const elementState = element.kind === 'shape' || element.kind === 'image'
    ? queryElementLink(doc, [id]) : null;
  const link = elementState?.value ? portableTarget(doc, elementState.value)
    : elementState?.direct ? { kind: 'none' as const } : null;
  const textLinks = editableText && element.kind === 'shape'
    ? bodyLinks(doc, id, element.text)
    : editableText && element.kind === 'table'
      ? element.rows.flatMap((row, r) => row.cells.flatMap((cell, c) =>
        // 合并占位格没有独立文本身份；读取它会绕过表格主格拓扑。
        cell.merged ? [] : bodyLinks(doc, id, cell.text, { r, c })))
      : [];
  return {
    ...(link ? { link } : {}),
    ...(textLinks.length ? { textLinks } : {}),
  };
}

export function assertClipboardPortableLink(value: unknown, label: string): asserts value is ClipboardPortableLink {
  const candidate = value as Partial<ClipboardPortableLink> | null;
  if (candidate?.kind === 'external') {
    assertLinkOverride(value, label);
    return;
  }
  if (candidate?.kind === 'slide') {
    assertDataObject(value, ['kind', 'sourceSlideId', 'packageTarget'], label);
    if (typeof candidate.sourceSlideId !== 'string' || !candidate.sourceSlideId) {
      throw new Error(`${label}.sourceSlideId 必须是非空页面身份`);
    }
    if (candidate.packageTarget) {
      assertDataObject(candidate.packageTarget, ['rootHash', 'closureHash'], `${label}.packageTarget`);
      if (!/^[0-9a-f]{64}$/.test(candidate.packageTarget.rootHash)
        || !/^[0-9a-f]{64}$/.test(candidate.packageTarget.closureHash)) {
        throw new Error(`${label}.packageTarget 无效`);
      }
    }
    return;
  }
  if (candidate?.kind === 'none' || candidate?.kind === 'unsupported') {
    assertDataObject(value, ['kind'], label);
    return;
  }
  if (candidate?.kind === 'relative') {
    assertDataObject(value, ['kind', 'action'], label);
    if (!['next', 'previous', 'first', 'last'].includes(String(candidate.action))) {
      throw new Error(`${label}.action 无效`);
    }
    return;
  }
  throw new Error(`${label}.kind 无效`);
}

export function assertClipboardTextLinks(value: unknown, label: string): asserts value is ClipboardTextLink[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const positions = new Set<string>();
  value.forEach((entry, index) => {
    assertDataObject(entry, ['paragraph', 'run', 'cell', 'value'], `${label}[${index}]`);
    const link = entry as ClipboardTextLink;
    if (!Number.isInteger(link.paragraph) || link.paragraph < 0
      || !Number.isInteger(link.run) || link.run < 0) throw new Error(`${label}[${index}] 位置无效`);
    if (link.cell) {
      assertDataObject(link.cell, ['r', 'c'], `${label}[${index}].cell`);
      if (!Number.isInteger(link.cell.r) || link.cell.r < 0
        || !Number.isInteger(link.cell.c) || link.cell.c < 0) {
        throw new Error(`${label}[${index}].cell 无效`);
      }
    }
    assertClipboardPortableLink(link.value, `${label}[${index}].value`);
    const key = `${link.cell?.r ?? ''}:${link.cell?.c ?? ''}:${link.paragraph}:${link.run}`;
    if (positions.has(key)) throw new Error(`${label} 包含重复位置`);
    positions.add(key);
  });
}

type AppliedLink = LinkOverride | Extract<ClipboardPortableLink, { kind: 'relative' | 'unsupported' }>;

function mappedLink(doc: EditDoc, value: ClipboardPortableLink): AppliedLink {
  if (value.kind === 'external') return { kind: 'external', href: value.href };
  if (value.kind === 'none') return { kind: 'none' };
  if (value.kind === 'relative') return { kind: 'relative', action: value.action };
  if (value.kind === 'unsupported') return { kind: 'unsupported' };
  if (doc.slides[value.sourceSlideId]) return { kind: 'slide', slideId: value.sourceSlideId };
  const part = value.packageTarget && doc.package
    ? resolvePackageTarget(doc.package, value.packageTarget) : null;
  const slideId = part && doc.slideOrder.find((id) => doc.slides[id].origin?.part === part);
  return { kind: 'slide', slideId: slideId || value.sourceSlideId };
}

function sourceRun(body: TextBody, link: ClipboardTextLink): TextRun {
  const run = body.paragraphs[link.paragraph]?.runs[link.run];
  if (!run) throw new Error(`剪贴板文字链接位置不存在：${link.paragraph}.${link.run}`);
  return run;
}

function prepareBody(
  doc: EditDoc,
  body: TextBody,
  links: readonly ClipboardTextLink[],
): ReturnType<typeof flattenTextBody> | null {
  const direct: Array<{ link: ClipboardTextLink; value: LinkOverride }> = [];
  for (const link of links) {
    const run = sourceRun(body, link);
    const mapped = mappedLink(doc, link.value);
    if (mapped.kind === 'relative') run.link = `slide:${mapped.action}`;
    else if (mapped.kind === 'unsupported') {
      delete run.link;
      if (run.editInfo) run.editInfo = { ...run.editInfo, readonlyLink: true };
    } else {
      delete run.link;
      direct.push({ link, value: mapped });
    }
  }
  if (!direct.length) return null;
  const flat = flattenTextBody(body);
  for (const item of direct) {
    const mark = flat.paragraphs[item.link.paragraph]?.marks[item.link.run];
    if (!mark) throw new Error('剪贴板文字链接格式位置不存在');
    (mark as { runOverrides?: typeof mark.runOverrides }).runOverrides = {
      ...mark.runOverrides, link: item.value,
    };
  }
  return flat;
}

export function applyCopiedLinks(
  doc: EditDoc,
  element: SlideElement,
  meta: ElementClipboardRecordMeta,
): { element: SlideElement; overrides: ElementOverrides; sourceLinkReadonly?: true } {
  const overrides: ElementOverrides = {};
  let sourceLinkReadonly: true | undefined;
  if (meta.link) {
    const mapped = mappedLink(doc, meta.link);
    if (mapped.kind === 'relative') element.link = `slide:${mapped.action}`;
    else if (mapped.kind === 'unsupported') {
      delete element.link;
      sourceLinkReadonly = true;
    } else {
      delete element.link;
      overrides.link = mapped;
    }
  }
  const textLinks = meta.textLinks ?? [];
  if (element.kind === 'shape' && element.text) {
    const flat = prepareBody(doc, element.text, textLinks.filter((link) => !link.cell));
    if (flat) overrides.text = flat;
  } else if (element.kind === 'table') {
    const cells: Record<string, TableCellOverrides> = {};
    const groups = new Map<string, ClipboardTextLink[]>();
    for (const link of textLinks) {
      if (!link.cell) throw new Error('表格文字链接缺少单元格位置');
      const key = `${link.cell.r}:${link.cell.c}`;
      groups.set(key, [...(groups.get(key) ?? []), link]);
    }
    for (const [key, links] of groups) {
      const [r, c] = key.split(':').map(Number);
      const body = element.rows[r]?.cells[c]?.text;
      if (!body) throw new Error(`剪贴板表格文字链接单元格不存在：${key}`);
      const flat = prepareBody(doc, body, links);
      if (flat) cells[key] = { text: flat };
    }
    if (Object.keys(cells).length) overrides.tableCells = cells;
  }
  return { element, overrides, ...(sourceLinkReadonly ? { sourceLinkReadonly } : {}) };
}
