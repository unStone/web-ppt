import { countedAssert } from './lib/counted-assert.mjs';
const {assert,record}=countedAssert('chartexEdit');
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/chartex-edit'); mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as renderer from ${JSON.stringify(join(root, 'packages/core/src/chart-ex.ts'))};
export * as modern from ${JSON.stringify(join(root, 'packages/edit-core/src/chart-ex/index.ts'))};`);
const { core, edit, renderer, modern } = process.argv.includes('--dist')
  ? Object.fromEntries(await Promise.all([['core', 'core/dist/core.js'], ['edit', 'edit-core/dist/edit-core.js'],
    ['renderer', 'core/dist/chart-ex.js'], ['modern', 'edit-core/dist/chart-ex.js']].map(async ([key, file]) =>
      [key, await import(pathToFileURL(join(root, 'packages', file)))])))
  : await bundleBrowser({ root, entry, output: join(out, 'contract.mjs'), aliases: [
    ['@web-ppt/core/chart-ex', join(root, 'packages/core/src/chart-ex.ts')],
    ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
    ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
    ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
    ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
  ] });
core.setChartExParser(renderer.parseChartEx);
const input = readFileSync(join(root, 'fixtures/sample-chartex-edit.pptx'));
const make = async (bytes = input, options = {}) => {
  const p = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(p, { idPrefix: 'modern-' }), options);
  return { p, editor, api: modern.createChartExEditor(editor) };
};
for (const generated of [false, true]) {
  const { p, editor, api } = await make(), frames = [];
  editor.subscribeRecovery((f) => frames.push(f));
  for (const item of modern.listEditableChartEx(editor.doc).filter((item) => item.name !== 'regionMap')) {
    const data = api.query(item.id)[0], dim = data.dimensions.findIndex((d) => d.numeric);
    const original = JSON.stringify(editor.effectiveElement(item.id));
    api.setCell(item.id, data.id, dim, 0, 0, 321);
    assert.notEqual(JSON.stringify(editor.effectiveElement(item.id)), original, `${item.name} 原生投影变化`);
    assert.throws(() => api.setCell(item.id, data.id, dim, 0, 0, '非法数值'));
    assert.equal(api.query(item.id)[0].dimensions[dim].levels[0][0], 321, '非法编辑无残留');
    api.insertRow(item.id, data.id, 1);
    api.setCell(item.id, data.id, dim, 0, 1, 77);
    api.removeRow(item.id, data.id, 2);
    assert.equal(api.query(item.id)[0].dimensions[dim].levels[0][1], 77);
  }
  if (generated) p.dispose();
  const bytes = await editor.save(); writeFileSync(join(out, `${generated ? 'generated' : 'patched'}.pptx`), bytes);
  const fresh = await make(bytes), parts = unzipSync(bytes);
  for (const item of modern.listEditableChartEx(fresh.editor.doc).filter((i) => i.name !== 'regionMap')) {
    const data = fresh.api.query(item.id)[0], numeric = data.dimensions.find((d) => d.numeric);
    assert.equal(numeric.levels[0][0], 321, `${item.name} 保存重开数值`);
    assert.equal(numeric.levels[0][1], 77, `${item.name} 保存重开新增行`);
    assert(fresh.editor.effectiveElement(item.id).children?.length > 0, `${item.name} 保存后仍为原生矢量图`);
  }
  const xml = new TextDecoder().decode(parts['ppt/charts/chartEx6.xml']); assert(xml.includes('原文保留'));
  const book = unzipSync(parts['ppt/embeddings/modern.xlsx']);
  const originalBook = unzipSync(unzipSync(input)['ppt/embeddings/modern.xlsx']);
  assert.deepEqual(book['xl/worksheets/sheet1.xml'], originalBook['xl/worksheets/sheet1.xml'], '既有公式范围不被增长的数据覆盖');
  assert.deepEqual(book['xl/worksheets/sheet2.xml'], originalBook['xl/worksheets/sheet2.xml'], '其他工作表保持原字节');
  assert(Object.keys(book).some((part) => part.startsWith('web-ppt/chart-data')), '真实数据写入工作簿新工作表');
  assert.deepEqual(await editor.save(), bytes, '重复保存稳定');
  const recovered = await make(input, { recoveryFrames: frames });
  assert.deepEqual(recovered.api.query(modern.listEditableChartEx(recovered.editor.doc)[0].id), api.query(modern.listEditableChartEx(editor.doc)[0].id));
  while (editor.history.undoCount) editor.undo();
  const undone = unzipSync(await editor.save());
  assert.deepEqual(undone['ppt/charts/chartEx6.xml'], unzipSync(input)['ppt/charts/chartEx6.xml'], '撤销后恢复原生数据');
  assert.deepEqual(undone['ppt/embeddings/modern.xlsx'], unzipSync(input)['ppt/embeddings/modern.xlsx'], '撤销后恢复原工作簿');
  for (const value of [{ p, editor }, fresh, recovered]) { value.p.dispose(); value.editor.dispose(); }
}
record();
console.log('ChartEx 编辑：七种原生图、数据行、类型边界、工作簿、历史恢复和两条保存路径通过');
