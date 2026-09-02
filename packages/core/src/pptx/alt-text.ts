import type { ElementBase } from '../types';
import { attr } from '../xml';

type ElementAltText = NonNullable<NonNullable<ElementBase['editInfo']>['altText']>;

/** cNvPr 的 title/descr 各自可缺省，不能把空字符串误当成未声明。 */
export function parseElementAltText(cNvPr: Element | null): ElementAltText | undefined {
  const title = attr(cNvPr, 'title');
  const descr = attr(cNvPr, 'descr');
  if (title === null && descr === null) return undefined;
  return {
    ...(title === null ? {} : { title }),
    ...(descr === null ? {} : { descr }),
  };
}
