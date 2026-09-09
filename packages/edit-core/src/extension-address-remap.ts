export interface ExtensionIdentityRemap {
  readonly ids: Readonly<Record<string, string>>;
  readonly paths: readonly (readonly string[])[];
  readonly values: readonly (readonly string[])[];
  readonly prefix: string;
}

const safe = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 1024
  && !['__proto__', 'constructor', 'prototype'].includes(value);

export function assertIdentityRemap(value: unknown): asserts value is ExtensionIdentityRemap | undefined {
  if (value === undefined) return;
  const remap = value as ExtensionIdentityRemap;
  if (!remap || typeof remap !== 'object' || Array.isArray(remap)
    || Object.keys(remap).some(key => !['ids', 'paths', 'values', 'prefix'].includes(key))
    || !remap.ids || typeof remap.ids !== 'object' || Array.isArray(remap.ids)
    || Object.entries(remap.ids).some(([key, id]) => !safe(key) || !safe(id))
    || typeof remap.prefix !== 'string' || remap.prefix.length > 64
    || [remap.paths, remap.values].some(patterns => !Array.isArray(patterns) || patterns.length > 32
      || patterns.some(path => !Array.isArray(path) || !path.length || path.length > 16 || !path.every(safe)))) {
    throw new Error('扩展身份映射无效');
  }
}

const matches = (path: readonly string[], pattern: readonly string[]): boolean =>
  pattern.length <= path.length && pattern.every((key, index) => key === '*' || key === path[index]);
function mappedId(remap: ExtensionIdentityRemap, id: string): string {
  return Object.prototype.hasOwnProperty.call(remap.ids, id) ? remap.ids[id] : `${remap.prefix}${id}`;
}

/** 只改声明为身份的路径位置与标量引用，标签即使恰好等于 ID 也必须原样保存。 */
export function remapExtensionField(remap: ExtensionIdentityRemap | undefined, path: readonly string[], value?: unknown) {
  if (!remap) return { path, value };
  const result = [...path];
  for (const pattern of remap.paths) if (matches(path, pattern)) {
    const index = pattern.length - 1;
    result[index] = mappedId(remap, path[index]);
    if (!safe(result[index])) throw new Error('扩展迁移后的身份路径无效');
  }
  return { path: result, value: typeof value === 'string'
    && remap.values.some(pattern => pattern.length === path.length && matches(path, pattern))
    ? mappedId(remap, value) : value };
}

/** 合并只接受相等或互不相交的叶；缺少原时钟的矛盾值不能凭所有者顺序裁决。 */
export function mergeExtensionValue(target: unknown, source: unknown, remap?: ExtensionIdentityRemap): unknown {
  const result = target === undefined ? Object.create(null) as Record<string, unknown> : structuredClone(target);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('扩展迁移目标不是容器');
  const visit = (node: unknown, path: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('扩展迁移来源不是容器');
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object') { visit(value, [...path, key]); continue; }
      const mapped = remapExtensionField(remap, [...path, key], value);
      let at = result as Record<string, unknown>;
      for (const segment of mapped.path.slice(0, -1)) {
        at[segment] ??= Object.create(null);
        if (!at[segment] || typeof at[segment] !== 'object' || Array.isArray(at[segment])) throw new Error('扩展迁移字段冲突');
        at = at[segment] as Record<string, unknown>;
      }
      const leaf = mapped.path[mapped.path.length - 1];
      if (at[leaf] !== undefined && at[leaf] !== mapped.value) throw new Error('扩展迁移字段冲突');
      at[leaf] = mapped.value;
    }
  };
  if (source !== undefined) visit(source, []);
  return result;
}
