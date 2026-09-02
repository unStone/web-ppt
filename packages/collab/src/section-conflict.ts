import type { EditDoc, SectionId, SectionState, SectionStatePatch } from '@web-ppt/edit-core';

const compareStableId = (left: SectionId, right: SectionId): number =>
  left < right ? -1 : left > right ? 1 : 0;

function insertByDesiredOrder(
  order: SectionId[],
  desired: readonly SectionId[],
  target: SectionId,
): void {
  const desiredIndex = desired.indexOf(target);
  const after = desired.slice(0, desiredIndex).reverse().find((id) => order.includes(id)) ?? null;
  const before = desired.slice(desiredIndex + 1).find((id) => order.includes(id)) ?? null;
  const start = after === null ? 0 : order.indexOf(after) + 1;
  const end = before === null ? order.length : order.indexOf(before);
  // 同一逻辑间隙里的并发新增没有共同时间顺序；按稳定 id 排序才能与到达顺序无关。
  const siblings = [...new Set([...order.slice(start, end), target])]
    .sort(compareStableId);
  order.splice(start, end - start, ...siblings);
}

function addSection(
  current: SectionState,
  desired: SectionState,
  target: SectionId,
): boolean {
  const record = desired.records[target];
  if (!record || current.records[target]) return false;
  const nextRecord = structuredClone(record);
  for (const slideId of [...nextRecord.slideIds]) {
    const owner = current.order.find((id) => current.records[id].slideIds.includes(slideId));
    if (!owner) continue;
    // 两个副本把同一页并发加入不同节时，以稳定节身份决定唯一归属。
    if (compareStableId(owner, target) < 0) {
      nextRecord.slideIds.splice(nextRecord.slideIds.indexOf(slideId), 1);
    } else {
      current.records[owner].slideIds.splice(current.records[owner].slideIds.indexOf(slideId), 1);
    }
  }
  current.records[target] = nextRecord;
  insertByDesiredOrder(current.order, desired.order, target);
  return true;
}

/** 把远端完整快照收窄成一个节操作，避免覆盖接收端的并发页面成员和其他节。 */
export function rebaseSectionStatePatch(
  doc: EditDoc,
  patch: SectionStatePatch,
): SectionStatePatch | null {
  const target = patch.path[2];
  const field = patch.path[3];
  const desired = patch.value;
  const next = structuredClone(doc.sections);
  let changed = false;
  if (field === 'name') {
    if (!next.records[target] || !desired.records[target]) return null;
    changed = next.records[target].name !== desired.records[target].name;
    next.records[target].name = desired.records[target].name;
  } else if (field === 'order') {
    if (!next.records[target] || !desired.records[target]) return null;
    const before = next.order.join('\0');
    next.order.splice(next.order.indexOf(target), 1);
    insertByDesiredOrder(next.order, desired.order, target);
    changed = before !== next.order.join('\0');
  } else if (desired.records[target]) {
    changed = addSection(next, desired, target);
  } else if (next.records[target]) {
    delete next.records[target];
    next.order.splice(next.order.indexOf(target), 1);
    changed = true;
  }
  next.edited ||= desired.edited;
  // 顺序意图即使局部已满足，也必须继续进入全量重放；否则并发的其他移动无法交换。
  if (!changed && next.edited === doc.sections.edited && field !== 'order') return null;
  return { ...patch, value: next };
}
