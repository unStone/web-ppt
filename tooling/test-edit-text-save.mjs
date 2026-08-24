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
editor.exec({
  type: 'EditText', id: rich.id,
  ops: [
    { type: 'replace', from: { p: 0, r: 1, off: 0 }, to: { p: 0, r: 1, off: 2 }, text: '纯 Web' },
    { type: 'splitParagraph', at: { p: 1, r: 0, off: 5 } },
  ],
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
if (!plain(reopenedRich).includes('纯 Web') || plain(reopenedEmpty) !== '从空白开始编辑'
  || !reopenedRich.text.paragraphs.slice(1, 3).every((paragraph) => paragraph.rtl)
  || !reopenedRich.text.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.math?.length))
  || !new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']).includes('<a:fld')) {
  throw new Error('基础文字编辑产物保存重开不一致');
}
edit.disposeDoc(doc);
console.log(`\n\x1b[32m✓ 基础文字编辑产物保存重开通过：${path}\x1b[0m`);
