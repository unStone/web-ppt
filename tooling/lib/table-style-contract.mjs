const BUILTIN_STYLE_ID = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const CUSTOM_STYLE_ID = '{A7D87910-7B6D-4B2F-9B21-54CB9C43E801}';
const APPEND_STYLE_ID = '{BFD9FC95-08A9-47D3-9785-8DB2E5A35D39}';
const SWITCH_STYLE_ID = '{71A84F42-BA92-4C1E-9EE0-71590D54A071}';
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };
const color = (table, row, column) => table.rows[row].cells[column].fill?.color;

/** 表样式目录只经公开 EditDoc seam 暴露，任意 UI 可直接渲染预览表格。 */
export async function runTableStyleContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ TableStyle 目录、命令与历史\x1b[0m');
  const input = load('sample-editor-table-text.pptx');
  if (!check('找到确定性表样式固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'table-style-' });
  const slideId = doc.slideOrder[0];
  const catalog = edit.listTableStyles(doc, slideId);
  const custom = catalog.find((item) => item.styleId === CUSTOM_STYLE_ID);
  const builtin = catalog.find((item) => item.styleId === BUILTIN_STYLE_ID);

  check('公开目录合并文档自带与内置样式并返回可直接渲染的预览',
    custom?.name === 'Editor Table Text' && custom.source === 'document'
      && builtin?.name === 'Medium Style 2 - Accent 1' && builtin.source === 'builtin'
      && catalog.every((item) => item.preview.kind === 'table'
        && item.preview.rows.length === 3 && item.preview.colWidths.length === 3
        && core.renderElementToSvg(item.preview, { idPrefix: `style-${item.styleId}-` }).markup
          .includes('<g')));

  const styledSlideId = doc.slideOrder[2];
  const styledId = Object.values(doc.elements)
    .find((record) => record.src.kind === 'table' && record.src.name === '追加行样式')?.id;
  const directId = Object.values(doc.elements)
    .find((record) => record.src.kind === 'table' && record.src.name === '表格文字综合')?.id;
  if (!check('找到样式切换与直接格式表格', !!styledId && !!directId)) return;
  const editor = new edit.Editor(doc);
  const sourceFill = editor.effectiveElement(styledId).rows[0].cells[0].fill;
  const directFill = editor.effectiveElement(directId).rows[0].cells[0].fill;
  const settings = {
    firstRow: true, lastRow: false, bandRow: true,
    firstCol: false, lastCol: false, bandCol: false,
  };
  editor.exec({ type: 'SetTableStyle', id: styledId, styleId: BUILTIN_STYLE_ID, ...settings });
  editor.exec({ type: 'SetTableStyle', id: directId, styleId: BUILTIN_STYLE_ID, ...settings });
  const switched = editor.effectiveElement(styledId);
  const direct = editor.effectiveElement(directId);
  check('SetTableStyle 即时切换样式且不清洗单元格直接填充',
    JSON.stringify(switched.rows[0].cells[0].fill) !== JSON.stringify(sourceFill)
      && JSON.stringify(direct.rows[0].cells[0].fill) === JSON.stringify(directFill)
      && doc.elements[styledId].ovr.tableStyle.styleId === BUILTIN_STYLE_ID
      && editor.history.undoCount === 2);
  editor.undo();
  editor.undo();
  check('撤销两次恢复来源样式与直接格式且不残留覆盖',
    JSON.stringify(editor.effectiveElement(styledId).rows[0].cells[0].fill) === JSON.stringify(sourceFill)
      && !Object.hasOwn(doc.elements[styledId].ovr, 'tableStyle')
      && !Object.hasOwn(doc.elements[directId].ovr, 'tableStyle'));
  editor.redo();
  editor.exec({ type: 'SetTableStyle', id: styledId, styleId: null });
  check('styleId=null 恢复来源并形成可撤销历史',
    !Object.hasOwn(doc.elements[styledId].ovr, 'tableStyle')
      && editor.history.undoCount === 2
      && doc.slides[styledSlideId].tableStyles.some((style) => style.styleId === APPEND_STYLE_ID));

  const switchPresentation = await core.parse(load('sample-editor-table-style.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const switchDoc = edit.createDoc(switchPresentation, { idPrefix: 'table-switch-' });
  const switchEditor = new edit.Editor(switchDoc);
  const switchId = Object.values(switchDoc.elements)
    .find((record) => record.src.kind === 'table' && record.src.name === '六开关表样式')?.id;
  if (!check('找到六开关确定性固件', !!switchId)) return;
  const off = {
    firstRow: false, lastRow: false, bandRow: false,
    firstCol: false, lastCol: false, bandCol: false,
  };
  const cases = [
    ['firstRow', [[0, 0, 'rgb(239,68,68)']]],
    ['lastRow', [[3, 0, 'rgb(34,197,94)']]],
    ['bandRow', [[0, 0, 'rgb(59,130,246)'], [1, 0, 'rgb(250,204,21)']]],
    ['firstCol', [[0, 0, 'rgb(168,85,247)']]],
    ['lastCol', [[0, 3, 'rgb(249,115,22)']]],
    ['bandCol', [[0, 0, 'rgb(6,182,212)'], [0, 1, 'rgb(236,72,153)']]],
  ];
  for (const [field, probes] of cases) {
    switchEditor.exec({
      type: 'SetTableStyle', id: switchId, styleId: SWITCH_STYLE_ID,
      ...off, [field]: true,
    });
    const table = switchEditor.effectiveElement(switchId);
    check(`${field} 开关独立控制对应表样式区域`,
      probes.every(([row, column, expected]) => color(table, row, column) === expected));
    switchEditor.undo();
  }
  switchEditor.exec({
    type: 'SetRunProps', id: switchId, cell: { r: 0, c: 2 },
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 3 } },
    props: { b: false, color: '#7C3AED' },
  });
  switchEditor.exec({
    type: 'SetTableStyle', id: switchId, styleId: SWITCH_STYLE_ID,
    ...off, firstRow: true, bandRow: true, bandCol: true,
  });
  const directTable = switchEditor.effectiveElement(switchId);
  const directRun = directTable.rows[0].cells[1].text.paragraphs[0].runs[0];
  const sessionDirectRun = directTable.rows[0].cells[2].text.paragraphs[0].runs[0];
  check('单元格直接填充、边框与字符直设高于切换后的表样式',
    color(directTable, 1, 1) === 'rgb(17,24,39)'
      && directTable.rows[1].cells[1].borders.l?.color === 'rgb(220,38,38)'
      && directRun.b === false && directRun.color === 'rgb(16,185,129)'
      && sessionDirectRun.b === false && sessionDirectRun.color === 'rgb(124,58,237)'
      && directTable.rows[0].cells[0].text.paragraphs[0].runs[0].b === true,
  `source=${JSON.stringify(directRun)} session=${JSON.stringify(sessionDirectRun)}`);
  const state = edit.queryTableStyle(switchDoc, switchId);
  check('公开查询区分来源值与直接覆盖', state.direct && state.source.styleId === SWITCH_STYLE_ID
    && state.value.firstRow && state.value.bandRow && state.value.bandCol);
  switchEditor.exec({
    type: 'SetTableStyle', id: switchId, styleId: BUILTIN_STYLE_ID,
    firstRow: true, lastRow: false, bandRow: true,
    firstCol: false, lastCol: false, bandCol: false,
  });
  const restyledSessionRun = switchEditor.effectiveElement(switchId)
    .rows[0].cells[2].text.paragraphs[0].runs[0];
  check('会话中新建的字符直设在二次切换表样式后仍保持优先',
    restyledSessionRun.b === false && restyledSessionRun.color === 'rgb(124,58,237)',
  JSON.stringify(restyledSessionRun));
  check('未知样式、缺失开关与 reset 混带开关在提交前拒绝',
    rejected(() => switchEditor.exec({ type: 'SetTableStyle', id: switchId, styleId: '{UNKNOWN}', ...off }))
      && rejected(() => switchEditor.exec({ type: 'SetTableStyle', id: switchId, styleId: SWITCH_STYLE_ID }))
      && rejected(() => switchEditor.exec({ type: 'SetTableStyle', id: switchId, styleId: null, firstRow: true })));
}
