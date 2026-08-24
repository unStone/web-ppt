/** 文字框属性只通过公开查询、纯数据命令与有效投影观察。 */
export async function runBodyPropsEditContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 文字框属性\x1b[0m');
  const presentation = await core.parse(load('sample-editor-body-props.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'body-props-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements)
    .find((candidate) => candidate.src.name === '继承文字框属性');
  const before = edit.queryBodyProps(doc, record.id);
  const result = editor.exec({
    type: 'SetBodyProps', id: record.id,
    props: { anchor: 'bottom', insets: [7, 8, 9, 10], wrap: false },
  });
  const effective = editor.effectiveElement(record.id).text;
  const after = edit.queryBodyProps(doc, record.id);
  check('公开查询与 SetBodyProps 原子修改基础文字框属性且不污染源值',
    before.anchor === 'top'
      && effective.anchor === 'bottom'
      && JSON.stringify(effective.insets) === '[7,8,9,10]'
      && effective.wrap === false
      && JSON.stringify(after) === JSON.stringify({
        ...before, anchor: 'bottom', insets: [7, 8, 9, 10], wrap: false,
      })
      && record.src.text.anchor === 'top'
      && result.forward.length >= 1
      && editor.history.undoCount === 1);

  editor.undo();
  const all = editor.exec({
    type: 'SetBodyProps', id: record.id,
    props: {
      anchor: 'middle', insets: [1, 2, 3, 4], wrap: false,
      vert: 'vert', anchorCtr: true, columns: 4, columnGap: 24, autoFit: 'normal',
    },
  });
  const formatted = edit.queryBodyProps(doc, record.id);
  check('一次命令设置方向、居中、分栏和互斥自动适应模式',
    JSON.stringify(formatted) === JSON.stringify({
      anchor: 'middle', insets: [1, 2, 3, 4], wrap: false,
      vert: 'vert', anchorCtr: true, columns: 4, columnGap: 24, autoFit: 'normal',
    })
      && editor.effectiveElement(record.id).text.autoFitCompute === true
      && !editor.effectiveElement(record.id).text.autoFitShape
      && all.forward.filter((patch) => patch.path[3] === 'text').length === 1);
  editor.undo();
  const reset = editor.exec({
    type: 'SetBodyProps', id: record.id,
    props: {
      anchor: null, insets: null, wrap: null, vert: null,
      anchorCtr: null, columns: null, columnGap: null, autoFit: null,
    },
  });
  check('null 清除本层 bodyPr 直设并立即投影版式与母版回退值',
    JSON.stringify(edit.queryBodyProps(doc, record.id)) === JSON.stringify({
      anchor: 'middle', insets: [21, 22, 13, 14], wrap: false,
      vert: 'vert270', anchorCtr: true, columns: 3, columnGap: 12, autoFit: 'normal',
    })
      && record.src.text.anchor === 'top'
      && reset.forward.length >= 1);
  editor.undo();
  check('撤销恢复全部本层文字框属性且重做再次恢复继承',
    JSON.stringify(edit.queryBodyProps(doc, record.id)) === JSON.stringify(before)
      && editor.redo()
      && edit.queryBodyProps(doc, record.id).anchor === 'middle');

  const grow = Object.values(doc.elements)
    .find((candidate) => candidate.src.name === '自动适应-无');
  const growBefore = editor.effectiveElement(grow.id);
  const growResult = editor.exec({ type: 'SetBodyProps', id: grow.id, props: { autoFit: 'shape' } });
  const grown = editor.effectiveElement(grow.id);
  check('切到 shape 模式时自动适应与派生改高属于同一原子历史',
    grown.text.autoFitShape === true && grown.h > growBefore.h
      && growResult.forward.filter((patch) => patch.path[3] === 'text').length === 1
      && growResult.forward.filter((patch) => patch.path[3] === 'h').length === 1);

  const empty = Object.values(doc.elements)
    .find((candidate) => candidate.src.name === '空文字框属性');
  check('来源为空的文字框仍可查询并设置 bodyPr',
    edit.queryBodyProps(doc, empty.id).anchor === 'bottom'
      && editor.exec({
        type: 'SetBodyProps', id: empty.id,
        props: { anchor: 'bottom', vert: 'vert270', autoFit: 'none' },
      }).forward.length === 1
      && edit.queryBodyProps(doc, empty.id).anchor === 'bottom'
      && edit.queryBodyProps(doc, empty.id).vert === 'vert270'
      && editor.effectiveElement(empty.id).text === null
      && doc.elements[empty.id].ovr.text.bodyOverrides.autoFit === 'none');

  editor.exec({ type: 'SetBodyProps', id: record.id, props: { anchor: 'bottom' } });
  editor.exec({ type: 'RemoveElement', id: record.id });
  const cleared = editor.exec({
    type: 'SetBodyProps', id: record.id, props: { anchor: 'middle', wrap: true },
  });
  check('清空占位符后 bodyPr 仍可编辑且不会复活旧文字',
    editor.effectiveElement(record.id).text === null
      && edit.queryBodyProps(doc, record.id).anchor === 'middle'
      && cleared.forward.length === 1
      && doc.elements[record.id].ovr.text.kind === 'empty'
      && doc.elements[record.id].ovr.text.body.anchor === 'middle');

  const baseline = JSON.stringify(doc);
  const history = editor.history.undoCount;
  const invalid = [
    {}, { anchor: undefined }, { anchor: 'center' }, { insets: [1, 2, 3] }, { insets: [1, -1, 2, 3] },
    { vert: 'diagonal' }, { anchorCtr: 1 }, { columns: 0 }, { columns: 17 },
    { columnGap: -1 }, { autoFit: 'grow' }, { wrap: true, unknown: 1 },
  ].every((props) => {
    try { editor.exec({ type: 'SetBodyProps', id: record.id, props }); return false; }
    catch { return true; }
  });
  check('非法文字框属性在命令边界原子拒绝',
    invalid && JSON.stringify(doc) === baseline && editor.history.undoCount === history);

  const rebaseDoc = edit.createDoc(presentation, { idPrefix: 'body-props-rebase-' });
  const boundary = new edit.Editor(rebaseDoc);
  const rebaseRecord = Object.values(rebaseDoc.elements)
    .find((candidate) => candidate.src.name === '文字方向-水平');
  boundary.transaction((tx) => tx.exec({
    type: 'SetBodyProps', id: rebaseRecord.id, props: { anchor: 'bottom' },
  }), '属性面板', { mergeKey: 'body-panel', time: 100 });
  boundary.transaction((tx) => tx.exec({
    type: 'SetBodyProps', id: rebaseRecord.id, props: { anchor: 'middle' },
  }), '属性面板', { mergeKey: 'body-panel', time: 200 });
  const merged = boundary.history.undoCount === 1;
  boundary.transaction((tx) => tx.exec({
    type: 'SetBodyProps', id: rebaseRecord.id, props: { anchor: 'top' },
  }), '远端文字框属性', { origin: 'remote', recordHistory: false });
  check('属性面板连续提交可合并且远端同路径写入会安全裁掉旧历史',
    merged && boundary.history.undoCount === 0
      && edit.queryBodyProps(rebaseDoc, rebaseRecord.id).anchor === 'top'
      && boundary.undo() === null);
  edit.disposeDoc(rebaseDoc);
  edit.disposeDoc(doc);
}
