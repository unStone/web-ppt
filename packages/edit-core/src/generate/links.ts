import { sourceLinkValue } from '../hyperlink';
import type { EditDoc, LinkOverride, SlideId } from '../types';

/** 相对跳转在生成包里固定到当前最终页序，避免依赖已经不存在的来源关系。 */
export function generatedLink(
  doc: EditDoc,
  slideId: SlideId,
  value: string | undefined,
  label: string,
): LinkOverride | undefined {
  const source = sourceLinkValue(doc, value);
  if (!source) return undefined;
  if (source.kind === 'external' || source.kind === 'slide') return source;
  if (source.kind === 'unsupported') throw new Error(`${label} 的来源链接无法生成`);
  const index = doc.slideOrder.indexOf(slideId);
  const target = source.action === 'first' ? 0
    : source.action === 'last' ? doc.slideOrder.length - 1
      : source.action === 'next' ? Math.min(index + 1, doc.slideOrder.length - 1)
        : Math.max(index - 1, 0);
  const targetId = doc.slideOrder[target];
  return targetId ? { kind: 'slide', slideId: targetId } : undefined;
}
