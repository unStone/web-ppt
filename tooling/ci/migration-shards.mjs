export const MIGRATION_SHARDS = 2;
export const MIGRATION_SCRIPT = 'tooling/test-chart-shared-legacy-migration.mjs';

export function selectMigrationCases(names, index, total) {
  if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== 'string' || !name)
    || new Set(names).size !== names.length) throw new Error('迁移用例清单必须非空且名称不能重复');
  if (!Number.isInteger(index) || ![1, MIGRATION_SHARDS].includes(total) || index < 0 || index >= total) {
    throw new Error(`无效迁移分片 ${index}/${total}；仅支持完整执行或两个完整覆盖的分片`);
  }
  if (total === 1) return [...names];
  if (!names.includes('legacy-shapes')) throw new Error('迁移分片缺少独立的 legacy-shapes 用例');
  // 该用例还会串行启动形状矩阵冷恢复进程，独立执行才能平衡两台 runner 的耗时。
  return names.filter((name) => index === 0 ? name === 'legacy-shapes' : name !== 'legacy-shapes');
}
