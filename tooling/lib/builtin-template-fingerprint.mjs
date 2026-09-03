/** 模板即时投影与保存产物各自在干净进程中计算两条文字路径指纹。 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installDomEnv } from './dom-env.mjs';

const [corePath, editPath, file, mode] = process.argv.slice(2);
if (!corePath || !editPath || !file || !['projected', 'saved'].includes(mode)) {
  console.error('用法: node builtin-template-fingerprint.mjs <core.mjs> <edit.mjs> <file> <projected|saved>');
  process.exit(2);
}

installDomEnv();
const core = await import(`${pathToFileURL(corePath).href}?template=${process.pid}`);
const edit = await import(`${pathToFileURL(editPath).href}?template=${process.pid}`);
const presentation = await core.parse(new Uint8Array(readFileSync(file)), {
  edit: true, keepPackage: true, lazy: false, assets: 'defer',
});
const doc = edit.createDoc(presentation, { idPrefix: 'template-fingerprint-' });
const editor = new edit.Editor(doc);
if (mode === 'projected') {
  const title = doc.slides[doc.slideOrder[0]].children.map((id) => doc.elements[id])
    .find((record) => record.meta.ph?.type === 'ctrTitle');
  if (!title) throw new Error('模板指纹找不到标题占位符');
  editor.exec({
    type: 'EditText', id: title.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '内置模板可编辑',
    }],
  });
}
const slide = editor.toSlide(doc.slideOrder[0]);
const visual = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(visual);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'id' && key !== 'editInfo' && key !== 'name')
    .map(([key, child]) => [key, visual(child)]));
};
const result = {};
for (const textMode of ['html', 'svg']) {
  const svg = core.renderSlideToSvg(presentation, visual(slide), {
    textMode, idPrefix: `template-${textMode}-`,
  });
  result[textMode] = `${svg.length}:${createHash('sha256').update(svg).digest('hex')}`;
}
edit.disposeDoc(doc);
process.stdout.write(JSON.stringify(result));
