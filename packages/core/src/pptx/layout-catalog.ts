import type { SlideElement } from '../types';
import { attr, kid, kids } from '../xml';

export type LayoutRelationshipIndex = Record<string, { type: string; target: string }>;

const FIELD_PLACEHOLDERS = new Set(['dt', 'ftr', 'sldNum', 'hdr']);

/** 版式目录遵循母版声明顺序；part 去重避免畸形包把同一版式暴露两次。 */
export function layoutCatalogPaths(
  presentation: Element,
  presentationRelationships: LayoutRelationshipIndex,
  xml: (path: string) => Element | null,
  relationships: (path: string) => LayoutRelationshipIndex,
): string[] {
  const paths: string[] = [];
  for (const masterId of kids(kid(presentation, 'sldMasterIdLst'), 'sldMasterId')) {
    const masterRid = attr(masterId, 'r:id');
    const masterPath = masterRid ? presentationRelationships[masterRid]?.target : null;
    const masterRoot = masterPath ? xml(masterPath) : null;
    const masterRels = masterPath ? relationships(masterPath) : {};
    for (const layoutId of kids(kid(masterRoot, 'sldLayoutIdLst'), 'sldLayoutId')) {
      const rid = attr(layoutId, 'r:id');
      const part = rid ? masterRels[rid]?.target : null;
      if (part && !paths.includes(part)) paths.push(part);
    }
  }
  return paths;
}

/** 提示文字不是页面内容；字段保留动态语义，普通占位符只保留首段输入格式。 */
export function layoutPlaceholderTemplate(element: SlideElement): SlideElement | null {
  const placeholder = element.editInfo?.placeholder;
  if (!placeholder) return null;
  if (element.kind !== 'shape') return element;
  const sourceText = element.editInfo?.textTemplate ?? element.text ?? undefined;
  const firstParagraph = sourceText?.paragraphs[0];
  const textTemplate = sourceText && firstParagraph ? {
    ...sourceText,
    paragraphs: [{
      ...firstParagraph,
      runs: firstParagraph.runs.length
        ? [{ ...firstParagraph.runs[firstParagraph.runs.length - 1], text: '' }]
        : [],
    }],
  } : sourceText;
  return {
    ...element,
    text: FIELD_PLACEHOLDERS.has(placeholder.type) ? element.text : null,
    editInfo: { ...element.editInfo, ...(textTemplate ? { textTemplate } : {}) },
  };
}
