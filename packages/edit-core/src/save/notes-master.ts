import { relativeTarget, resolveRelationshipTarget } from '../clipboard-source';
import { own } from '../data-validation';
import type { EditDoc, SlideRecord } from '../types';
import { createXmlElement, insertXmlChildUnchecked } from '../xml/nodes';
import { setXmlAttribute } from '../xml/mutate';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from '../xml/query';
import { DRAWINGML_NS, OFFICE_RELATIONSHIPS_NS, PRESENTATIONML_NS } from '../xml/qname';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import type { XmlElement } from '../xml/types';
import { patchRelationshipPart, relationshipPartFor } from './clipboard-parts';
import { namespacedElement } from './xml-element';

const PRESENTATION = 'ppt/presentation.xml';
const PRESENTATION_RELS = relationshipPartFor(PRESENTATION);
const TYPES = '[Content_Types].xml';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MASTER_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml';
const MASTER_REL = `${OFFICE_RELATIONSHIPS_NS}/notesMaster`;
const SLIDE_REL = `${OFFICE_RELATIONSHIPS_NS}/slide`;
const MASTER_PART = /^ppt\/notesMasters\/[^/]+\.xml$/;
const COLOR_MAP = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
};

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}
export interface NotesMasterSavePlan {
  readonly part: string;
  readonly created: boolean;
  readonly linkPresentation: boolean;
  readonly theme?: string;
  readonly slides: readonly SlideRecord[];
}
const attr = (node: XmlElement, name: string) => findXmlAttribute(node, { localName: name, namespaceUri: null })?.value;

function relations(bytes: Uint8Array | undefined): Relationship[] {
  if (!bytes) return [];
  const root = parseXmlTree(bytes).root;
  if (root.namespaceUri !== PACKAGE_REL_NS || root.localName !== 'Relationships') throw new Error('备注保存关系部件的根命名空间无效');
  return xmlElementChildren(root, { localName: 'Relationship', namespaceUri: PACKAGE_REL_NS }).flatMap((node) => {
    const id = attr(node, 'Id'),
      type = attr(node, 'Type'),
      target = attr(node, 'Target');
    return id && type && target ? [{ id, type, target, external: attr(node, 'TargetMode') === 'External' }] : [];
  });
}

function masterTarget(bytes: Uint8Array | undefined, host: string): string | undefined {
  const matches = relations(bytes).filter((relation) => relation.type.endsWith('/notesMaster'));
  if (matches.length > 1 || matches.some((relation) => relation.external)) throw new Error(`备注母版关系不唯一或指向外部：${host}`);
  return matches[0] ? resolveRelationshipTarget(host, matches[0].target) : undefined;
}

function capture(doc: EditDoc, baselines: Record<string, Uint8Array>, created: Set<string>, part: string): void {
  if (baselines[part] || created.has(part)) return;
  const bytes = doc.package?.parts[part];
  if (bytes) baselines[part] = bytes.slice();
  else created.add(part);
}

function source(doc: EditDoc, baselines: Readonly<Record<string, Uint8Array>>, part: string): Uint8Array | undefined {
  return baselines[part] ?? doc.package?.parts[part];
}

/** 基线必须先于保存主干的 presentation/ContentTypes 物化捕获，撤销后才能恢复原目录。 */
export function prepareNotesMasterSave(
  doc: EditDoc,
  baselines: Record<string, Uint8Array>,
  created: Set<string>,
): NotesMasterSavePlan | undefined {
  const active = doc.slideOrder.map((id) => doc.slides[id]).filter((slide) => !!slide.notes);
  const slides = active.filter((slide) => own(slide.ovr, 'notes') || created.has(slide.notes!.targetPart));
  const owned = [...created].filter((part) => MASTER_PART.test(part));
  // 旧文稿的未编辑 notes 不在本次交付范围；撤销后只移除本会话生成的闭包。
  if (!slides.length) return owned.length ? { part: owned[0], created: true, linkPresentation: true, slides: [] } : undefined;
  const presentationRels = source(doc, baselines, PRESENTATION_RELS);
  const declared = masterTarget(presentationRels, PRESENTATION);
  const implicit = new Set(
    active.flatMap((slide) => {
      const host = slide.notes!.sourcePart ?? slide.notes!.targetPart;
      const target = masterTarget(source(doc, baselines, relationshipPartFor(host)), host);
      return target ? [target] : [];
    }),
  );
  if (implicit.size > 1 || (declared && [...implicit].some((part) => part !== declared))) {
    throw new Error('活动备注页引用了不同的备注母版，不能在保存时覆盖既有设计');
  }
  const types = source(doc, baselines, TYPES);
  const listed = types
    ? xmlElementChildren(parseXmlTree(types).root, { localName: 'Override', namespaceUri: CONTENT_TYPES_NS })
        .filter((node) => attr(node, 'ContentType') === MASTER_TYPE)
        .flatMap((node) => attr(node, 'PartName')?.replace(/^\//, '') ?? [])
    : [];
  let part = declared ?? [...implicit][0] ?? owned[0];
  if (!part && listed.length === 1) part = listed[0];
  if (!part && listed.length > 1) throw new Error('存在多个未绑定的备注母版，不能猜测应复用的设计');
  const generated = !part || owned.includes(part);
  if (!part) {
    let serial = 1;
    do {
      part = `ppt/notesMasters/notesMaster${serial++}.xml`;
    } while (doc.package?.parts[part] || created.has(part) || listed.includes(part));
  }
  if (!generated && !source(doc, baselines, part)) throw new Error(`备注母版关系目标不存在：${part}`);
  if (!generated) {
    const root = parseXmlTree(source(doc, baselines, part)!).root;
    if (root.localName !== 'notesMaster' || root.namespaceUri !== PRESENTATIONML_NS)
      throw new Error(`备注母版目标不是标准 notesMaster：${part}`);
  }
  const presentation = source(doc, baselines, PRESENTATION);
  if (!presentation) throw new Error('备注保存缺少 ppt/presentation.xml');
  const root = parseXmlTree(presentation).root;
  const list = findXmlChild(root, { localName: 'notesMasterIdLst', namespaceUri: root.namespaceUri });
  const entries = list ? xmlElementChildren(list, { localName: 'notesMasterId', namespaceUri: root.namespaceUri }) : [];
  const targets = relations(presentationRels);
  if (
    entries.length > 1
    || entries.some((entry) => {
      const id = entry.attributes.find(
        (attribute) => attribute.localName === 'id' && attribute.namespaceUri?.endsWith('/relationships'),
      )?.value;
      const relation = targets.find((candidate) => candidate.id === id);
      return (
        !relation
        || !relation.type.endsWith('/notesMaster')
        || relation.external
        || resolveRelationshipTarget(PRESENTATION, relation.target) !== part
      );
    })
  )
    throw new Error('presentation 的备注母版目录与关系目标不一致');
  const linkPresentation = generated || !declared || !entries.length || !listed.includes(part);
  if (linkPresentation) for (const item of [PRESENTATION, PRESENTATION_RELS, TYPES]) capture(doc, baselines, created, item);
  for (const slide of slides) {
    const notePart = slide.notes!.targetPart,
      relsPart = relationshipPartFor(notePart);
    const bytes = source(doc, baselines, relsPart);
    if (masterTarget(bytes, notePart) !== part || !relations(bytes).some((relation) => relation.type === SLIDE_REL && !relation.external))
      capture(doc, baselines, created, relsPart);
  }
  let theme: string | undefined;
  if (generated) {
    created.add(part);
    created.add(relationshipPartFor(part));
    const layout = slides[0].layoutId ? doc.layouts[slides[0].layoutId] : undefined;
    theme = layout?.themeId ?? doc.themeOrder[0];
    if (!theme || !source(doc, baselines, theme)) throw new Error('新增备注母版缺少可读的主题来源');
  }
  return { part, created: generated, linkPresentation, theme, slides };
}

function emptyNotesMaster(): Uint8Array {
  const tree = parseXmlTree(
    `<p:notesMaster xmlns:p="${PRESENTATIONML_NS}" xmlns:a="${DRAWINGML_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}"/>`,
  );
  const add = (parent: XmlElement, name: string, attributes: Readonly<Record<string, string>> = {}) => {
    const node = createXmlElement(name, { attributes: Object.entries(attributes) });
    insertXmlChildUnchecked(parent, node);
    return node;
  };
  const shapes = add(add(tree.root, 'p:cSld'), 'p:spTree');
  const nonVisual = add(shapes, 'p:nvGrpSpPr');
  add(nonVisual, 'p:cNvPr', { id: '1', name: '' });
  add(nonVisual, 'p:cNvGrpSpPr');
  add(nonVisual, 'p:nvPr');
  const xfrm = add(add(shapes, 'p:grpSpPr'), 'a:xfrm');
  add(xfrm, 'a:off', { x: '0', y: '0' });
  add(xfrm, 'a:ext', { cx: '0', cy: '0' });
  add(xfrm, 'a:chOff', { x: '0', y: '0' });
  add(xfrm, 'a:chExt', { cx: '0', cy: '0' });
  add(tree.root, 'p:clrMap', COLOR_MAP);
  add(tree.root, 'p:hf');
  add(tree.root, 'p:notesStyle');
  return serializeXmlTreeBytes(tree);
}

function withRelation(
  bytes: Uint8Array | undefined,
  host: string,
  type: string,
  targetPart: string,
  stem: string,
): { bytes: Uint8Array; id: string } {
  const entries = relations(bytes);
  const existing = entries.find(
    (entry) => entry.type === type && !entry.external && resolveRelationshipTarget(host, entry.target) === targetPart,
  );
  if (existing) return { bytes: bytes!, id: existing.id };
  const used = new Set(entries.map((entry) => entry.id));
  let id = stem,
    serial = 1;
  while (used.has(id)) id = `${stem}${serial++}`;
  return { id, bytes: patchRelationshipPart(bytes, [{ sourceId: id, targetId: id, type, target: relativeTarget(host, targetPart) }]) };
}

function contentType(bytes: Uint8Array, part: string): Uint8Array {
  const tree = parseXmlTree(bytes);
  if (tree.root.namespaceUri !== CONTENT_TYPES_NS || tree.root.localName !== 'Types') throw new Error('备注保存缺少有效内容类型目录');
  const existing = xmlElementChildren(tree.root, { localName: 'Override', namespaceUri: CONTENT_TYPES_NS }).find(
    (node) => attr(node, 'PartName') === `/${part}`,
  );
  if (existing) {
    if (attr(existing, 'ContentType') !== MASTER_TYPE) throw new Error(`备注母版 Content-Type 冲突：${part}`);
    return bytes;
  }
  insertXmlChildUnchecked(
    tree.root,
    createXmlElement('Override', {
      attributes: [
        ['PartName', `/${part}`],
        ['ContentType', MASTER_TYPE],
      ],
    }),
  );
  return serializeXmlTreeBytes(tree);
}

/** NotesSlide 的隐式关系与 Presentation 的显式目录必须同时形成完整闭包。 */
export function materializeNotesMaster(
  doc: EditDoc,
  plan: NotesMasterSavePlan | undefined,
  baselines: Readonly<Record<string, Uint8Array>>,
  changes: Record<string, Uint8Array | null>,
): void {
  if (!plan?.slides.length) return;
  const bytes = (part: string) => (changes[part] instanceof Uint8Array ? (changes[part] as Uint8Array) : source(doc, baselines, part));
  if (plan.created) {
    changes[plan.part] = emptyNotesMaster();
    changes[relationshipPartFor(plan.part)] = withRelation(
      undefined,
      plan.part,
      `${OFFICE_RELATIONSHIPS_NS}/theme`,
      plan.theme!,
      'rIdTheme',
    ).bytes;
  }
  if (plan.linkPresentation) {
    const relation = withRelation(bytes(PRESENTATION_RELS), PRESENTATION, MASTER_REL, plan.part, 'rIdNotesMaster');
    changes[PRESENTATION_RELS] = relation.bytes;
    const tree = parseXmlTree(bytes(PRESENTATION)!);
    let list = findXmlChild(tree.root, { localName: 'notesMasterIdLst', namespaceUri: tree.root.namespaceUri });
    if (!list) {
      list = namespacedElement(tree.root, tree.root.namespaceUri!, 'notesMasterIdLst');
      const before = xmlElementChildren(tree.root).find(
        (node) => node.namespaceUri === tree.root.namespaceUri && node.localName !== 'sldMasterIdLst',
      );
      insertXmlChildUnchecked(tree.root, list, before ?? null);
    }
    if (!xmlElementChildren(list, { localName: 'notesMasterId', namespaceUri: tree.root.namespaceUri }).length) {
      const entry = namespacedElement(list, tree.root.namespaceUri!, 'notesMasterId');
      setXmlAttribute(entry, 'xmlns:r', OFFICE_RELATIONSHIPS_NS);
      setXmlAttribute(entry, 'r:id', relation.id);
      insertXmlChildUnchecked(list, entry);
    }
    changes[PRESENTATION] = serializeXmlTreeBytes(tree);
    changes[TYPES] = contentType(bytes(TYPES)!, plan.part);
  }
  for (const slide of plan.slides) {
    const notePart = slide.notes!.targetPart,
      relsPart = relationshipPartFor(notePart);
    const current = bytes(relsPart);
    const target = masterTarget(current, notePart);
    if (target && target !== plan.part) throw new Error(`备注页 ${notePart} 的母版与 presentation 不一致`);
    let relationships = withRelation(current, notePart, MASTER_REL, plan.part, 'rIdNotesMaster').bytes;
    if (!relations(relationships).some((relation) => relation.type === SLIDE_REL && !relation.external)) {
      if (!slide.origin) throw new Error(`备注页 ${notePart} 缺少对应页面锚点`);
      relationships = withRelation(relationships, notePart, SLIDE_REL, slide.origin.part, 'rIdNotesSlide').bytes;
    }
    changes[relsPart] = relationships;
  }
}
