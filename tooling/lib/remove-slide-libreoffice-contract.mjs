import { roundtripSlideNotes } from './libreoffice-slide-roundtrip.mjs';

/** 由 LibreOffice roundtrip 独立证明删除后的页面顺序、渲染与 notes 归属。 */
export function runRemoveSlideLibreOfficeContract({
  savedPath, pages, out, root, soffice, exportSvg,
}) {
  const markup = exportSvg('删除页顺序与页码');
  const titleNumber = (value) => new RegExp(
    `可删除页面 </tspan><tspan[^>]*>${value}</tspan>`,
  ).test(markup);
  if ((markup.match(/可删除页面 <\/tspan>/g) ?? []).length !== 3
    || ![1, 3, 4].every(titleNumber) || titleNumber(2) || pages !== 3) {
    throw new Error('LibreOffice 删除页 SVG 仍含被删页面或丢失存活页');
  }

  const { slideParts, notes } = roundtripSlideNotes({
    savedPath, out, root, soffice, name: 'remove-slide',
  });
  const expectedNotes = ['页面1的独立备注', '页面3的独立备注', '页面4的独立备注'];
  if (slideParts.length !== 3
    || expectedNotes.some((text, index) => !notes[index]?.includes(text))
    || notes.some((text) => text.includes('页面2的独立备注'))) {
    throw new Error(`LibreOffice 删除页 notes 归属无效：${slideParts.join(' → ')}`);
  }
  return '，删除页 3 页顺序/渲染与 notes 归属 roundtrip 一致';
}
