import { canonicalExtensionMigrationInputs, isExtensionMigrationPatch, readExtensionMigration } from '@web-ppt/edit-core';
import type { EditDoc, Patch } from '@web-ppt/edit-core';
import { compareStamp } from '../message';
import type { Register } from '../state';
import { evidence } from './evidence';

/** 迁移元数据的运输时钟不能覆盖赢家原时钟；寄存器对象替换仍随基础事务快照一起回滚。 */
export function recordReceiptWinners(doc: EditDoc, registers: Map<string, Register>, patches: readonly Patch[]): void {
  for (const patch of patches.filter(isExtensionMigrationPatch)) {
    const receipt = readExtensionMigration(patch.op === 'set' ? patch.value : undefined);
    const inputs = canonicalExtensionMigrationInputs(doc, receipt);
    for (const input of [...receipt.inputs, ...receipt.winners.map(index => inputs[index])]) {
      const key = JSON.stringify(input.path), previous = registers.get(key);
      if (!input.stamp || previous && compareStamp(input.stamp, previous.stamp) < 0) continue;
      const register: Register = { stamp: input.stamp, kind: 'field' };
      const operation = input.op === 'del' ? { op: 'del' as const } : { op: 'set' as const, value: input.value! };
      registers.set(key, register); evidence.set(register, operation);
    }
  }
}
