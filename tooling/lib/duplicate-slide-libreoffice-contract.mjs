import { roundtripSlideNotes } from './libreoffice-slide-roundtrip.mjs';

/** LibreOffice 独立证明副本页序、渲染与 notes 一页一身份。 */
export function runDuplicateSlideLibreOfficeContract({
  savedPath, pages, out, root, soffice, exportSvg,
}) {
  const markup = exportSvg('复制页顺序与页码');
  const titleNumbers = [...markup.matchAll(
    /可删除页面 <\/tspan><tspan[^>]*>([1-4])<\/tspan>/g,
  )].map((match) => Number(match[1]));
  if (pages !== 5 || titleNumbers.join(',') !== '1,2,2,3,4') {
    throw new Error(`LibreOffice 复制页 SVG 顺序无效：${titleNumbers.join(' → ')}`);
  }
  const { slideParts, noteParts, notes } = roundtripSlideNotes({
    savedPath, out, root, soffice, name: 'duplicate-slide',
  });
  const expectedNotes = [
    '页面1的独立备注', '页面2的独立备注', '页面2的独立备注',
    '页面3的独立备注', '页面4的独立备注',
  ];
  if (slideParts.length !== 5
    || expectedNotes.some((text, index) => !notes[index]?.includes(text))
    || !noteParts[1] || !noteParts[2] || noteParts[1] === noteParts[2]) {
    throw new Error(`LibreOffice 复制页 notes 归属无效：${noteParts.join(' → ')}`);
  }
  return '，复制页 5 页顺序/渲染与独立 notes roundtrip 一致';
}
