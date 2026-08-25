import type { SlideElement, TextBody } from '@web-ppt/core';

const DYNAMIC_LINK = /^(?:slide:(?:next|previous|first|last)|slide-part:)/;

export const isDynamicSlideLink = (link: string | undefined): boolean =>
  !!link && DYNAMIC_LINK.test(link);

function textHasDynamicLink(text: TextBody | null): boolean {
  return !!text?.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => isDynamicSlideLink(run.link)));
}

function textHasDynamicSlideNumber(text: TextBody | null): boolean {
  return !!text?.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => run.field?.toLowerCase() === 'slidenum'));
}

/** 组后代有独立记录和索引；字段身份来自内容，不依赖可选的页码占位符元数据。 */
export function hasDynamicSlideNumber(element: SlideElement): boolean {
  if (element.kind === 'shape') return textHasDynamicSlideNumber(element.text);
  if (element.kind === 'table') {
    return element.rows.some((row) => row.cells.some((cell) => textHasDynamicSlideNumber(cell.text)));
  }
  return false;
}

/** 组后代有独立记录和索引；这里只判断当前记录自身承载的跳转。 */
export function hasDynamicSlideLink(element: SlideElement): boolean {
  if (isDynamicSlideLink(element.link)) return true;
  if (element.kind === 'shape') return textHasDynamicLink(element.text);
  if (element.kind === 'table') {
    return element.rows.some((row) => row.cells.some((cell) => textHasDynamicLink(cell.text)));
  }
  return false;
}
