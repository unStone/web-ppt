import { textRunDirectFlags } from '../edit-metadata';
import type { Paragraph, TextBody } from '../types';
import { resolveParagraphLevel } from './paragraph-props';
import { finalizeRun } from './text';
import type { TextEnv } from './text';
import { materializeParagraph } from './text-materialization';

function emptyParagraph(paragraph: Paragraph): Paragraph {
  return {
    ...paragraph,
    runs: paragraph.runs.length
      ? [{ ...paragraph.runs[paragraph.runs.length - 1], text: '' }]
      : [],
  };
}

/**
 * 版式常只放一级提示文字，但 lstStyle 仍定义完整九级默认值。
 * 目录只构造一次九级模板，页面切换时即可按 lvl 重基，无需保留 OOXML。
 */
export function completeTextTemplateLevels(source: TextBody, env: TextEnv): TextBody {
  const existing = new Map<number, Paragraph>();
  for (const paragraph of source.paragraphs) {
    if (!existing.has(paragraph.lvl)) existing.set(paragraph.lvl, emptyParagraph(paragraph));
  }
  const counters: number[] = [];
  const paragraphs = Array.from({ length: 9 }, (_, lvl): Paragraph => {
    const paragraph = existing.get(lvl);
    if (paragraph) return paragraph;
    const resolved = resolveParagraphLevel(env.chain, lvl);
    const run = finalizeRun('', resolved.rp, env, resolved.rp);
    return materializeParagraph({
      lvl,
      resolved,
      inherited: resolved,
      direct: { rp: {} },
      directRun: textRunDirectFlags(0),
      runs: [run],
      counters,
      lnSpcReduction: source.lnSpcReduction ?? 0,
      env,
    });
  });
  return { ...source, paragraphs };
}
