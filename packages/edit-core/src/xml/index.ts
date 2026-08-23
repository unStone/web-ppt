/** 保存期按需加载的无 DOM 保留型 XML 树。 */
export { parseXmlTree, serializeXmlTree, serializeXmlTreeBytes } from './tree';
export { removeXmlAttribute, setXmlAttribute } from './mutate';
export { createXmlElement, createXmlText, removeXmlChild } from './nodes';
export { insertXmlChild, insertXmlInOrder, OOXML_CHILD_ORDER } from './order';
export { findXmlAttribute, findXmlChild, findXmlDescendant, xmlElementChildren } from './query';
export type { CreateXmlElementOptions } from './nodes';
export type { XmlNameSelector } from './query';
export type {
  XmlAttribute, XmlCdata, XmlComment, XmlDeclaration, XmlDocument, XmlElement, XmlNode,
  XmlProcessingInstruction, XmlQuote, XmlText,
} from './types';
