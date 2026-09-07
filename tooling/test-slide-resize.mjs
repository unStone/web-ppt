import { countedAssert } from './lib/counted-assert.mjs';
const {assert,record}=countedAssert('slideResize');
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/slide-resize');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as resize from ${JSON.stringify(join(root, 'packages/edit-core/src/resize/index.ts'))};`);
const { core, edit, resize } = process.argv.includes('--dist') ? Object.fromEntries(await Promise.all([["core", "@web-ppt/core"], ["edit", "@web-ppt/edit-core"], ["resize", "@web-ppt/edit-core/resize"]].map(async ([key, path]) => [key, await import(path)]))) : await bundleBrowser({ root, entry, output: join(out, 'contract.mjs'), aliases: [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
] });
const input = readFileSync(join(root, 'fixtures/sample-editor-resize.pptx'));
const make = async (options) => {
  const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  return { p, editor: new edit.Editor(edit.createDoc(p, { idPrefix: 'resize-' }), options) };
};
const find = (editor, name) => Object.values(editor.doc.elements).find((r) => r.src.name === name && !r.meta.inherited);
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < .03, `${label}: ${actual} != ${expected}`);
const shapeCheck = (element, scale = .5) => {
  close(element.x, 80 * scale, '横坐标'); close(element.y, 70 * scale + 20, '纵坐标');
  close(element.w, 240 * scale, '形状宽度'); close(element.stroke.width, 4 * scale, '线宽');
  close(element.text.paragraphs[0].runs[0].size, 32 * scale, '字号');
  close(element.text.insets[3], 10 * scale, '文字内边距');
};
{
  const { p, editor } = await make();
  assert.throws(() => editor.exec({ type: 'SetSlideSize', w: 640, h: 400, fit: 'ensureFit' }), /resize/);
  assert.equal(editor.doc.meta.width, 1280, '模块缺失失败不改变画布');
  assert.equal(editor.history.undoCount, 0);
  p.dispose(); editor.dispose();
}
for (const generated of [false, true]) {
  const { p, editor } = await make(), frames = [];
  editor.subscribeRecovery((frame) => frames.push(frame));
  const target = find(editor, 'scale-text'), nested = find(editor, 'nested-text');
  const initialNested = JSON.stringify(editor.effectiveElement(nested.id));
  const table = Object.values(editor.doc.elements).find((r) => r.src.kind === 'table');
  const initialTable = editor.effectiveElement(table.id);
  resize.createSlideSizeEditor(editor).setSize({ w: 640, h: 400, fit: 'ensureFit' });
  shapeCheck(editor.effectiveElement(target.id));
  assert.equal(JSON.stringify(editor.effectiveElement(nested.id)), initialNested, '组合子对象不重复缩放');
  assert.equal(editor.history.undoCount, 1);
  const smallTable = editor.effectiveElement(table.id);
  close(smallTable.rows[0].height, initialTable.rows[0].height / 2, '表格行高');
  close(smallTable.rows[0].cells[0].text.paragraphs[0].runs[0].size,
    initialTable.rows[0].cells[0].text.paragraphs[0].runs[0].size / 2, '表格字号');
  close(smallTable.colWidths[0], initialTable.colWidths[0] / 2, '表格列宽');
  editor.undo(); assert.equal(editor.doc.meta.width, 1280); assert.equal(Object.keys(target.ovr).length, 0);
  editor.redo(); shapeCheck(editor.effectiveElement(target.id));
  assert.equal(resize.createSlideSizeEditor(editor).setSize({ w: 640, h: 400, fit: 'ensureFit' }).forward.length, 0);
  if (generated) p.dispose();
  const bytes = await editor.save();
  writeFileSync(join(out, `resize-${generated ? 'generated' : 'patched'}.pptx`), bytes);
  const reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  shapeCheck(reopened.slides[0].elements.find((el) => el.name === 'scale-text'));
  close(reopened.slides[0].elements.find((el) => el.name === 'master-scale').x, 475, '母版缩放');
  close(reopened.slides[0].elements.find((el) => el.name === 'layout-scale').y, 300, '版式缩放');
  for (const mode of ['recovery', 'external']) {
    const restored = await make(mode === 'recovery' ? { recoveryFrames: frames } : undefined);
    if (mode === 'external') for (const frame of frames) restored.editor.applyExternalPatches(frame.patches);
    shapeCheck(restored.editor.effectiveElement(find(restored.editor, 'scale-text').id));
    restored.p.dispose(); restored.editor.dispose();
  }
  reopened.dispose(); p.dispose(); editor.dispose();
}
{
  const { p, editor } = await make();
  const table = Object.values(editor.doc.elements).find((r) => r.src.kind === 'table');
  editor.exec({ type: 'InsertRow', id: table.id });
  editor.exec({ type: 'SetLocked', id: table.id, locked: true });
  const height = editor.effectiveElement(table.id).h;
  resize.createSlideSizeEditor(editor).setSize({ w: 640, h: 360, fit: 'ensureFit' });
  close(editor.effectiveElement(table.id).h, height / 2, '追加行后使用有效表格高度');
  assert.equal(table.meta.locked, true, '整稿适配保留对象锁定');
  assert.throws(() => editor.exec({ type: 'SetSlideSize', w: 500, h: 300, fit: 'bad' }), /fit/);
  assert.equal(editor.doc.meta.width, 640, '非法适配模式原子拒绝');
  p.dispose(); editor.dispose();
}
record();
console.log('页面确保适合：文字/效果/组合/表格/母版/版式、历史、恢复与两条保存通过');
