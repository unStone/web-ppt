const rejected = (run) => { try { run(); return false; } catch { return true; } };

/** 格式刷只从公开纯命令、有效投影和历史观察，避免把实现中的 patch 拼装当成契约。 */
export async function runFormatPainterContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 格式刷对象外观原子复制\x1b[0m');
  const presentation = await core.parse(load('sample-editor-format-painter.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'format-painter-' });
  const editor = new edit.Editor(doc);
  const recoveryFrames = [];
  editor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const records = Object.values(doc.elements);
  const named = (name) => records.find((record) => record.src.name === name);
  const source = named('format-source');
  const target = named('format-target-local');
  const crossTarget = named('format-target-cross-page');
  const emptySource = named('format-empty-source');
  const imageFillSource = named('format-image-fill-shape');
  const group = named('format-group');
  if (!check('专用固件含跨页 shape、image、group、表格和显式空格式',
    !!source && !!target && !!crossTarget && !!emptySource && !!imageFillSource
      && !!named('format-picture') && !!named('format-group') && !!named('format-table'))) return;

  editor.exec({
    type: 'SetFill', id: source.id,
    fill: { type: 'gradient', angle: 45, stops: [
      { pos: 0, color: '#123456' }, { pos: 1, color: 'rgba(240,120,60,0.5)' },
    ] },
  });
  editor.exec({
    type: 'SetStroke', id: source.id,
    stroke: { color: '#334455', width: 3, dash: [12, 9], cap: 'round', join: 'bevel' },
  });
  editor.exec({
    type: 'SetEffects', id: source.id,
    effects: { glow: { radius: 6, color: '#2563EB' }, softEdge: 1.5 },
  });
  const targetBefore = structuredClone(editor.effectiveElement(target.id));
  const sourceEffective = structuredClone(editor.effectiveElement(source.id));
  const targetIdentity = {
    id: target.src.id, x: target.src.x, y: target.src.y, w: target.src.w, h: target.src.h,
    name: target.src.name, text: structuredClone(target.src.kind === 'shape' ? target.src.text : null),
    link: structuredClone(target.src.link),
  };
  const historyBefore = editor.history.undoCount;
  const result = editor.exec({
    type: 'ApplyFormat', from: source.id, to: target.id,
    mask: ['fill', 'stroke', 'effects'],
  });
  const applied = editor.effectiveElement(target.id);
  check('ApplyFormat 把来源有效外观复制为目标直接覆盖且只形成一个历史单元',
    JSON.stringify(applied.fill) === JSON.stringify(sourceEffective.fill)
      && JSON.stringify(applied.stroke) === JSON.stringify(sourceEffective.stroke)
      && JSON.stringify(applied.effects) === JSON.stringify(sourceEffective.effects)
      && result.forward.length === 3 && result.dirtyElements.has(target.id)
      && !result.dirtyElements.has(source.id)
      && editor.history.undoCount === historyBefore + 1
      && Object.hasOwn(target.ovr, 'fill') && Object.hasOwn(target.ovr, 'stroke')
      && Object.hasOwn(target.ovr, 'effects'));
  check('格式刷不复制几何、内容、链接、名称或元素身份',
    JSON.stringify(targetIdentity) === JSON.stringify({
      id: target.src.id, x: target.src.x, y: target.src.y, w: target.src.w, h: target.src.h,
      name: target.src.name, text: structuredClone(target.src.kind === 'shape' ? target.src.text : null),
      link: structuredClone(target.src.link),
    }));
  editor.undo();
  check('撤销格式刷原子恢复目标全部外观且保留来源',
    JSON.stringify(editor.effectiveElement(target.id).fill) === JSON.stringify(targetBefore.fill)
      && JSON.stringify(editor.effectiveElement(target.id).stroke) === JSON.stringify(targetBefore.stroke)
      && JSON.stringify(editor.effectiveElement(target.id).effects) === JSON.stringify(targetBefore.effects)
      && JSON.stringify(editor.effectiveElement(source.id).fill) === JSON.stringify(sourceEffective.fill));

  const crossBefore = structuredClone(editor.effectiveElement(crossTarget.id));
  const crossResult = editor.exec({
    type: 'ApplyFormat', from: source.id, to: crossTarget.id,
    mask: ['fill', 'stroke', 'effects'],
  });
  const crossApplied = editor.effectiveElement(crossTarget.id);
  check('跨页继承不同时仍把来源有效外观物化为目标直接格式',
    JSON.stringify(crossBefore.fill) !== JSON.stringify(sourceEffective.fill)
      && JSON.stringify(crossApplied.fill) === JSON.stringify(sourceEffective.fill)
      && JSON.stringify(crossApplied.stroke) === JSON.stringify(sourceEffective.stroke)
      && JSON.stringify(crossApplied.effects) === JSON.stringify(sourceEffective.effects)
      && crossResult.forward.length === 3
      && Object.hasOwn(crossTarget.ovr, 'fill') && Object.hasOwn(crossTarget.ovr, 'stroke')
      && Object.hasOwn(crossTarget.ovr, 'effects'));
  editor.undo();

  const groupEffects = structuredClone(editor.effectiveElement(group.id).effects);
  editor.exec({
    type: 'ApplyFormat', from: group.id, to: target.id, mask: ['effects'],
  });
  const groupToShape = editor.effectiveElement(target.id);
  editor.undo();
  editor.exec({
    type: 'ApplyFormat', from: source.id, to: group.id, mask: ['effects'],
  });
  check('组合与形状之间只复制二维效果且两端都形成有效兼容目标',
    JSON.stringify(groupToShape.effects) === JSON.stringify(groupEffects)
      && JSON.stringify(editor.effectiveElement(group.id).effects)
        === JSON.stringify(sourceEffective.effects));
  editor.undo();

  editor.exec({
    type: 'ApplyFormat', from: emptySource.id, to: target.id,
    mask: ['fill', 'stroke', 'effects'],
  });
  const emptied = editor.effectiveElement(target.id);
  check('无填充、无描边和空效果是明确格式，不会误还原目标继承',
    emptied.fill?.type === 'none' && emptied.stroke === null
      && JSON.stringify(emptied.effects ?? {}) === '{}'
      && Object.hasOwn(target.ovr, 'fill') && Object.hasOwn(target.ovr, 'stroke')
      && Object.hasOwn(target.ovr, 'effects'),
  JSON.stringify({ fill: emptied.fill, stroke: emptied.stroke, effects: emptied.effects, ovr: target.ovr }));
  editor.undo();

  const combinedText = edit.textBodyEditText(editor.effectiveElement(target.id).text);
  const combinedHistory = editor.history.undoCount;
  const combined = editor.exec({
    type: 'ApplyFormat', from: source.id, to: target.id,
    mask: ['fill', 'run', 'paragraph', 'body'],
  });
  check('对象与文字格式可在一条命令中组合并共用单一撤销单元',
    combined.forward.filter((patch) => patch.path[3] === 'fill').length === 1
      && combined.forward.filter((patch) => patch.path.at(-1) === 'text').length === 1
      && edit.textBodyEditText(editor.effectiveElement(target.id).text) === combinedText
      && editor.history.undoCount === combinedHistory + 1);
  editor.undo();

  const image = named('format-picture');
  const atomicBefore = JSON.stringify(doc);
  const atomicHistory = editor.history.undoCount;
  const inheritedCommand = Object.assign(Object.create({ inherited: true }), {
    type: 'ApplyFormat', from: source.id, to: target.id, mask: ['fill'],
  });
  const sparseMask = [];
  sparseMask.length = 1;
  const extraMask = Object.assign(['fill'], { extra: true });
  const inheritedMask = ['fill'];
  Object.setPrototypeOf(inheritedMask, null);
  let accessorRead = false;
  const accessorMask = ['fill'];
  Object.defineProperty(accessorMask, '0', {
    enumerable: true, configurable: true,
    get() { accessorRead = true; return 'fill'; },
  });
  let commandAccessorRead = false;
  const accessorCommand = { from: source.id, to: target.id, mask: ['fill'] };
  Object.defineProperty(accessorCommand, 'type', {
    enumerable: true, configurable: true,
    get() { commandAccessorRead = true; return 'ApplyFormat'; },
  });
  const invalidResults = [
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: [] },
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: ['fill', 'fill'] },
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: ['unknown'] },
    { type: 'ApplyFormat', from: source.id, to: image.id, mask: ['fill'] },
    { type: 'ApplyFormat', from: imageFillSource.id, to: target.id, mask: ['fill'] },
    { type: 'ApplyFormat', from: 'missing', to: target.id, mask: ['fill'] },
    { type: 'ApplyFormat', from: source.id, to: 'missing', mask: ['fill'] },
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: ['fill'], extra: true },
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: ['fill'], fromCell: undefined },
    inheritedCommand,
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: sparseMask },
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: extraMask },
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: inheritedMask },
    { type: 'ApplyFormat', from: source.id, to: target.id, mask: accessorMask },
    accessorCommand,
    {
      type: 'ApplyFormat', from: source.id, to: target.id, mask: ['run'],
      fromRange: {
        from: { p: 0, r: 0, off: 0, extra: true }, to: { p: 0, r: 0, off: 1 },
      },
    },
  ].map((command) => rejected(() => editor.exec(command)));
  const invalid = invalidResults.every(Boolean);
  check('非法掩码、类型、身份、原型与嵌套额外字段在落模前原子拒绝',
    invalid && !accessorRead && !commandAccessorRead && JSON.stringify(doc) === atomicBefore
      && editor.history.undoCount === atomicHistory,
  JSON.stringify({
    invalidResults, accessorRead, commandAccessorRead,
    history: editor.history.undoCount - atomicHistory,
  }));
  editor.exec({ type: 'SetElementHidden', id: target.id, hidden: true });
  const hiddenBefore = JSON.stringify(doc);
  const hiddenHistory = editor.history.undoCount;
  check('隐藏格式目标在命令边界原子拒绝',
    rejected(() => editor.exec({
      type: 'ApplyFormat', from: source.id, to: target.id, mask: ['fill'],
    })) && JSON.stringify(doc) === hiddenBefore && editor.history.undoCount === hiddenHistory);
  editor.exec({ type: 'SetElementHidden', id: target.id, hidden: false });
  const relationBefore = JSON.stringify(doc);
  check('同一事务不允许删除格式来源再依赖它读取外观',
    rejected(() => editor.transaction((transaction) => {
      transaction.exec({
        type: 'ApplyFormat', from: source.id, to: target.id, mask: ['fill'],
      });
      transaction.exec({ type: 'RemoveElement', id: source.id });
    })) && JSON.stringify(doc) === relationBefore);
  const recoveredPresentation = await core.parse(load('sample-editor-format-painter.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveredDoc = edit.createDoc(recoveredPresentation, { idPrefix: 'format-painter-' });
  const persistedFrames = JSON.parse(JSON.stringify(recoveryFrames));
  const recoveredEditor = new edit.Editor(recoveredDoc, { recoveryFrames: persistedFrames });
  const model = (value) => JSON.stringify({
    identity: value.identity, slides: value.slides, slideOrder: value.slideOrder,
    elements: value.elements, removedElements: value.removedElements,
  });
  check('ApplyFormat 与撤销帧可纯 JSON 往返并恢复精确模型',
    recoveryFrames.some((frame) => frame.patches.some((patch) =>
      patch.path[0] === 'elements' && patch.path[3] === 'fill'))
      && model(recoveredDoc) === model(doc) && recoveredEditor.history.undoCount === 0);
  edit.disposeDoc(recoveredDoc);
  edit.disposeDoc(doc);

  console.log('\n\x1b[36m▸ 格式刷文字格式与混合来源\x1b[0m');
  const textPresentation = await core.parse(load('sample-editor-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const textDoc = edit.createDoc(textPresentation, { idPrefix: 'format-text-' });
  const textEditor = new edit.Editor(textDoc);
  const textRecords = Object.values(textDoc.elements);
  const textSource = textRecords.find((record) => record.src.name === '重复格式');
  const textTarget = textRecords.find((record) => record.src.name === '中段格式');
  const richSource = textRecords.find((record) => record.src.name === '文本综合');
  const whole = (body) => ({
    from: { p: 0, r: 0, off: 0 },
    to: edit.textPositionAtIndex(body, edit.textBodyEditText(body).length),
  });
  const sourceRange = whole(textEditor.effectiveElement(textSource.id).text);
  textEditor.exec({
    type: 'SetRunProps', id: textSource.id, range: sourceRange,
    props: { font: 'Noto Sans', size: 31.2, color: '#123456', b: true, i: true, u: true, strike: true },
  });
  textEditor.exec({
    type: 'SetParaProps', id: textSource.id, range: sourceRange,
    props: {
      align: 'center', lineHeight: 1.8, spaceBefore: 7, spaceAfter: 9,
      marginLeft: 12, indent: -4,
    },
  });
  textEditor.exec({
    type: 'SetBodyProps', id: textSource.id,
    props: {
      anchor: 'bottom', insets: [3, 4, 5, 6], wrap: false,
      vert: 'horz', anchorCtr: true, columns: 2, columnGap: 8, autoFit: 'none',
    },
  });
  const targetTextBefore = edit.textBodyEditText(textEditor.effectiveElement(textTarget.id).text);
  const textHistory = textEditor.history.undoCount;
  const textResult = textEditor.exec({
    type: 'ApplyFormat', from: textSource.id, to: textTarget.id,
    mask: ['run', 'paragraph', 'body'],
  });
  const targetBody = textEditor.effectiveElement(textTarget.id).text;
  const targetRange = whole(targetBody);
  check('文字格式刷一次复制字符、段落与文字框有效值且不改目标内容',
    edit.textBodyEditText(targetBody) === targetTextBefore
      && JSON.stringify(edit.queryRunProps(textDoc, textTarget.id, targetRange))
        === JSON.stringify(edit.queryRunProps(textDoc, textSource.id, sourceRange))
      && JSON.stringify(edit.queryParaProps(textDoc, textTarget.id, targetRange))
        === JSON.stringify(edit.queryParaProps(textDoc, textSource.id, sourceRange))
      && JSON.stringify(edit.queryBodyProps(textDoc, textTarget.id))
        === JSON.stringify(edit.queryBodyProps(textDoc, textSource.id))
      && textResult.forward.filter((patch) => patch.path.at(-1) === 'text').length === 1
      && textEditor.history.undoCount === textHistory + 1);
  textEditor.undo();
  check('撤销文字格式刷同时恢复三类格式和原内容',
    edit.textBodyEditText(textEditor.effectiveElement(textTarget.id).text) === targetTextBefore);

  textEditor.exec({
    type: 'SetParaProps', id: textSource.id, range: sourceRange, props: { lineHeight: null },
  });
  textEditor.exec({
    type: 'SetParaProps', id: textTarget.id, range: targetRange, props: { lineHeight: 2.2 },
  });
  const defaultLineHeight = edit.queryParaProps(textDoc, textSource.id, sourceRange).lineHeight;
  textEditor.exec({
    type: 'ApplyFormat', from: textSource.id, to: textTarget.id, mask: ['paragraph'],
  });
  check('来源默认行距被物化为 1.2 倍行盒，不会误恢复目标的不同继承',
    !defaultLineHeight.mixed && defaultLineHeight.value === null
      && edit.queryParaProps(textDoc, textTarget.id, targetRange).lineHeight.value === 1.2);
  textEditor.undo();

  const richRange = whole(textEditor.effectiveElement(richSource.id).text);
  const mixedBefore = JSON.stringify(textDoc);
  const mixedHistory = textEditor.history.undoCount;
  check('混合字符来源拒绝猜测第一个值并保持命令原子',
    rejected(() => textEditor.exec({
      type: 'ApplyFormat', from: richSource.id, to: textTarget.id,
      fromRange: richRange, mask: ['run'],
    }))
      && JSON.stringify(textDoc) === mixedBefore && textEditor.history.undoCount === mixedHistory);
  edit.disposeDoc(textDoc);

  console.log('\n\x1b[36m▸ 格式刷驱动 spAutoFit\x1b[0m');
  const fitPresentation = await core.parse(load('sample-editor-sp-autofit.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const fitDoc = edit.createDoc(fitPresentation, { idPrefix: 'format-fit-' });
  const fitEditor = new edit.Editor(fitDoc);
  const fitSource = Object.values(fitDoc.elements)
    .find((record) => record.src.name === 'sp-autofit-disabled');
  const fitTarget = Object.values(fitDoc.elements)
    .find((record) => record.src.name === 'sp-autofit-top');
  fitEditor.exec({ type: 'FitTextShape', id: fitTarget.id });
  const fitSourceBody = fitEditor.effectiveElement(fitSource.id).text;
  const fitSourceRange = whole(fitSourceBody);
  fitEditor.exec({
    type: 'SetRunProps', id: fitSource.id, range: fitSourceRange,
    props: { size: 40 },
  });
  const fitBefore = fitEditor.effectiveElement(fitTarget.id).h;
  const fitResult = fitEditor.exec({
    type: 'ApplyFormat', from: fitSource.id, to: fitTarget.id, mask: ['run'],
  });
  check('文字格式刷与普通文字命令共用自动改高且只派生一次',
    fitEditor.effectiveElement(fitTarget.id).h > fitBefore
      && fitResult.forward.filter((item) => item.path[3] === 'h').length === 1);
  edit.disposeDoc(fitDoc);

  console.log('\n\x1b[36m▸ 格式刷表格单元格文字\x1b[0m');
  const tablePresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const tableDoc = edit.createDoc(tablePresentation, { idPrefix: 'format-table-' });
  const tableEditor = new edit.Editor(tableDoc);
  const table = Object.values(tableDoc.elements).find((record) => record.src.kind === 'table');
  const cellRange = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 },
  };
  tableEditor.exec({
    type: 'SetRunProps', id: table.id, cell: { r: 0, c: 0 }, range: cellRange,
    props: { font: 'Aptos', size: 28, b: true, i: false, u: true, strike: false },
  });
  tableEditor.exec({
    type: 'SetParaProps', id: table.id, cell: { r: 0, c: 0 }, range: cellRange,
    props: { align: 'right' },
  });
  tableEditor.exec({
    type: 'SetBodyProps', id: table.id, cell: { r: 0, c: 0 },
    props: { anchor: 'bottom', insets: [2, 3, 4, 5] },
  });
  tableEditor.exec({
    type: 'ApplyFormat', from: table.id, to: table.id,
    fromCell: { r: 0, c: 0 }, toCell: { r: 0, c: 1 },
    mask: ['run', 'paragraph', 'body'],
  });
  const tableEffective = tableEditor.effectiveElement(table.id);
  const targetCellBody = tableEffective.rows[0].cells[1].text;
  check('同一表格的格式刷按显式单元格地址复制格式且保留目标文字',
    edit.textBodyEditText(targetCellBody) === 'B'
      && edit.queryRunProps(tableDoc, table.id, cellRange, { r: 0, c: 1 }).b.value === true
      && edit.queryParaProps(tableDoc, table.id, cellRange, { r: 0, c: 1 }).align.value === 'right'
      && edit.queryBodyProps(tableDoc, table.id, { r: 0, c: 1 }).anchor === 'bottom');
  edit.disposeDoc(tableDoc);
}
