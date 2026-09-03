import type { Fill, Paragraph, Slide, SlideElement, TextBody, TextRun } from '@web-ppt/core';
import { own } from '../data-validation';
import { masterTextStyleStates } from '../master-text-style-state';
import { runProperties } from '../run-style';
import { patchMasterProperties } from '../save/master-properties';
import { sourceParagraphBullet } from '../text-flatten';
import type {
  EditDoc, MasterParagraphPropertyOverrides, MasterRecord, MasterRunPropertyOverrides,
  MasterTextStyleOverrides, ParagraphBullet,
} from '../types';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';

const MASTER_PART = 'ppt/slideMasters/slideMaster1.xml';

function textBodies(elements: readonly SlideElement[]): TextBody[] {
  return elements.flatMap((element): TextBody[] => [
    ...(element.kind === 'shape' && element.text ? [element.text] : []),
    ...(element.kind === 'table' ? element.rows.flatMap((row) =>
      row.cells.flatMap((cell) => cell.text ? [cell.text] : [])) : []),
    ...(element.kind === 'group' ? textBodies(element.children) : []),
  ]);
}

function firstRun(paragraph: Paragraph): TextRun {
  return paragraph.runs[paragraph.runs.length - 1] ?? {
    text: '', b: false, i: false, u: false, strike: false,
    size: 18, color: 'rgb(0,0,0)', fonts: [],
  };
}

function bulletOf(paragraph: Paragraph): ParagraphBullet {
  const source = sourceParagraphBullet(paragraph.editInfo?.bullet);
  if (source?.kind === 'blip') return { kind: 'none' };
  if (source) return source;
  return paragraph.bullet === null
    ? { kind: 'none' } : { kind: 'char', char: paragraph.bullet };
}

function paragraphOverrides(paragraph: Paragraph): MasterParagraphPropertyOverrides {
  return {
    align: paragraph.align,
    lineHeight: paragraph.lineHeight,
    spaceBefore: paragraph.spaceBefore,
    spaceAfter: paragraph.spaceAfter,
    marginLeft: paragraph.marL,
    indent: paragraph.indent,
    bullet: bulletOf(paragraph),
  };
}

function runOverrides(paragraph: Paragraph): MasterRunPropertyOverrides {
  return runProperties(firstRun(paragraph));
}

function levelsFromBody(body: TextBody): NonNullable<MasterTextStyleOverrides['body']> {
  const fallback = body.paragraphs[0];
  if (!fallback) throw new Error('生成母版文字默认值缺少段落来源');
  return Object.fromEntries(Array.from({ length: 9 }, (_, level) => {
    const paragraph = body.paragraphs.find((candidate) => candidate.lvl === level) ?? fallback;
    return [level, { paragraph: paragraphOverrides(paragraph), run: runOverrides(paragraph) }];
  }));
}

function fallbackBody(): TextBody {
  return {
    anchor: 'top', insets: [0, 0, 0, 0], wrap: true, fontScale: 1,
    paragraphs: [{
      align: 'left', lvl: 0, marL: 0, indent: 0, bullet: null,
      lineHeight: null, spaceBefore: 0, spaceAfter: 0,
      runs: [firstRun({ runs: [] } as unknown as Paragraph)],
    }],
  };
}

function inferredTextStyles(slides: readonly Slide[]): MasterTextStyleOverrides {
  const bodies = slides.flatMap((slide) => textBodies(slide.elements));
  const fallback = bodies[0] ?? fallbackBody();
  const ranked = [...bodies].sort((left, right) => {
    const size = (body: TextBody) => Math.max(0, ...body.paragraphs.flatMap((paragraph) =>
      paragraph.runs.map((run) => run.size)));
    return size(right) - size(left);
  });
  const title = ranked[0] ?? fallback;
  const body = bodies.find((candidate) => candidate.paragraphs.length > 1)
    ?? ranked.find((candidate) => candidate !== title) ?? fallback;
  return {
    title: levelsFromBody(title),
    body: levelsFromBody(body),
    other: levelsFromBody(fallback),
  };
}

function effectiveTextStyles(doc: EditDoc, masterId: string): MasterTextStyleOverrides {
  const states = masterTextStyleStates(doc, masterId);
  return Object.fromEntries(Object.entries(states).map(([category, levels]) => [
    category,
    Object.fromEntries(levels.map((level) => {
      const { level: _level, ...paragraph } = level.value.paragraph;
      return [level.level, { paragraph, run: level.value.run }];
    })),
  ])) as MasterTextStyleOverrides;
}

/** 生成包仍用固定单母版，但必须把当前有效设计默认值写入该母版，而不是输出空壳。 */
export function materializeGeneratedMasterDefaults(
  doc: EditDoc,
  slides: readonly Slide[],
  parts: Record<string, Uint8Array>,
): void {
  const firstLayout = doc.slides[doc.slideOrder[0]]?.layoutId;
  const masterId = firstLayout ? doc.layouts[firstLayout]?.origin.masterPart : doc.masterOrder[0];
  const master = masterId ? doc.masters[masterId] : undefined;
  const background = (master
    ? own(master.ovr, 'background') ? master.ovr.background! : master.background
    : slides[0]?.background) as Fill | null | undefined;
  const vectorBackground = background?.type === 'image'
    ? undefined : background === null ? { type: 'none' as const } : background;
  const tree = parseXmlTree(parts[MASTER_PART]);
  patchMasterProperties(tree, {
    id: MASTER_PART,
    ovr: {
      ...(vectorBackground ? { background: vectorBackground } : {}),
      textStyles: master ? effectiveTextStyles(doc, master.id) : inferredTextStyles(slides),
    },
  } as MasterRecord);
  parts[MASTER_PART] = serializeXmlTreeBytes(tree);
}
