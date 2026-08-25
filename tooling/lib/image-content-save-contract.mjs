import { diffPackageBytes } from '../diff-package.mjs';
import { makePng } from './ooxml.mjs';

const decoder = new TextDecoder();
const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);
const count = (source, needle) => source.split(needle).length - 1;

function hostXml(xml, spid) {
  const marker = new RegExp(`<p:cNvPr[^>]*\\bid="${spid}"(?:\\s|/|>)`);
  const match = marker.exec(xml);
  if (!match) return '';
  const start = xml.lastIndexOf('<p:pic>', match.index);
  const end = xml.indexOf('</p:pic>', match.index);
  return start >= 0 && end >= 0 ? xml.slice(start, end + '</p:pic>'.length) : '';
}

/** 图片替换/裁剪保存只从包差异、关系闭包、重开与独立进程渲染取证。 */
export async function runImageContentSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 图片替换、裁剪与媒体闭包保存\x1b[0m');
  const input = load('sample-editor-image-content.pptx');
  const replacement = makePng(6, 4, (x, y) => [x * 35 + 20, y * 55 + 15, (x + y) * 24]);
  const scenario = Object.freeze({
    type: 'imageContent', file: 'sample-editor-image-content.pptx', targetName: 'image-external',
    base64: Buffer.from(replacement).toString('base64'), mime: 'image/png',
    crop: { l: 0.25, t: 0.125, r: 0.1, b: 0.2 },
    add: { x: 30, y: 360, w: 120, h: 80 }, copy: { x: 650, y: 300 },
  });
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'image-content-save-' });
  const editor = new edit.Editor(doc);
  const picture = byName(doc, scenario.targetName);
  if (!check('图片保存固件提供稳定宿主与来源关系', picture?.meta.origin)) return;
  editor.exec({ type: 'SetCrop', id: picture.id, crop: scenario.crop });
  editor.exec({
    type: 'ReplaceImage', id: picture.id, bytes: replacement, mime: scenario.mime,
  });
  const replacementState = structuredClone(picture.meta.imageReplacement);
  editor.exec({
    type: 'AddImage', slideId: doc.slideOrder[0], bytes: replacement, mime: scenario.mime,
    rect: scenario.add,
  });
  const addedId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  editor.exec({
    type: 'PasteElements', payload: edit.copyElements(doc, [picture.id]),
    at: { parentId: doc.slideOrder[0], ...scenario.copy },
  });
  const pastedId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('image-content.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const slidePart = picture.meta.origin.part;
  const relsPart = 'ppt/slides/_rels/slide1.xml.rels';
  const mediaPart = doc.imageResources[replacementState.resourceHash].targetPart;
  const xml = decoder.decode(saved.package.parts[slidePart]);
  const rels = decoder.decode(saved.package.parts[relsPart]);
  const host = hostXml(xml, picture.meta.origin.spid);

  check('首次保存只增加一个去重媒体并修改目标 slide 与关系 part',
    diff.added.join(',') === mediaPart && diff.removed.length === 0
      && new Set(diff.changed).size === 2 && diff.changed.includes(relsPart)
      && diff.changed.includes(slidePart),
  `added=${diff.added} removed=${diff.removed} changed=${diff.changed}`);
  check('源裁剪按 schema 顺序写为十万分数且保留图片宿主未知信息',
    host.includes('fixture:keep="srcRect-extension"')
      && host.includes('<fixture:keep value="srcRect-child"/>')
      && /<a:srcRect\b[^>]*\bl="25000"[^>]*\bt="12500"[^>]*\br="10000"[^>]*\bb="20000"/.test(host)
      && host.indexOf('<a:blip ') < host.indexOf('<a:srcRect ')
      && host.indexOf('<a:srcRect ') < host.indexOf('<a:stretch>')
      && host.includes('fixture:host="keep-image-content"')
      && host.includes('r:embed=') && !host.includes('r:link='));
  check('替换、新增与复制使用不同关系 id 但共享唯一媒体 part',
    count(rels, `Target="${replacementState.relationships[0].target}"`) === 3
      && Buffer.from(saved.package.parts[mediaPart]).equals(Buffer.from(replacement))
      && addedId && editor.effectiveElement(addedId).src === editor.effectiveElement(picture.id).src
      && pastedId && editor.effectiveElement(pastedId).src === editor.effectiveElement(picture.id).src);

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedPictures = reopened.slides[0].elements.filter((element) =>
    element.kind === 'image' && element.name === picture.src.name);
  check('core 重开恢复两张图片的同一像素来源与裁剪语义',
    reopenedPictures.length === 2
      && reopenedPictures.every((image) => JSON.stringify(image.crop) === JSON.stringify(scenario.crop))
      && reopenedPictures[0].src === reopenedPictures[1].src);

  const projected = renderFingerprint(scenario.file, 'projected', scenario);
  const materialized = renderFingerprint(artifact, 'saved', scenario);
  for (const mode of ['html', 'svg']) {
    eq(`图片替换/裁剪保存产物 ${mode} 指纹等于独立进程有效投影`,
      materialized[mode], projected[mode]);
  }
  const identity = await editor.saveDetailed();
  check('同一图片状态连续保存保持 identity', identity.mode === 'identity'
    && identity.bytes === saved.bytes && identity.package === saved.package);

  const nextBytes = makePng(5, 5, (x, y) => [240 - x * 30, y * 40, 80 + x * 10]);
  editor.exec({ type: 'ReplaceImage', id: picture.id, bytes: nextBytes, mime: 'image/png' });
  const nextPart = doc.imageResources[picture.meta.imageReplacement.resourceHash].targetPart;
  const replacedAgain = await editor.saveDetailed();
  const secondDiff = diffPackageBytes(saved.bytes, replacedAgain.bytes);
  check('连续替换原图时保留仍被复制图片共享的旧媒体',
    nextPart !== mediaPart && secondDiff.added.join(',') === nextPart
      && secondDiff.removed.length === 0 && !!replacedAgain.package.parts[mediaPart]);
  editor.exec({ type: 'ReplaceImage', id: pastedId, bytes: nextBytes, mime: 'image/png' });
  editor.exec({ type: 'ReplaceImage', id: addedId, bytes: nextBytes, mime: 'image/png' });
  const pruned = await editor.saveDetailed();
  const pruneDiff = diffPackageBytes(replacedAgain.bytes, pruned.bytes);
  check('最后一个引用替换后回收不可达会话媒体',
    pruneDiff.added.length === 0 && pruneDiff.removed.join(',') === mediaPart
      && !pruned.package.parts[mediaPart] && !!pruned.package.parts[nextPart],
  `added=${pruneDiff.added} removed=${pruneDiff.removed} media=${Object.keys(pruned.package.parts)
    .filter((part) => part.startsWith('ppt/media/')).join(',')}`);
  editor.undo();
  editor.undo();
  const sharedRestored = await editor.saveDetailed();
  check('撤销复制图片替换恢复共享媒体状态',
    diffPackageBytes(replacedAgain.bytes, sharedRestored.bytes).equal);
  editor.undo();
  const replacementRestored = await editor.saveDetailed();
  check('撤销第二次替换逐字节恢复首个确定性保存产物',
    diffPackageBytes(saved.bytes, replacementRestored.bytes).equal);

  editor.undo(); editor.undo(); editor.undo(); editor.undo();
  const original = await editor.saveDetailed();
  check('复制、替换与裁剪全部撤销后逐字节恢复原包',
    diffPackageBytes(input, original.bytes).equal);
  editor.redo(); editor.redo(); editor.redo(); editor.redo();
  const redone = await editor.saveDetailed();
  check('重做恢复相同媒体闭包与保存产物', diffPackageBytes(saved.bytes, redone.bytes).equal);

  reopened.dispose?.();
  edit.disposeDoc(doc);
}
