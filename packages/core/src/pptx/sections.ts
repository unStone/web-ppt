import type { Section } from '../types';
import { attr, kid, kids, numAttr } from '../xml';

/** p:extLst → p14:sectionLst；slideIds 为 p:sldId@id，同时给出对应页序号。 */
export function parseSections(presRoot: Element, idToIndex: Map<number, number>): Section[] {
  const out: Section[] = [];
  const all = presRoot.getElementsByTagName('*');
  for (let index = 0; index < all.length; index++) {
    if (all[index].localName !== 'sectionLst') continue;
    for (const section of kids(all[index], 'section')) {
      const slideIds: number[] = [];
      const slideIndexes: number[] = [];
      for (const slide of kids(kid(section, 'sldIdLst'), 'sldId')) {
        const id = numAttr(slide, 'id');
        if (id === null) continue;
        slideIds.push(id);
        const at = idToIndex.get(id);
        if (at !== undefined) slideIndexes.push(at);
      }
      const id = attr(section, 'id');
      out.push({
        name: attr(section, 'name') ?? `节 ${out.length + 1}`,
        slideIds,
        slideIndexes,
        ...(id === null ? {} : { id }),
      });
    }
    break;
  }
  return out;
}
