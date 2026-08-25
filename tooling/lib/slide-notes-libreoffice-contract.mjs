import { roundtripSlideNotes } from './libreoffice-slide-roundtrip.mjs';

/** LibreOffice 独立证明正文编辑不改变四页 notes 归属。 */
export function runSlideNotesLibreOfficeContract({ savedPath, out, root, soffice }) {
  const { slideParts, noteParts, notes } = roundtripSlideNotes({
    savedPath, out, root, soffice, name: 'slide-notes',
  });
  const expected = ['第一段第三段', '页面2的独立备注', '页面3的独立备注'];
  if (slideParts.length !== 4 || new Set(noteParts).size !== 4
    || expected.some((text, index) => !notes[index]?.includes(text))) {
    throw new Error(`LibreOffice 演讲者备注归属无效：${noteParts.join(' → ')}`);
  }
  return '，4 页 notes 正文与页面归属 roundtrip 一致';
}
