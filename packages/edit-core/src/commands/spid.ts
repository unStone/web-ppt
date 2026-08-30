import { parseXmlTree } from '../xml/tree';
import type { XmlElement } from '../xml/types';
import type { EditDoc } from '../types';
import { allocateIdentityRange } from '../identity-allocation';

const MAX_SPID = 0xffff_ffff;

function maxSourceSpid(doc: EditDoc, part: string): number {
  const bytes = doc.saveState.baselines[part] ?? doc.package?.parts[part];
  if (!bytes) {
    if (Object.values(doc.slides).some((slide) => slide.creation && slide.origin?.part === part)) return 0;
    throw new Error(`无法读取元素目标 part：${part}`);
  }
  let maximum = 0;
  const visit = (element: XmlElement): void => {
    if (element.localName === 'cNvPr') {
      const raw = element.attributes.find((attribute) =>
        attribute.localName === 'id' && attribute.namespaceUri === null)?.value;
      const value = raw === undefined ? NaN : Number(raw);
      if (Number.isSafeInteger(value) && value >= 0) maximum = Math.max(maximum, value);
    }
    for (const child of element.children) if (child.type === 'element') visit(child);
  };
  visit(parseXmlTree(bytes).root);
  return maximum;
}

function maxModelSpid(doc: EditDoc, part: string): number {
  return Math.max(0, ...[...Object.values(doc.elements), ...Object.values(doc.removedElements)]
    .flatMap((record) => record.meta.origin?.part === part ? [record.meta.origin.spid] : []));
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
  const highest = Math.max(maxSourceSpid(doc, part), maxModelSpid(doc, part));
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
  const next = cached ?? Math.max(maxSourceSpid(doc, part), maxModelSpid(doc, part)) + 1;
  if (!Number.isSafeInteger(next) || next <= 0) throw new Error(`目标 part 的 spid 已耗尽：${part}`);
  doc.identity.nextSpid[part] = next + 1;
  return next;
}

export function partSpidAllocator(doc: EditDoc, part: string): () => number {
  return () => allocateElementSpid(doc, part);
}
