import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);
const DASH_PRESETS = [
  ['dash', [4, 3]], ['dashDot', [4, 3, 1, 3]], ['dot', [1, 3]], ['lgDash', [8, 3]],
  ['lgDashDot', [8, 3, 1, 3]], ['lgDashDotDot', [8, 3, 1, 3, 1, 3]],
  ['sysDash', [3, 3]], ['sysDashDot', [3, 3, 1, 3]],
  ['sysDashDotDot', [3, 3, 1, 3, 1, 3]], ['sysDot', [1, 1]],
];

const alternateContent = (xml) =>
  xml.match(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/)?.[0] ?? '';

function hostXml(xml, spid) {
  const marker = new RegExp(`<p:cNvPr[^>]*\\bid="${spid}"(?:\\s|/|>)`);
  const match = marker.exec(xml);
  if (!match) return '';
  const pictureStart = xml.lastIndexOf('<p:pic>', match.index);
  const shapeStart = xml.lastIndexOf('<p:sp>', match.index);
  const start = Math.max(pictureStart, shapeStart);
  const close = start === pictureStart ? '</p:pic>' : '</p:sp>';
  const end = xml.indexOf(close, match.index);
  return start < 0 || end < 0 ? '' : xml.slice(start, end + close.length);
}

/** SetFill 保存 seam：直接格式只改目标 slide part，reset 从首次基线恢复原包。 */
export async function runShapeFormatSaveContract({
  edit, core, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 形状填充与描边保留型保存\x1b[0m');
  const input = load('sample-edit-basic.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'shape-format-save-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) =>
    candidate.src.kind === 'shape' && candidate.src.path && candidate.meta.editable === 'full');
  if (!check('找到可保存形状格式目标', !!record?.meta.origin)) return;
  const part = record.meta.origin.part;
  const spid = record.meta.origin.spid;
  editor.exec({
    type: 'SetFill', id: record.id, fill: { type: 'solid', color: '#33AA77' },
  });
  const saved = await editor.saveDetailed();
  const diff = diffPackageBytes(input, saved.bytes);
  const slideXml = new TextDecoder().decode(saved.package.parts[part]);
  const reopened = await core.parse(saved.bytes, {
    edit: true, lazy: false, assets: 'defer',
  });
  const reopenedTarget = reopened.slides.flatMap((slide) => slide.elements)
    .find((element) => element.editInfo?.origin?.spid === spid);
  check('纯色填充保存只改目标 slide part 并可重开',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === part
      && slideXml.includes('<a:solidFill><a:srgbClr val="33AA77"/></a:solidFill>')
      && reopenedTarget?.kind === 'shape'
      && reopenedTarget.fill?.type === 'solid'
      && reopenedTarget.fill.color === 'rgb(51,170,119)',
  `added=${diff.added} removed=${diff.removed} changed=${diff.changed}`);

  editor.exec({ type: 'SetFill', id: record.id, fill: null });
  const reset = await editor.saveDetailed();
  check('连续保存后恢复默认从首次基线重建为原包字节',
    diffPackageBytes(input, reset.bytes).equal);
  const identity = await editor.saveDetailed();
  check('恢复默认后的连续保存进入包 identity',
    identity.mode === 'identity' && identity.bytes === reset.bytes);

  reopened.dispose?.();
  edit.disposeDoc(doc);

  const richInput = load('sample-editor-shape-format.pptx');
  const richPresentation = await core.parse(richInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const richDoc = edit.createDoc(richPresentation, { idPrefix: 'shape-format-rich-' });
  const richEditor = new edit.Editor(richDoc);
  const scenario = Object.freeze({
    type: 'shapeFormat', file: 'sample-editor-shape-format.pptx',
    fills: [
      {
        targetName: 'format-inherited',
        fill: {
          type: 'gradient', angle: 135.1234567, radial: false, stops: [
            { pos: 0, color: '#0EA5E9' },
            { pos: 0.400004, color: 'rgba(99,102,241,0.5504)' },
            { pos: 1, color: '#D946EF' },
          ],
        },
      },
      {
        targetName: 'format-radial',
        fill: {
          type: 'gradient', angle: 123.456, radial: true,
          stops: [{ pos: 0, color: '#FFFFFF' }, { pos: 1, color: '#F97316' }],
        },
      },
      {
        targetName: 'format-pattern',
        fill: { type: 'pattern', preset: 'trellis', fg: '#052E16', bg: '#DCFCE7' },
      },
      { targetName: 'format-nested-leaf', fill: { type: 'none' } },
    ],
    strokes: [
      {
        targetName: 'format-inherited',
        stroke: { color: '#111827', width: 6, dash: null },
      },
      {
        targetName: 'format-image-fill',
        stroke: { color: '#7C3AED', width: 2, dash: null, cap: 'square', join: 'round' },
      },
      {
        targetName: 'format-rich-stroke',
        stroke: {
          color: 'rgba(239,68,68,0.6)', width: 2, dash: [16, 6, 2, 6],
          cap: 'butt', join: 'miter', compound: 'thickThin',
          head: { type: 'stealth', w: 2, h: 3 }, tail: { type: 'oval', w: 5, h: 2 },
        },
      },
      {
        targetName: 'format-picture-border',
        stroke: { color: '#0284C7', width: 4, dash: [4, 4], cap: 'round', join: 'bevel' },
      },
    ],
    added: {
      preset: 'roundRect', rect: { x: 45, y: 430, w: 180, h: 28 },
      fill: { type: 'solid', color: '#FDE047' }, stroke: { type: 'none' },
    },
    copied: { targetName: 'format-rich-stroke', x: 455, y: 400 },
  });
  const inherited = byName(richDoc, 'format-inherited');
  const radial = byName(richDoc, 'format-radial');
  const pattern = byName(richDoc, 'format-pattern');
  const imageFill = byName(richDoc, 'format-image-fill');
  const richStroke = byName(richDoc, 'format-rich-stroke');
  const picture = byName(richDoc, 'format-picture-border');
  const nested = byName(richDoc, 'format-nested-leaf');
  const dashRecords = DASH_PRESETS.map(([name]) => byName(richDoc, `format-dash-${name}`));
  if (!check('富格式固件覆盖继承、图片关系、图片边框与嵌套组',
    [inherited, radial, pattern, imageFill, richStroke, picture, nested]
      .every((candidate) => candidate?.meta.origin)
      && dashRecords.every((candidate) => candidate?.meta.origin))) {
    edit.disposeDoc(richDoc);
    return;
  }
  const richPart = inherited.meta.origin.part;
  const sourceXml = decoder.decode(richPresentation.package.parts[richPart]);
  const sourceAlternate = alternateContent(sourceXml);
  const dashFixtureCoverage = DASH_PRESETS.every(([, ratios], index) => {
    const stroke = dashRecords[index].src.stroke;
    return stroke?.width === 2
      && JSON.stringify(stroke.dash) === JSON.stringify(ratios.map((ratio) => ratio * 2));
  });
  check('确定性固件覆盖十种预设虚线与 mc:AlternateContent',
    dashFixtureCoverage && sourceAlternate.includes('format-alternate-choice')
      && sourceAlternate.includes('format-alternate-fallback'));
  const inheritedSourceStroke = structuredClone(edit.queryElementStroke(richDoc, [inherited.id]).value);
  const inheritedHistory = richEditor.history.undoCount;
  const sourceNoOp = richEditor.exec({
    type: 'SetStroke', id: inherited.id, stroke: inheritedSourceStroke,
  });
  const pictureSourceStroke = edit.queryElementStroke(richDoc, [picture.id]).value;
  const pictureNoOp = richEditor.exec({
    type: 'SetStroke', id: picture.id, stroke: pictureSourceStroke,
  });
  check('查询统一补全来源默认描边且原样提交保持严格 no-op',
    inheritedSourceStroke?.dash !== null && inheritedSourceStroke?.head?.type === 'triangle'
      && sourceNoOp.dirtyElements.size === 0
      && pictureSourceStroke?.cap === 'butt' && pictureSourceStroke.join === 'miter'
      && pictureSourceStroke.compound === 'sng'
      && pictureSourceStroke.head?.type === 'none' && pictureSourceStroke.tail?.type === 'none'
      && pictureNoOp.dirtyElements.size === 0
      && richEditor.history.undoCount === inheritedHistory
      && edit.queryElementStroke(richDoc, [inherited.id]).direct === false
      && edit.queryElementStroke(richDoc, [picture.id]).direct === false);
  richEditor.exec(
    ...scenario.fills.map((change) => ({
      type: 'SetFill', id: byName(richDoc, change.targetName).id, fill: change.fill,
    })),
    ...scenario.strokes.map((change) => ({
      type: 'SetStroke', id: byName(richDoc, change.targetName).id, stroke: change.stroke,
    })),
  );
  richEditor.exec({
    type: 'AddShape', slideId: richDoc.slideOrder[0],
    preset: scenario.added.preset, rect: scenario.added.rect,
  });
  const addedId = richEditor.selection.kind === 'elements' ? richEditor.selection.ids[0] : null;
  const added = addedId ? richDoc.elements[addedId] : null;
  if (added) richEditor.exec(
    { type: 'SetFill', id: added.id, fill: scenario.added.fill },
    { type: 'SetStroke', id: added.id, stroke: scenario.added.stroke },
  );
  richEditor.exec({
    type: 'PasteElements', payload: edit.copyElements(richDoc, [richStroke.id]),
    at: { parentId: richDoc.slideOrder[0], x: scenario.copied.x, y: scenario.copied.y },
  });
  const pastedId = richEditor.selection.kind === 'elements' ? richEditor.selection.ids[0] : null;
  const pasted = pastedId ? richDoc.elements[pastedId] : null;

  const richSaved = await richEditor.saveDetailed();
  const artifact = saveArtifact('shape-format.pptx', richSaved.bytes);
  const richDiff = diffPackageBytes(richInput, richSaved.bytes);
  const richXml = decoder.decode(richSaved.package.parts[richPart]);
  const inheritedXml = hostXml(richXml, inherited.meta.origin.spid);
  const richLineXml = hostXml(richXml, richStroke.meta.origin.spid);
  const imageFillXml = hostXml(richXml, imageFill.meta.origin.spid);
  const pictureXml = hostXml(richXml, picture.meta.origin.spid);
  check('富格式与新增形状仍只改目标 slide，图片资源和关系逐字直通',
    richDiff.added.length === 0 && richDiff.removed.length === 0
      && richDiff.changed.join(',') === richPart
      && sourceAlternate.length > 0 && alternateContent(richXml) === sourceAlternate);
  check('线性渐变写回 stop 透明度、角度，并替换继承填充',
    inheritedXml.includes('<a:gradFill rotWithShape="1">')
      && inheritedXml.includes('<a:alpha val="55000"/>')
      && inheritedXml.includes('<a:gs pos="40000">')
      && inheritedXml.includes('<a:lin ang="8107407" scaled="1"/>')
      && inheritedXml.indexOf('<a:gradFill') < inheritedXml.indexOf('<a:ln'));
  check('实线、端帽、连接、复合线与无端点显式写回并阻断主题回退',
    inheritedXml.includes('<a:ln w="57150" cap="flat" cmpd="sng">')
      && inheritedXml.includes('<a:srgbClr val="111827"/>')
      && inheritedXml.includes('<a:prstDash val="solid"/>')
      && inheritedXml.includes('<a:miter/>')
      && inheritedXml.includes('<a:headEnd type="none" w="med" len="med"/>')
      && inheritedXml.includes('<a:tailEnd type="none" w="med" len="med"/>'));
  check('完整描边按 schema 顺序写回并保留未知属性与 extLst',
    richLineXml.includes('fixture:token="keep-line"')
      && richLineXml.includes('<fixture:keep value="line-extension"/>')
      && richLineXml.includes('w="19050" cap="flat" cmpd="thickThin"')
      && richLineXml.includes('<a:prstDash val="lgDashDot"/>')
      && richLineXml.includes('<a:miter/>')
      && richLineXml.includes('<a:headEnd type="stealth" w="sm" len="med"/>')
      && richLineXml.includes('<a:tailEnd type="oval" w="lg" len="sm"/>')
      && richLineXml.indexOf('<a:solidFill>') < richLineXml.indexOf('<a:prstDash')
      && richLineXml.indexOf('<a:tailEnd') < richLineXml.indexOf('<a:extLst>'));
  check('改图片填充形状的描边不删除 blipFill 与媒体关系',
    imageFillXml.includes('<a:blipFill><a:blip r:embed="rId20"/>')
      && imageFillXml.includes('<a:ln w="19050" cap="sq" cmpd="sng">'));
  check('图片元素描边走同一保存主干',
    pictureXml.includes('<p:blipFill>')
      && pictureXml.includes('<a:ln w="38100" cap="rnd" cmpd="sng">'));

  const richReopened = await core.parse(richSaved.bytes, {
    edit: true, lazy: false, assets: 'defer',
  });
  const reopenedElements = richReopened.slides[0].elements;
  const reopenedBySpid = (spid) => reopenedElements
    .find((element) => element.editInfo?.origin?.spid === spid);
  const reopenedInherited = reopenedBySpid(inherited.meta.origin.spid);
  const reopenedRadial = reopenedBySpid(radial.meta.origin.spid);
  const reopenedRichStroke = reopenedBySpid(richStroke.meta.origin.spid);
  const reopenedPicture = reopenedBySpid(picture.meta.origin.spid);
  const reopenedAdded = added?.meta.origin ? reopenedBySpid(added.meta.origin.spid) : null;
  const reopenedPasted = pasted?.meta.origin ? reopenedBySpid(pasted.meta.origin.spid) : null;
  check('全部格式经独立 core 重开后语义一致',
    reopenedInherited?.fill?.type === 'gradient'
      && reopenedInherited.fill.angle === 8107407 / 60000
      && reopenedInherited.fill.radial === undefined
      && reopenedInherited.fill.stops[1]?.pos === 0.4
      && reopenedInherited.fill.stops[1]?.color === 'rgba(99,102,241,0.55)'
      && reopenedInherited.stroke?.dash === null
      && reopenedInherited.stroke.cap === 'butt'
      && reopenedInherited.stroke.join === 'miter'
      && reopenedInherited.stroke.compound === 'sng'
      && reopenedInherited.stroke.head?.type === 'none'
      && reopenedInherited.stroke.tail?.type === 'none'
      && reopenedRadial?.fill?.type === 'gradient'
      && reopenedRadial.fill.radial === true && reopenedRadial.fill.angle === 0
      && reopenedRichStroke?.stroke?.compound === 'thickThin'
      && reopenedRichStroke.stroke.head?.type === 'stealth'
      && reopenedRichStroke.stroke.tail?.type === 'oval'
      && reopenedPicture?.kind === 'image' && reopenedPicture.stroke?.width === 4
      && reopenedAdded?.kind === 'shape' && reopenedAdded.fill?.type === 'solid'
      && reopenedAdded.stroke === null
      && reopenedPasted?.kind === 'shape'
      && JSON.stringify(reopenedPasted.stroke) === JSON.stringify(reopenedRichStroke.stroke));
  const projected = renderFingerprint(scenario.file, 'projected', scenario);
  const materialized = renderFingerprint(artifact, 'saved', scenario);
  for (const textMode of ['html', 'svg']) {
    eq(`形状格式保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      materialized[textMode], projected[textMode]);
  }

  while (richEditor.undo()) { /* 所有事务回退到首次保存基线，验证无旁路状态。 */ }
  const richReset = await richEditor.saveDetailed();
  check('富格式、嵌套元素和新增形状全部撤销后恢复原包字节',
    diffPackageBytes(richInput, richReset.bytes).equal);
  let redoCount = 0;
  while (richEditor.redo()) redoCount++;
  const richRedone = await richEditor.saveDetailed();
  check('保存后重做完整恢复格式、新增与粘贴的确定性包结果',
    redoCount > 0 && diffPackageBytes(richSaved.bytes, richRedone.bytes).equal);
  while (richEditor.undo()) { /* 复位后再离开，避免测试依赖重做后的会话状态。 */ }
  const finalReset = await richEditor.saveDetailed();
  check('保存后重做再撤销仍回到首次基线',
    diffPackageBytes(richInput, finalReset.bytes).equal);

  richReopened.dispose?.();
  edit.disposeDoc(richDoc);
}
