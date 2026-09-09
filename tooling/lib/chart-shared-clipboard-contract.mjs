import { readFileSync, writeFileSync } from 'node:fs';

const geometry = elements => elements.map(element => [element.kind, element.x, element.y, element.w, element.h,
  element.path, element.kind === 'group' ? geometry(element.children) : undefined]);

export async function testSharedClipboard({ core, edit, chart, chartDesign, generate, assert }) {
  for (const suffix of ['', '-cache', '-xy']) for (const released of [false, true]) {
    const input = readFileSync(`fixtures/sample-chart-shared${suffix}.pptx`);
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
    const recoveryFrames = [];
    editor.subscribeRecovery(frame => recoveryFrames.push(frame));
    const first = chart.queryChartData(editor.doc, chart.listEditableCharts(editor.doc)[0].id);
    api.setValue(first.chartId, first.series[0].id, first.series[0].points[1].id, 987);
    if (suffix === '-xy') api.addPoint(first.chartId, first.series[0].id, { x: 14, value: 41, size: 4 });
    else api.addCategory(first.chartId, [null, 'Copied category']);
    api.addSeries(first.chartId, 'Copied series');
    chartDesign.createChartDesignEditor(editor).set(first.chartId, { title: 'Copied current chart' });
    if (released) presentation.dispose();
    const before = JSON.stringify({ extensions: editor.doc.extensions, identity: editor.doc.identity, saveState: editor.doc.saveState });
    const originalParts = structuredClone(editor.doc.package.parts);
    const undoCount = editor.history.undoCount;
    const appearance = geometry(editor.effectiveElement(first.chartId).children);
    const payload = generate.copyPortableElements(editor.doc, [first.chartId]);
    assert.equal(JSON.stringify({ extensions: editor.doc.extensions, identity: editor.doc.identity, saveState: editor.doc.saveState }), before,
      '复制按有效数据计算闭包，但不提交源文稿状态');
    assert.deepEqual(editor.doc.package.parts, originalParts, '复制不得隐式保存或修改源 OPC 字节');
    assert.equal(editor.history.undoCount, undoCount);
    assert.equal(editor.isDirty(), true);

    const obsoletePresentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const obsolete = new edit.Editor(edit.createDoc(obsoletePresentation));
    const oldCount = Object.keys(obsolete.doc.elements).length;
    assert.throws(() => obsolete.exec({ type: 'PasteElements', payload,
      at: { parentId: obsolete.doc.slideOrder[0], x: 30, y: 30 } }), /闭包/,
    '目标只有修改前的原生资源时不能误认成同一闭包并丢掉新值');
    assert.equal(Object.keys(obsolete.doc.elements).length, oldCount);
    assert.equal(obsolete.history.undoCount, 0);
    obsolete.dispose(); obsoletePresentation.dispose();

    const clonedPresentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const cloned = new edit.Editor(edit.createDoc(clonedPresentation, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames });
    const saved = await cloned.save();
    cloned.dispose(); clonedPresentation.dispose();
    const destinationPresentation = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
    const destination = new edit.Editor(edit.createDoc(destinationPresentation));
    const pastedRecovery = [];
    destination.subscribeRecovery(frame => pastedRecovery.push(frame));
    for (const target of released ? [destination] : [editor, destination]) {
      const previous = new Set(chart.listEditableCharts(target.doc).map(frame => frame.id));
      target.exec({ type: 'PasteElements', payload: JSON.parse(JSON.stringify(payload)),
        at: { parentId: target.doc.slideOrder[0], x: 30, y: 30 } });
      const pasted = chart.listEditableCharts(target.doc).find(frame => !previous.has(frame.id));
      assert.ok(pasted, '新粘贴的原生图表立即参与图表定位与依赖图');
      const rendered = core.renderElementToSvg(target.effectiveElement(pasted.id), { includeEditMarkers: true });
      assert.equal((rendered.markup.match(/ data-el=/g) ?? []).length, 1,
        '粘贴框架只有一个交互身份，派生图形不能占据独立 DOM 绑定槽');
      const data = chart.queryChartData(target.doc, pasted.id);
      assert.deepEqual(geometry(target.effectiveElement(pasted.id).children), appearance,
        '粘贴到另一文稿后立即显示复制时的有效图表，不能等待下一次编辑才刷新');
      assert.equal(data.series[0].points[1].value, 987, `${suffix} 相同有效资源的文稿立即读到复制时的数据`);
      assert.equal(data.series.at(-1).name, 'Copied series');
      assert.equal(suffix === '-xy' ? data.series[0].points.at(-1).value : data.categories.at(-1).label,
        suffix === '-xy' ? 41 : 'Copied category', '新增系列和数据记录随复制立即可见');
      assert.equal(data.binding.chartPart, first.binding.chartPart, '复用已有共享部件，不拆成私有图表');
      chart.createChartDataEditor(target).setValue(pasted.id, data.series[0].id, data.series[0].points[1].id, 876);
      const linked = () => chart.listEditableCharts(target.doc).filter(frame => frame.binding.chartPart === data.binding.chartPart);
      assert.ok(linked().every(frame => chart.queryChartData(target.doc, frame.id).series[0].points[1].value === 876),
        '从粘贴框架编辑后原有框架同样联动');
      target.undo(); target.undo();
      assert.equal(chart.listEditableCharts(target.doc).length, previous.size, '撤销数据与粘贴恢复原引用集合');
      target.redo(); target.redo();
      if (target === destination) {
        const recovering = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
        const restored = new edit.Editor(edit.createDoc(recovering, { idPrefix: target.doc.identity.prefix }),
          { recoveryFrames: JSON.parse(JSON.stringify(pastedRecovery)) });
        assert.equal(chart.queryChartData(restored.doc, pasted.id).series[0].points[1].value, 876,
          '未保存的粘贴框架和共享数据从恢复帧一起重建');
        assert.deepEqual(geometry(restored.effectiveElement(pasted.id).children), geometry(target.effectiveElement(pasted.id).children));
        restored.dispose(); recovering.dispose();
        if (released) destinationPresentation.dispose();
      }
      const final = await target.save();
      if (target === destination) writeFileSync(`out/chart-shared/clipboard${suffix}-${released ? 'generated' : 'patched'}.pptx`, final);
      const reopenedPresentation = await core.parse(final, { edit: true, keepPackage: true, lazy: false });
      const reopened = edit.createDoc(reopenedPresentation);
      assert.ok(new TextDecoder().decode(reopened.package.parts[data.binding.chartPart]).includes('Copied current chart'),
        '复制资源包含当前样式，数据物化不能回退已编辑的标题');
      const values = chart.listEditableCharts(reopened).filter(frame => frame.binding.chartPart === data.binding.chartPart)
        .map(frame => chart.queryChartData(reopened, frame.id).series[0].points[1].value);
      assert.ok(values.length >= 3 && values.every(value => value === 876), '粘贴后编辑、撤销重做与原生保存保持共享值');
      edit.disposeDoc(reopened); reopenedPresentation.dispose();
    }
    destination.dispose(); destinationPresentation.dispose(); editor.dispose(); presentation.dispose();
  }
}
