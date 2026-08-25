import { relativeTarget } from '../clipboard-source';
import type { EditDoc, RemovedElementRecord, SlideRecord } from '../types';
import { setXmlAttribute } from '../xml/mutate';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import { patchRelationshipPart, relationshipPartFor } from './clipboard-parts';

const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

export interface DuplicateNotesParts {
  readonly slidePart: string;
  readonly sourcePart: string;
  readonly targetPart: string;
}

function packageSource(
  doc: EditDoc,
  baselines: Readonly<Record<string, Uint8Array>>,
  part: string,
): Uint8Array {
  const source = baselines[part] ?? doc.package?.parts[part];
  if (!source) throw new Error(`页面副本缺少来源 OPC part：${part}`);
  return source;
}

export function duplicateSlideSource(
  doc: EditDoc,
  slide: SlideRecord,
  baselines: Readonly<Record<string, Uint8Array>>,
): Uint8Array | undefined {
  const sourcePart = slide.creation?.duplicateSourcePart;
  return sourcePart ? packageSource(doc, baselines, sourcePart) : undefined;
}

export function duplicateRelationshipSource(
  doc: EditDoc,
  slide: SlideRecord,
  baselines: Readonly<Record<string, Uint8Array>>,
): Uint8Array | undefined {
  const sourcePart = slide.creation?.duplicateSourcePart;
  return sourcePart ? packageSource(doc, baselines, relationshipPartFor(sourcePart)) : undefined;
}

export function duplicateSlideRemovals(slide: SlideRecord): RemovedElementRecord[] {
  const part = slide.origin?.part;
  if (!part) return [];
  return (slide.creation?.duplicateRemovedSpids ?? []).map((spid) => ({
    id: `${slide.id}-baseline-${spid}`,
    parent: slide.id,
    meta: { editable: 'full', origin: { part, spid } },
  }));
}

export function duplicateNotesParts(slides: readonly SlideRecord[]): DuplicateNotesParts[] {
  return slides.flatMap((slide) => {
    const sourcePart = slide.creation?.duplicateNotesSourcePart;
    const targetPart = slide.creation?.duplicateNotesPart;
    const slidePart = slide.origin?.part;
    return sourcePart && targetPart && slidePart ? [{ slidePart, sourcePart, targetPart }] : [];
  });
}

function patchRelationshipTarget(
  source: Uint8Array,
  type: string,
  target: string,
): { bytes: Uint8Array; found: boolean } {
  const tree = parseXmlTree(source);
  let found = false;
  for (const relation of xmlElementChildren(tree.root, { localName: 'Relationship' })) {
    const relationType = findXmlAttribute(relation, { localName: 'Type', namespaceUri: null })?.value;
    const mode = findXmlAttribute(relation, { localName: 'TargetMode', namespaceUri: null })?.value;
    if (relationType !== type || mode === 'External') continue;
    const attribute = findXmlAttribute(relation, { localName: 'Target', namespaceUri: null });
    if (!attribute) throw new Error(`关系 ${type} 缺少 Target`);
    setXmlAttribute(relation, attribute.name, target);
    found = true;
  }
  return { bytes: serializeXmlTreeBytes(tree), found };
}

export function patchDuplicateSlideRelationships(
  source: Uint8Array,
  notes: DuplicateNotesParts | undefined,
): Uint8Array {
  if (!notes) return source;
  const patched = patchRelationshipTarget(source, NOTES_REL,
    relativeTarget(notes.slidePart, notes.targetPart));
  if (!patched.found) throw new Error(`页面副本 ${notes.slidePart} 缺少 notesSlide 关系`);
  return patched.bytes;
}

export function cloneDuplicateNotesParts(
  doc: EditDoc,
  baselines: Readonly<Record<string, Uint8Array>>,
  notes: DuplicateNotesParts,
): { notes: Uint8Array; relationships: Uint8Array } {
  const bytes = packageSource(doc, baselines, notes.sourcePart);
  const sourceRelsPart = relationshipPartFor(notes.sourcePart);
  const sourceRelationships = baselines[sourceRelsPart] ?? doc.package?.parts[sourceRelsPart];
  const target = relativeTarget(notes.targetPart, notes.slidePart);
  if (!sourceRelationships) {
    return {
      notes: bytes,
      relationships: patchRelationshipPart(undefined, [{
        sourceId: 'rId1', targetId: 'rId1', type: SLIDE_REL, target,
      }]),
    };
  }
  const patched = patchRelationshipTarget(sourceRelationships, SLIDE_REL, target);
  if (patched.found) return { notes: bytes, relationships: patched.bytes };
  const ids = xmlElementChildren(parseXmlTree(sourceRelationships).root, { localName: 'Relationship' })
    .flatMap((relation) => {
      const id = findXmlAttribute(relation, { localName: 'Id', namespaceUri: null })?.value;
      const match = id && /^rId(\d+)$/.exec(id);
      return match ? [Number(match[1])] : [];
    });
  const id = `rId${Math.max(0, ...ids) + 1}`;
  return {
    notes: bytes,
    relationships: patchRelationshipPart(sourceRelationships, [{
      sourceId: id, targetId: id, type: SLIDE_REL, target,
    }]),
  };
}
