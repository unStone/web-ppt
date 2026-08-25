import { diffPackageBytes } from '../diff-package.mjs';

const decode = (parts, name) => new TextDecoder().decode(parts[name]);
const hasParts = (parts, names) => names.every((name) => !!parts[name]);

/** RemoveSlide 保存从公开命令、OPC 差异、重开与独立进程渲染取证。 */
export async function runRemoveSlideSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ RemoveSlide OPC 清理、最小保存与重开\x1b[0m');
  const file = 'sample-editor-remove-slide.pptx';
  const input = load(file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'remove-slide-save-' });
  const editor = new edit.Editor(doc);
  const source = [...doc.slideOrder];
  const savedResult = editor.exec({ type: 'RemoveSlide', id: source[1] });
  check('保存前删除结果只公开目标页和原后继',
    savedResult.removedSlides.has(source[1])
      && savedResult.removedSlideFallbacks.get(source[1]) === source[2]);

  const startedAt = performance.now();
  const saved = await editor.saveDetailed();
  const elapsedMs = performance.now() - startedAt;
  console.log(`  RemoveSlide 单次保存实测：${elapsedMs.toFixed(1)} ms（4→3 页）`);
  check('页面删除保存耗时已实测', Number.isFinite(elapsedMs) && elapsedMs >= 0);
  const artifact = saveArtifact('remove-slide.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('保存只删除目标 slide/关系/独占 notes，并改写三个索引与后续页码',
    diff.added.length === 0
      && diff.removed.join(',') === [
        'ppt/notesSlides/_rels/notesSlide2.xml.rels',
        'ppt/notesSlides/notesSlide2.xml',
        'ppt/slides/_rels/slide2.xml.rels',
        'ppt/slides/slide2.xml',
      ].join(',')
      && diff.changed.join(',') === [
        '[Content_Types].xml', 'ppt/_rels/presentation.xml.rels',
        'ppt/presentation.xml', 'ppt/slides/slide3.xml', 'ppt/slides/slide4.xml',
      ].join(','),
  `added=${diff.added} removed=${diff.removed} changed=${diff.changed}`);

  const parts = saved.package.parts;
  const presentationXml = decode(parts, 'ppt/presentation.xml');
  const presentationRels = decode(parts, 'ppt/_rels/presentation.xml.rels');
  const contentTypes = decode(parts, '[Content_Types].xml');
  check('presentation 与 section 只移除页面 2 身份并保留未知属性和尾节点',
    !presentationXml.includes('id="905"') && !presentationXml.includes('r:id="rId77"')
      && presentationXml.includes('fixture:keep="SECTION-A"')
      && presentationXml.includes('fixture:keep="MEMBER-A" id="801"')
      && presentationXml.includes('name="前两页"')
      && presentationXml.includes('value="presentation-tail"'));
  check('presentation 关系与 Content Types 只清理目标页和独占 notes 的索引',
    !presentationRels.includes('Id="rId77"')
      && presentationRels.includes('Id="rId300" Type="urn:web-ppt:unknown"')
      && !contentTypes.includes('PartName="/ppt/slides/slide2.xml"')
      && !contentTypes.includes('PartName="/ppt/notesSlides/notesSlide2.xml"')
      && contentTypes.includes('fixture:keep="TYPE-TAIL"')
      && contentTypes.includes('Extension="png" ContentType="image/png"'));
  const preservedTargets = [
    'ppt/media/shared.png', 'ppt/charts/chartKeep.xml', 'ppt/comments/commentKeep.xml',
    'ppt/notesMasters/notesMasterKeep.xml', 'customXml/keep.xml',
    'ppt/slideLayouts/slideLayout1.xml',
  ];
  check('媒体、图表、评论、notesMaster、版式和未知目标不级联删除且字节直通',
    hasParts(parts, preservedTargets)
      && preservedTargets.every((part) => parts[part] === presentation.package.parts[part]));
  check('后续动态页码字段缓存按最终页序写回',
    decode(parts, 'ppt/slides/slide3.xml').includes('<a:t>2</a:t>')
      && decode(parts, 'ppt/slides/slide4.xml').includes('<a:t>3</a:t>'));

  const reopened = await core.parse(saved.bytes, { lazy: false, assets: 'defer' });
  check('保存重开恢复三页内容、独立 notes 归属与最终页序',
    reopened.slides.length === 3
      && reopened.slides.map((slide) => JSON.stringify(slide.elements))
        .every((text, index) => text.includes(`可删除页面 ${[1, 3, 4][index]}`))
      && reopened.slides.map((slide) => slide.notes).join('|')
        === '页面 1 的独立备注|页面 3 的独立备注|页面 4 的独立备注');

  const scenario = { type: 'removeSlide', part: 'ppt/slides/slide2.xml' };
  for (let resultSlideIndex = 0; resultSlideIndex < 3; resultSlideIndex++) {
    const fingerprintScenario = { ...scenario, resultSlideIndex };
    const projected = renderFingerprint(file, 'projected', fingerprintScenario);
    const materialized = renderFingerprint(artifact, 'saved', fingerprintScenario);
    for (const mode of ['html', 'svg']) {
      eq(`删除后第 ${resultSlideIndex + 1} 页 ${mode} 保存指纹等于独立进程投影`,
        materialized[mode], projected[mode]);
    }
  }

  const savedAgain = await editor.saveDetailed();
  check('连续保存进入 identity 且不再次改写 part',
    savedAgain.mode === 'identity' && savedAgain.bytes === saved.bytes);
  doc.saveState.baselines['customXml/forged-missing.xml'] = new Uint8Array([1]);
  let forgedBaselineRejected = false;
  try { await editor.saveDetailed(); } catch { forgedBaselineRejected = true; }
  delete doc.saveState.baselines['customXml/forged-missing.xml'];
  check('缺失来源页不会放宽无关 baseline 的模型校验', forgedBaselineRejected);
  editor.undo();
  const restored = await editor.saveDetailed();
  check('保存后撤销按逐 part 内容恢复原包', diffPackageBytes(input, restored.bytes).equal);
  editor.redo();
  const redone = await editor.saveDetailed();
  check('重做再次得到确定性删除包', diffPackageBytes(saved.bytes, redone.bytes).equal);

  const editedPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const editedDoc = edit.createDoc(editedPresentation, { idPrefix: 'remove-slide-edited-' });
  const editedEditor = new edit.Editor(editedDoc);
  const editedSlide = editedDoc.slideOrder[1];
  const editedElement = editedDoc.slides[editedSlide].children[0];
  editedEditor.exec({
    type: 'SetXfrm', id: editedElement, x: editedDoc.elements[editedElement].src.x + 17,
  });
  editedEditor.exec({ type: 'RemoveSlide', id: editedSlide });
  const editedSaved = await editedEditor.saveDetailed();
  check('删除前的元素编辑不会从保存基线复活已删 slide part',
    !editedSaved.package.parts['ppt/slides/slide2.xml']
      && !editedSaved.package.parts['ppt/slides/_rels/slide2.xml.rels']);

  const sharedInput = load('sample-editor-remove-slide-shared-notes.pptx');
  const sharedPresentation = await core.parse(sharedInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sharedDoc = edit.createDoc(sharedPresentation, { idPrefix: 'remove-slide-shared-notes-' });
  const sharedEditor = new edit.Editor(sharedDoc);
  sharedEditor.exec({ type: 'RemoveSlide', id: sharedDoc.slideOrder[1] });
  const sharedSaved = await sharedEditor.saveDetailed();
  const sharedReopened = await core.parse(sharedSaved.bytes, { lazy: false, assets: 'defer' });
  check('畸形文件中仍被活动页引用的 notesSlide 与关系不会级联删除',
    !sharedSaved.package.parts['ppt/slides/slide2.xml']
      && !!sharedSaved.package.parts['ppt/notesSlides/notesSlide2.xml']
      && !!sharedSaved.package.parts['ppt/notesSlides/_rels/notesSlide2.xml.rels']
      && decode(sharedSaved.package.parts, '[Content_Types].xml')
        .includes('PartName="/ppt/notesSlides/notesSlide2.xml"')
      && sharedReopened.slides[1].notes === '页面 2 的独立备注');

  const unsavedPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const unsavedDoc = edit.createDoc(unsavedPresentation, { idPrefix: 'remove-slide-unsaved-add-' });
  const unsavedEditor = new edit.Editor(unsavedDoc);
  const unsavedAdd = unsavedEditor.exec({
    type: 'AddSlide', layoutId: unsavedDoc.layoutOrder[0], at: { after: unsavedDoc.slideOrder[0] },
  });
  unsavedEditor.exec({ type: 'RemoveSlide', id: [...unsavedAdd.createdSlides][0] });
  const unsavedResult = await unsavedEditor.saveDetailed();
  check('新增页首次保存前又删除会净化为包 identity',
    unsavedResult.mode === 'identity' && unsavedResult.bytes === input);

  const createdPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const createdDoc = edit.createDoc(createdPresentation, { idPrefix: 'remove-slide-saved-add-' });
  const createdEditor = new edit.Editor(createdDoc);
  const createdAdd = createdEditor.exec({
    type: 'AddSlide', layoutId: createdDoc.layoutOrder[0], at: { after: createdDoc.slideOrder[0] },
  });
  const createdId = [...createdAdd.createdSlides][0];
  const createdPart = createdDoc.slides[createdId].origin.part;
  const createdSaved = await createdEditor.saveDetailed();
  const createdWasMaterialized = !!createdSaved.package.parts[createdPart];
  createdEditor.exec({ type: 'RemoveSlide', id: createdId });
  const createdRemoved = await createdEditor.saveDetailed();
  const createdRelsPart = createdPart.replace('/slides/', '/slides/_rels/') + '.rels';
  const createdRemovedDiff = diffPackageBytes(input, createdRemoved.bytes);
  check('新增页保存后再删除会清理已生成 slide/rels 并恢复原包逐 part 内容',
    createdWasMaterialized
      && !createdRemoved.package.parts[createdPart]
      && !createdRemoved.package.parts[createdRelsPart]
      && createdRemovedDiff.equal,
  `part=${createdPart}/${!!createdRemoved.package.parts[createdPart]}`
    + ` rels=${createdRelsPart}/${!!createdRemoved.package.parts[createdRelsPart]}`
    + ` added=${createdRemovedDiff.added} removed=${createdRemovedDiff.removed}`
    + ` changed=${createdRemovedDiff.changed}`);

  reopened.dispose?.();
  sharedReopened.dispose?.();
  edit.disposeDoc(sharedDoc);
  edit.disposeDoc(createdDoc);
  edit.disposeDoc(unsavedDoc);
  edit.disposeDoc(editedDoc);
  edit.disposeDoc(doc);
}
