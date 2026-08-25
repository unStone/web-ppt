import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);
const alternateContent = (xml) =>
  xml.match(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/)?.[0] ?? '';

function hostXml(xml, spid) {
  const marker = new RegExp(`<p:cNvPr[^>]*\\bid="${spid}"(?:\\s|/|>)`);
  const match = marker.exec(xml);
  if (!match) return '';
  const candidates = [
    ['<p:grpSp>', '</p:grpSp>'], ['<p:pic>', '</p:pic>'], ['<p:sp>', '</p:sp>'],
  ].map(([open, close]) => ({ start: xml.lastIndexOf(open, match.index), close }))
    .filter(({ start }) => start >= 0).sort((a, b) => b.start - a.start);
  const candidate = candidates[0];
  const end = candidate ? xml.indexOf(candidate.close, match.index) : -1;
  return candidate && end >= 0 ? xml.slice(candidate.start, end + candidate.close.length) : '';
}

function flattened(elements) {
  const out = [];
  const visit = (element) => {
    out.push(element);
    if (element.kind === 'group') element.children.forEach(visit);
  };
  elements.forEach(visit);
  return out;
}

/** SetEffects 保存 seam：效果列表必须保留宿主未知信息并经独立进程得到同一 SVG。 */
export async function runShapeEffectsSaveContract({
  edit, core, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 形状与图片二维效果保留型保存\x1b[0m');
  const input = load('sample-editor-effects.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'effects-save-' });
  const editor = new edit.Editor(doc);
  const sourceXml = decoder.decode(presentation.package.parts['ppt/slides/slide1.xml']);
  const sourceAlternate = alternateContent(sourceXml);
  const inherited = byName(doc, 'effects-inherited');
  const explicitEmpty = byName(doc, 'effects-explicit-empty');
  const rich = byName(doc, 'effects-rich');
  const picture = byName(doc, 'effects-picture');
  const group = byName(doc, 'effects-group');
  if (!check('效果保存固件覆盖主题、空列表、图片和组合宿主',
    [inherited, explicitEmpty, rich, picture, group].every((record) => record?.meta.origin)
      && !!inherited?.src.effects?.shadow
      && JSON.stringify(explicitEmpty?.src.effects) === '{}')) return;

  const scenario = Object.freeze({
    type: 'shapeEffects', file: 'sample-editor-effects.pptx',
    changes: [
      { targetName: 'effects-inherited', effects: {} },
      {
        targetName: 'effects-explicit-empty',
        effects: { shadow: { dx: 8, dy: 0, blur: 5, color: 'rgba(15,23,42,0.55)' } },
      },
      {
        targetName: 'effects-rich',
        effects: {
          shadow: { dx: -4, dy: 7, blur: 6, color: '#1E293B', inner: true },
          glow: { radius: 9, color: 'rgba(249,115,22,0.7)' },
          softEdge: 2,
          reflection: { alpha: 0.62, size: 0.48, distance: 5 },
        },
      },
      {
        targetName: 'effects-picture',
        effects: { glow: { radius: 7, color: '#2563EB' }, softEdge: 1 },
      },
      {
        targetName: 'effects-group',
        effects: { reflection: { alpha: 0.45, size: 0.7, distance: 3 } },
      },
      {
        targetName: 'effects-lo-shadow',
        effects: { shadow: { dx: 8, dy: 5, blur: 5, color: 'rgba(15,23,42,0.55)' } },
      },
      {
        targetName: 'effects-lo-glow',
        effects: { glow: { radius: 7, color: 'rgba(124,58,237,0.65)' } },
      },
      { targetName: 'effects-lo-soft-edge', effects: { softEdge: 3 } },
      {
        targetName: 'effects-lo-reflection',
        effects: { reflection: { alpha: 0.6, size: 0.5, distance: 4 } },
      },
    ],
    added: {
      preset: 'ellipse', rect: { x: 370, y: 235, w: 180, h: 100 },
      effects: { glow: { radius: 6, color: '#16A34A' } },
    },
    copied: { targetName: 'effects-rich', x: 620, y: 235 },
  });
  for (const change of scenario.changes) editor.exec({
    type: 'SetEffects', id: byName(doc, change.targetName).id, effects: change.effects,
  });
  const expected = new Map(scenario.changes.map((change) => [
    change.targetName, structuredClone(edit.queryElementEffects(doc, [byName(doc, change.targetName).id]).value),
  ]));
  editor.exec({
    type: 'AddShape', slideId: doc.slideOrder[0],
    preset: scenario.added.preset, rect: scenario.added.rect,
  });
  const addedId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  if (addedId) editor.exec({ type: 'SetEffects', id: addedId, effects: scenario.added.effects });
  editor.exec({
    type: 'PasteElements', payload: edit.copyElements(doc, [rich.id]),
    at: { parentId: doc.slideOrder[0], x: scenario.copied.x, y: scenario.copied.y },
  });
  const pastedId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;

  const saved = await editor.saveDetailed();
  const identity = await editor.saveDetailed();
  check('同一效果状态连续保存保持 identity 与同一字节句柄',
    identity.mode === 'identity' && identity.bytes === saved.bytes
      && identity.package === saved.package);
  const artifact = saveArtifact('shape-effects.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const part = rich.meta.origin.part;
  const xml = decoder.decode(saved.package.parts[part]);
  const richXml = hostXml(xml, rich.meta.origin.spid);
  const pictureXml = hostXml(xml, picture.meta.origin.spid);
  const groupXml = hostXml(xml, group.meta.origin.spid);
  const inheritedXml = hostXml(xml, inherited.meta.origin.spid);
  check('二维效果只改目标 slide part，图片资源与关系逐字直通',
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.join(',') === part
      && sourceAlternate.length > 0 && alternateContent(xml) === sourceAlternate,
  `added=${diff.added} removed=${diff.removed} changed=${diff.changed}`);
  check('效果子项与宿主节点按 DrawingML 顺序写回',
    richXml.includes('fixture:token="keep-effect-list"')
      && richXml.indexOf('<a:glow') < richXml.indexOf('<a:innerShdw')
      && richXml.indexOf('<a:innerShdw') < richXml.indexOf('<a:reflection')
      && richXml.indexOf('<a:reflection') < richXml.indexOf('<a:softEdge')
      && richXml.indexOf('<a:effectLst') < richXml.indexOf('<a:scene3d')
      && richXml.indexOf('<a:scene3d') < richXml.indexOf('<a:sp3d')
      && richXml.includes('value="shape-extension"/>'));
  check('图片效果保留宿主属性，组合效果用 effectLst 原子替换 effectDag',
    pictureXml.includes('fixture:host="keep-picture"')
      && pictureXml.includes('<a:glow rad="66675">')
      && pictureXml.includes('<a:softEdge rad="9525"/>')
      && groupXml.includes('fixture:host="keep-group"')
      && !groupXml.includes('<a:effectDag')
      && groupXml.includes('<a:reflection')
      && groupXml.indexOf('<a:effectLst') < groupXml.indexOf('<a:extLst>'));
  check('显式空 effectLst 屏蔽主题效果而非删除节点',
    inheritedXml.includes('<a:effectLst/>'));

  const reopened = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const reopenedElements = flattened(reopened.slides[0].elements);
  const reopenedBySpid = (spid) => reopenedElements
    .find((element) => element.editInfo?.origin?.spid === spid);
  const semanticRoundTrip = scenario.changes.every((change) => {
    const source = byName(doc, change.targetName);
    return JSON.stringify(reopenedBySpid(source.meta.origin.spid)?.effects ?? {})
      === JSON.stringify(expected.get(change.targetName));
  });
  const added = addedId ? doc.elements[addedId] : null;
  const pasted = pastedId ? doc.elements[pastedId] : null;
  check('四类效果、显式空列表、新增与复制经 core 重开语义一致',
    semanticRoundTrip
      && !!added?.meta.origin && reopenedBySpid(added.meta.origin.spid)?.effects?.glow?.radius === 6
      && !!pasted?.meta.origin
      && JSON.stringify(reopenedBySpid(pasted.meta.origin.spid)?.effects)
        === JSON.stringify(expected.get('effects-rich')));

  const projected = renderFingerprint(scenario.file, 'projected', scenario);
  const materialized = renderFingerprint(artifact, 'saved', scenario);
  for (const textMode of ['html', 'svg']) {
    eq(`二维效果保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      materialized[textMode], projected[textMode]);
  }

  while (editor.undo()) { /* 回到首次基线，验证所有效果都只存在于历史与覆盖层。 */ }
  const reset = await editor.saveDetailed();
  check('效果、新增与复制全部撤销后恢复原包字节', diffPackageBytes(input, reset.bytes).equal);
  let redoCount = 0;
  while (editor.redo()) redoCount++;
  const redone = await editor.saveDetailed();
  check('保存后重做完整恢复确定性效果包',
    redoCount > 0 && diffPackageBytes(saved.bytes, redone.bytes).equal);

  reopened.dispose?.();
  edit.disposeDoc(doc);
}
