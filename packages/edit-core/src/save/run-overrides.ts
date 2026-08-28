import { TEXT_RUN_DIRECT_BITS } from '@web-ppt/core';
import type { TextBody } from '@web-ppt/core';
import type { FlatTextParagraph, RunProperties, TextMark } from '../types';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS } from '../xml/qname';
import { removeXmlChild } from '../xml/nodes';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { xmlElementChildren } from '../xml/query';
import type { XmlElement } from '../xml/types';
import { appendDrawingColor } from './drawing-color';
import { patchHyperlinkNode } from './hyperlink';
import type { HyperlinkSaveContext } from './hyperlink';
import { namespacedElement } from './xml-element';

const own = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

function removePropertyChildren(properties: XmlElement, names: readonly string[]): void {
  for (const child of xmlElementChildren(properties)) {
    // clone 尚未挂回宿主时可能还没有继承命名空间；rPr 内这些 localName 本身已唯一。
    if (names.includes(child.localName)) removeXmlChild(properties, child);
  }
}

function setFont(properties: XmlElement, font: string | null): void {
  const names = ['latin', 'ea', 'cs'] as const;
  if (font === null) return void removePropertyChildren(properties, names);
  for (const name of names) {
    let child = xmlElementChildren(properties).find((candidate) => candidate.localName === name);
    if (!child) {
      child = namespacedElement(properties, DRAWINGML_NS, name);
      insertXmlInOrder(properties, child);
    }
    setXmlAttribute(child, 'typeface', font);
  }
}

function setColor(properties: XmlElement, color: string | null): void {
  removePropertyChildren(properties, ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);
  if (color === null) return;
  const fill = namespacedElement(properties, DRAWINGML_NS, 'solidFill');
  appendDrawingColor(fill, color);
  insertXmlInOrder(properties, fill);
}

export function applyRunOverrides(
  properties: XmlElement,
  mark: TextMark,
  links?: HyperlinkSaveContext,
  clearedFallback?: Partial<RunProperties>,
): void {
  const overrides = mark.runOverrides;
  if (!overrides) return;
  if (own(overrides, 'font')) {
    const value = overrides.font === null && own(clearedFallback ?? {}, 'font')
      ? clearedFallback!.font ?? null : overrides.font ?? null;
    setFont(properties, value);
  }
  if (own(overrides, 'color')) {
    const value = overrides.color === null && own(clearedFallback ?? {}, 'color')
      ? clearedFallback!.color ?? null : overrides.color ?? null;
    setColor(properties, value);
  }
  const attributes = {
    size: ['sz', (value: number) => String(Math.round(value * 75))],
    b: ['b', (value: boolean) => value ? '1' : '0'],
    i: ['i', (value: boolean) => value ? '1' : '0'],
    u: ['u', (value: boolean) => value ? 'sng' : 'none'],
    strike: ['strike', (value: boolean) => value ? 'sngStrike' : 'noStrike'],
  } as const;
  for (const field of Object.keys(attributes) as (keyof typeof attributes)[]) {
    if (!own(overrides, field)) continue;
    const [name, serialize] = attributes[field];
    const value = overrides[field] === null && own(clearedFallback ?? {}, field)
      ? clearedFallback![field] : overrides[field];
    if (value === null) removeXmlAttribute(properties, name);
    else setXmlAttribute(properties, name, (serialize as (input: never) => string)(value as never));
  }
  if (links && own(overrides, 'link') && overrides.link !== null) {
    patchHyperlinkNode(properties, overrides.link!, links);
  }
}

/**
 * OOXML 无法在 run 上表达“跳过 pPr/defRPr、继续继承 lvlNpPr”。改级前若用户清掉了
 * 段落级字符直设，保存时只能把新级继承结果落到 run，才能让 Office 重开与即时投影一致。
 */
export function clearedLevelRunFallback(
  source: TextBody,
  paragraph: FlatTextParagraph,
  mark: TextMark,
): Partial<RunProperties> | undefined {
  if (!own(paragraph.paragraphOverrides ?? {}, 'level') || !mark.runOverrides) return undefined;
  const sourceIndex = mark.source?.paragraph ?? paragraph.sourceParagraph;
  const direct = sourceIndex === undefined ? 0 : source.paragraphs[sourceIndex]?.editInfo?.directRun ?? 0;
  const inherited = mark.inheritedProps;
  if (!direct || !inherited) return undefined;
  let fallback: Partial<RunProperties> = {};
  for (const field of ['size', 'color', 'b', 'i', 'u', 'strike'] as const) {
    if (mark.runOverrides[field] === null && direct & TEXT_RUN_DIRECT_BITS[field]) {
      fallback = { ...fallback, [field]: inherited[field] };
    }
  }
  const fontBits = TEXT_RUN_DIRECT_BITS.fonts | TEXT_RUN_DIRECT_BITS.fontLatin
    | TEXT_RUN_DIRECT_BITS.fontEastAsian | TEXT_RUN_DIRECT_BITS.fontComplexScript;
  if (mark.runOverrides.font === null && direct & fontBits) {
    fallback = { ...fallback, font: mark.inheritedFonts?.[0] ?? inherited.font };
  }
  return Object.keys(fallback).length ? fallback : undefined;
}
