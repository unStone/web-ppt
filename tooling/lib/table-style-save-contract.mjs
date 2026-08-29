import { diffPackageBytes } from '../diff-package.mjs';

const STYLE_ID = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const decoder = new TextDecoder();

const appearance = (table) => table.rows.map((row) => row.cells.map((cell) => ({
  fill: cell.fill, borders: cell.borders,
  text: cell.text?.paragraphs.map((paragraph) => paragraph.runs.map((run) => ({
    text: run.text, b: run.b, color: run.color,
  }))),
})));

/** 表样式保存只从公开命令、OPC 差异与重解析投影取证。 */
export async function runTableStyleSaveContract({
  edit, core, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ TableStyle 最小写回与缺失样式物化\x1b[0m');
  const input = load('sample-editor-table-text.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'table-style-save-' });
  const editor = new edit.Editor(doc);
  const id = Object.values(doc.elements)
    .find((record) => record.src.kind === 'table' && record.src.name === '追加行样式')?.id;
  if (!check('找到表样式保存目标', !!id)) return;
  editor.exec({
    type: 'SetTableStyle', id, styleId: STYLE_ID,
    firstRow: true, lastRow: true, bandRow: false,
    firstCol: true, lastCol: false, bandCol: true,
  });
  const projected = editor.effectiveElement(id);
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('table-style.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const slideXml = decoder.decode(saved.package.parts['ppt/slides/slide3.xml']);
  const styleXml = decoder.decode(saved.package.parts['ppt/tableStyles.xml']);
  const hostStart = slideXml.lastIndexOf('<p:graphicFrame>', slideXml.indexOf('name="追加行样式"'));
  const host = slideXml.slice(hostStart, slideXml.indexOf('</p:graphicFrame>', hostStart));
  const tableProps = host.match(/<a:tblPr\b[^>]*>[\s\S]*?<\/a:tblPr>/)?.[0] ?? '';

  check('保存只改目标页与 tableStyles.xml，内置定义恰好物化一次',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide3.xml,ppt/tableStyles.xml'
      && styleXml.split(`styleId="${STYLE_ID}"`).length - 1 === 1
      && styleXml.includes('styleName="Medium Style 2 - Accent 1"'),
  `artifact=${artifact}`);
  check('tblPr 六开关按默认值最小改写且 tableStyleId 更新',
    tableProps.includes('firstRow="1"') && tableProps.includes('lastRow="1"')
      && tableProps.includes('firstCol="1"') && tableProps.includes('bandCol="1"')
      && !tableProps.includes('bandRow=') && !tableProps.includes('lastCol=')
      && tableProps.includes(`<a:tableStyleId>${STYLE_ID}</a:tableStyleId>`));

  const reopened = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const table = reopened.slides[2].elements
    .find((element) => element.kind === 'table' && element.name === '追加行样式');
  check('保存重解析后的表样式投影与保存前一致',
    table?.kind === 'table'
      && JSON.stringify(appearance(table)) === JSON.stringify(appearance(projected)));
  const scenario = {
    type: 'tableStyle', file: 'sample-editor-table-text.pptx', slideIndex: 2,
    targetName: '追加行样式', settings: {
      styleId: STYLE_ID,
      firstRow: true, lastRow: true, bandRow: false,
      firstCol: true, lastCol: false, bandCol: true,
    },
  };
  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  check('保存前后 HTML 与原生 SVG 在独立进程中投影指纹一致',
    projectedFingerprint.html === savedFingerprint.html
      && projectedFingerprint.svg === savedFingerprint.svg);

  const identity = await editor.saveDetailed();
  check('相同模型连续保存复用当前包 identity', identity.mode === 'identity' && identity.bytes === saved.bytes);
  editor.undo();
  const reset = await editor.saveDetailed();
  check('保存后撤销从首次基线移除按需样式并恢复原包', diffPackageBytes(input, reset.bytes).equal);
  edit.disposeDoc(doc);

  const noPartInput = load('sample-generated-save.pptx');
  const noPartPresentation = await core.parse(noPartInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const noPartDoc = edit.createDoc(noPartPresentation, { idPrefix: 'table-style-part-' });
  const noPartEditor = new edit.Editor(noPartDoc);
  const noPartId = Object.values(noPartDoc.elements)
    .find((record) => record.src.kind === 'table')?.id;
  if (!check('找到无 tableStyles.xml 的表格固件', !!noPartId)) return;
  noPartEditor.exec({
    type: 'SetTableStyle', id: noPartId, styleId: STYLE_ID,
    firstRow: true, lastRow: false, bandRow: true,
    firstCol: false, lastCol: false, bandCol: false,
  });
  const noPartSaved = await noPartEditor.saveDetailed();
  saveArtifact('table-style-new-part.pptx', noPartSaved.bytes);
  const noPartDiff = diffPackageBytes(noPartInput, noPartSaved.bytes);
  const contentTypes = decoder.decode(noPartSaved.package.parts['[Content_Types].xml']);
  const relationships = decoder.decode(noPartSaved.package.parts['ppt/_rels/presentation.xml.rels']);
  check('来源缺少表样式 part 时按需补齐唯一 OPC 闭包',
    noPartDiff.added.join(',') === 'ppt/tableStyles.xml'
      && noPartDiff.removed.length === 0
      && noPartDiff.changed.join(',')
        === '[Content_Types].xml,ppt/_rels/presentation.xml.rels,ppt/slides/slide1.xml'
      && contentTypes.includes('PartName="/ppt/tableStyles.xml"')
      && relationships.includes('/relationships/tableStyles')
      && relationships.includes('Target="tableStyles.xml"'));
  const noPartReopened = await core.parse(noPartSaved.bytes, { edit: true, lazy: false, assets: 'defer' });
  check('新建 tableStyles.xml 的产物可重开并枚举已物化样式',
    noPartReopened.editInfo.tableStylesPart === 'ppt/tableStyles.xml'
      && noPartReopened.slides[0].editInfo.tableStyles
        .some((definition) => definition.styleId === STYLE_ID));
  noPartEditor.undo();
  const noPartReset = await noPartEditor.saveDetailed();
  check('保存后撤销移除新建表样式 OPC 闭包并恢复原包',
    diffPackageBytes(noPartInput, noPartReset.bytes).equal);
  edit.disposeDoc(noPartDoc);

  const oraclePresentation = await core.parse(load('sample-editor-table-style.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const oracleDoc = edit.createDoc(oraclePresentation, { idPrefix: 'table-style-oracle-' });
  const oracleEditor = new edit.Editor(oracleDoc);
  const oracleId = Object.values(oracleDoc.elements)
    .find((record) => record.src.kind === 'table' && record.src.name === '六开关表样式')?.id;
  if (!check('找到 LibreOffice 表样式 oracle', !!oracleId)) return;
  oracleEditor.exec({
    type: 'SetRunProps', id: oracleId, cell: { r: 0, c: 2 },
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 3 } },
    props: { b: false, color: '#7C3AED' },
  });
  oracleEditor.exec({
    type: 'SetTableStyle', id: oracleId,
    styleId: '{71A84F42-BA92-4C1E-9EE0-71590D54A071}',
    firstRow: true, lastRow: true, bandRow: true,
    firstCol: false, lastCol: false, bandCol: false,
  });
  const oracleSaved = await oracleEditor.saveDetailed();
  saveArtifact('table-style-oracle.pptx', oracleSaved.bytes);
  const oracleDiff = diffPackageBytes(load('sample-editor-table-style.pptx'), oracleSaved.bytes);
  const oracleReopened = await core.parse(oracleSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const oracleReopenedTable = oracleReopened.slides[0].elements
    .find((element) => element.kind === 'table' && element.name === '六开关表样式');
  const oracleSessionRun = oracleReopenedTable?.kind === 'table'
    ? oracleReopenedTable.rows[0].cells[2].text.paragraphs[0].runs[0] : null;
  check('已有文档样式只最小改写目标页并保留直接格式与未知尾节点',
    oracleDiff.added.length === 0 && oracleDiff.removed.length === 0
      && oracleDiff.changed.join(',') === 'ppt/slides/slide1.xml'
      && oracleSaved.package.parts['ppt/slides/slide1.xml']
      && decoder.decode(oracleSaved.package.parts['ppt/slides/slide1.xml'])
        .includes('{TABLE-STYLE-KEEP}')
      && oracleSessionRun?.b === false && oracleSessionRun.color === 'rgb(124,58,237)');
  const oracleReopenedDoc = edit.createDoc(oracleReopened, { idPrefix: 'table-style-oracle-reopened-' });
  const oracleReopenedEditor = new edit.Editor(oracleReopenedDoc);
  const oracleReopenedId = Object.values(oracleReopenedDoc.elements)
    .find((record) => record.src.kind === 'table' && record.src.name === '六开关表样式')?.id;
  oracleReopenedEditor.exec({
    type: 'SetTableStyle', id: oracleReopenedId,
    styleId: STYLE_ID,
    firstRow: true, lastRow: false, bandRow: true,
    firstCol: false, lastCol: false, bandCol: false,
  });
  const oracleRestyledRun = oracleReopenedEditor.effectiveElement(oracleReopenedId)
    .rows[0].cells[2].text.paragraphs[0].runs[0];
  check('补丁保存重开后二次切换样式仍保留会话字符直设',
    oracleRestyledRun.b === false && oracleRestyledRun.color === 'rgb(124,58,237)');
  edit.disposeDoc(oracleReopenedDoc);
  edit.disposeDoc(oracleDoc);
}
