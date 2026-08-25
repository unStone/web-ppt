/** OOXML 与旧二进制格式最终都按这组语义等价类型绑定占位符。 */
export const PLACEHOLDER_TYPE_EQUIVALENTS: Readonly<Record<string, readonly string[]>> = {
  title: ['title', 'ctrTitle'], ctrTitle: ['ctrTitle', 'title'],
  body: ['body', 'subTitle', 'obj'], subTitle: ['subTitle', 'body'], obj: ['obj', 'body'],
};

export interface PlaceholderIdentity {
  readonly type?: string | null;
  readonly idx?: string | null;
}

/** OOXML 解析与编辑投影共用同一套 idx 优先、类型等价回退规则。 */
export function findPlaceholderByIdentity<T>(
  candidates: readonly T[],
  identityOf: (candidate: T) => PlaceholderIdentity | null | undefined,
  query: PlaceholderIdentity,
): T | undefined {
  const idx = query.idx ?? null;
  if (idx !== null) {
    const exact = candidates.find((candidate) => identityOf(candidate)?.idx === idx);
    if (exact) return exact;
  }
  const type = query.type ?? null;
  if (type) {
    for (const equivalent of PLACEHOLDER_TYPE_EQUIVALENTS[type] ?? [type]) {
      const matched = candidates.find((candidate) => identityOf(candidate)?.type === equivalent);
      if (matched) return matched;
    }
  }
  if (!type && idx === null) {
    return candidates.find((candidate) => identityOf(candidate)?.type === 'body');
  }
  return undefined;
}
