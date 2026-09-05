import { parseXmlTree } from '../xml/tree';
import { shapeIds } from '../xml/shape-ids';
import type { EditDoc } from '../types';
import { allocateIdentityRange } from '../identity-allocation';
import { maxElementSpid } from '../element-spids';

const MAX_SPID = 0xffff_ffff;

function maxSourceSpid(doc: EditDoc, part: string): number {
  const creation = Object.values(doc.slides).find((slide) => slide.origin?.part === part)?.creation;
  const source = creation?.duplicateSourcePart ?? part;
  const bytes = doc.saveState.baselines[part] ?? doc.package?.parts[part]
    ?? doc.saveState.baselines[source] ?? doc.package?.parts[source];
  if (!bytes) {
    if (creation && !creation.duplicateSourcePart) return 0;
    throw new Error(`无法读取元素目标 part：${part}`);
  }
  let maximum = 0;
  for (const raw of shapeIds(parseXmlTree(bytes).root)) {
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= 0) maximum = Math.max(maximum, value);
  }
  return maximum;
}

function maxModelSpid(doc: EditDoc, part: string): number {
  return Math.max(0, ...[...Object.values(doc.elements), ...Object.values(doc.removedElements)]
    .map((record) => record.meta.origin?.part === part ? maxElementSpid(record) : 0));
}

export function maxPartSpid(doc: EditDoc, part: string): number {
  return Math.max(maxSourceSpid(doc, part), maxModelSpid(doc, part));
}

function preparePartRange(doc: EditDoc, part: string): void {
  const allocation = doc.identity.allocation;
  if (!allocation) return;
  const key = `spid:${part}`;
  const existing = allocation.ranges[key];
  if (existing) {
    if (existing.step !== allocation.count || existing.end !== MAX_SPID + 1
      || (existing.next - (allocation.slot + 1)) % allocation.count !== 0) {
      throw new Error(`目标 part 的 spid 分区无效：${part}`);
    }
    return;
  }
  // 每个 slot 固守自己的模 count 余数；即使副本首次看到新 part 的时刻不同，也不可能取到同一 id。
  const first = allocation.slot + 1;
  const highest = maxPartSpid(doc, part);
  const rounds = highest < first ? 0 : Math.floor((highest - first) / allocation.count) + 1;
  const next = first + rounds * allocation.count;
  if (!Number.isSafeInteger(next) || next > MAX_SPID) throw new Error(`目标 part 的 spid 已耗尽：${part}`);
  allocation.ranges[key] = {
    base: first, maximum: MAX_SPID, next, end: MAX_SPID + 1, step: allocation.count,
  };
}

export function prepareElementSpidNamespaces(doc: EditDoc): void {
  const parts = new Set([
    ...Object.values(doc.slides).flatMap((slide) => slide.origin ? [slide.origin.part] : []),
    ...Object.values(doc.elements).flatMap((record) => record.meta.origin ? [record.meta.origin.part] : []),
  ]);
  for (const part of parts) preparePartRange(doc, part);
}

/** 来源 XML 里还有不进入 Schema 的 cNvPr；只扫模型会在空页或未知宿主上复用 spid。 */
export function allocateElementSpid(doc: EditDoc, part: string): number {
  if (doc.identity.allocation) {
    if (!doc.identity.allocation.ranges[`spid:${part}`]) preparePartRange(doc, part);
    const next = allocateIdentityRange(doc.identity, `spid:${part}`, 1)!;
    doc.identity.nextSpid[part] = Math.max(doc.identity.nextSpid[part] ?? 1, next + 1);
    return next;
  }
  const cached = doc.identity.nextSpid[part];
  const next = cached ?? maxPartSpid(doc, part) + 1;
  if (!Number.isSafeInteger(next) || next <= 0) throw new Error(`目标 part 的 spid 已耗尽：${part}`);
  doc.identity.nextSpid[part] = next + 1;
  return next;
}
