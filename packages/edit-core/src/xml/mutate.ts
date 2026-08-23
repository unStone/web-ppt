import { attributeStates, elementState, markXmlDirty } from './state';
import type { XmlAttributeState } from './state';
import type { XmlAttribute, XmlElement, XmlQuote } from './types';
import { rebindXmlNamespaces } from './namespace';
import { assertXmlQName, namespaceForQName, splitQName } from './qname';

const mutableAttributes = (element: XmlElement): XmlAttribute[] =>
  element.attributes as XmlAttribute[];

const setAttributeValue = (attribute: XmlAttribute, value: string): void => {
  (attribute as { value: string }).value = value;
};

function namespaceFor(element: XmlElement, name: string): string | null {
  return namespaceForQName(name, elementState(element).namespaces, true);
}

function restoredIndex(element: XmlElement, attribute: XmlAttribute): number {
  const state = elementState(element);
  const sourceIndex = state.sourceAttributes.indexOf(attribute);
  if (sourceIndex < 0) return mutableAttributes(element).length;
  const present = mutableAttributes(element);
  for (let index = 0; index < present.length; index++) {
    const candidate = state.sourceAttributes.indexOf(present[index]);
    if (candidate >= 0 && candidate > sourceIndex) return index;
  }
  return present.findIndex((candidate) => !attributeStates.get(candidate)?.source) >= 0
    ? present.findIndex((candidate) => !attributeStates.get(candidate)?.source)
    : present.length;
}

/** 按限定名设置属性；已有属性保持原位置、空白与引号，新属性追加到现有属性之后。 */
export function setXmlAttribute(
  element: XmlElement,
  name: string,
  value: string,
  quote: XmlQuote = '"',
): XmlAttribute {
  assertXmlQName(name, '属性');
  const state = elementState(element);
  let attribute = state.sourceAttributes.find((candidate) => candidate.name === name)
    ?? mutableAttributes(element).find((candidate) => candidate.name === name);
  if (attribute) {
    const attrState = attributeStates.get(attribute)!;
    let changed = false;
    if (!attrState.present) {
      attrState.present = true;
      mutableAttributes(element).splice(restoredIndex(element, attribute), 0, attribute);
      changed = true;
    }
    if (attribute.value !== value) {
      setAttributeValue(attribute, value);
      attrState.changed = true;
      changed = true;
    }
    if (!changed) return attribute;
    if (name === 'xmlns' || name.startsWith('xmlns:')) rebindXmlNamespaces(element);
    markXmlDirty(element);
    return attribute;
  }

  const parts = splitQName(name);
  attribute = {
    name,
    prefix: parts.prefix,
    localName: parts.localName,
    namespaceUri: namespaceFor(element, name),
    value,
    quote,
  };
  const attrState: XmlAttributeState = {
    source: false,
    present: true,
    changed: true,
    start: -1,
    nameStart: -1,
    valueStart: -1,
    valueEnd: -1,
    end: -1,
  };
  attributeStates.set(attribute, attrState);
  mutableAttributes(element).push(attribute);
  if (name === 'xmlns' || name.startsWith('xmlns:')) rebindXmlNamespaces(element);
  markXmlDirty(element);
  return attribute;
}

/** 删除限定名完全相同的属性；不存在时不产生脏标记。 */
export function removeXmlAttribute(element: XmlElement, name: string): boolean {
  const attributes = mutableAttributes(element);
  const index = attributes.findIndex((attribute) => attribute.name === name);
  if (index < 0) return false;
  const [attribute] = attributes.splice(index, 1);
  attributeStates.get(attribute)!.present = false;
  if (name === 'xmlns' || name.startsWith('xmlns:')) rebindXmlNamespaces(element);
  markXmlDirty(element);
  return true;
}

function encodeAttribute(value: string, quote: XmlQuote): string {
  let encoded = value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  encoded = quote === '"' ? encoded.replace(/"/g, '&quot;') : encoded.replace(/'/g, '&apos;');
  return encoded;
}

function insertionPoint(openTag: string): number {
  let point = openTag.length - 1;
  while (point > 0 && /\s/.test(openTag[point - 1])) point--;
  if (openTag[point - 1] === '/') {
    point--;
    while (point > 0 && /\s/.test(openTag[point - 1])) point--;
  }
  return point;
}

/** tree.ts 使用；只重写发生变化的属性值和新增/删除属性。 */
export function serializeElementOpen(element: XmlElement): string {
  const state = elementState(element);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  for (const attribute of state.sourceAttributes) {
    const attrState = attributeStates.get(attribute)!;
    if (!attrState.present) {
      edits.push({ start: attrState.start, end: attrState.end, value: '' });
    } else if (attrState.changed) {
      edits.push({
        start: attrState.valueStart,
        end: attrState.valueEnd,
        value: encodeAttribute(attribute.value, attribute.quote),
      });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let result = state.openRaw;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);

  const inserted = element.attributes.filter((attribute) => !attributeStates.get(attribute)!.source);
  if (inserted.length) {
    const point = insertionPoint(result);
    const markup = inserted.map((attribute) =>
      ` ${attribute.name}=${attribute.quote}${encodeAttribute(attribute.value, attribute.quote)}${attribute.quote}`).join('');
    result = result.slice(0, point) + markup + result.slice(point);
  }
  if (state.sourceSelfClosing && element.children.length) result = result.replace(/\s*\/\s*>$/, '>');
  return result;
}
