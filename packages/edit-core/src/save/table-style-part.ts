import type { TableStyleDefinition } from '@web-ppt/core';
import { tableStyleDefinitionForElement } from '../table-style';
import type { EditDoc } from '../types';
import { insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { DRAWINGML_NS } from '../xml/qname';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import { relativeTarget } from '../clipboard-source';
import { patchContentTypes, patchRelationshipPart } from './clipboard-parts';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const TABLE_STYLE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml';
const TABLE_STYLE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles';

export interface TableStyleSavePlan {
  readonly part: string;
  readonly definitions: readonly TableStyleDefinition[];
}

export function tableStyleSavePlan(doc: EditDoc): TableStyleSavePlan | null {
  const definitions = new Map<string, TableStyleDefinition>();
  for (const record of Object.values(doc.elements)) {
    const settings = record.ovr.tableStyle;
    if (!settings) continue;
    const definition = tableStyleDefinitionForElement(doc, record.id, settings.styleId);
    if (!definition) throw new Error(`表格 ${record.id} 的样式定义不存在：${settings.styleId}`);
    definitions.set(definition.styleId.toUpperCase(), definition);
  }
  const part = doc.meta.tableStylesPart
    ?? doc.saveState.createdParts.find((candidate) => /(?:^|\/)tableStyles\.xml$/.test(candidate));
  if (!definitions.size && !part) return null;
  return { part: part ?? 'ppt/tableStyles.xml', definitions: [...definitions.values()] };
}

export function patchTableStyleContentType(source: Uint8Array, part: string): Uint8Array {
  return patchContentTypes(source, [{
    targetPart: part,
    hash: 'table-style-part',
    mime: TABLE_STYLE_CONTENT_TYPE,
    extension: 'xml',
    bytes: '',
    created: true,
  }]);
}

export function patchTableStylePresentationRelationships(
  source: Uint8Array,
  part: string,
): Uint8Array {
  const tree = parseXmlTree(source);
  const relationships = xmlElementChildren(tree.root, { localName: 'Relationship' });
  const existing = relationships.find((node) =>
    findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value === TABLE_STYLE_RELATIONSHIP);
  if (existing) return source;
  const used = new Set(relationships.flatMap((node) => {
    const value = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
    return value ? [value] : [];
  }));
  let serial = 1;
  while (used.has(`rId${serial}`)) serial++;
  const id = `rId${serial}`;
  return patchRelationshipPart(source, [{
    sourceId: id,
    targetId: id,
    type: TABLE_STYLE_RELATIONSHIP,
    target: relativeTarget('ppt/presentation.xml', part),
  }]);
}

function styleIds(bytes: Uint8Array): Set<string> {
  const tree = parseXmlTree(bytes);
  if (tree.root.localName !== 'tblStyleLst' || tree.root.namespaceUri !== DRAWINGML_NS) {
    throw new Error('tableStyles.xml 根节点不是 a:tblStyleLst');
  }
  return new Set(xmlElementChildren(tree.root, { localName: 'tblStyle', namespaceUri: DRAWINGML_NS })
    .flatMap((style) => {
      const value = findXmlAttribute(style, { localName: 'styleId', namespaceUri: null })?.value;
      return value ? [value.toUpperCase()] : [];
    }));
}

export function missingTableStyleDefinitions(
  source: Uint8Array | undefined,
  definitions: readonly TableStyleDefinition[],
): TableStyleDefinition[] {
  const existing = source ? styleIds(source) : new Set<string>();
  return definitions.filter((definition) => !existing.has(definition.styleId.toUpperCase()));
}

export function materializeTableStyles(
  source: Uint8Array | undefined,
  definitions: readonly TableStyleDefinition[],
): Uint8Array {
  const missing = missingTableStyleDefinitions(source, definitions);
  if (source && !missing.length) return source;
  const initial = source ?? new TextEncoder().encode(
    `${XML}<a:tblStyleLst xmlns:a="${DRAWINGML_NS}" def="${definitions[0]?.styleId ?? ''}"></a:tblStyleLst>`,
  );
  const tree = parseXmlTree(initial);
  const extension = xmlElementChildren(tree.root, { localName: 'extLst', namespaceUri: DRAWINGML_NS })[0] ?? null;
  for (const definition of missing) {
    const wrapper = parseXmlTree(`<root xmlns:a="${DRAWINGML_NS}">${definition.markup}</root>`);
    const style = xmlElementChildren(wrapper.root, { localName: 'tblStyle', namespaceUri: DRAWINGML_NS })[0];
    if (!style || !removeXmlChild(wrapper.root, style)) {
      throw new Error(`无法物化表样式：${definition.styleId}`);
    }
    insertXmlChildUnchecked(tree.root, style, extension);
  }
  return serializeXmlTreeBytes(tree);
}
