import { allocateNotesPart, allocateSlideOpcIdentity } from './commands/add-slide-identity';
import { isElementTreePatch } from './commands/element-tree';
import { isSlideNotesPatch } from './commands/slide-notes';
import { isSlideTreePatch } from './commands/slide-tree';
import { allocateElementSpid } from './commands/spid';
import type { Patch } from './commands/types';
import type {
  EditDoc, EditIdentity, EditIdentityAllocation, ElementRecord, SlideNotesBinding, SlideRecord,
} from './types';
import { assertIdentityAllocation } from './identity-allocation';

export function assertRecoveryIdentity(
  value: unknown,
  prefix: string,
  sequence: number,
): asserts value is EditIdentity {
  if (!value || typeof value !== 'object') throw new Error(`恢复帧 ${sequence} 的身份水位无效`);
  const identity = value as Partial<EditIdentity>;
  const optionalCounter = (counter: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) =>
    counter === undefined || typeof counter === 'number'
      && Number.isSafeInteger(counter) && counter >= minimum && counter <= maximum;
  if (identity.prefix !== prefix
    || !Number.isSafeInteger(identity.nextSlide) || identity.nextSlide! <= 0
    || !Number.isSafeInteger(identity.nextElement) || identity.nextElement! <= 0
    || !identity.nextSpid || typeof identity.nextSpid !== 'object' || Array.isArray(identity.nextSpid)
    || Object.entries(identity.nextSpid).some(([part, counter]) =>
      !part || !Number.isSafeInteger(counter) || counter <= 0)
    || !optionalCounter(identity.nextSlidePart)
    || !optionalCounter(identity.nextNotesPart)
    // 0x8000_0000 表示已分配完最后一个合法 ST_SlideId；文档仍可打开，但不能再新增页。
    || !optionalCounter(identity.nextPresentationSlideId, 256, 0x8000_0000)
    || !optionalCounter(identity.nextPresentationRelationship)) {
    throw new Error(`恢复帧 ${sequence} 的身份水位无效`);
  }
  if (identity.allocation !== undefined) {
    assertIdentityAllocation(
      identity.allocation, `恢复帧 ${sequence} 的身份分配命名空间`, identity.prefix,
    );
  }
}

export interface RecoveryIdentityFloor {
  nextSlide: number;
  nextElement: number;
  readonly nextSpid: Map<string, number>;
  readonly checkedSpidSources: Set<string>;
  readonly createdParts: Set<string>;
  readonly knownElements: Map<string, string | null>;
  readonly owningParts: Map<string, string | null>;
  readonly knownSlides: Map<string, string>;
  readonly occupiedSlideParts: Set<string>;
  readonly usedPresentationSlideIds: Set<number>;
  readonly usedPresentationRelationships: Set<string>;
  readonly allowedNotesBindings: Map<string, Set<string>>;
  readonly currentNotesBindings: Map<string, string | null>;
  readonly occupiedNotesParts: Set<string>;
  readonly inheritedSources: Map<string, Set<string>>;
  readonly slideIdPattern: RegExp;
  readonly elementIdPattern: RegExp;
  readonly rowIdPattern: RegExp;
  readonly columnIdPattern: RegExp;
  nextSlidePart?: number;
  nextNotesPart?: number;
  nextPresentationSlideId?: number;
  nextPresentationRelationship?: number;
  minimumNewSlidePart?: number;
  minimumNewPresentationSlideId?: number;
  minimumNewPresentationRelationship?: number;
  minimumNewNotesPart?: number;
  checkedSlideSource: boolean;
  checkedNotesSource: boolean;
  allocation?: EditIdentityAllocation;
}

function anchorKey(record: Pick<ElementRecord, 'meta'>): string | null {
  const anchor = record.meta.origin;
  if (!anchor) return null;
  if (typeof anchor.part !== 'string' || !anchor.part
    || !Number.isSafeInteger(anchor.spid) || anchor.spid <= 0) {
    throw new Error('恢复日志包含无效的 OOXML 元素身份');
  }
  return `${anchor.part}\0${anchor.spid}`;
}

function owningParts(doc: EditDoc): Map<string, string | null> {
  const owners = new Map(Object.values(doc.slides)
    .map((slide) => [slide.id, slide.origin?.part ?? null] as const));
  const records = new Map([...Object.values(doc.elements), ...Object.values(doc.removedElements)]
    .map((record) => [record.id, record] as const));
  const resolve = (id: string, visiting = new Set<string>()): string | null => {
    if (owners.has(id)) return owners.get(id)!;
    const record = records.get(id);
    if (!record || visiting.has(id)) throw new Error(`恢复基线的元素父链无效：${id}`);
    visiting.add(id);
    const owner = resolve(record.parent, visiting);
    owners.set(id, owner);
    return owner;
  };
  for (const id of records.keys()) resolve(id);
  return owners;
}

function slideIdentityKey(slide: SlideRecord): string {
  const creation = slide.creation;
  return JSON.stringify([
    slide.origin?.part ?? null,
    creation ? [
      creation.layoutPart, creation.layoutRelationshipId, creation.duplicateSourcePart ?? null,
      creation.duplicateNotesSourcePart ?? null, creation.duplicateNotesPart ?? null,
      creation.duplicateRemovedSpids ?? null, creation.duplicateRemovedAnimationSpids ?? null,
      creation.presentationSlideId,
      creation.presentationRelationshipId, creation.sectionAfterSlideId ?? null,
    ] : null,
  ]);
}

const notesBindingKey = (binding: SlideNotesBinding): string => JSON.stringify([
  binding.sourcePart ?? null, binding.targetPart, binding.relationshipId,
]);

function inheritedSources(doc: EditDoc): Map<string, Set<string>> {
  const sources = new Map<string, Set<string>>();
  const visit = (element: ElementRecord['src']): void => {
    const origin = element.editInfo?.origin;
    if (origin && typeof origin.part === 'string' && origin.part
      && Number.isSafeInteger(origin.spid) && origin.spid > 0) {
      const key = `${origin.part}\0${origin.spid}`;
      const variants = sources.get(key) ?? new Set<string>();
      variants.add(JSON.stringify(element));
      sources.set(key, variants);
    }
    if (element.kind === 'group') for (const child of element.children) visit(child);
  };
  for (const layout of Object.values(doc.layouts)) for (const element of layout.elements) visit(element);
  return sources;
}

export function createRecoveryIdentityFloor(doc: EditDoc): RecoveryIdentityFloor {
  const identity = doc.identity;
  const escaped = identity.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const packageParts = [...Object.keys(doc.package?.parts ?? {}), ...Object.keys(doc.saveState.baselines)];
  return {
    nextSlide: identity.nextSlide,
    nextElement: identity.nextElement,
    nextSpid: new Map(Object.entries(identity.nextSpid)),
    checkedSpidSources: new Set(),
    createdParts: new Set(),
    knownElements: new Map([...Object.values(doc.elements), ...Object.values(doc.removedElements)]
      .map((record) => [record.id, anchorKey(record)])),
    owningParts: owningParts(doc),
    knownSlides: new Map(Object.values(doc.slides)
      .map((slide) => [slide.id, slideIdentityKey(slide)])),
    occupiedSlideParts: new Set([
      ...packageParts.filter((part) => /^ppt\/slides\/slide\d+\.xml$/.test(part)),
      ...Object.values(doc.slides).flatMap((slide) => slide.origin ? [slide.origin.part] : []),
    ]),
    usedPresentationSlideIds: new Set(Object.values(doc.slides)
      .flatMap((slide) => slide.creation ? [slide.creation.presentationSlideId] : [])),
    usedPresentationRelationships: new Set(Object.values(doc.slides)
      .flatMap((slide) => slide.creation ? [slide.creation.presentationRelationshipId] : [])),
    allowedNotesBindings: new Map(Object.values(doc.slides).map((slide) => [
      slide.id, new Set(slide.notes ? [notesBindingKey(slide.notes)] : []),
    ])),
    currentNotesBindings: new Map(Object.values(doc.slides)
      .map((slide) => [slide.id, slide.notes ? notesBindingKey(slide.notes) : null])),
    occupiedNotesParts: new Set([
      ...packageParts.filter((part) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(part)),
      ...Object.values(doc.slides).flatMap((slide) => slide.notes ? [slide.notes.targetPart] : []),
    ]),
    inheritedSources: inheritedSources(doc),
    slideIdPattern: new RegExp(`^${escaped}s([0-9a-z]+)$`),
    elementIdPattern: new RegExp(`^${escaped}e([0-9a-z]+)$`),
    rowIdPattern: new RegExp(`^${escaped}r([0-9a-z]+):`),
    columnIdPattern: new RegExp(`^${escaped}c([0-9a-z]+):`),
    ...(identity.nextSlidePart === undefined ? {} : { nextSlidePart: identity.nextSlidePart }),
    ...(identity.nextNotesPart === undefined ? {} : { nextNotesPart: identity.nextNotesPart }),
    ...(identity.nextPresentationSlideId === undefined
      ? {} : { nextPresentationSlideId: identity.nextPresentationSlideId }),
    ...(identity.nextPresentationRelationship === undefined
      ? {} : { nextPresentationRelationship: identity.nextPresentationRelationship }),
    checkedSlideSource: false,
    checkedNotesSource: false,
    ...(identity.allocation ? { allocation: structuredClone(identity.allocation) } : {}),
  };
}

function base36Serial(value: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(value);
  if (!match) return undefined;
  const serial = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(serial) && serial > 0 ? serial : undefined;
}

function advanceLogicalId(floor: RecoveryIdentityFloor, id: string): void {
  const slide = base36Serial(id, floor.slideIdPattern);
  if (slide !== undefined) floor.nextSlide = Math.max(floor.nextSlide, slide + 1);
  const element = base36Serial(id, floor.elementIdPattern);
  const row = base36Serial(id, floor.rowIdPattern);
  const column = base36Serial(id, floor.columnIdPattern);
  const serial = element ?? row ?? column;
  if (serial !== undefined) floor.nextElement = Math.max(floor.nextElement, serial + 1);
}

function advanceRecord(
  floor: RecoveryIdentityFloor,
  record: ElementRecord,
  insert: boolean,
  owner: string | null,
  embedded: boolean,
): void {
  advanceLogicalId(floor, record.id);
  const anchor = anchorKey(record);
  if (floor.knownElements.has(record.id)) {
    if (floor.knownElements.get(record.id) !== anchor
      || floor.owningParts.has(record.id) && floor.owningParts.get(record.id) !== owner) {
      throw new Error(`恢复日志改变了已分配元素的 OOXML 身份：${record.id}`);
    }
    if (insert) floor.owningParts.set(record.id, owner);
    return;
  }
  if (!insert) throw new Error(`恢复日志删除了未分配的元素身份：${record.id}`);
  floor.knownElements.set(record.id, anchor);
  floor.owningParts.set(record.id, owner);
  if (!record.meta.origin && !embedded) {
    throw new Error(`恢复日志的新元素缺少可持久化宿主：${record.id}`);
  }
  if (record.meta.origin && record.meta.origin.part !== owner) {
    const inherited = record.meta.inherited === true && record.meta.editable === 'none'
      && !record.meta.created && !record.meta.insertion && record.order === undefined
      && Object.keys(record.ovr).length === 0
      && floor.inheritedSources.get(anchor!)?.has(JSON.stringify(record.src)) === true;
    if (!inherited) throw new Error(`恢复日志的新元素没有归属当前页面 part：${record.id}`);
  }
  if (record.meta.origin?.part === owner) floor.nextSpid.set(record.meta.origin.part, Math.max(
    floor.nextSpid.get(record.meta.origin.part) ?? 1, record.meta.origin.spid + 1,
  ));
}

function embeddedRecordIds(
  records: Readonly<Record<string, ElementRecord>>,
  owner: string | null,
): Set<string> {
  const embedded = new Set<string>();
  const visit = (id: string): void => {
    const record = records[id];
    if (!record || embedded.has(id)) return;
    embedded.add(id);
    for (const child of record.children ?? []) visit(child);
  };
  for (const record of Object.values(records)) {
    if (record.meta.created && record.meta.insertion && record.meta.origin?.part === owner) {
      for (const child of record.children ?? []) visit(child);
    }
  }
  return embedded;
}

function trackNotesBinding(
  floor: RecoveryIdentityFloor,
  slideId: string,
  binding: SlideNotesBinding | undefined,
  explicit = false,
): void {
  const current = floor.currentNotesBindings.get(slideId) ?? null;
  if (!binding) {
    if (explicit && current === null) throw new Error(`恢复日志重复删除备注绑定：${slideId}`);
    floor.currentNotesBindings.set(slideId, null);
    return;
  }
  if (typeof binding.targetPart !== 'string' || typeof binding.relationshipId !== 'string'
    || !binding.relationshipId || binding.sourcePart !== undefined
      && (typeof binding.sourcePart !== 'string' || !binding.sourcePart)) {
    throw new Error(`恢复日志的备注绑定无效：${slideId}`);
  }
  const signature = notesBindingKey(binding);
  if (explicit && signature === current) throw new Error(`恢复日志重复设置备注绑定：${slideId}`);
  const allowed = floor.allowedNotesBindings.get(slideId) ?? new Set<string>();
  if (!allowed.has(signature)) {
    const serial = Number(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(binding.targetPart)?.[1]);
    if (!Number.isSafeInteger(serial)
      || serial < (floor.minimumNewNotesPart ?? Number.MAX_SAFE_INTEGER)
      || floor.occupiedNotesParts.has(binding.targetPart)) {
      throw new Error(`恢复日志的备注 part 不是独立新身份：${binding.targetPart}`);
    }
    allowed.add(signature);
    floor.allowedNotesBindings.set(slideId, allowed);
    floor.occupiedNotesParts.add(binding.targetPart);
    floor.nextNotesPart = Math.max(floor.nextNotesPart ?? 1, serial + 1);
  }
  floor.currentNotesBindings.set(slideId, signature);
}

function advanceSlideCreation(floor: RecoveryIdentityFloor, slide: SlideRecord): void {
  advanceLogicalId(floor, slide.id);
  if (!slide.creation || !slide.origin) return;
  floor.createdParts.add(slide.origin.part);
  const part = /^ppt\/slides\/slide(\d+)\.xml$/.exec(slide.origin.part);
  const partSerial = Number(part?.[1]);
  if (part && Number.isSafeInteger(partSerial)) {
    floor.nextSlidePart = Math.max(floor.nextSlidePart ?? 1, partSerial + 1);
  }
  floor.nextPresentationSlideId = Math.max(
    floor.nextPresentationSlideId ?? 256, slide.creation.presentationSlideId + 1,
  );
  const relationship = /^rId(\d+)$/.exec(slide.creation.presentationRelationshipId);
  const relationshipSerial = Number(relationship?.[1]);
  if (relationship && Number.isSafeInteger(relationshipSerial)) {
    floor.nextPresentationRelationship = Math.max(
      floor.nextPresentationRelationship ?? 1, relationshipSerial + 1,
    );
  }
}

function advancePatchIdentities(floor: RecoveryIdentityFloor, patches: readonly Patch[]): void {
  for (const patch of patches) {
    advanceLogicalId(floor, patch.path[1]);
    if (patch.path[0] === 'elements' && patch.path[2] === 'ovr'
      && (patch.path[3] === 'tableRows' || patch.path[3] === 'tableColumns')
      && typeof patch.path[4] === 'string') {
      advanceLogicalId(floor, patch.path[4]);
    }
    if (isElementTreePatch(patch)) {
      if (!floor.owningParts.has(patch.value.parent)) {
        throw new Error(`恢复日志的元素父节点没有页面归属：${patch.value.parent}`);
      }
      const owner = floor.owningParts.get(patch.value.parent)!;
      const embedded = embeddedRecordIds(patch.value.records, owner);
      for (const record of Object.values(patch.value.records)) {
        advanceRecord(floor, record, patch.op === 'insert', owner, embedded.has(record.id));
      }
    } else if (isSlideTreePatch(patch)) {
      const slide = patch.value.slide;
      const owner = slide.origin?.part ?? null;
      const identity = slideIdentityKey(slide);
      if (floor.knownSlides.has(slide.id)) {
        if (floor.knownSlides.get(slide.id) !== identity) {
          throw new Error(`恢复日志改变了已分配页面的 OPC 身份：${slide.id}`);
        }
      } else {
        const partSerial = Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(owner ?? '')?.[1]);
        const relationship = slide.creation
          && /^rId(\d+)$/.exec(slide.creation.presentationRelationshipId);
        const relationshipSerial = Number(relationship?.[1]);
        if (patch.op !== 'insert' || !slide.creation || !owner
          || (slide.creation.duplicateNotesPart ?? null) !== (slide.notes?.targetPart ?? null)
          || !Number.isSafeInteger(partSerial)
          || partSerial < (floor.minimumNewSlidePart ?? Number.MAX_SAFE_INTEGER)
          || slide.creation.presentationSlideId
            < (floor.minimumNewPresentationSlideId ?? Number.MAX_SAFE_INTEGER)
          || !relationship || !Number.isSafeInteger(relationshipSerial)
          || relationshipSerial
            < (floor.minimumNewPresentationRelationship ?? Number.MAX_SAFE_INTEGER)
          || floor.occupiedSlideParts.has(owner)
          || floor.usedPresentationSlideIds.has(slide.creation.presentationSlideId)
          || floor.usedPresentationRelationships.has(slide.creation.presentationRelationshipId)) {
          throw new Error(`恢复日志的新页面缺少独立 OPC 身份：${slide.id}`);
        }
        floor.knownSlides.set(slide.id, identity);
        floor.occupiedSlideParts.add(owner);
        floor.usedPresentationSlideIds.add(slide.creation.presentationSlideId);
        floor.usedPresentationRelationships.add(slide.creation.presentationRelationshipId);
      }
      advanceSlideCreation(floor, slide);
      floor.owningParts.set(slide.id, owner);
      trackNotesBinding(floor, slide.id, slide.notes);
      const embedded = embeddedRecordIds(patch.value.records, owner);
      for (const record of Object.values(patch.value.records)) {
        advanceRecord(floor, record, patch.op === 'insert', owner, embedded.has(record.id));
      }
    } else if (isSlideNotesPatch(patch) && patch.path.length === 3) {
      trackNotesBinding(floor, patch.path[1], patch.op === 'set' && typeof patch.value === 'object'
        ? patch.value as SlideNotesBinding : undefined, true);
    }
  }
}

function identityProbe(doc: EditDoc): EditDoc {
  return {
    ...doc,
    identity: {
      ...structuredClone(doc.identity), nextSpid: {},
      allocation: undefined,
      nextSlidePart: undefined, nextNotesPart: undefined,
      nextPresentationSlideId: undefined, nextPresentationRelationship: undefined,
    },
  };
}

function ensureOpcSourceFloors(
  doc: EditDoc,
  floor: RecoveryIdentityFloor,
  next: EditIdentity,
): void {
  const needsSlideSource = next.nextSlidePart !== undefined
    || next.nextPresentationSlideId !== undefined || next.nextPresentationRelationship !== undefined;
  if (needsSlideSource && !floor.checkedSlideSource) {
    const probe = identityProbe(doc);
    const allocated = allocateSlideOpcIdentity(probe);
    const partSerial = Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(allocated.part)?.[1]);
    const relationshipSerial = Number(/^rId(\d+)$/.exec(allocated.presentationRelationshipId)?.[1]);
    floor.minimumNewSlidePart = Math.max(floor.nextSlidePart ?? 1, partSerial);
    floor.minimumNewPresentationSlideId = Math.max(
      floor.nextPresentationSlideId ?? 256, allocated.presentationSlideId,
    );
    floor.minimumNewPresentationRelationship = Math.max(
      floor.nextPresentationRelationship ?? 1, relationshipSerial,
    );
    // allocateNotesPart 也会惰性初始化这三项但不会消费页面身份；实际消费由 SlideTreePatch 再推进。
    floor.nextSlidePart = Math.max(floor.nextSlidePart ?? 1, partSerial);
    floor.nextPresentationSlideId = Math.max(
      floor.nextPresentationSlideId ?? 256, allocated.presentationSlideId,
    );
    floor.nextPresentationRelationship = Math.max(
      floor.nextPresentationRelationship ?? 1, relationshipSerial,
    );
    floor.checkedSlideSource = true;
  }
  if (next.nextNotesPart !== undefined && !floor.checkedNotesSource) {
    const probe = identityProbe(doc);
    const allocated = allocateNotesPart(probe);
    const serial = Number(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(allocated)?.[1]);
    floor.minimumNewNotesPart = Math.max(floor.nextNotesPart ?? 1, serial);
    floor.nextNotesPart = Math.max(floor.nextNotesPart ?? 1, probe.identity.nextNotesPart!);
    floor.checkedNotesSource = true;
  }
}

function ensureSpidSourceFloors(doc: EditDoc, floor: RecoveryIdentityFloor, next: EditIdentity): void {
  for (const part of Object.keys(next.nextSpid)) {
    if (floor.checkedSpidSources.has(part)) continue;
    const sourcePart = doc.saveState.baselines[part] ?? doc.package?.parts[part];
    if (floor.createdParts.has(part) && !sourcePart) {
      // 新页 XML 尚未写入原包，只有根组占用 id=1；空白版式没有 record 可替它建立水位。
      floor.nextSpid.set(part, Math.max(floor.nextSpid.get(part) ?? 2, 2));
      floor.checkedSpidSources.add(part);
      continue;
    }
    const probe = identityProbe(doc);
    try {
      allocateElementSpid(probe, part);
      floor.nextSpid.set(part, Math.max(
        floor.nextSpid.get(part) ?? 1, probe.identity.nextSpid[part],
      ));
    } catch (error) {
      if (!floor.nextSpid.has(part)) throw error;
    }
    floor.checkedSpidSources.add(part);
  }
}

export function assertRecoveryIdentityFloor(
  doc: EditDoc,
  floor: RecoveryIdentityFloor,
  next: EditIdentity,
  patches: readonly Patch[],
  sequence: number,
): void {
  ensureOpcSourceFloors(doc, floor, next);
  advancePatchIdentities(floor, patches);
  ensureSpidSourceFloors(doc, floor, next);
  const optional = [
    'nextSlidePart', 'nextNotesPart', 'nextPresentationSlideId', 'nextPresentationRelationship',
  ] as const;
  const previousAllocation = floor.allocation;
  const nextAllocation = next.allocation;
  const allocationInvalid = previousAllocation ? !nextAllocation
    || previousAllocation.replicaId !== nextAllocation.replicaId
    || previousAllocation.prefix !== nextAllocation.prefix
    || previousAllocation.slot !== nextAllocation.slot
    || previousAllocation.count !== nextAllocation.count
    || nextAllocation.clock < previousAllocation.clock
    || nextAllocation.sequence < previousAllocation.sequence
    || Object.entries(previousAllocation.ranges).some(([key, range]) => {
      const candidate = nextAllocation.ranges[key];
      return !candidate || candidate.base !== range.base || candidate.maximum !== range.maximum
        || candidate.end !== range.end || candidate.step !== range.step
        || candidate.next < range.next;
    }) : false;
  const invalid = next.nextSlide < floor.nextSlide || next.nextElement < floor.nextElement
    || [...floor.nextSpid].some(([part, counter]) =>
      next.nextSpid[part] === undefined || next.nextSpid[part] < counter)
    || optional.some((key) => floor[key] !== undefined
      && (next[key] === undefined || next[key]! < floor[key]!)) || allocationInvalid;
  if (invalid) throw new Error(`恢复帧 ${sequence} 的身份水位没有越过已分配身份`);
  floor.nextSlide = next.nextSlide;
  floor.nextElement = next.nextElement;
  for (const [part, counter] of Object.entries(next.nextSpid)) floor.nextSpid.set(part, counter);
  for (const key of optional) if (next[key] !== undefined) floor[key] = next[key];
  floor.allocation = nextAllocation ? structuredClone(nextAllocation) : undefined;
}
