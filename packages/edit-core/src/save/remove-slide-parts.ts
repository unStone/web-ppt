import { resolveRelationshipTarget } from '../clipboard-source';
import type { EditDoc } from '../types';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { parseXmlTree } from '../xml/tree';
import { relationshipPartFor } from './clipboard-parts';

const NOTES_SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const SLIDE_PART = /^ppt\/slides\/slide\d+\.xml$/;

export interface RemovedSlidePackageParts {
  readonly slideParts: ReadonlySet<string>;
  readonly packageParts: ReadonlySet<string>;
  readonly contentTypeParts: ReadonlySet<string>;
}

export function removedSlidePartNames(
  doc: EditDoc,
  knownCreatedParts: ReadonlySet<string> = new Set(doc.saveState.createdParts),
): Set<string> {
  const activeSlides = new Set(doc.slideOrder.flatMap((id) => doc.slides[id].origin?.part ?? []));
  const candidates = new Set([
    ...doc.saveState.sourceSlideParts,
    ...[...knownCreatedParts].filter((part) => SLIDE_PART.test(part)),
  ]);
  return new Set([...candidates].filter((part) => !activeSlides.has(part)));
}

function relationshipBytes(doc: EditDoc, sourcePart: string): Uint8Array | undefined {
  const part = relationshipPartFor(sourcePart);
  return doc.saveState.baselines[part] ?? doc.package?.parts[part];
}

function notesTargets(doc: EditDoc, slidePart: string): Set<string> {
  const source = relationshipBytes(doc, slidePart);
  if (!source) return new Set();
  const targets = new Set<string>();
  for (const node of xmlElementChildren(parseXmlTree(source).root, { localName: 'Relationship' })) {
    const type = findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
    const mode = findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
    const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
    if (type !== NOTES_SLIDE_REL || mode === 'External' || !target) continue;
    try { targets.add(resolveRelationshipTarget(slidePart, target)); } catch { /* 越界目标不能安全删除。 */ }
  }
  return targets;
}

/** 保存后撤销尚未写回时，只有缺失来源页及其 notes 闭包可由基线暂时托管。 */
export function detachedSlideBaselineParts(doc: EditDoc): Set<string> {
  const detached = new Set<string>();
  if (!doc.package) return detached;
  for (const part of doc.saveState.sourceSlideParts) {
    if (doc.package.parts[part]) continue;
    detached.add(part);
    detached.add(relationshipPartFor(part));
    for (const notesPart of notesTargets(doc, part)) {
      detached.add(notesPart);
      detached.add(relationshipPartFor(notesPart));
    }
  }
  return detached;
}

/** 只清理页面拥有的 OPC 身份；关系目标默认保留，notes 仅在没有活动页引用时删除。 */
export function removedSlidePackageParts(
  doc: EditDoc,
  knownCreatedParts: ReadonlySet<string>,
): RemovedSlidePackageParts {
  const activeSlides = new Set(doc.slideOrder.flatMap((id) => doc.slides[id].origin?.part ?? []));
  const slideParts = removedSlidePartNames(doc, knownCreatedParts);
  const activeNotes = new Set<string>();
  for (const part of activeSlides) for (const target of notesTargets(doc, part)) activeNotes.add(target);

  const packageParts = new Set<string>();
  const contentTypeParts = new Set<string>();
  for (const part of slideParts) {
    packageParts.add(part);
    packageParts.add(relationshipPartFor(part));
    contentTypeParts.add(part);
    for (const notesPart of notesTargets(doc, part)) {
      if (activeNotes.has(notesPart)) continue;
      if (!doc.saveState.baselines[notesPart] && !doc.package?.parts[notesPart]) continue;
      packageParts.add(notesPart);
      packageParts.add(relationshipPartFor(notesPart));
      contentTypeParts.add(notesPart);
    }
  }
  return { slideParts, packageParts, contentTypeParts };
}
