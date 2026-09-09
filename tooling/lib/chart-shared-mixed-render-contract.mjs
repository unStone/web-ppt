import { readFileSync, writeFileSync } from 'node:fs';

export const mixedRenderCases = ['mixed-records', 'mixed-records-horizontal', 'mixed-scatter'];

const bubbles = element => (element.kind === 'group' ? element.children.flatMap(bubbles)
  : element.kind === 'shape' && element.path?.includes(' A ') ? [{ x: element.x + element.w / 2,
    y: element.y + element.h / 2, w: element.w }] : []).sort((a, b) => a.w - b.w);

export async function testSharedMixedRendering({ core, edit, chart, assert }) {
  for (const name of mixedRenderCases) {
    const p = await core.parse(readFileSync(`fixtures/sample-chart-shared-${name}.pptx`), { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor);
    try {
      const frames = chart.listEditableCharts(editor.doc), first = chart.queryChartData(editor.doc, frames[0].id);
      const kind = name === 'mixed-scatter' ? 'scatter' : 'bubble';
      const series = first.series.find(series => series.plotKind === kind);
      const valid = series.points.filter(point => point.x !== null && point.value !== null);
      const count = valid.length + (kind === 'scatter' ? 1 : 0); // 散点图例本身也有一个圆形标记。
      const rendered = () => frames.map(frame => bubbles(editor.effectiveElement(frame.id)));
      const original = rendered();
      assert.ok(original.every(points => points.length === count), '混合图的每个关联框架必须实际绘制全部 XY 点');
      assert.ok(original[0].length > 1);
      assert.ok(original.every(points => JSON.stringify(points) === JSON.stringify(original[0])));
      const point = [...valid].sort((a, b) => a.size - b.size)[0];
      const last = chart.queryChartData(editor.doc, frames.at(-1).id).series.find(series => series.plotKind === kind);
      const lastPoint = last.points[series.points.indexOf(point)];
      const stages = [];
      const edits = [{ x: point.x + 1 }, { value: point.value + 1 }];
      if (kind === 'bubble') edits.push({ size: point.size * 1.2 });
      for (const values of edits) {
        stages.push(rendered());
        api.setPoint(frames.at(-1).id, last.id, lastPoint.id, values);
        const next = rendered();
        assert.notDeepEqual(next[0], stages.at(-1)[0], 'X、Y、大小的修改必须改变实际绘制几何');
        assert.ok(next.every(points => JSON.stringify(points) === JSON.stringify(next[0])), '关联框架同帧更新几何');
      }
      const edited = rendered();
      const added = api.addPoint(first.chartId, series.id, { x: 31, value: 32, ...(kind === 'bubble' ? { size: 33 } : {}) });
      assert.ok(rendered().every(points => points.length === count + 1), '新增记录会绘制新 XY 点');
      api.removePoint(first.chartId, series.id, added);
      assert.deepEqual(rendered(), edited);
      editor.undo();
      assert.ok(rendered().every(points => points.length === count + 1));
      editor.undo();
      assert.deepEqual(rendered(), edited);
      for (const before of stages.reverse()) { editor.undo(); assert.deepEqual(rendered(), before); }
      for (let i = 0; i < edits.length; i++) editor.redo();
      assert.deepEqual(rendered(), edited);
      for (const mode of ['html', 'svg']) {
        const svg = core.renderSlideToSvg(p, editor.toSlide(editor.doc.slideOrder[0]), { textMode: mode });
        assert.ok(svg.includes(series.name), '混合图的 XY 图例不能丢失');
      }
      for (const mode of ['patched', 'generated']) {
        if (mode === 'generated') p.dispose();
        const bytes = await editor.save();
        writeFileSync(`out/chart-shared/render-${name}-${mode}.pptx`, bytes);
        const reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
        const restored = new edit.Editor(edit.createDoc(reopened));
        try {
          const geometry = chart.listEditableCharts(restored.doc).map(frame => bubbles(restored.effectiveElement(frame.id)));
          assert.deepEqual(geometry, edited, '两种原生保存重开后，关联框架保留编辑后的 XY 几何');
        } finally { restored.dispose(); reopened.dispose(); }
      }
    } finally { editor.dispose(); p.dispose(); }
  }
}
