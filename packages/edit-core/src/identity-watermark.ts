import type { EditIdentity } from './types';
import { assertIdentityAllocation } from './identity-allocation';

const validCounter = (value: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

export function assertEditIdentityWatermark(value: unknown): asserts value is EditIdentity {
  const identity = value as Partial<EditIdentity> | null;
  const optional = (counter: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) =>
    counter === undefined || validCounter(counter, minimum, maximum);
  if (!identity || typeof identity !== 'object' || typeof identity.prefix !== 'string' || !identity.prefix
    || !validCounter(identity.nextSlide) || !validCounter(identity.nextElement)
    || !identity.nextSpid || typeof identity.nextSpid !== 'object' || Array.isArray(identity.nextSpid)
    || Object.entries(identity.nextSpid).some(([part, counter]) => !part || !validCounter(counter))
    || !optional(identity.nextSlidePart) || !optional(identity.nextNotesPart)
    || !optional(identity.nextPresentationSlideId, 256, 0x8000_0000)
    || !optional(identity.nextPresentationRelationship)) {
    throw new Error('外部补丁的身份水位无效');
  }
  if (identity.allocation !== undefined) {
    assertIdentityAllocation(identity.allocation, '外部补丁的身份分配命名空间', identity.prefix);
  }
}

function mergeOptional(target: EditIdentity, source: EditIdentity, key: keyof EditIdentity): void {
  const incoming = source[key];
  if (typeof incoming !== 'number') return;
  const current = target[key];
  (target as unknown as Record<string, unknown>)[key] = typeof current === 'number'
    ? Math.max(current, incoming) : incoming;
}

/** 不同副本使用不同逻辑 id 前缀；只有 OPC 的全局数值水位需要跨副本取最大值。 */
export function mergeEditIdentityWatermark(target: EditIdentity, source: EditIdentity): void {
  if (target.prefix === source.prefix) {
    target.nextSlide = Math.max(target.nextSlide, source.nextSlide);
    target.nextElement = Math.max(target.nextElement, source.nextElement);
  }
  for (const [part, counter] of Object.entries(source.nextSpid)) {
    target.nextSpid[part] = Math.max(target.nextSpid[part] ?? 1, counter);
  }
  mergeOptional(target, source, 'nextSlidePart');
  mergeOptional(target, source, 'nextNotesPart');
  mergeOptional(target, source, 'nextPresentationSlideId');
  mergeOptional(target, source, 'nextPresentationRelationship');
}
