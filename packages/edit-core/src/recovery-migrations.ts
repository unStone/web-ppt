import type { RecoveryFrame } from './recovery-types';
import { isExtensionMigrationPatch, readExtensionMigration } from './extension-migration-receipt';

/** 凭据到达前保留旧来源；实际路由、清源与赢家均在原日志位置执行。 */
export function recoveryMigrationSources(frames: readonly RecoveryFrame[]): ReadonlySet<string> {
  const declared = new Map<string, string>();
  for (const frame of frames) {
    if (!Array.isArray(frame?.patches)) continue;
    for (const patch of frame.patches) {
      if (!Array.isArray(patch?.path) || !isExtensionMigrationPatch(patch)) continue;
      const receipt = readExtensionMigration(patch.op === 'set' ? patch.value : undefined);
      for (const route of receipt.routes) {
        const key = JSON.stringify(route.source), previous = declared.get(key);
        if (previous === route.address) continue;
        if (previous !== undefined) throw new Error('恢复日志不能重新指定扩展地址');
        declared.set(key, route.address);
      }
    }
  }
  return new Set(declared.keys());
}
