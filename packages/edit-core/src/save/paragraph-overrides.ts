import { DEFAULT_TEXT_LINE_HEIGHT } from '@web-ppt/core';
import type { FlatTextParagraph, ParagraphBullet } from '../types';
import { insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import type { XmlElement } from '../xml/types';
import { appendDrawingColor } from './drawing-color';
import { namespacedElement } from './xml-element';

const own = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);
const ALIGN = { left: 'l', center: 'ctr', right: 'r', justify: 'just' } as const;

function replaceSpacing(
  properties: XmlElement,
  containerName: 'lnSpc' | 'spcBef' | 'spcAft',
  valueName: 'spcPct' | 'spcPts',
  value: number | null,
): void {
  let container = findXmlChild(properties, { localName: containerName, namespaceUri: DRAWINGML_NS });
  if (value === null) {
    if (container) removeXmlChild(properties, container);
    return;
  }
  if (!container) {
    container = namespacedElement(properties, DRAWINGML_NS, containerName);
    insertXmlInOrder(properties, container);
  }
  let spacing: XmlElement | null = null;
  for (const child of xmlElementChildren(container)) {
    if (child.namespaceUri !== DRAWINGML_NS || !['spcPct', 'spcPts'].includes(child.localName)) continue;
    if (child.localName === valueName && !spacing) spacing = child;
    else removeXmlChild(container, child);
  }
  if (!spacing) {
    spacing = namespacedElement(container, DRAWINGML_NS, valueName);
    insertXmlChildUnchecked(container, spacing);
  }
  setXmlAttribute(spacing, 'val', String(Math.round(value)));
}

function removeParagraphChildren(properties: XmlElement, names: ReadonlySet<string>): void {
  for (const child of xmlElementChildren(properties)) {
    if (child.namespaceUri === DRAWINGML_NS && names.has(child.localName)) {
      removeXmlChild(properties, child);
    }
  }
}

function replaceBullet(
  properties: XmlElement,
  bullet: ParagraphBullet | null,
  imageRelationshipId?: string,
): void {
  removeParagraphChildren(properties, new Set(['buNone', 'buAutoNum', 'buChar', 'buBlip']));
  if (bullet === null) {
    removeParagraphChildren(properties, new Set([
      'buClrTx', 'buClr', 'buSzTx', 'buSzPct', 'buSzPts', 'buFontTx', 'buFont',
    ]));
    return;
  }
  if (bullet.kind !== 'none') {
    if (own(bullet, 'color')) {
      removeParagraphChildren(properties, new Set(['buClrTx', 'buClr']));
      const color = namespacedElement(properties, DRAWINGML_NS,
        bullet.color === null ? 'buClrTx' : 'buClr');
      if (bullet.color !== null && bullet.color !== undefined) appendDrawingColor(color, bullet.color);
      insertXmlInOrder(properties, color);
    }
    if (own(bullet, 'font')) {
      removeParagraphChildren(properties, new Set(['buFontTx', 'buFont']));
      const font = namespacedElement(properties, DRAWINGML_NS,
        bullet.font === null ? 'buFontTx' : 'buFont');
      if (bullet.font !== null && bullet.font !== undefined) {
        setXmlAttribute(font, 'typeface', bullet.font);
      }
      insertXmlInOrder(properties, font);
    }
    if (own(bullet, 'size')) {
      removeParagraphChildren(properties, new Set(['buSzTx', 'buSzPct', 'buSzPts']));
      const size = namespacedElement(properties, DRAWINGML_NS,
        bullet.size === null ? 'buSzTx'
          : bullet.size?.kind === 'points' ? 'buSzPts' : 'buSzPct');
      if (bullet.size !== null && bullet.size !== undefined) {
        setXmlAttribute(size, 'val', String(Math.round(bullet.size.value
          * (bullet.size.kind === 'points' ? 100 : 100000))));
      }
      insertXmlInOrder(properties, size);
    }
  }
  const node = namespacedElement(properties, DRAWINGML_NS,
    bullet.kind === 'none' ? 'buNone'
      : bullet.kind === 'char' ? 'buChar'
        : bullet.kind === 'autoNum' ? 'buAutoNum' : 'buBlip');
  if (bullet.kind === 'char') setXmlAttribute(node, 'char', bullet.char);
  if (bullet.kind === 'autoNum') {
    setXmlAttribute(node, 'type', bullet.type);
    if (bullet.startAt !== undefined) setXmlAttribute(node, 'startAt', String(bullet.startAt));
  }
  insertXmlInOrder(properties, node);
  if (bullet.kind === 'blip') {
    if (!imageRelationshipId) throw new Error('图片项目符号缺少保存关系');
    const image = namespacedElement(node, DRAWINGML_NS, 'blip');
    setXmlAttribute(image, 'r:embed', imageRelationshipId);
    insertXmlChildUnchecked(node, image);
  }
}

export function applyParagraphOverrides(
  properties: XmlElement,
  paragraph: FlatTextParagraph,
  lnSpcReduction: number,
): void {
  const overrides = paragraph.paragraphOverrides;
  if (!overrides) return;
  if (own(overrides, 'bullet')) {
    if (overrides.bullet === undefined) throw new Error('段落项目符号覆盖无效');
    replaceBullet(
      properties, overrides.bullet,
      paragraph.bulletImageOverride?.relationships[0]?.targetId,
    );
  }
  if (own(overrides, 'level')) {
    const value = overrides.level;
    if (value === undefined) throw new Error('段落级别覆盖无效');
    if (value === null) removeXmlAttribute(properties, 'lvl');
    else setXmlAttribute(properties, 'lvl', String(value));
  }
  if (own(overrides, 'align')) {
    const value = overrides.align;
    if (value === undefined) throw new Error('段落对齐覆盖无效');
    if (value === null) removeXmlAttribute(properties, 'algn');
    else setXmlAttribute(properties, 'algn', ALIGN[value]);
  }
  for (const [field, attribute] of [['marginLeft', 'marL'], ['indent', 'indent']] as const) {
    if (!own(overrides, field)) continue;
    const value = overrides[field];
    if (value === undefined) throw new Error(`段落格式 ${field} 覆盖无效`);
    if (value === null) removeXmlAttribute(properties, attribute);
    else setXmlAttribute(properties, attribute, String(Math.round(value * 9525)));
  }
  if (own(overrides, 'lineHeight')) {
    const value = overrides.lineHeight;
    if (value === undefined) throw new Error('段落行高覆盖无效');
    const percentage = value === null ? null
      : (value + lnSpcReduction) / DEFAULT_TEXT_LINE_HEIGHT * 100000;
    replaceSpacing(properties, 'lnSpc', 'spcPct', percentage);
  }
  for (const [field, container] of [
    ['spaceBefore', 'spcBef'], ['spaceAfter', 'spcAft'],
  ] as const) {
    if (!own(overrides, field)) continue;
    const value = overrides[field];
    if (value === undefined) throw new Error(`段落格式 ${field} 覆盖无效`);
    replaceSpacing(properties, container, 'spcPts', value === null ? null : value * 75);
  }
}
