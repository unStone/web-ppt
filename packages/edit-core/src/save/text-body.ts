import type { TextBodyPropertyOverrides } from '../types';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS } from '../xml/qname';
import { xmlElementChildren } from '../xml/query';
import type { XmlElement } from '../xml/types';
import { namespacedElement } from './xml-element';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);
const EMU_PER_PX = 9525;

function setOrRemove<T>(
  element: XmlElement,
  attribute: string,
  value: T | null | undefined,
  serialize: (input: T) => string,
): void {
  if (value === null) removeXmlAttribute(element, attribute);
  else if (value !== undefined) setXmlAttribute(element, attribute, serialize(value));
}

function patchAutoFit(bodyPr: XmlElement, value: TextBodyPropertyOverrides['autoFit']): void {
  for (const child of xmlElementChildren(bodyPr)) {
    if (child.namespaceUri === DRAWINGML_NS
      && ['noAutofit', 'normAutofit', 'spAutoFit'].includes(child.localName)) {
      removeXmlChild(bodyPr, child);
    }
  }
  if (value === null || value === undefined) return;
  const localName = value === 'none' ? 'noAutofit'
    : value === 'normal' ? 'normAutofit' : 'spAutoFit';
  insertXmlInOrder(bodyPr, namespacedElement(bodyPr, DRAWINGML_NS, localName));
}

/** 只改用户触碰的 bodyPr 字段；null 删除本层声明，让 OOXML 继承链重新生效。 */
export function patchTextBodyProperties(
  bodyPr: XmlElement,
  overrides: TextBodyPropertyOverrides | undefined,
): void {
  if (!overrides) return;
  if (own(overrides, 'anchor')) {
    setOrRemove(bodyPr, 'anchor', overrides.anchor, (value: 'top' | 'middle' | 'bottom') =>
      value === 'middle' ? 'ctr' : value === 'bottom' ? 'b' : 't');
  }
  if (own(overrides, 'insets')) {
    const value = overrides.insets;
    for (const [index, name] of ['tIns', 'rIns', 'bIns', 'lIns'].entries()) {
      setOrRemove(bodyPr, name, value === null ? null : value?.[index],
        (part: number) => String(Math.round(part * EMU_PER_PX)));
    }
  }
  if (own(overrides, 'wrap')) {
    setOrRemove(bodyPr, 'wrap', overrides.wrap, (value: boolean) => value ? 'square' : 'none');
  }
  if (own(overrides, 'vert')) setOrRemove(bodyPr, 'vert', overrides.vert, String);
  if (own(overrides, 'anchorCtr')) {
    setOrRemove(bodyPr, 'anchorCtr', overrides.anchorCtr, (value: boolean) => value ? '1' : '0');
  }
  if (own(overrides, 'columns')) setOrRemove(bodyPr, 'numCol', overrides.columns, String);
  if (own(overrides, 'columnGap')) {
    setOrRemove(bodyPr, 'spcCol', overrides.columnGap,
      (value: number) => String(Math.round(value * EMU_PER_PX)));
  }
  if (own(overrides, 'autoFit')) patchAutoFit(bodyPr, overrides.autoFit);
}
