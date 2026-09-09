import type { EditDoc } from './types';
import type { HistoryEntry, Patch, SlideTreeSnapshot } from './commands/types';
import { applyExtensionPatch, extensionCopyResolver, finalizeExtensionPatch, isExtensionPatch, validateExtensionPatch } from './extension-runtime';
import { extensionCopyMatches, readExtensionCopies, type ExtensionCopyResolver } from './extension-copy';

/** 只派生结构快照；完整领域/结构校验仍在实际插入批次执行。 */
export function rebaseExtensionCopySnapshot(doc: EditDoc, before: SlideTreeSnapshot, updates: readonly Patch[],
  resolve: ExtensionCopyResolver | undefined = extensionCopyResolver(doc)): SlideTreeSnapshot {
  const relevant = updates.filter(isExtensionPatch).filter(field => field.path[0] === 'elements'
    && Object.prototype.hasOwnProperty.call(before.records, field.path[1]));
  if (!relevant.length) return before;
  const records = { ...before.records }, affected = new Set(relevant.map(field => field.path[1]));
  for (const id of affected) records[id] = { ...records[id], ovr: structuredClone(records[id].ovr) };
  const view = { ...doc, elements: { ...doc.elements, ...records }, slides: { ...doc.slides, [before.slide.id]: before.slide },
    slideOrder: doc.slides[before.slide.id] ? doc.slideOrder : [...doc.slideOrder, before.slide.id] };
  relevant.forEach((field, index) => validateExtensionPatch(view, field, index, true));
  relevant.forEach(field => applyExtensionPatch(view, field));
  relevant.forEach(field => finalizeExtensionPatch(view, field.path[1], field.path[4], 'elements'));
  const next = { ...before, records }, paths = new Set(relevant.map(field => JSON.stringify(field.path)));
  const inherited = readExtensionCopies(before).filter(input => !paths.has(JSON.stringify(input.path))
    && extensionCopyMatches(next, input));
  // 用当前目标的原寄存器说明恢复值；缺证据时不能把旧来源 stamp 嫁接到新值。
  const own = resolve?.(doc, { ...next,
    copySources: Object.fromEntries([...affected].map(id => [id, id])) }, []) ?? [];
  const inputs = [...inherited, ...own.filter(input => paths.has(JSON.stringify(input.path)))];
  delete (next as { extensionCopies?: string }).extensionCopies;
  if (inputs.length) next.extensionCopies = JSON.stringify(inputs);
  readExtensionCopies(next);
  return next;
}

/** 非记录写入仍属于被复制的对象；撤销复制可以移除它，重做必须恢复已经获胜的字段。 */
export function rebaseExtensionCopyHistory(doc: EditDoc, entry: HistoryEntry, updates: readonly Patch[]): HistoryEntry {
  const fields = updates.filter(isExtensionPatch).filter(patch => patch.path[0] === 'elements');
  if (!fields.length) return entry;
  const snapshots = new Map<SlideTreeSnapshot, SlideTreeSnapshot>();
  const rewrite = (patch: Patch): Patch => {
    if (patch.path[0] !== 'slides' || patch.path.length !== 2 || patch.op !== 'insert' && patch.op !== 'remove') return patch;
    const before = patch.value as SlideTreeSnapshot;
    if (!snapshots.has(before)) {
      const next = rebaseExtensionCopySnapshot(doc, before, fields);
      if (next === before) return patch;
      snapshots.set(before, next);
    }
    return { ...patch, value: snapshots.get(before)! } as Patch;
  };
  const forward = entry.forward.map(rewrite), inverse = entry.inverse.map(rewrite);
  return snapshots.size ? { ...entry, forward, inverse } : entry;
}
