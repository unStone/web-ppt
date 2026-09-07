import type { TextBody } from '@web-ppt/core';
import { flattenTextBody } from '../text-flatten';
import { applyBodyProps } from '../body-properties';
import type { ParagraphBullet, TextOverride } from '../types';

function scaleBullet(bullet: ParagraphBullet | null | undefined, factor: number): ParagraphBullet | undefined {
  if (!bullet || bullet.kind === 'none' || bullet.size?.kind !== 'points') return undefined;
  return { ...bullet, size: { kind: 'points', value: bullet.size.value * factor } };
}

/** 修改直设值而非只改预览字号，避免保存重开后文字回到缩放前的大小。 */
export function scaleText(body: TextBody, before: TextOverride | undefined, factor: number): TextOverride {
  const initial = before?.kind === 'flat' ? before : flattenTextBody(body);
  const value = applyBodyProps(initial, {
    insets: body.insets.map((n) => n * factor) as [number, number, number, number],
    columnGap: (body.columnGap ?? 0) * factor,
  }, body.editInfo);
  if (before?.kind === 'empty') return {
    kind: 'empty', body: value.body, bodyOverrides: value.bodyOverrides,
  };
  return {
    ...value,
    paragraphs: value.paragraphs.map((paragraph, paragraphIndex) => {
      const p = body.paragraphs[paragraphIndex] ?? paragraph.props;
      const spacing = {
        spaceBefore: p.spaceBefore * factor, spaceAfter: p.spaceAfter * factor,
        marginLeft: p.marL * factor, indent: p.indent * factor,
      };
      const bullet = scaleBullet(paragraph.paragraphOverrides?.bullet ?? paragraph.sourceBullet, factor);
      return {
        ...paragraph,
        props: { ...paragraph.props, spaceBefore: spacing.spaceBefore, spaceAfter: spacing.spaceAfter,
          marL: spacing.marginLeft, indent: spacing.indent },
        paragraphOverrides: {
          ...paragraph.paragraphOverrides, ...spacing,
          // 来源绝对行距随字号一起缩放，写成当前比例避免保留旧的 spcPts。
          ...(p.lineHeight !== null ? { lineHeight: p.lineHeight } : {}),
          ...(bullet ? { bullet } : {}),
        },
        marks: paragraph.marks.map((mark, markIndex) => {
          // 母版/版式更改后，旧覆盖中的缓存字号可能过时；缩放当前有效投影。
          const run = body.paragraphs[paragraphIndex]?.runs[markIndex] ?? mark.props;
          const size = run.size * factor, spacing = (run.spacing ?? 0) * factor;
          return { ...mark,
            props: { ...mark.props, size, spacing },
            runOverrides: { ...mark.runOverrides, size, spacing },
          };
        }),
      };
    }),
  };
}
