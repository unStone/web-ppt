/**
 * 编辑投影与保存产物必须各自在干净进程渲染；渲染器的 defs id 是进程级序列，
 * 同进程比较会把测试顺序误当成文件差异。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installDomEnv } from './dom-env.mjs';

const [corePath, editPath, file, mode, scenarioJson] = process.argv.slice(2);
if (!corePath || !editPath || !file || !scenarioJson || !['projected', 'saved'].includes(mode)) {
  console.error('用法: node m1-save-fingerprint.mjs <core.mjs> <edit.mjs> <file> <projected|saved> <scenario-json>');
  process.exit(2);
}
const scenario = JSON.parse(scenarioJson);

installDomEnv();
const core = await import(`${pathToFileURL(corePath).href}?worker=${process.pid}`);
const edit = await import(`${pathToFileURL(editPath).href}?worker=${process.pid}`);
const bytes = new Uint8Array(readFileSync(file));
const pres = await core.parse(bytes, {
  edit: mode === 'projected', keepPackage: mode === 'projected', lazy: false, assets: 'defer',
});
let slide = pres.slides[0];
let doc;
if (mode === 'projected') {
  doc = edit.createDoc(pres, { idPrefix: 'm1-fingerprint-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements).find((record) => record.src.name === scenario.targetName);
  if (!target) throw new Error('M1 指纹固件缺少编辑目标');
  if (scenario.type === 'remove') editor.exec({ type: 'RemoveElement', id: target.id });
  else if (scenario.type === 'order') editor.exec({ type: 'SetZ', id: target.id, to: scenario.to });
  else if (scenario.type === 'align') {
    const ids = scenario.targetNames.map((name) => Object.values(doc.elements)
      .find((record) => record.src.name === name)?.id);
    if (ids.some((id) => !id)) throw new Error('M1 指纹固件缺少对齐目标');
    editor.exec({ type: 'AlignElements', ids, edge: scenario.edge });
  }
  else editor.exec({ type: 'SetXfrm', id: target.id, x: scenario.x });
  slide = editor.toSlide(doc.slideOrder[0]);
}

const fingerprints = {};
for (const textMode of ['html', 'svg']) {
  const svg = core.renderSlideToSvg(pres, slide, { textMode, idPrefix: `m1-${textMode}-` });
  fingerprints[textMode] = `${svg.length}:${createHash('sha256').update(svg).digest('hex')}`;
}
if (doc) edit.disposeDoc(doc);
else pres.dispose?.();
process.stdout.write(JSON.stringify(fingerprints));
