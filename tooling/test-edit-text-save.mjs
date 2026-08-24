/** 生成并重开基础文字编辑产物，供 LibreOffice 独立打开验证。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/edit-save');
mkdirSync(out, { recursive: true });
const aliases = [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
];
const core = await bundleBrowser({
  root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'text-core.mjs'),
});
const edit = await bundleBrowser({
  root, entry: join(root, 'packages/edit-core/src/index.ts'), output: join(out, 'text-edit.mjs'), aliases,
});
const source = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-text.pptx')));
const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
const doc = edit.createDoc(presentation, { idPrefix: 'text-save-' });
const editor = new edit.Editor(doc);
const byName = (name) => Object.values(doc.elements).find((record) => record.src.name === name);
const rich = byName('文本综合');
const empty = byName('空文本框');
const repeated = byName('重复格式');
const paragraphs = byName('段落格式');
editor.exec({
  type: 'EditText', id: rich.id,
  ops: [
    { type: 'replace', from: { p: 0, r: 1, off: 0 }, to: { p: 0, r: 1, off: 2 }, text: '纯 Web' },
    { type: 'splitParagraph', at: { p: 1, r: 0, off: 5 } },
  ],
});
editor.exec({
  type: 'SetRunProps', id: repeated.id,
  range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 2, off: 1 } },
  props: { font: 'Noto Sans', size: 31.2, b: true, i: true, u: true, strike: true },
});
editor.exec({
  type: 'SetRunProps', id: rich.id,
  range: { from: { p: 5, r: 0, off: 0 }, to: { p: 5, r: 0, off: 1 } },
  props: { b: true, size: 28 },
});
editor.exec({
  type: 'SetParaProps', id: rich.id,
  range: { from: { p: 1, r: 0, off: 1 }, to: { p: 5, r: 0, off: 1 } },
  props: { spaceAfter: 11, marginLeft: 19 },
});
editor.exec({
  type: 'SetParaProps', id: paragraphs.id,
  range: { from: { p: 0, r: 0, off: 1 }, to: { p: 2, r: 0, off: 0 } },
  props: {
    align: 'left', lineHeight: 2.1, spaceBefore: 14, spaceAfter: 7,
    marginLeft: 30, indent: -12,
  },
});
editor.exec({
  type: 'EditText', id: empty.id,
  ops: [{
    type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '从空白开始编辑',
  }],
});
const saved = await editor.save();
const path = join(out, 'basic-text-editing.pptx');
writeFileSync(path, saved);
const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
const plain = (element) => element.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';
const reopenedRich = reopened.slides[0].elements.find((element) => element.name === '文本综合');
const reopenedEmpty = reopened.slides[0].elements.find((element) => element.name === '空文本框');
const reopenedRepeated = reopened.slides[0].elements.find((element) => element.name === '重复格式');
const reopenedParagraphs = reopened.slides[0].elements.find((element) => element.name === '段落格式');
const slideXml = new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']);
if (!plain(reopenedRich).includes('纯 Web') || plain(reopenedEmpty) !== '从空白开始编辑'
  || !reopenedRich.text.paragraphs.slice(1, 3).every((paragraph) => paragraph.rtl)
  || !reopenedRich.text.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.math?.length))
  || !reopenedRich.text.paragraphs.slice(1).every((paragraph) =>
    paragraph.spaceAfter === 11 && paragraph.marL === 19)
  || !reopenedParagraphs.text.paragraphs.slice(0, 3).every((paragraph) => paragraph.align === 'left'
    && paragraph.lineHeight === 2.1 && paragraph.spaceBefore === 14 && paragraph.spaceAfter === 7
    && paragraph.marL === 30 && paragraph.indent === -12)
  || reopenedParagraphs.text.paragraphs[3].align !== 'right'
  || !reopenedRepeated.text.paragraphs[0].runs.every((run) => run.fonts[0] === 'Noto Sans'
    && Math.abs(run.size - 31.2) < 1e-9 && run.b && run.i && run.u && run.strike)
  || !reopenedRich.text.paragraphs[5].runs[0].b || reopenedRich.text.paragraphs[5].runs[0].size !== 28
  || !slideXml.includes('x:keep="spacing"')
  || !slideXml.includes('<!--unselected-ppr:  keep-->')
  || !slideXml.includes('<a:fld') || (slideXml.match(/typeface="Noto Sans"/g) ?? []).length !== 9) {
  throw new Error('基础文字编辑产物保存重开不一致');
}
edit.disposeDoc(doc);
console.log(`\n\x1b[32m✓ 基础文字编辑产物保存重开通过：${path}\x1b[0m`);
