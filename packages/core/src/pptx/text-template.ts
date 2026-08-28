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
 * 正文常只出现少数级别，但 lstStyle 仍定义完整九级默认值。
 * 编辑解析预先构造九级模板，改级即可按 lvl 重基，无需让 edit-core 认识 OOXML。
 */
export function completeTextTemplateLevels(
  source: TextBody,
  env: TextEnv,
  preserveExisting = false,
): TextBody {
  const existing = new Map<number, Paragraph>();
  if (preserveExisting) {
    // 版式目录还承担换版式投影，目标占位符的提示段直设不能被纯 lvl 样式抹掉。
    for (const paragraph of source.paragraphs) {
      if (!existing.has(paragraph.lvl)) existing.set(paragraph.lvl, emptyParagraph(paragraph));
    }
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
