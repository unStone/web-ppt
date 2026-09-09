import type { EditDoc } from './types';
import type { Patch } from './commands/types';
import { assertPatchCount } from './commands/patch-count';
import { extensionAddressPatches, isExtensionAddressPatch } from './extension-addresses';
import { extensionMigrationReceipts, isExtensionMigrationPatch } from './extension-migration-receipt';

const metadata = (patch: Patch): boolean => isExtensionAddressPatch(patch) || isExtensionMigrationPatch(patch);

/** 每个日志独立声明地址；预检只读，失败事务不能消耗下次声明的机会。 */
export class ExtensionAddressJournal {
  private readonly declared = new Map<string, unknown>();

  reset(): void { this.declared.clear(); }

  prepare(doc: EditDoc, patches: readonly Patch[], origin: string): readonly Patch[] {
    const explicit = new Map<string, unknown>();
    for (const patch of patches) {
      if (!metadata(patch)) break;
      if (patch.op === 'set') explicit.set(JSON.stringify(patch.path), patch.value);
    }
    const addresses = [...extensionMigrationReceipts(doc, origin), ...extensionAddressPatches(doc, origin)].filter(patch => {
      const key = JSON.stringify(patch.path);
      const value = patch.op === 'set' ? patch.value : undefined;
      return this.declared.get(key) !== value && explicit.get(key) !== value;
    });
    assertPatchCount(addresses.length + patches.length);
    if (!addresses.length) return patches;
    // 未宣布的当前状态先补齐；随后严格保留调用方次序，包括延迟组中的字段→新凭据。
    return [...addresses.filter(isExtensionMigrationPatch), ...addresses.filter(isExtensionAddressPatch), ...patches];
  }

  record(patches: readonly Patch[]): void {
    for (const patch of patches) if (metadata(patch) && patch.op === 'set') this.declared.set(JSON.stringify(patch.path), patch.value);
  }
}
