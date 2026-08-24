import type { ElementRecord } from '../types';
import type { FlatTextParagraph, TextMark } from '../types';
import { createXmlElement, createXmlText, insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlDocument, XmlElement } from '../xml/types';
import { locateElementHost } from './xfrm';
import { namespacedElement } from './xml-element';

export function hasTextOverrides(record: ElementRecord): boolean {
  return record.ovr.text !== undefined;
}

function cloneElement(source: XmlElement): XmlElement {
  const clone = createXmlElement(source.name, {
    selfClosing: source.selfClosing,
    attributes: source.attributes.map((attribute) => [attribute.name, attribute.value, attribute.quote]),
  });
  for (const child of source.children) {
    if (child.type === 'element') insertXmlChildUnchecked(clone, cloneElement(child));
    else if (child.type === 'text') insertXmlChildUnchecked(clone, createXmlText(child.value));
  }
  return clone;
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
    for (const child of sourceProperties.children) {
      if (child.type === 'element') insertXmlChildUnchecked(properties, cloneElement(child));
      else if (child.type === 'text') insertXmlChildUnchecked(properties, createXmlText(child.value));
    }
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
  insertXmlChildUnchecked(run, properties);
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
    insertXmlChildUnchecked(paragraph, cloneElement(source));
    return;
  }
  if (mark.preserveSource && source?.localName === 'fld' && mark.atomText === undefined) {
    const value = findXmlChild(source, { localName: 't', namespaceUri: DRAWINGML_NS });
    const sourceText = value?.children.map((child) => child.type === 'text' ? child.value : '').join('') ?? '';
    // 未修改字段必须继续是动态字段；空 a:t 的日期/页码由解析器给出显示值，也直接保留来源节点。
    if (!sourceText || sourceText === text) {
      insertXmlChildUnchecked(paragraph, cloneElement(source));
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
  if (pPr) insertXmlChildUnchecked(paragraph, cloneElement(pPr));
  for (const mark of flat.marks) {
    appendMark(paragraph, mark, flat.text.slice(mark.from, mark.to), sourceUnit(sourceParagraphs, flat, mark));
  }
  const end = sourceParagraph
    ? findXmlChild(sourceParagraph, { localName: 'endParaRPr', namespaceUri: DRAWINGML_NS })
    : null;
  insertXmlChildUnchecked(paragraph, end ? cloneElement(end) : namespacedElement(paragraph, DRAWINGML_NS, 'endParaRPr'));
  insertXmlInOrder(body, paragraph);
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
