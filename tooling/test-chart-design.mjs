import { countedAssert } from './lib/counted-assert.mjs';
const {assert,record}=countedAssert('chartDesign');
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyChartDesignXml } from './lib/chart-design-schema.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { makeZip } from './lib/ooxml.mjs';

const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/chart-design'); mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as chart from ${JSON.stringify(join(root, 'packages/edit-core/src/chart/index.ts'))};
export * as design from ${JSON.stringify(join(root, 'packages/edit-core/src/chart-design/index.ts'))};`);
const { core, edit, chart, design } = process.argv.includes('--dist')
  ? Object.fromEntries(await Promise.all([['core', 'core/dist/core.js'], ['edit', 'edit-core/dist/edit-core.js'],
    ['chart', 'edit-core/dist/chart.js'], ['design', 'edit-core/dist/chart-design.js']].map(async ([key, file]) =>
      [key, await import(pathToFileURL(join(root, 'packages', file)))])))
  : await bundleBrowser({ root, entry, output: join(out, 'contract.mjs'), aliases: [
  ['@web-ppt/core/chart-edit', join(root, 'packages/core/src/chart-edit.ts')],
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core/chart', join(root, 'packages/edit-core/src/chart/index.ts')],
  ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
  ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
] });
const input = readFileSync(join(root, 'fixtures/sample-chart-design.pptx'));
const make = async (options) => {
  const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(p, { idPrefix: 'design-' }), options), api = design.createChartDesignEditor(editor);
  const id = chart.listEditableCharts(editor.doc).find((c) => c.binding.chartPart === 'ppt/charts/chart1.xml').id;
  return { p, editor, api, id };
};
for (const generated of [false, true]) for (const type of ['bar', 'line', 'area', 'doughnut', 'radar']) {
  const { p, editor, api, id } = await make(), frames = [];
  editor.subscribeRecovery((f) => frames.push(f));
  const original = JSON.stringify(editor.effectiveElement(id).children);
  api.set(id, { type, title: `新标题 ${type} & <`, palette: ['#D32F2F', '#1565C0'], legend: 'bottom', labels: true });
  assert.notEqual(JSON.stringify(editor.effectiveElement(id).children), original, '真实图表投影变化');
  const data = chart.queryChartData(editor.doc, id), series = data.series[0], point = series.points[0];
  chart.createChartDataEditor(editor).setValue(id, series.id, point.id, 9876);
  if (generated) p.dispose();
  const bytes = await editor.save(); writeFileSync(join(out, `${type}-${generated ? 'generated' : 'patched'}.pptx`), bytes);
  const xml = strFromU8(unzipSync(bytes)['ppt/charts/chart1.xml']);
  verifyChartDesignXml(xml);
  const dom = new JSDOM(xml, { contentType: 'application/xml' });
  assert.equal(dom.window.document.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', `${type}Chart`).length, 1);
  assert(xml.includes('保留原扩展') && xml.includes('9876') && xml.includes('D32F2F'));
  const reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const fresh = new edit.Editor(edit.createDoc(reopened));
  const freshId = chart.listEditableCharts(fresh.doc).find((c) => c.binding.chartPart === 'ppt/charts/chart1.xml').id;
  const saved = chart.queryChartData(fresh.doc, freshId);
  assert(saved.plotKinds.includes(type)); assert.equal(saved.series[0].points[0].value, 9876, '样式切换和工作簿数据共同保存');
  const restored = await make({ recoveryFrames: frames });
  assert.deepEqual(restored.api.query(restored.id), api.query(id), '样式恢复');
  restored.p.dispose(); restored.editor.dispose();
  assert.deepEqual(await editor.save(), bytes, '重复保存稳定');
  editor.undo(); editor.undo();
  assert.equal(JSON.stringify(editor.effectiveElement(id).children), original, '完整撤销');
  const undone = await editor.save(); if (!generated) assert.equal(strFromU8(unzipSync(undone)['ppt/charts/chart1.xml']), strFromU8(unzipSync(input)['ppt/charts/chart1.xml']), '保存后撤销恢复来源 XML');
  dom.window.close(); reopened.dispose(); fresh.dispose(); p.dispose(); editor.dispose();
}
{
  const parts=unzipSync(readFileSync('fixtures/sample-chart-data.pptx'));
  delete parts['ppt/embeddings/chart-data.xlsx'];
  const p=await core.parse(makeZip(Object.entries(parts)),{edit:true,keepPackage:true,lazy:false});
  const editor=new edit.Editor(edit.createDoc(p)),api=design.createChartDesignEditor(editor);
  const id=chart.listEditableCharts(editor.doc).find(c=>c.binding.mode==='readonly').id;
  assert.throws(()=>api.set(id,{title:'不应写入'}),/工作簿不存在/);
  assert.equal(editor.isDirty(),false,'只读图表样式原子拒绝');
  assert.deepEqual(api.query(id),{});
  editor.dispose();p.dispose();
}
record();
console.log('图表类型与样式：投影、原生类型、数据联动、工作簿、历史、恢复及重复保存通过');
