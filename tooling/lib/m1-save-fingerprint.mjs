/**
 * 编辑投影与保存产物必须各自在干净进程渲染；渲染器的 defs id 是进程级序列，
 * 同进程比较会把测试顺序误当成文件差异。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
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
  edit: mode === 'projected', keepPackage: true, lazy: false, assets: 'defer',
});
let slide = pres.slides[0];
let doc;
if (mode === 'projected') {
  doc = edit.createDoc(pres, { idPrefix: 'm1-fingerprint-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements).find((record) => record.src.name === scenario.targetName);
  if (scenario.type === 'clipboard') {
    const sourceBytes = new Uint8Array(readFileSync(join(dirname(file), scenario.sourceFile)));
    const sourcePres = await core.parse(sourceBytes, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const sourceDoc = edit.createDoc(sourcePres, { idPrefix: 'm1-fingerprint-source-' });
    const sourceTarget = Object.values(sourceDoc.elements)
      .find((record) => record.src.name === scenario.targetName);
    if (!sourceTarget) throw new Error('M1 指纹固件缺少剪贴板来源目标');
    editor.exec({
      type: 'PasteElements', payload: edit.copyElements(sourceDoc, [sourceTarget.id]),
      at: { parentId: doc.slideOrder[0], x: scenario.x, y: scenario.y },
    });
    edit.disposeDoc(sourceDoc);
  } else if (scenario.type === 'text') {
    for (const change of scenario.edits) {
      const textTarget = Object.values(doc.elements)
        .find((record) => record.src.name === change.targetName);
      if (!textTarget) throw new Error(`M1 指纹固件缺少文字目标：${change.targetName}`);
      editor.exec({ type: 'EditText', id: textTarget.id, ops: change.ops });
    }
  } else if (!target) throw new Error('M1 指纹固件缺少编辑目标');
  else if (scenario.type === 'remove') editor.exec({ type: 'RemoveElement', id: target.id });
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

// blob:/asset: 都是解析会话身份；指纹比较必须先内联同一资源字节，才是在比视觉投影。
const inlineAssets = (value) => {
  if (typeof value === 'string') {
    const asset = pres.package?.assets?.[value];
    if (!asset) return value;
    return `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(inlineAssets);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inlineAssets(child)]));
};
slide = inlineAssets(slide);

const fingerprints = {};
for (const textMode of ['html', 'svg']) {
  const svg = core.renderSlideToSvg(pres, slide, { textMode, idPrefix: `m1-${textMode}-` });
  fingerprints[textMode] = `${svg.length}:${createHash('sha256').update(svg).digest('hex')}`;
}
if (doc) edit.disposeDoc(doc);
else pres.dispose?.();
process.stdout.write(JSON.stringify(fingerprints));
