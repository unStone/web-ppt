import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '@web-ppt/core';
import * as edit from '@web-ppt/edit-core';
import * as chart from '@web-ppt/edit-core/chart';

for (const name of ['patched', 'cache']) {
  const presentation = await core.parse(readFileSync(`out/chart-shared/${name}.pptx`), { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation));
  const frames = chart.listEditableCharts(editor.doc).filter(frame => frame.binding.chartPart === 'ppt/charts/chart1.xml');
  assert.ok(frames.every(frame => frame.binding.mode === 'readonly'));
  frames.slice(1).forEach(frame => editor.exec({ type: 'RemoveElement', id: frame.id }));
  const remaining = chart.queryChartData(editor.doc, frames[0].id);
  assert.equal(remaining.binding.mode, 'readonly', '保存过的共享部件只剩一个框架时仍须加载共享入口');
  assert.match(remaining.binding.reason, /chart-shared/);
  editor.dispose(); presentation.dispose();
}
for (const [variant, orientation] of [['', 'rows'], ['-horizontal', 'columns'], ['-three-level', 'rows']]) {
  const presentation = await core.parse(readFileSync(`out/chart-shared/cache-square-single${variant}.pptx`), { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation));
  const frame = chart.listEditableCharts(editor.doc).find(frame => frame.binding.chartPart === 'ppt/charts/chart1.xml');
  const data = chart.queryChartData(editor.doc, frame.id);
  assert.equal(data.binding.mode, 'cache', '普通图表入口独立读取非共享的方形层级缓存');
  assert.equal(data.series[0].bindings.categories.hierarchy.orientation, orientation);
  chart.createChartDataEditor(editor).setValue(frame.id, data.series[0].id, data.categories[0].id, 913);
  const reopened = await core.parse(await editor.save(), { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(reopened), actual = chart.queryChartData(doc, chart.listEditableCharts(doc)[0].id);
  assert.equal(actual.series[0].points[0].value, 913);
  edit.disposeDoc(doc); reopened.dispose(); editor.dispose(); presentation.dispose();
}
console.log('共享图表：独立进程普通入口、单框架保护与非共享层级重建通过');
