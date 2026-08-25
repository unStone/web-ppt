import { relativeTarget, resolveRelationshipTarget } from '../clipboard-source';
import { own } from '../data-validation';
import type {
  EditDoc, ElementInsertionRelationship, ElementRecord, LinkOverride, LinkTarget, TextOverride,
} from '../types';
import { insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, OFFICE_RELATIONSHIPS_NS, PRESENTATIONML_NS } from '../xml/qname';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { findXmlAttribute, findXmlChild, findXmlDescendant, xmlElementChildren } from '../xml/query';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import type { XmlDocument, XmlElement } from '../xml/types';
import { namespacedElement } from './xml-element';
import { locateElementHost } from './xfrm';

export const HYPERLINK_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
export const SLIDE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

interface ResolvedRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly targetMode?: 'External';
}

function relationshipInfo(element: XmlElement): ResolvedRelationship | null {
  const id = findXmlAttribute(element, { localName: 'Id', namespaceUri: null })?.value;
  const type = findXmlAttribute(element, { localName: 'Type', namespaceUri: null })?.value;
  const target = findXmlAttribute(element, { localName: 'Target', namespaceUri: null })?.value;
  const mode = findXmlAttribute(element, { localName: 'TargetMode', namespaceUri: null })?.value;
  if (!id || !type || !target || (mode !== undefined && mode !== 'External')) return null;
  return { id, type, target, ...(mode === 'External' ? { targetMode: 'External' } : {}) };
}

function sourceRelationships(source?: Uint8Array): ResolvedRelationship[] {
  if (!source) return [];
  return xmlElementChildren(parseXmlTree(source).root, { localName: 'Relationship' })
    .flatMap((element) => relationshipInfo(element) ?? []);
}

function relationKey(sourcePart: string, relationship: ResolvedRelationship): string | null {
  if (relationship.type === HYPERLINK_RELATIONSHIP && relationship.targetMode === 'External') {
    return `external\0${relationship.target}`;
  }
  if (relationship.type !== SLIDE_RELATIONSHIP || relationship.targetMode) return null;
  try {
    return `internal\0${resolveRelationshipTarget(sourcePart, relationship.target)}`;
  } catch { return null; }
}

function targetRelation(doc: EditDoc, sourcePart: string, target: LinkTarget): {
  key: string; type: string; target: string; targetMode?: 'External';
} | null {
  if (target.kind === 'external') {
    return {
      key: `external\0${target.href}`, type: HYPERLINK_RELATIONSHIP,
      target: target.href, targetMode: 'External',
    };
  }
  const targetPart = doc.slides[target.slideId]?.origin?.part;
  return targetPart ? {
    key: `internal\0${targetPart}`, type: SLIDE_RELATIONSHIP,
    target: relativeTarget(sourcePart, targetPart),
  } : null;
}

export interface HyperlinkSaveContext {
  readonly sourcePart: string;
  relationId(target: LinkTarget): string | null;
  retireRelationship(id: string): void;
  retiredRelationshipIds(): ReadonlySet<string>;
  removeDanglingHyperlinks(document: XmlDocument): void;
  generatedRelationships(): readonly ElementInsertionRelationship[];
}

function missingSlideRelationship(
  doc: EditDoc,
  sourcePart: string,
  relationship: ResolvedRelationship,
): boolean {
  if (relationship.type !== SLIDE_RELATIONSHIP || relationship.targetMode) return false;
  let targetPart: string;
  try { targetPart = resolveRelationshipTarget(sourcePart, relationship.target); } catch { return false; }
  return !doc.slideOrder.some((id) => doc.slides[id]?.origin?.part === targetPart);
}

export function hasDanglingSlideRelationships(
  doc: EditDoc,
  sourcePart: string,
  source: Uint8Array | undefined,
): boolean {
  return sourceRelationships(source).some((relationship) =>
    missingSlideRelationship(doc, sourcePart, relationship));
}

export function createHyperlinkSaveContext(
  doc: EditDoc,
  sourcePart: string,
  source: Uint8Array | undefined,
  additions: readonly ElementInsertionRelationship[],
): HyperlinkSaveContext {
  const existing = sourceRelationships(source);
  const dangling = new Set(existing.filter((relationship) =>
    missingSlideRelationship(doc, sourcePart, relationship)).map((relationship) => relationship.id));
  const used = new Set(existing.map((relationship) => relationship.id));
  const byKey = new Map<string, string>();
  for (const relationship of existing) {
    const key = relationKey(sourcePart, relationship);
    if (key && !byKey.has(key)) byKey.set(key, relationship.id);
  }
  for (const relationship of additions) {
    if (used.has(relationship.targetId)) throw new Error(`目标关系 id 冲突：${relationship.targetId}`);
    used.add(relationship.targetId);
    const key = relationKey(sourcePart, {
      id: relationship.targetId, type: relationship.type, target: relationship.target,
      ...(relationship.targetMode ? { targetMode: relationship.targetMode } : {}),
    });
    if (key && !byKey.has(key)) byKey.set(key, relationship.targetId);
  }
  let nextId = Math.max(0, ...[...used].map((id) => /^rId(\d+)$/.exec(id)?.[1] ?? '0').map(Number)) + 1;
  const generated: ElementInsertionRelationship[] = [];
  const retired = new Set<string>();
  return {
    sourcePart,
    relationId(target) {
      const relation = targetRelation(doc, sourcePart, target);
      if (!relation) return null;
      const previous = byKey.get(relation.key);
      if (previous) return previous;
      let id = `rId${nextId++}`;
      while (used.has(id)) id = `rId${nextId++}`;
      used.add(id);
      byKey.set(relation.key, id);
      generated.push({
        sourceId: id, targetId: id, type: relation.type,
        target: relation.target, ...(relation.targetMode ? { targetMode: relation.targetMode } : {}),
      });
      return id;
    },
    retireRelationship(id) { retired.add(id); },
    retiredRelationshipIds: () => retired,
    removeDanglingHyperlinks(document) {
      // 目标页删除使这些关系本身进入本次结构变更闭包；即使源文件原本没有引用也不能继续悬空。
      for (const id of dangling) retired.add(id);
      const visit = (parent: XmlElement): void => {
        for (const child of [...xmlElementChildren(parent)]) {
          const id = findXmlAttribute(child, {
            localName: 'id', namespaceUri: OFFICE_RELATIONSHIPS_NS,
          })?.value;
          if (id && dangling.has(id) && child.namespaceUri === DRAWINGML_NS
            && (child.localName === 'hlinkClick' || child.localName === 'hlinkMouseOver')) {
            removeXmlChild(parent, child);
            retired.add(id);
          } else visit(child);
        }
      };
      visit(document.root);
    },
    generatedRelationships: () => generated,
  };
}

function linkMarks(text: TextOverride | undefined): boolean {
  return text?.kind === 'flat' && text.paragraphs.some((paragraph) =>
    paragraph.marks.some((mark) => own(mark.runOverrides ?? {}, 'link')));
}

export function hasHyperlinkOverrides(record: ElementRecord): boolean {
  return own(record.ovr, 'link') || linkMarks(record.ovr.text)
    || Object.values(record.ovr.tableCells ?? {}).some((cell) => linkMarks(cell.text));
}

function hyperlinkChild(parent: XmlElement): XmlElement | null {
  return findXmlChild(parent, { localName: 'hlinkClick', namespaceUri: DRAWINGML_NS });
}

export function patchHyperlinkNode(
  parent: XmlElement,
  override: LinkOverride,
  context: HyperlinkSaveContext,
): void {
  let node = hyperlinkChild(parent);
  const previousId = node ? findXmlAttribute(node, {
    localName: 'id', namespaceUri: OFFICE_RELATIONSHIPS_NS,
  })?.value : undefined;
  const id = override.kind === 'none' ? null : context.relationId(override);
  if (!id) {
    if (node) removeXmlChild(parent, node);
    if (previousId) context.retireRelationship(previousId);
    return;
  }
  if (!node) {
    node = namespacedElement(parent, DRAWINGML_NS, 'hlinkClick');
    insertXmlInOrder(parent, node);
  }
  setXmlAttribute(node, 'r:id', id);
  if (previousId && previousId !== id) context.retireRelationship(previousId);
  if (override.kind === 'slide') setXmlAttribute(node, 'action', 'ppaction://hlinksldjump');
  else removeXmlAttribute(node, 'action');
}

export function patchElementHyperlink(
  document: XmlDocument,
  record: ElementRecord,
  context: HyperlinkSaveContext,
): void {
  if (!own(record.ovr, 'link')) return;
  const { host } = locateElementHost(document, record);
  const properties = findXmlDescendant(host, {
    localName: 'cNvPr', namespaceUri: PRESENTATIONML_NS,
  });
  if (!properties) throw new Error(`元素 ${record.id} 缺少 p:cNvPr`);
  patchHyperlinkNode(properties, record.ovr.link!, context);
}

function referencedRelationshipIds(document: XmlDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (element: XmlElement): void => {
    for (const attribute of element.attributes) {
      if (attribute.namespaceUri === OFFICE_RELATIONSHIPS_NS && attribute.value) ids.add(attribute.value);
    }
    for (const child of xmlElementChildren(element)) visit(child);
  };
  visit(document.root);
  return ids;
}

function appendRelationship(root: XmlElement, relationship: ElementInsertionRelationship): void {
  insertXmlChildUnchecked(root, namespacedElement(root, root.namespaceUri!, 'Relationship'));
  const children = xmlElementChildren(root);
  const node = children[children.length - 1]!;
  setXmlAttribute(node, 'Id', relationship.targetId);
  setXmlAttribute(node, 'Type', relationship.type);
  setXmlAttribute(node, 'Target', relationship.target);
  if (relationship.targetMode) setXmlAttribute(node, 'TargetMode', relationship.targetMode);
}

export function patchHyperlinkRelationshipPart(
  source: Uint8Array | undefined,
  additions: readonly ElementInsertionRelationship[],
  context: HyperlinkSaveContext,
  slideBytes: Uint8Array,
): Uint8Array {
  const tree = source
    ? parseXmlTree(source)
    : parseXmlTree('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  const existing = new Set(xmlElementChildren(tree.root, { localName: 'Relationship' }).flatMap((node) => {
    const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
    return id ? [id] : [];
  }));
  for (const relationship of [...additions, ...context.generatedRelationships()]) {
    if (existing.has(relationship.targetId)) throw new Error(`目标关系 id 冲突：${relationship.targetId}`);
    existing.add(relationship.targetId);
    appendRelationship(tree.root, relationship);
  }
  const active = referencedRelationshipIds(parseXmlTree(slideBytes));
  const retired = context.retiredRelationshipIds();
  for (const node of xmlElementChildren(tree.root, { localName: 'Relationship' })) {
    const relationship = relationshipInfo(node);
    if (relationship && retired.has(relationship.id) && !active.has(relationship.id)) {
      removeXmlChild(tree.root, node);
    }
  }
  return serializeXmlTreeBytes(tree);
}
