import type { EditIdentity, EditIdentityAllocation, EditIdentityRange } from './types';

const MAX_ID = 0xffff_ffff;
/** JSON number 协议的显式上限；达到上限时必须在编辑落模前失败，不能静默停止广播。 */
export const MAX_COLLABORATION_VERSION = 0xffff_ffff;
const modularRange = (key: string) => key.startsWith('spid:') || key.startsWith('relationship:');

function encodedReplica(replicaId: string): string {
  return [...new TextEncoder().encode(replicaId)]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function assertIdentityAllocation(
  value: unknown,
  label = '身份分配命名空间',
  basePrefix?: string,
): asserts value is EditIdentityAllocation {
  const allocation = value as Partial<EditIdentityAllocation> | null;
  const ranges = allocation?.ranges && typeof allocation.ranges === 'object'
    && !Array.isArray(allocation.ranges) ? Object.entries(allocation.ranges) : null;
  if (!allocation || typeof allocation !== 'object'
    || typeof allocation.replicaId !== 'string' || !allocation.replicaId
    || typeof allocation.prefix !== 'string' || !allocation.prefix
    || basePrefix !== undefined
      && allocation.prefix !== `${basePrefix}c${encodedReplica(allocation.replicaId)}_`
    || !Number.isSafeInteger(allocation.slot) || allocation.slot! < 0
    || !Number.isSafeInteger(allocation.count) || allocation.count! < 2
    || allocation.slot! >= allocation.count! || allocation.count! > 65_536
    || !Number.isSafeInteger(allocation.clock) || allocation.clock! < 0
    || allocation.clock! > MAX_COLLABORATION_VERSION
    || !Number.isSafeInteger(allocation.sequence) || allocation.sequence! < 0
    || allocation.sequence! > MAX_COLLABORATION_VERSION
    || !ranges || ranges.length > 20_000
    || ranges.some(([key, range]) => !key || !range
      || !Number.isSafeInteger(range.base) || range.base <= 0
      || !Number.isSafeInteger(range.maximum) || range.maximum < range.base
      || range.maximum > MAX_ID
      || !Number.isSafeInteger(range.next) || !Number.isSafeInteger(range.end)
      || !Number.isSafeInteger(range.step) || range.step <= 0
      || range.next <= 0 || range.end <= 0 || range.end > range.maximum + 1
      || range.next > range.end + range.step - 1
      || (modularRange(key) ? (range.base !== allocation.slot! + 1
        || range.maximum !== MAX_ID || range.step !== allocation.count
        || range.end !== MAX_ID + 1
        || (range.next - range.base) % allocation.count! !== 0)
        : (() => {
          const capacity = Math.floor((range.maximum - range.base + 1) / allocation.count!);
          const start = range.base + allocation.slot! * capacity;
          const end = allocation.slot === allocation.count! - 1
            ? range.maximum + 1 : start + capacity;
          return capacity < 1 || range.step !== 1 || range.end !== end
            || range.next < start || range.next > end;
        })()))) {
    throw new Error(`${label}无效`);
  }
}

export function configureIdentityAllocation(
  identity: EditIdentity,
  replicaId: string,
  slot: number,
  count = 4096,
): void {
  const current = identity.allocation;
  if (current) {
    assertIdentityAllocation(current, '身份分配命名空间', identity.prefix);
    if (current.replicaId !== replicaId || current.slot !== slot || current.count !== count) {
      throw new Error('同一文档不能切换协同身份分配命名空间');
    }
    return;
  }
  identity.allocation = {
    replicaId, slot, count, prefix: `${identity.prefix}c${encodedReplica(replicaId)}_`,
    clock: 0, sequence: 0, ranges: {},
  };
}

export function ensureIdentityRange(
  identity: EditIdentity,
  key: string,
  first: number,
  maximum = MAX_ID,
): EditIdentityRange | null {
  const allocation = identity.allocation;
  if (!allocation) return null;
  const existing = allocation.ranges[key];
  if (existing) {
    if (modularRange(key)) {
      if (existing.base !== allocation.slot + 1 || existing.maximum !== MAX_ID
        || existing.step !== allocation.count || existing.end !== MAX_ID + 1
        || (existing.next - existing.base) % allocation.count !== 0) {
        throw new Error(`身份范围 ${key} 与当前副本分区不匹配`);
      }
      return existing;
    }
    // range.base 在绑定期已经固化；远端水位只抬高兼容 next*，不能重新定义本副本分区。
    const capacity = Math.floor((maximum - existing.base + 1) / allocation.count);
    const start = existing.base + allocation.slot * capacity;
    const end = allocation.slot === allocation.count - 1 ? maximum + 1 : start + capacity;
    if (existing.maximum !== maximum || existing.step !== 1
      || existing.end !== end || existing.next < start || existing.next > end) {
      throw new Error(`身份范围 ${key} 与当前副本分区不匹配`);
    }
    return existing;
  }
  if (!Number.isSafeInteger(first) || first <= 0 || first > maximum) {
    throw new Error(`身份范围 ${key} 已耗尽`);
  }
  const capacity = Math.floor((maximum - first + 1) / allocation.count);
  if (capacity < 1) throw new Error(`身份范围 ${key} 无法容纳协同副本`);
  const next = first + allocation.slot * capacity;
  const end = allocation.slot === allocation.count - 1 ? maximum + 1 : next + capacity;
  return allocation.ranges[key] = { base: first, maximum, next, end, step: 1 };
}

export function allocateIdentityRange(
  identity: EditIdentity,
  key: string,
  first: number,
  maximum = MAX_ID,
): number | null {
  const range = ensureIdentityRange(identity, key, first, maximum);
  if (!range) return null;
  if (range.next >= range.end) throw new Error(`身份范围 ${key} 已耗尽`);
  const allocated = range.next;
  range.next += range.step;
  return allocated;
}

export const logicalIdentityPrefix = (identity: EditIdentity): string =>
  identity.allocation?.prefix ?? identity.prefix;

/** 在编辑落模前调用；版本耗尽必须先拒绝事务，不能留下未广播的本地状态。 */
export function assertCollaborationVersionAvailable(identity: EditIdentity): void {
  const allocation = identity.allocation;
  if (allocation && (allocation.clock >= MAX_COLLABORATION_VERSION
    || allocation.sequence >= MAX_COLLABORATION_VERSION)) {
    throw new Error('协同逻辑时钟或消息序号已耗尽');
  }
}

/** Editor 在恢复帧取样前预留本地消息版本。 */
export function advanceCollaborationVersion(identity: EditIdentity): void {
  const allocation = identity.allocation;
  if (!allocation) return;
  assertCollaborationVersionAvailable(identity);
  allocation.clock++;
  allocation.sequence++;
}
