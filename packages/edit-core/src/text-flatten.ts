import type { Paragraph, TextBody, TextRun } from '@web-ppt/core';
import type { ParagraphBullet, TextMark, TextOverride } from './types';
import { TEXT_ATOM } from './text-position';
import { runProperties } from './run-style';

function runProps(run: TextRun): Omit<TextRun, 'text'> {
  const { text: _text, editInfo: _editInfo, ...props } = run;
  return props;
}

function paragraphProps(paragraph: Paragraph): Omit<Paragraph, 'runs'> {
  const { runs: _runs, editInfo: _editInfo, ...props } = paragraph;
  return props;
}

function sourceInheritedRunProps(run: TextRun): NonNullable<TextRun['editInfo']>['inheritedRunProps'] {
  if (run.editInfo?.inheritedRunProps) return run.editInfo.inheritedRunProps;
  return {
    b: run.b, i: run.i, u: run.u, strike: run.strike,
    ...(run.underline ? { underline: run.underline } : {}),
    ...(run.strikeType ? { strikeType: run.strikeType } : {}),
    size: run.size, color: run.color, fonts: [...run.fonts],
    baseline: run.baseline, spacing: run.spacing, caps: run.caps,
    outline: run.outline, gradient: run.gradient, highlight: run.highlight,
    underlineColor: run.underlineColor,
  };
}

export function sourceParagraphBullet(
  value: NonNullable<Paragraph['editInfo']>['bullet'] | undefined,
): ParagraphBullet | undefined {
  if (!value) return undefined;
  if (value.kind === 'none') return value;
  const style = {
    ...(value.color !== undefined ? { color: value.color } : {}),
    ...(value.font !== undefined ? { font: value.font } : {}),
    ...(value.size !== undefined ? { size: value.size } : {}),
  };
  if (value.kind === 'image') {
    return value.src ? { kind: 'blip', image: { src: value.src }, ...style } : undefined;
  }
  if (value.kind === 'char') return { kind: 'char', char: value.char, ...style };
  return {
    kind: 'autoNum', type: value.type as import('./types').ParagraphAutoNumberType,
    startAt: value.startAt, ...style,
  };
}

export function flattenTextBody(body: TextBody): Extract<TextOverride, { kind: 'flat' }> {
  // editInfo 是只读来源事实；覆盖层只保存用户结果，防止历史与远端 patch 伪造继承来源。
  const { paragraphs: _paragraphs, editInfo: _editInfo, ...bodyProps } = body;
  return {
    kind: 'flat',
    body: bodyProps,
    paragraphs: body.paragraphs.map((paragraph, paragraphIndex) => {
      let offset = 0;
      const marks = paragraph.runs.map((run, runIndex): TextMark => {
        const text = run.math?.length ? TEXT_ATOM : run.text;
        const from = offset;
        offset += text.length;
        const inheritedRunProps = sourceInheritedRunProps(run);
        return {
          from, to: offset, props: runProps(run),
          inheritedProps: runProperties(inheritedRunProps),
          inheritedRunProps,
          inheritedFonts: inheritedRunProps.fonts,
          inheritedFontSlots: run.editInfo?.inheritedFontSlots,
          ...(run.editInfo?.readonlyLink ? { sourceLinkReadonly: true } : {}),
          ...(run.math?.length ? { atomText: run.text } : {}),
          source: { paragraph: paragraphIndex, run: runIndex },
          preserveSource: true,
        };
      });
      return {
        text: paragraph.runs.map((run) => run.math?.length ? TEXT_ATOM : run.text).join(''),
        props: paragraphProps(paragraph), marks, sourceParagraph: paragraphIndex,
        inheritedParagraphProps: paragraph.editInfo?.inheritedParagraphProps,
        directParagraphProps: paragraph.editInfo?.directParagraphProps,
        sourceBullet: sourceParagraphBullet(paragraph.editInfo?.bullet),
        inheritedBullet: sourceParagraphBullet(paragraph.editInfo?.inheritedBullet),
      };
    }),
  };
}
