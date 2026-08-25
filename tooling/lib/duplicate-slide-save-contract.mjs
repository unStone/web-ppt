import { diffPackageBytes } from '../diff-package.mjs';

const decode = (parts, name) => new TextDecoder().decode(parts[name]);

async function sessionFrom(core, edit, input, prefix) {
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: prefix });
  return { presentation, doc, editor: new edit.Editor(doc) };
}

/** DuplicateSlide 保存 seam：证明独立 slide/notes 身份、最小 OPC 差异与重开。 */
export async function runDuplicateSlideSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ DuplicateSlide OPC 克隆、关系与重开\x1b[0m');
  const input = load('sample-editor-duplicate-slide.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'duplicate-slide-save-' });
  const editor = new edit.Editor(doc);
  const sourceId = doc.slideOrder[1];
  const result = editor.exec({ type: 'DuplicateSlide', id: sourceId });
  const duplicateId = [...result.createdSlides][0];
  const duplicatePart = doc.slides[duplicateId].origin.part;
  const duplicateNotesPart = doc.slides[duplicateId].creation.duplicateNotesPart;
  const startedAt = performance.now();
  const saved = await editor.saveDetailed();
  const elapsedMs = performance.now() - startedAt;
  console.log(`  DuplicateSlide 单次保存实测：${elapsedMs.toFixed(1)} ms（4→5 页）`);
  const artifact = saveArtifact('duplicate-slide.pptx', saved.bytes);
  const reopened = await core.parse(saved.bytes, { lazy: false, assets: 'defer' });

  check('副本保存物化独立 slide part 并可重开为紧邻第五页',
    !!saved.package.parts[duplicatePart]
      && !!duplicateNotesPart && !!saved.package.parts[duplicateNotesPart]
      && reopened.slides.length === 5
      && JSON.stringify(reopened.slides[2].elements).includes('可删除页面 2')
      && reopened.slides[2].notes === '页面 2 的独立备注');
  check('页面复制保存耗时已实测', Number.isFinite(elapsedMs) && elapsedMs >= 0);

  const diff = diffPackageBytes(input, saved.bytes);
  check('最小保存只新增副本 slide/notes 闭包并改写页索引与后续页码',
    diff.added.join(',') === [
      'ppt/notesSlides/_rels/notesSlide5.xml.rels',
      'ppt/notesSlides/notesSlide5.xml',
      'ppt/slides/_rels/slide5.xml.rels',
      'ppt/slides/slide5.xml',
    ].join(',')
      && diff.removed.length === 0
      && diff.changed.join(',') === [
        '[Content_Types].xml', 'ppt/_rels/presentation.xml.rels',
        'ppt/presentation.xml', 'ppt/slides/slide3.xml', 'ppt/slides/slide4.xml',
      ].join(','),
  `added=${diff.added} removed=${diff.removed} changed=${diff.changed}`);

  const parts = saved.package.parts;
  const presentationXml = decode(parts, 'ppt/presentation.xml');
  const presentationRels = decode(parts, 'ppt/_rels/presentation.xml.rels');
  const slideRels = decode(parts, 'ppt/slides/_rels/slide5.xml.rels');
  const notesRels = decode(parts, 'ppt/notesSlides/_rels/notesSlide5.xml.rels');
  const contentTypes = decode(parts, '[Content_Types].xml');
  check('副本获得新的 presentation 身份并继承来源 section',
    presentationXml.includes('id="4091" r:id="rId301"')
      && presentationXml.indexOf('id="905"') < presentationXml.indexOf('id="4091"')
      && presentationXml.includes('<p14:sldId id="905"/><p14:sldId id="4091"/>')
      && presentationXml.includes('value="presentation-tail"')
      && presentationRels.includes('Id="rId301"')
      && presentationRels.includes('Target="slides/slide5.xml"'));
  check('slide rels 保留 rId、共享与未知目标，只把 notes 指向独立 part',
    slideRels.includes('Id="rId8"') && slideRels.includes('../media/shared.png')
      && slideRels.includes('Id="rId9"') && slideRels.includes('../notesSlides/notesSlide5.xml')
      && !slideRels.includes('../notesSlides/notesSlide2.xml')
      && slideRels.includes('Id="rId96"') && slideRels.includes('../comments/commentKeep.xml')
      && slideRels.includes('Id="rId97"') && slideRels.includes('../charts/chartKeep.xml')
      && slideRels.includes('Id="rId99" Type="urn:web-ppt:unknown"'));
  check('独立 notes 保留外链与 notesMaster，并把回指改到新 slide',
    notesRels.includes('Id="rId1"') && notesRels.includes('https://example.com/note/2')
      && notesRels.includes('Id="rId2"') && notesRels.includes('../notesMasters/notesMasterKeep.xml')
      && notesRels.includes('Id="rId10"') && notesRels.includes('../slides/slide5.xml')
      && !notesRels.includes('../slides/slide2.xml'));
  check('Content Types 只追加新 slide/notes Override 并保留未知尾节点',
    contentTypes.includes('PartName="/ppt/slides/slide5.xml"')
      && contentTypes.includes('PartName="/ppt/notesSlides/notesSlide5.xml"')
      && contentTypes.includes('fixture:keep="TYPE-TAIL"'));
  const sharedParts = [
    'ppt/media/shared.png', 'ppt/charts/chartKeep.xml', 'ppt/comments/commentKeep.xml',
    'ppt/notesMasters/notesMasterKeep.xml', 'customXml/keep.xml',
  ];
  check('共享资源、来源 slide/notes 与未知 part 均保持原始字节对象直通',
    sharedParts.every((part) => parts[part] === presentation.package.parts[part])
      && parts['ppt/slides/slide2.xml'] === presentation.package.parts['ppt/slides/slide2.xml']
      && parts['ppt/notesSlides/notesSlide2.xml'] === presentation.package.parts['ppt/notesSlides/notesSlide2.xml']);

  check('保存工件路径已生成', artifact.endsWith('duplicate-slide.pptx'));
  const scenario = { type: 'duplicateSlide', part: 'ppt/slides/slide2.xml' };
  for (let resultSlideIndex = 0; resultSlideIndex < 5; resultSlideIndex++) {
    const fingerprintScenario = { ...scenario, resultSlideIndex };
    const projected = renderFingerprint(
      'sample-editor-duplicate-slide.pptx', 'projected', fingerprintScenario,
    );
    const materialized = renderFingerprint(artifact, 'saved', fingerprintScenario);
    for (const mode of ['html', 'svg']) {
      eq(`复制后第 ${resultSlideIndex + 1} 页 ${mode} 保存指纹等于独立进程投影`,
        materialized[mode], projected[mode]);
    }
  }

  const savedAgain = await editor.saveDetailed();
  check('连续保存进入 identity 且不再次改写 part',
    savedAgain.mode === 'identity' && savedAgain.bytes === saved.bytes);
  editor.undo();
  const restored = await editor.saveDetailed();
  check('保存后撤销删除副本闭包并逐 part 恢复原包', diffPackageBytes(input, restored.bytes).equal);
  editor.redo();
  const redone = await editor.saveDetailed();
  check('重做恢复同一 slide/notes 身份并得到确定性副本包',
    diffPackageBytes(saved.bytes, redone.bytes).equal);

  const independent = await sessionFrom(core, edit, input, 'duplicate-slide-independent-');
  const independentSource = independent.doc.slideOrder[1];
  const sourceElement = independent.doc.slides[independentSource].children[0];
  const sourceX = independent.doc.elements[sourceElement].src.x;
  independent.editor.exec({ type: 'SetXfrm', id: sourceElement, x: sourceX + 17 });
  const independentDuplicate = [...independent.editor.exec({
    type: 'DuplicateSlide', id: independentSource,
  }).createdSlides][0];
  independent.editor.exec({ type: 'SetXfrm', id: sourceElement, x: sourceX + 31 });
  const independentSaved = await independent.editor.saveDetailed();
  const independentReopened = await core.parse(independentSaved.bytes, {
    lazy: false, assets: 'defer',
  });
  check('副本固化复制瞬间的覆盖，来源后续编辑只写原 slide part',
    independent.editor.doc.slides[independentDuplicate].origin.part === 'ppt/slides/slide5.xml'
      && independentReopened.slides[1].elements[0].x === sourceX + 31
      && independentReopened.slides[2].elements[0].x === sourceX + 17);

  const removedElement = await sessionFrom(core, edit, input, 'duplicate-slide-removed-element-');
  const removedElementSource = removedElement.doc.slideOrder[1];
  const nested = removedElement.doc.slides[removedElementSource].children.find((id) =>
    removedElement.doc.elements[id].src.name === '外层组合');
  removedElement.editor.exec({ type: 'RemoveElement', id: nested });
  removedElement.editor.exec({ type: 'DuplicateSlide', id: removedElementSource });
  const removedElementSaved = await removedElement.editor.saveDetailed();
  const removedElementReopened = await core.parse(removedElementSaved.bytes, {
    lazy: false, assets: 'defer',
  });
  check('复制前已删除的来源宿主不会从副本基线复活',
    !JSON.stringify(removedElementReopened.slides[1].elements).includes('嵌套副本')
      && !JSON.stringify(removedElementReopened.slides[2].elements).includes('嵌套副本'));

  const sourceRemoved = await sessionFrom(core, edit, input, 'duplicate-slide-source-removed-');
  const removedSourceId = sourceRemoved.doc.slideOrder[1];
  const survivingCopy = [...sourceRemoved.editor.exec({
    type: 'DuplicateSlide', id: removedSourceId,
  }).createdSlides][0];
  sourceRemoved.editor.exec({ type: 'RemoveSlide', id: removedSourceId });
  const sourceRemovedSaved = await sourceRemoved.editor.saveDetailed();
  const sourceRemovedReopened = await core.parse(sourceRemovedSaved.bytes, {
    lazy: false, assets: 'defer',
  });
  const sourceRemovedPresentation = decode(sourceRemovedSaved.package.parts, 'ppt/presentation.xml');
  const sourceRemovedFrontSection = sourceRemovedPresentation
    .match(/<p14:section\b[^>]*name="前两页"[\s\S]*?<\/p14:section>/)?.[0] ?? '';
  check('来源页先删除也不影响副本从保存基线独立物化',
    sourceRemoved.doc.slides[survivingCopy].origin.part === 'ppt/slides/slide5.xml'
      && sourceRemovedReopened.slides.length === 4
      && JSON.stringify(sourceRemovedReopened.slides[1].elements).includes('可删除页面 2')
      && sourceRemovedReopened.slides[1].notes === '页面 2 的独立备注'
      && !sourceRemovedSaved.package.parts['ppt/slides/slide2.xml']
      && !sourceRemovedSaved.package.parts['ppt/notesSlides/notesSlide2.xml']
      && !!sourceRemovedSaved.package.parts['ppt/notesSlides/notesSlide5.xml']);
  check('来源页先删除时副本仍继承复制瞬间的 section',
    sourceRemovedFrontSection.includes('id="801"')
      && sourceRemovedFrontSection.includes('id="4091"')
      && !sourceRemovedFrontSection.includes('id="905"'));

  const unsavedRemoved = await sessionFrom(core, edit, input, 'duplicate-slide-unsaved-remove-');
  const transientCopy = [...unsavedRemoved.editor.exec({
    type: 'DuplicateSlide', id: unsavedRemoved.doc.slideOrder[1],
  }).createdSlides][0];
  unsavedRemoved.editor.exec({ type: 'RemoveSlide', id: transientCopy });
  const unsavedRemovedResult = await unsavedRemoved.editor.saveDetailed();
  check('副本首次保存前删除会净化为包 identity',
    unsavedRemovedResult.mode === 'identity' && unsavedRemovedResult.bytes === input);

  const addChain = await sessionFrom(core, edit, input, 'duplicate-slide-add-chain-');
  const added = [...addChain.editor.exec({
    type: 'AddSlide', layoutId: addChain.doc.layoutOrder[0],
    at: { after: addChain.doc.slideOrder[0] },
  }).createdSlides][0];
  const firstCopy = [...addChain.editor.exec({ type: 'DuplicateSlide', id: added }).createdSlides][0];
  const secondCopy = [...addChain.editor.exec({ type: 'DuplicateSlide', id: firstCopy }).createdSlides][0];
  addChain.editor.exec({
    type: 'AddShape', slideId: secondCopy, preset: 'ellipse',
    rect: { x: 100, y: 100, w: 160, h: 90 },
  });
  const addChainSaved = await addChain.editor.saveDetailed();
  const addChainReopened = await core.parse(addChainSaved.bytes, { lazy: false, assets: 'defer' });
  check('未保存 AddSlide 与副本链从空白版式基线独立物化且不依赖页序',
    addChainReopened.slides.length === 7
      && [added, firstCopy, secondCopy].every((id) =>
        !!addChainSaved.package.parts[addChain.doc.slides[id].origin.part])
      && addChainReopened.slides.some((slide) => slide.elements.some((element) =>
        element.kind === 'shape' && element.name?.startsWith('形状'))));

  const originalChain = await sessionFrom(core, edit, input, 'duplicate-slide-original-chain-');
  const chainSource = originalChain.doc.slideOrder[1];
  const chainFirst = [...originalChain.editor.exec({
    type: 'DuplicateSlide', id: chainSource,
  }).createdSlides][0];
  const chainSecond = [...originalChain.editor.exec({
    type: 'DuplicateSlide', id: chainFirst,
  }).createdSlides][0];
  const originalChainSaved = await originalChain.editor.saveDetailed();
  const originalChainReopened = await core.parse(originalChainSaved.bytes, {
    lazy: false, assets: 'defer',
  });
  const chainNotes = [chainFirst, chainSecond]
    .map((id) => originalChain.doc.slides[id].creation.duplicateNotesPart);
  check('未保存的原包副本链展平到同一基线并分配独立 notes 身份',
    originalChainReopened.slides.length === 6
      && originalChainReopened.slides.slice(1, 4)
        .every((slide) => slide.notes === '页面 2 的独立备注')
      && new Set(chainNotes).size === 2
      && chainNotes.every((part) => !!originalChainSaved.package.parts[part]));

  const savedAdd = await sessionFrom(core, edit, input, 'duplicate-slide-saved-add-');
  const savedAddedId = [...savedAdd.editor.exec({
    type: 'AddSlide', layoutId: savedAdd.doc.layoutOrder[0],
    at: { after: savedAdd.doc.slideOrder[0] },
  }).createdSlides][0];
  await savedAdd.editor.saveDetailed();
  const savedAddedCopy = [...savedAdd.editor.exec({
    type: 'DuplicateSlide', id: savedAddedId,
  }).createdSlides][0];
  const savedAddDuplicated = await savedAdd.editor.saveDetailed();
  const savedAddReopened = await core.parse(savedAddDuplicated.bytes, {
    lazy: false, assets: 'defer',
  });
  check('已保存 AddSlide 页仍从版式/插入树复制，不依赖包内新页字节',
    savedAddReopened.slides.length === 6
      && !!savedAddDuplicated.package.parts[savedAdd.doc.slides[savedAddedCopy].origin.part]);

  const persistedSource = await sessionFrom(core, edit, input, 'duplicate-slide-persisted-source-');
  const persistedSourceId = persistedSource.doc.slideOrder[1];
  const persistedCopy = [...persistedSource.editor.exec({
    type: 'DuplicateSlide', id: persistedSourceId,
  }).createdSlides][0];
  await persistedSource.editor.saveDetailed();
  persistedSource.editor.exec({ type: 'RemoveSlide', id: persistedSourceId });
  const persistedRemoved = await persistedSource.editor.saveDetailed();
  const persistedIdentity = await persistedSource.editor.saveDetailed();
  const persistedReopened = await core.parse(persistedRemoved.bytes, {
    lazy: false, assets: 'defer',
  });
  check('副本保存后再删来源仍由精确 detached baseline 托管并进入连续 identity',
    persistedReopened.slides.length === 4
      && persistedReopened.slides[1].notes === '页面 2 的独立备注'
      && !!persistedSource.doc.slides[persistedCopy]
      && !persistedRemoved.package.parts['ppt/slides/slide2.xml']
      && persistedIdentity.mode === 'identity' && persistedIdentity.bytes === persistedRemoved.bytes);

  const restoredSource = await sessionFrom(core, edit, input, 'duplicate-slide-restored-source-');
  const restoredSourceId = restoredSource.doc.slideOrder[1];
  restoredSource.editor.exec({ type: 'RemoveSlide', id: restoredSourceId });
  await restoredSource.editor.saveDetailed();
  restoredSource.editor.undo();
  let restoredCopy;
  let restoredSaved;
  try {
    restoredCopy = [...restoredSource.editor.exec({
      type: 'DuplicateSlide', id: restoredSourceId,
    }).createdSlides][0];
    restoredSaved = await restoredSource.editor.saveDetailed();
  } catch { /* 断言负责报告从 detached baseline 复制失败。 */ }
  const restoredCreation = restoredCopy && restoredSource.doc.slides[restoredCopy]?.creation;
  const restoredPresentation = restoredSaved
    ? decode(restoredSaved.package.parts, 'ppt/presentation.xml') : '';
  const restoredFrontSection = restoredPresentation
    .match(/<p14:section\b[^>]*name="前两页"[\s\S]*?<\/p14:section>/)?.[0] ?? '';
  check('删除保存再撤销的来源页可从 detached baseline 复制且不复用 OPC 身份',
    restoredCreation?.presentationSlideId === 4091
      && restoredCreation?.presentationRelationshipId === 'rId301'
      && restoredCreation?.duplicateNotesPart === 'ppt/notesSlides/notesSlide5.xml'
      && restoredFrontSection.includes('id="905"')
      && restoredFrontSection.includes('id="4091"')
      && !!restoredSaved?.package.parts['ppt/slides/slide2.xml']
      && !!restoredSaved?.package.parts['ppt/slides/slide5.xml']);

  const noncanonicalInput = load('sample-editor-duplicate-slide-noncanonical.pptx');
  const noncanonical = await sessionFrom(
    core, edit, noncanonicalInput, 'duplicate-slide-noncanonical-',
  );
  const noncanonicalSource = noncanonical.doc.slideOrder[1];
  let noncanonicalCopy;
  let noncanonicalSaved;
  try {
    noncanonicalCopy = [...noncanonical.editor.exec({
      type: 'DuplicateSlide', id: noncanonicalSource,
    }).createdSlides][0];
    noncanonicalSaved = await noncanonical.editor.saveDetailed();
  } catch { /* 断言负责报告合法 OPC 命名被错误拒绝。 */ }
  const noncanonicalCreation = noncanonicalCopy
    && noncanonical.doc.slides[noncanonicalCopy]?.creation;
  const noncanonicalSlideRels = noncanonicalSaved
    ? decode(noncanonicalSaved.package.parts, 'ppt/slides/_rels/slide5.xml.rels') : '';
  const noncanonicalNotesRels = noncanonicalSaved
    ? decode(noncanonicalSaved.package.parts, 'ppt/notesSlides/_rels/notesSlide5.xml.rels') : '';
  check('复制接受非 slideN/notesSlideN 来源 part 与非 rIdN 关系身份',
    noncanonicalCreation?.duplicateSourcePart === 'ppt/slides/source-page.xml'
      && noncanonicalCreation?.layoutRelationshipId === 'layout-main'
      && noncanonicalCreation?.duplicateNotesSourcePart === 'ppt/notesSlides/source-note.xml'
      && noncanonicalSlideRels.includes('Id="layout-main"')
      && noncanonicalSlideRels.includes('Id="notes-main"')
      && noncanonicalSlideRels.includes('../notesSlides/notesSlide5.xml')
      && noncanonicalNotesRels.includes('Id="slide-back"')
      && noncanonicalNotesRels.includes('../slides/slide5.xml'));

  editor.exec({ type: 'RemoveSlide', id: duplicateId });
  const removedSavedCopy = await editor.saveDetailed();
  check('已保存副本再删除会清理 slide/notes 闭包并恢复原包逐 part 内容',
    diffPackageBytes(input, removedSavedCopy.bytes).equal
      && !removedSavedCopy.package.parts[duplicatePart]
      && !removedSavedCopy.package.parts[duplicateNotesPart]);

  reopened.dispose?.();
  independentReopened.dispose?.();
  removedElementReopened.dispose?.();
  sourceRemovedReopened.dispose?.();
  addChainReopened.dispose?.();
  originalChainReopened.dispose?.();
  savedAddReopened.dispose?.();
  persistedReopened.dispose?.();
  edit.disposeDoc(persistedSource.doc);
  edit.disposeDoc(restoredSource.doc);
  edit.disposeDoc(noncanonical.doc);
  edit.disposeDoc(savedAdd.doc);
  edit.disposeDoc(originalChain.doc);
  edit.disposeDoc(addChain.doc);
  edit.disposeDoc(unsavedRemoved.doc);
  edit.disposeDoc(sourceRemoved.doc);
  edit.disposeDoc(removedElement.doc);
  edit.disposeDoc(independent.doc);
  edit.disposeDoc(doc);
}
