import type { ElementRecord } from '../types';
import type { FlatTextParagraph, TextMark } from '../types';
import { flattenTextBody } from '../text-model';
import {
  cloneXmlNode, createXmlElement, createXmlText, insertXmlChildUnchecked, removeXmlChild,
  replaceXmlChildren,
} from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import type { XmlDocument, XmlElement } from '../xml/types';
import { locateElementHost } from './xfrm';
import { namespacedElement } from './xml-element';

export function hasTextOverrides(record: ElementRecord): boolean {
  return record.ovr.text !== undefined;
}

function textUnits(paragraph: XmlElement): XmlElement[] {
  return xmlElementChildren(paragraph).filter((child) =>
    ['r', 'fld', 'br', 'oMath', 'oMathPara', 'AlternateContent'].includes(child.localName));
}

function sourceUnit(
  paragraphs: readonly XmlElement[],
  paragraph: FlatTextParagraph,
  mark: TextMark,
): XmlElement | null {
  const paragraphIndex = mark.source?.paragraph ?? paragraph.sourceParagraph;
  if (paragraphIndex === undefined) return null;
  const sourceParagraph = paragraphs[paragraphIndex];
  return textUnits(sourceParagraph)?.[mark.source?.run ?? 0]
    ?? findXmlChild(sourceParagraph, { localName: 'endParaRPr', namespaceUri: DRAWINGML_NS });
}

function removeRunPropertyChildren(properties: XmlElement, names: readonly string[]): void {
  for (const child of xmlElementChildren(properties)) {
    // clone 尚未挂回宿主时可能还没有继承命名空间；rPr 内这些 localName 本身已唯一。
    if (names.includes(child.localName)) {
      removeXmlChild(properties, child);
    }
  }
}

function setFont(properties: XmlElement, font: string | null): void {
  const names = ['latin', 'ea', 'cs'] as const;
  if (font === null) {
    removeRunPropertyChildren(properties, names);
    return;
  }
  for (const name of names) {
    let child = xmlElementChildren(properties).find((candidate) => candidate.localName === name);
    if (!child) {
      child = namespacedElement(properties, DRAWINGML_NS, name);
      insertXmlInOrder(properties, child);
    }
    setXmlAttribute(child, 'typeface', font);
  }
}

function applyRunOverrides(properties: XmlElement, mark: TextMark): void {
  const overrides = mark.runOverrides;
  if (!overrides) return;
  if (Object.prototype.hasOwnProperty.call(overrides, 'font')) setFont(properties, overrides.font ?? null);
  const attributes = {
    size: ['sz', (value: number) => String(Math.round(value * 75))],
    b: ['b', (value: boolean) => value ? '1' : '0'],
    i: ['i', (value: boolean) => value ? '1' : '0'],
    u: ['u', (value: boolean) => value ? 'sng' : 'none'],
    strike: ['strike', (value: boolean) => value ? 'sngStrike' : 'noStrike'],
  } as const;
  for (const field of Object.keys(attributes) as (keyof typeof attributes)[]) {
    if (!Object.prototype.hasOwnProperty.call(overrides, field)) continue;
    const [name, serialize] = attributes[field];
    const value = overrides[field];
    if (value === null) removeXmlAttribute(properties, name);
    else setXmlAttribute(properties, name, (serialize as (input: never) => string)(value as never));
  }
}

function patchSourceRunProperties(source: XmlElement, mark: TextMark): void {
  let properties = xmlElementChildren(source).find((child) => child.localName === 'rPr');
  if (!properties) {
    properties = namespacedElement(source, DRAWINGML_NS, 'rPr');
    insertXmlChildUnchecked(source, properties, xmlElementChildren(source)[0] ?? null);
  }
  applyRunOverrides(properties, mark);
  if (!hasRunProperties(properties)) removeXmlChild(source, properties);
}

function hasRunProperties(properties: XmlElement): boolean {
  return properties.attributes.some((attribute) => !attribute.name.startsWith('xmlns'))
    || properties.children.some((child) => child.type === 'element'
      || (child.type === 'text' && !!child.value.trim()));
}

function appendCopiedRunProperties(
  run: XmlElement,
  source: XmlElement | null,
  mark: TextMark,
): void {
  const sourceProperties = source?.localName === 'endParaRPr' ? source
    : source && ['r', 'fld', 'br'].includes(source.localName)
      ? findXmlChild(source, { localName: 'rPr', namespaceUri: DRAWINGML_NS })
      : null;
  const properties = namespacedElement(run, DRAWINGML_NS, 'rPr');
  if (sourceProperties) {
    for (const attribute of sourceProperties.attributes) {
      if (!attribute.name.startsWith('xmlns')) setXmlAttribute(properties, attribute.name, attribute.value, attribute.quote);
    }
    for (const child of sourceProperties.children) insertXmlChildUnchecked(properties, cloneXmlNode(child));
  } else {
    setXmlAttribute(properties, 'sz', String(Math.round(mark.props.size * 75)));
    if (mark.props.b) setXmlAttribute(properties, 'b', '1');
    if (mark.props.i) setXmlAttribute(properties, 'i', '1');
    if (mark.props.u) setXmlAttribute(properties, 'u', 'sng');
    if (mark.props.strike) setXmlAttribute(properties, 'strike', 'sngStrike');
    if (mark.props.baseline) setXmlAttribute(properties, 'baseline', String(Math.round(mark.props.baseline * 1000)));
    if (mark.props.spacing) setXmlAttribute(properties, 'spc', String(Math.round(mark.props.spacing * 75)));
    const color = /^#([0-9a-f]{6})$/i.exec(mark.props.color)?.[1];
    if (color) {
      const fill = namespacedElement(properties, DRAWINGML_NS, 'solidFill');
      const srgb = namespacedElement(fill, DRAWINGML_NS, 'srgbClr');
      setXmlAttribute(srgb, 'val', color.toUpperCase());
      insertXmlChildUnchecked(fill, srgb);
      insertXmlChildUnchecked(properties, fill);
    }
    if (mark.props.fonts[0]) {
      const latin = namespacedElement(properties, DRAWINGML_NS, 'latin');
      setXmlAttribute(latin, 'typeface', mark.props.fonts[0]);
      insertXmlChildUnchecked(properties, latin);
    }
  }
  applyRunOverrides(properties, mark);
  if (hasRunProperties(properties)) insertXmlChildUnchecked(run, properties);
}

function appendTextRun(paragraph: XmlElement, source: XmlElement | null, mark: TextMark, text: string): void {
  const run = namespacedElement(paragraph, DRAWINGML_NS, 'r');
  appendCopiedRunProperties(run, source, mark);
  const value = namespacedElement(run, DRAWINGML_NS, 't');
  if (/^\s|\s$/.test(text)) setXmlAttribute(value, 'xml:space', 'preserve');
  insertXmlChildUnchecked(value, createXmlText(text));
  insertXmlChildUnchecked(run, value);
  insertXmlChildUnchecked(paragraph, run);
}

function appendMark(
  paragraph: XmlElement,
  mark: TextMark,
  text: string,
  source: XmlElement | null,
): void {
  if (mark.preserveSource && mark.atomText !== undefined && source
    && ['oMath', 'oMathPara', 'AlternateContent'].includes(source.localName)) {
    insertXmlChildUnchecked(paragraph, cloneXmlNode(source));
    return;
  }
  if (mark.preserveSource && source?.localName === 'fld' && mark.atomText === undefined) {
    const value = findXmlChild(source, { localName: 't', namespaceUri: DRAWINGML_NS });
    const sourceText = value?.children.map((child) => child.type === 'text' ? child.value : '').join('') ?? '';
    // 未修改字段必须继续是动态字段；空 a:t 的日期/页码由解析器给出显示值，也直接保留来源节点。
    if (!sourceText || sourceText === text) {
      const field = cloneXmlNode(source);
      let properties = xmlElementChildren(field).find((child) => child.localName === 'rPr');
      if (!properties && mark.runOverrides) {
        properties = namespacedElement(field, DRAWINGML_NS, 'rPr');
        insertXmlChildUnchecked(field, properties, xmlElementChildren(field)[0] ?? null);
      }
      if (properties) {
        applyRunOverrides(properties, mark);
        if (!hasRunProperties(properties)) removeXmlChild(field, properties);
      }
      insertXmlChildUnchecked(paragraph, field);
      return;
    }
  }
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line) appendTextRun(paragraph, source, mark, line);
    if (index < lines.length - 1) {
      const br = namespacedElement(paragraph, DRAWINGML_NS, 'br');
      appendCopiedRunProperties(br, source, mark);
      insertXmlChildUnchecked(paragraph, br);
    }
  });
}

function appendFlatParagraph(
  body: XmlElement,
  sourceParagraphs: readonly XmlElement[],
  flat: FlatTextParagraph,
): void {
  const paragraph = namespacedElement(body, DRAWINGML_NS, 'p');
  const sourceParagraph = flat.sourceParagraph === undefined ? null : sourceParagraphs[flat.sourceParagraph];
  const pPr = sourceParagraph
    ? findXmlChild(sourceParagraph, { localName: 'pPr', namespaceUri: DRAWINGML_NS })
    : null;
  if (pPr) insertXmlChildUnchecked(paragraph, cloneXmlNode(pPr));
  for (const mark of flat.marks) {
    appendMark(paragraph, mark, flat.text.slice(mark.from, mark.to), sourceUnit(sourceParagraphs, flat, mark));
  }
  const end = sourceParagraph
    ? findXmlChild(sourceParagraph, { localName: 'endParaRPr', namespaceUri: DRAWINGML_NS })
    : null;
  const nextEnd = end ? cloneXmlNode(end) : namespacedElement(paragraph, DRAWINGML_NS, 'endParaRPr');
  if (!flat.text.length && flat.marks[0]) applyRunOverrides(nextEnd, flat.marks[0]);
  insertXmlChildUnchecked(paragraph, nextEnd);
  insertXmlInOrder(body, paragraph);
}

function isFormatOnly(record: ElementRecord, flat: Extract<ElementRecord['ovr']['text'], { kind: 'flat' }>): boolean {
  const source = record.src.kind === 'shape' ? record.src.text ?? record.meta.textTemplate : null;
  if (!source) return false;
  const baseline = flattenTextBody(source);
  return JSON.stringify(flat.body) === JSON.stringify(baseline.body)
    && flat.paragraphs.length === baseline.paragraphs.length
    && flat.paragraphs.every((paragraph, index) => {
      const original = baseline.paragraphs[index];
      return paragraph.text === original.text
        && paragraph.sourceParagraph === index
        && JSON.stringify(paragraph.props) === JSON.stringify(original.props)
        && paragraph.marks.every((mark) => mark.preserveSource && mark.source?.paragraph === index);
    });
}

/** 纯格式操作只替换受影响 run 的原槽位；段落、未知节点与其它 run 保持原树身份。 */
function patchFormatOnly(
  sourceParagraphs: readonly XmlElement[],
  record: ElementRecord,
  flat: Extract<ElementRecord['ovr']['text'], { kind: 'flat' }>,
): boolean {
  if (!isFormatOnly(record, flat) || sourceParagraphs.length !== flat.paragraphs.length) return false;
  flat.paragraphs.forEach((paragraph, paragraphIndex) => {
    const changed = new Set(paragraph.marks
      .filter((mark) => mark.runOverrides)
      .map((mark) => mark.source!.run));
    if (!changed.size) return;
    const sourceParagraph = sourceParagraphs[paragraphIndex];
    const units = textUnits(sourceParagraph);
    if (!paragraph.text.length) {
      const mark = paragraph.marks[0];
      let end = findXmlChild(sourceParagraph, { localName: 'endParaRPr', namespaceUri: DRAWINGML_NS });
      if (!end) {
        end = namespacedElement(sourceParagraph, DRAWINGML_NS, 'endParaRPr');
        insertXmlInOrder(sourceParagraph, end);
      }
      applyRunOverrides(end, mark);
      return;
    }
    for (const runIndex of changed) {
      const source = units[runIndex];
      if (!source) throw new Error(`字符格式来源 run 不存在：${paragraphIndex}.${runIndex}`);
      const fragments = paragraph.marks.filter((mark) => mark.source?.run === runIndex);
      if (fragments.length === 1 && ['r', 'fld', 'br'].includes(source.localName)) {
        patchSourceRunProperties(source, fragments[0]);
        continue;
      }
      const staging = createXmlElement('a:p', {
        selfClosing: false, attributes: [['xmlns:a', DRAWINGML_NS]],
      });
      for (const mark of fragments) {
        appendMark(staging, mark, paragraph.text.slice(mark.from, mark.to), source);
      }
      const replacements = [...xmlElementChildren(staging)];
      for (const replacement of replacements) removeXmlChild(staging, replacement);
      replaceXmlChildren(sourceParagraph, source, replacements);
    }
  });
  return true;
}

/** 只替换段落序列；bodyPr、lstStyle、命名空间与宿主身份全部原样保留。 */
export function patchElementText(document: XmlDocument, record: ElementRecord): void {
  if (!record.ovr.text) return;
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`元素 ${record.id} 不能写回文本`);
  }
  const { host } = locateElementHost(document, record);
  const body = findXmlChild(host, { localName: 'txBody', namespaceUri: PRESENTATIONML_NS });
  if (!body) throw new Error(`文本形状 ${record.id} 缺少 p:txBody`);
  const sourceParagraphs = xmlElementChildren(body, { localName: 'p', namespaceUri: DRAWINGML_NS });
  if (record.ovr.text.kind === 'flat'
    && patchFormatOnly(sourceParagraphs, record, record.ovr.text)) return;
  for (const paragraph of sourceParagraphs) {
    removeXmlChild(body, paragraph);
  }
  if (record.ovr.text.kind === 'flat') {
    for (const paragraph of record.ovr.text.paragraphs) {
      appendFlatParagraph(body, sourceParagraphs, paragraph);
    }
    return;
  }
  const paragraph = namespacedElement(body, DRAWINGML_NS, 'p');
  insertXmlInOrder(body, paragraph);
  const end = namespacedElement(paragraph, DRAWINGML_NS, 'endParaRPr');
  insertXmlChildUnchecked(paragraph, end);
}
