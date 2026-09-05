import { MAX_PATCHES_PER_TRANSACTION } from './types';

export function assertPatchCount(count: number): void {
  if (count > MAX_PATCHES_PER_TRANSACTION) {
    throw new Error(`单个编辑事务不能超过 ${MAX_PATCHES_PER_TRANSACTION} 个补丁`);
  }
}
