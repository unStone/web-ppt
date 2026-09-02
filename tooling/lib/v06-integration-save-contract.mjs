import { equalBytes } from './bytes.mjs';

function addShape(editor, slideId, name, x) {
  editor.exec({
    type: 'AddShape', slideId, preset: 'roundRect',
    rect: { x, y: 70, w: 220, h: 120 },
  });
  const id = editor.selection.ids[0];
  editor.exec({ type: 'SetName', id, name });
  return id;
}

export function applyV06Journey(edit, editor) {
  const { doc } = editor;
  const firstSlide = doc.slideOrder[0];
  const shapeIds = [
    addShape(editor, firstSlide, '0.6 列表形状', 70),
    addShape(editor, firstSlide, '0.6 分布中项', 350),
    addShape(editor, firstSlide, '0.6 分布末项', 690),
  ];
  editor.exec({
    type: 'EditText', id: shapeIds[0], ops: [{
      type: 'replaceFragment',
      from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      fragment: { paragraphs: [
        { text: '表格结构', marks: [{ from: 0, to: 4, props: {} }] },
        { text: '批量导出', marks: [{ from: 0, to: 4, props: {} }] },
      ] },
    }],
  });
  editor.exec({
    type: 'SetParaProps', id: shapeIds[0],
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 } },
    props: { bullet: { kind: 'char', char: '◆' } },
  });
  editor.exec({
    type: 'SetParaProps', id: shapeIds[0],
    range: { from: { p: 1, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } },
    props: { bullet: { kind: 'autoNum', type: 'arabicPeriod', startAt: 3 } },
  });
  editor.exec({
    type: 'SetRunProps', id: shapeIds[0],
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 4 } },
    props: {
      underline: 'wavyDbl', strikeType: 'sngStrike', highlight: '#FDE68A',
      spacing: 2, caps: 'small', baseline: 18,
    },
  });
  editor.exec({ type: 'SetAdj', id: shapeIds[0], name: 'adj', value: 36_000 });
  editor.exec({
    type: 'SetAltText', id: shapeIds[0], title: '0.6 集成形状', descr: '列表与高级字符格式',
  });
  editor.exec({ type: 'DistributeElements', ids: shapeIds, axis: 'horizontal' });

  editor.exec({
    type: 'AddTable', slideId: firstSlide, rows: 2, cols: 2,
    rect: { x: 170, y: 260, w: 760, h: 270 },
  });
  const tableId = editor.selection.ids[0];
  editor.exec({ type: 'SetName', id: tableId, name: '0.6 结构表格' });
  const sourceGrid = edit.queryTableGrid(doc, tableId);
  editor.exec({ type: 'InsertRow', id: tableId, at: { before: sourceGrid.rows[1].id } });
  editor.exec({ type: 'InsertColumn', id: tableId, at: { before: sourceGrid.columns[1].id } });
  const grid = edit.queryTableGrid(doc, tableId);
  editor.exec(
    { type: 'SetRowHeight', id: tableId, row: grid.rows[0].id, height: 96 },
    { type: 'SetColumnWidth', id: tableId, column: grid.columns[0].id, width: 300 },
  );
  const anchor = { row: grid.rows[0].id, column: grid.columns[0].id };
  editor.exec({
    type: 'MergeCells', id: tableId, from: anchor,
    to: { row: grid.rows[0].id, column: grid.columns[1].id },
  });
  editor.exec({
    type: 'SetCellProps', id: tableId, cell: anchor,
    props: { fill: { type: 'solid', color: '#DBEAFE' }, margins: [6, 8, 6, 8], vAlign: 'middle' },
  });
  editor.exec({
    type: 'EditText', id: tableId, cell: { r: 0, c: 0 }, ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '跨能力旅程',
    }],
  });

  const layoutId = doc.layoutOrder.find((id) => doc.layouts[id].name === '空白')
    ?? doc.layoutOrder[0];
  const result = editor.exec({ type: 'AddSlide', layoutId, at: { after: firstSlide } });
  const secondSlide = [...result.createdSlides][0];
  editor.exec({
    type: 'AddSection', name: '0.6 集成旅程', slideIds: [firstSlide, secondSlide],
    at: { after: null },
  });
  editor.exec({ type: 'SetSlideSize', w: 1200, h: 675 });
  const undoWorked = editor.undo();
  const undoSize = edit.querySlideSize(doc);
  const redoWorked = editor.redo();
  const redoSize = edit.querySlideSize(doc);
  return {
    firstSlide, secondSlide, shapeIds, tableId,
    historyRoundTrip: undoWorked && redoWorked
      && undoSize.w === 1280 && undoSize.h === 720
      && redoSize.w === 1200 && redoSize.h === 675,
  };
}

function reopenedEvidence(presentation) {
  const first = presentation.slides[0];
  const shape = first?.elements.find((element) => element.name === '0.6 列表形状');
  const table = first?.elements.find((element) => element.name === '0.6 结构表格');
  const paragraphs = shape?.kind === 'shape' ? shape.text?.paragraphs : undefined;
  const firstRun = paragraphs?.[0]?.runs[0];
  return {
    complete: presentation.width === 1200 && presentation.height === 675
      && presentation.slides.length === 2
      && presentation.sections?.[0]?.name === '0.6 集成旅程'
      && presentation.slides.some((slide) => slide.elements.some((element) =>
        element.kind === 'shape' && element.text?.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.field?.toLowerCase() === 'slidenum'))))
      && shape?.kind === 'shape'
      && shape.editInfo?.altText?.title === '0.6 集成形状'
      && shape.editInfo.altText.descr === '列表与高级字符格式'
      && shape.editInfo?.geom?.preset === 'roundRect'
      && shape.editInfo.geom.adj.adj === 36_000
      && paragraphs?.[0]?.bullet === '◆' && paragraphs?.[1]?.bullet === '3.'
      && firstRun?.underline === 'wavyDbl' && firstRun.strikeType === 'sngStrike'
      && firstRun.highlight === 'rgb(253,230,138)' && firstRun.spacing === 2
      && firstRun.caps === 'small' && firstRun.baseline === 18
      && table?.kind === 'table' && table.rows.length === 3 && table.colWidths.length === 3
      && table.rows[0].height === 96 && table.colWidths[0] === 300
      && table.rows[0].cells[0].colSpan === 2
      && table.rows[0].cells[0].fill?.type === 'solid'
      && table.rows[0].cells[0].text?.paragraphs[0]?.runs
        .map((run) => run.text).join('').startsWith('跨能力旅程'),
    slideCount: presentation.slides.length,
  };
}

async function saveRecovered({ core, edit, blank, frames, mode, saveArtifact }) {
  const presentation = await core.parse(blank, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'v06-journey-' });
  const editor = new edit.Editor(doc, { recoveryFrames: frames });
  if (mode === 'generated') presentation.dispose?.();
  const saved = await editor.saveDetailed();
  const again = await editor.saveDetailed();
  const path = saveArtifact(`v06-integration-${mode}.pptx`, saved.bytes);
  const reopened = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const evidence = reopenedEvidence(reopened);
  reopened.dispose?.();
  edit.disposeDoc(doc);
  return { ...evidence, path, saved, deterministic: equalBytes(saved.bytes, again.bytes) };
}

/** 从新建到恢复、两种保存与重开的单条 0.6 用户旅程。 */
export async function runV06IntegrationSaveContract({ core, edit, generate, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 0.6 跨能力用户旅程\x1b[0m');
  const blank = generate.createBlankPptx();
  check('新建文稿固件连续生成逐字节一致', equalBytes(blank, generate.createBlankPptx()));
  const presentation = await core.parse(blank, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'v06-journey-' });
  const editor = new edit.Editor(doc);
  const frames = [];
  const unsubscribe = editor.subscribeRecovery((frame) => frames.push(frame));
  const journey = applyV06Journey(edit, editor);
  unsubscribe();
  check('跨能力旅程的撤销与重做保持页面尺寸事务完整', journey.historyRoundTrip);
  check('跨能力旅程写入可序列化恢复日志', frames.length > 0
    && JSON.parse(JSON.stringify(frames)).length === frames.length);
  const projected = editor.toSlide(journey.firstSlide);
  check('同一投影同时包含列表预设形状、结构表格和页面命令',
    projected.elements.some((element) => element.name === '0.6 列表形状')
      && projected.elements.some((element) => element.name === '0.6 结构表格')
      && edit.listSections(doc)[0]?.slideIds.length === 2
      && edit.querySlideSize(doc).w === 1200);
  edit.disposeDoc(doc);

  const recoveredFrames = JSON.parse(JSON.stringify(frames));
  const patch = await saveRecovered({
    core, edit, blank, frames: recoveredFrames, mode: 'patch', saveArtifact,
  });
  const generated = await saveRecovered({
    core, edit, blank, frames: recoveredFrames, mode: 'generated', saveArtifact,
  });
  check('恢复后的补丁保存重开保留七类 0.6 语义', patch.complete);
  check('恢复后的生成保存重开保留七类 0.6 语义', generated.complete);
  check('恢复后的补丁与生成保存连续执行都逐字节确定',
    patch.deterministic && generated.deterministic);
  check('同一恢复日志的两条保存路径页数一致且模式明确',
    patch.slideCount === generated.slideCount
      && ['passthrough', 'repacked'].includes(patch.saved.mode)
      && generated.saved.mode === 'repacked');
}
