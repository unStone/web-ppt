import { relativeTarget, resolveRelationshipTarget } from '../clipboard-source';
import { own } from '../data-validation';
import { isNotesPart } from '../notes-part';
import type { EditDoc, SlideRecord } from '../types';
import { cloneXmlNode, createXmlElement, createXmlText, insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import { findXmlChild, findXmlDescendant, xmlElementChildren } from '../xml/query';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import type { XmlElement } from '../xml/types';
import { patchRelationshipPart, relationshipPartFor } from './clipboard-parts';

const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

function notesTextBody(root: XmlElement): XmlElement {
  const shapeTree = findXmlDescendant(root, {
    localName: 'spTree', namespaceUri: PRESENTATIONML_NS,
  });
  for (const shape of shapeTree ? xmlElementChildren(shapeTree, {
    localName: 'sp', namespaceUri: PRESENTATIONML_NS,
  }) : []) {
    const nonVisual = findXmlChild(shape, {
      localName: 'nvSpPr', namespaceUri: PRESENTATIONML_NS,
    });
    const properties = nonVisual && findXmlChild(nonVisual, {
      localName: 'nvPr', namespaceUri: PRESENTATIONML_NS,
    });
    const placeholder = properties && findXmlChild(properties, {
      localName: 'ph', namespaceUri: PRESENTATIONML_NS,
    });
    const type = placeholder?.attributes.find((attribute) =>
      attribute.namespaceUri === null && attribute.localName === 'type')?.value;
    const body = findXmlChild(shape, {
      localName: 'txBody', namespaceUri: PRESENTATIONML_NS,
    });
    if (type === 'body' && body) return body;
  }
  throw new Error('notesSlide 缺少可编辑的 body 占位符');
}

function setElementText(element: XmlElement, value: string): void {
  for (const child of [...element.children]) removeXmlChild(element, child);
  insertXmlChildUnchecked(element, createXmlText(value));
}

function paragraphFromTemplate(template: XmlElement | null, value: string): XmlElement {
  const paragraph = template
    ? cloneXmlNode(template)
    : createXmlElement('a:p', { selfClosing: false });
  // 克隆节点脱离原树时尚未重新绑定命名空间，只能先按 localName 定位。
  let text = findXmlDescendant(paragraph, { localName: 't' });
  if (!text) {
    const prefix = paragraph.prefix ? `${paragraph.prefix}:` : '';
    const run = createXmlElement(`${prefix}r`, { selfClosing: false });
    const endProperties = xmlElementChildren(paragraph)
      .find((child) => child.localName === 'endParaRPr');
    if (endProperties) {
      const properties = createXmlElement(`${prefix}rPr`);
      for (const attribute of endProperties.attributes) {
        setXmlAttribute(properties, attribute.name, attribute.value, attribute.quote);
      }
      for (const child of endProperties.children) {
        insertXmlChildUnchecked(properties, cloneXmlNode(child));
      }
      insertXmlChildUnchecked(run, properties);
    }
    text = createXmlElement(`${prefix}t`, { selfClosing: false });
    insertXmlChildUnchecked(run, text);
    // endParaRPr 在 CT_TextParagraph 中必须收尾；放到它后面会触发 Office 修复。
    insertXmlChildUnchecked(paragraph, run, endProperties ?? null);
  }
  setElementText(text, value);
  let found = false;
  const clearOtherText = (parent: XmlElement): void => {
    for (const child of xmlElementChildren(parent)) {
      if (child.localName === 't') {
        if (!found) found = true;
        else setElementText(child, '');
      } else clearOtherText(child);
    }
  };
  clearOtherText(paragraph);
  return paragraph;
}

/** 只替换 body 占位符段落；其它形状、关系、扩展和文本格式保持原树。 */
export function patchNotesText(source: Uint8Array, value: string): Uint8Array {
  const tree = parseXmlTree(source);
  const body = notesTextBody(tree.root);
  const paragraphs = xmlElementChildren(body, {
    localName: 'p', namespaceUri: DRAWINGML_NS,
  });
  for (const paragraph of paragraphs) removeXmlChild(body, paragraph);
  for (const [index, line] of value.split('\n').entries()) {
    const template = paragraphs[index] ?? paragraphs[paragraphs.length - 1] ?? null;
    insertXmlChildUnchecked(body, paragraphFromTemplate(template, line));
  }
  return serializeXmlTreeBytes(tree);
}

function emptyNotesXml(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="备注正文"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t></a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:notes>`);
}

const attribute = (element: XmlElement, localName: string): string | undefined =>
  element.attributes.find((candidate) =>
    candidate.localName === localName && candidate.namespaceUri === null)?.value;

function patchRelationshipTarget(
  source: Uint8Array,
  type: string,
  target: string,
): { bytes: Uint8Array; found: boolean } {
  const tree = parseXmlTree(source);
  let found = false;
  for (const relation of xmlElementChildren(tree.root, { localName: 'Relationship' })) {
    if (attribute(relation, 'Type') !== type || attribute(relation, 'TargetMode') === 'External') continue;
    setXmlAttribute(relation, 'Target', target);
    removeXmlAttribute(relation, 'TargetMode');
    found = true;
  }
  return { bytes: found ? serializeXmlTreeBytes(tree) : source, found };
}

function availableRelationshipId(source?: Uint8Array): string {
  const ids = new Set(source ? xmlElementChildren(
    parseXmlTree(source).root, { localName: 'Relationship' },
  ).flatMap((relation) => attribute(relation, 'Id') ?? []) : []);
  for (let serial = 1; Number.isSafeInteger(serial); serial++) {
    const id = `rId${serial}`;
    if (!ids.has(id)) return id;
  }
  throw new Error('备注页的页面回指关系身份已耗尽');
}

function patchNotesBackReference(
  source: Uint8Array | undefined,
  notesPart: string,
  slidePart: string,
): Uint8Array {
  const target = relativeTarget(notesPart, slidePart);
  if (source) {
    const patched = patchRelationshipTarget(source, SLIDE_REL, target);
    if (patched.found) return patched.bytes;
  }
  const id = availableRelationshipId(source);
  return patchRelationshipPart(source, [{
    sourceId: id, targetId: id, type: SLIDE_REL, target,
  }]);
}

/** 备注关系属于页面元数据；只重定向指定 rId，不能重建整个关系 part。 */
export function patchSlideNotesRelationship(slide: SlideRecord, source?: Uint8Array): Uint8Array {
  if (!slide.origin) throw new Error(`页面 ${slide.id} 缺少 notes 关系宿主`);
  if (!source) {
    if (!slide.notes) return patchRelationshipPart(undefined, []);
    return patchRelationshipPart(undefined, [{
      sourceId: slide.notes.relationshipId,
      targetId: slide.notes.relationshipId,
      type: NOTES_REL,
      target: relativeTarget(slide.origin.part, slide.notes.targetPart),
    }]);
  }
  const tree = parseXmlTree(source);
  const relations = xmlElementChildren(tree.root, { localName: 'Relationship' });
  if (!slide.notes) {
    let changed = false;
    for (const relation of relations) {
      if (attribute(relation, 'Type') === NOTES_REL && attribute(relation, 'TargetMode') !== 'External') {
        removeXmlChild(tree.root, relation);
        changed = true;
      }
    }
    return changed ? serializeXmlTreeBytes(tree) : source;
  }
  const relation = relations.find((candidate) =>
    attribute(candidate, 'Id') === slide.notes!.relationshipId);
  if (!relation) return patchRelationshipPart(source, [{
    sourceId: slide.notes.relationshipId,
    targetId: slide.notes.relationshipId,
    type: NOTES_REL,
    target: relativeTarget(slide.origin.part, slide.notes.targetPart),
  }]);
  if (attribute(relation, 'Type') !== NOTES_REL) {
    throw new Error(`页面 ${slide.id} 的 notes 关系 id 与其它关系冲突`);
  }
  const target = relativeTarget(slide.origin.part, slide.notes.targetPart);
  if (attribute(relation, 'Target') === target && attribute(relation, 'TargetMode') === undefined) {
    return source;
  }
  setXmlAttribute(relation, 'Target', target);
  removeXmlAttribute(relation, 'TargetMode');
  return serializeXmlTreeBytes(tree);
}

function relationshipTargetsTrackedNotes(
  doc: EditDoc,
  slide: SlideRecord,
  tracked: ReadonlySet<string>,
): boolean {
  const part = slide.origin && relationshipPartFor(slide.origin.part);
  const source = part && doc.package?.parts[part];
  if (!source || !slide.origin) return false;
  return xmlElementChildren(parseXmlTree(source).root, { localName: 'Relationship' }).some((relation) => {
    const target = attribute(relation, 'Target');
    return attribute(relation, 'Type') === NOTES_REL
      && attribute(relation, 'TargetMode') !== 'External' && !!target
      && tracked.has(resolveRelationshipTarget(slide.origin!.part, target));
  });
}

export interface NotesSavePlan {
  readonly relationshipSlides: Map<string, SlideRecord>;
  readonly trackedParts: Set<string>;
}

/** 捕获第一次触碰的基线，并把会话创建的 notes part 纳入可撤销生命周期。 */
export function prepareNotesSave(
  doc: EditDoc,
  baselines: Record<string, Uint8Array>,
  createdParts: Set<string>,
): NotesSavePlan {
  const trackedParts = new Set([...createdParts].filter(isNotesPart));
  for (const slide of Object.values(doc.slides)) {
    const binding = slide.notes;
    if (!binding) continue;
    if (trackedParts.has(binding.targetPart)
      || !doc.package?.parts[binding.targetPart] && !baselines[binding.targetPart]) {
      trackedParts.add(binding.targetPart);
      createdParts.add(binding.targetPart);
      createdParts.add(relationshipPartFor(binding.targetPart));
    } else if (own(slide.ovr, 'notes') && !baselines[binding.targetPart]) {
      const sourcePart = binding.sourcePart ?? binding.targetPart;
      const source = doc.package?.parts[sourcePart];
      if (!source) throw new Error(`找不到备注保存基线：${sourcePart}`);
      baselines[binding.targetPart] = source.slice();
    }
  }
  const relationshipSlides = new Map<string, SlideRecord>();
  for (const slide of Object.values(doc.slides)) {
    if (!slide.origin) continue;
    const needsPatch = !!slide.notes && trackedParts.has(slide.notes.targetPart)
      || relationshipTargetsTrackedNotes(doc, slide, trackedParts);
    if (!needsPatch) continue;
    relationshipSlides.set(slide.origin.part, slide);
    if (slide.creation) continue;
    const relsPart = relationshipPartFor(slide.origin.part);
    if (baselines[relsPart] || createdParts.has(relsPart)) continue;
    const source = doc.package?.parts[relsPart];
    if (source) baselines[relsPart] = source.slice();
    else createdParts.add(relsPart);
  }
  return { relationshipSlides, trackedParts };
}

export function materializeNotesParts(
  doc: EditDoc,
  baselines: Readonly<Record<string, Uint8Array>>,
  plan: NotesSavePlan,
  changes: Record<string, Uint8Array | null>,
): void {
  for (const slide of Object.values(doc.slides)) {
    const binding = slide.notes;
    if (!binding) continue;
    if (plan.trackedParts.has(binding.targetPart)) {
      const source = binding.sourcePart
        ? baselines[binding.sourcePart] ?? doc.package?.parts[binding.sourcePart]
        : undefined;
      if (binding.sourcePart && !source) throw new Error(`找不到备注克隆来源：${binding.sourcePart}`);
      const value = own(slide.ovr, 'notes') ? slide.ovr.notes! : slide.src.notes ?? '';
      changes[binding.targetPart] = patchNotesText(source ?? emptyNotesXml(), value);
      const sourceRelationships = binding.sourcePart
        ? baselines[relationshipPartFor(binding.sourcePart)]
          ?? doc.package?.parts[relationshipPartFor(binding.sourcePart)]
        : undefined;
      changes[relationshipPartFor(binding.targetPart)] = patchNotesBackReference(
        sourceRelationships, binding.targetPart, slide.origin!.part,
      );
      continue;
    }
    const baseline = baselines[binding.targetPart];
    if (!baseline) continue;
    const current = doc.package?.parts[binding.targetPart];
    const changed = own(slide.ovr, 'notes')
      || !!current && (current.length !== baseline.length
        || current.some((byte, index) => byte !== baseline[index]));
    if (!changed) continue;
    changes[binding.targetPart] = own(slide.ovr, 'notes')
      ? patchNotesText(baseline, slide.ovr.notes!)
      : baseline;
  }
}
