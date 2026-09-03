import type { MasterTextCategory, Paragraph, SlideMasterTemplate, TextRun } from '@web-ppt/core';
import { runProperties } from './run-style';
import { sourceParagraphBullet } from './text-flatten';
import type {
  EditDoc, MasterParagraphPropertyOverrides, MasterParagraphStyle, MasterRunPropertyOverrides,
  MasterTextLevelState, ParagraphBullet, RunProperties,
} from './types';

const CATEGORIES = ['title', 'body', 'other'] as const satisfies readonly MasterTextCategory[];

function paragraphStyle(paragraph: Paragraph, level: number): MasterParagraphStyle {
  return {
    level,
    align: paragraph.align,
    lineHeight: paragraph.lineHeight,
    spaceBefore: paragraph.spaceBefore,
    spaceAfter: paragraph.spaceAfter,
    marginLeft: paragraph.marL,
    indent: paragraph.indent,
    bullet: sourceParagraphBullet(paragraph.editInfo?.bullet) ?? { kind: 'none' },
  };
}

function applyParagraph(
  source: MasterParagraphStyle,
  overrides?: MasterParagraphPropertyOverrides,
): MasterParagraphStyle {
  if (!overrides) return structuredClone(source);
  const value = structuredClone(source) as MasterParagraphStyle & Record<string, unknown>;
  const mutable = value as Record<string, unknown>;
  for (const [field, next] of Object.entries(overrides)) {
    if (field === 'bullet') mutable[field] = structuredClone(next as ParagraphBullet);
    else mutable[field] = next;
  }
  return value;
}

function applyRun(source: RunProperties, overrides?: MasterRunPropertyOverrides): RunProperties {
  if (!overrides) return structuredClone(source);
  const value = structuredClone(source) as RunProperties & Record<string, unknown>;
  const mutable = value as Record<string, unknown>;
  for (const [field, next] of Object.entries(overrides)) {
    if (field === 'u') {
      mutable[field] = next as boolean;
      mutable.underline = next ? 'sng' : 'none';
    } else if (field === 'underline') {
      mutable.underline = next as RunProperties['underline'];
      mutable.u = next !== 'none';
    } else if (field === 'strike') {
      mutable.strike = next as boolean;
      mutable.strikeType = next ? 'sngStrike' : 'noStrike';
    } else if (field === 'strikeType') {
      mutable.strikeType = next as RunProperties['strikeType'];
      mutable.strike = next !== 'noStrike';
    } else mutable[field] = next;
  }
  return value;
}

function levelState(
  doc: EditDoc,
  masterId: string,
  category: MasterTextCategory,
  level: number,
  resolved?: SlideMasterTemplate | null,
): MasterTextLevelState {
  const master = doc.masters[masterId];
  const sourceParagraph = master.textStyles[category].paragraphs[level];
  const sourceRun = sourceParagraph?.runs[sourceParagraph.runs.length - 1] as TextRun | undefined;
  const valueParagraph = resolved?.textStyles[category].paragraphs[level] ?? sourceParagraph;
  const valueRun = valueParagraph?.runs[valueParagraph.runs.length - 1] as TextRun | undefined;
  if (!sourceParagraph || !sourceRun || !valueParagraph || !valueRun) {
    throw new Error(`母版 ${masterId} 的 ${category} 第 ${level + 1} 级来源不完整`);
  }
  const source = { paragraph: paragraphStyle(sourceParagraph, level), run: runProperties(sourceRun) };
  const resolvedValue = { paragraph: paragraphStyle(valueParagraph, level), run: runProperties(valueRun) };
  const overrides = master.ovr.textStyles?.[category]?.[level];
  return {
    level,
    source: structuredClone(source),
    value: resolved ? structuredClone(resolvedValue) : {
      paragraph: applyParagraph(source.paragraph, overrides?.paragraph),
      run: applyRun(source.run, overrides?.run),
    },
    direct: {
      paragraph: Object.keys(overrides?.paragraph ?? {}) as MasterTextLevelState['direct']['paragraph'],
      run: Object.keys(overrides?.run ?? {}) as MasterTextLevelState['direct']['run'],
    },
  };
}

export function masterTextStyleStates(
  doc: EditDoc,
  masterId: string,
  resolved?: SlideMasterTemplate | null,
): Readonly<Record<MasterTextCategory, readonly MasterTextLevelState[]>> {
  return Object.fromEntries(CATEGORIES.map((category) => [
    category,
    Array.from({ length: 9 }, (_, level) => levelState(doc, masterId, category, level, resolved)),
  ])) as unknown as Readonly<Record<MasterTextCategory, readonly MasterTextLevelState[]>>;
}
