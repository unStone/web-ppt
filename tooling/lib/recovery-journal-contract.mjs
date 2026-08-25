import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecoveryAssetContract } from './recovery-asset-contract.mjs';
import { runRecoveryNotesIdentityContract } from './recovery-notes-identity-contract.mjs';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const bytesOf = (base64) => Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));

const modelJson = (doc) => JSON.stringify({
  meta: doc.meta,
  identity: doc.identity,
  slides: doc.slides,
  slideOrder: doc.slideOrder,
  layouts: doc.layouts,
  layoutOrder: doc.layoutOrder,
  elements: doc.elements,
  removedElements: doc.removedElements,
  imageResources: doc.imageResources,
});

const contentJson = (doc) => JSON.stringify({
  meta: doc.meta,
  slides: doc.slides,
  slideOrder: doc.slideOrder,
  layouts: doc.layouts,
  layoutOrder: doc.layoutOrder,
  elements: doc.elements,
  removedElements: doc.removedElements,
  imageResources: doc.imageResources,
});

const rejected = (fn) => {
  try { fn(); return false; } catch { return true; }
};

const stableSessionUrls = (markup) => markup.replace(
  /(<image\b[^>]*\bhref=")(?:(?:blob|asset):|data:image\/)[^"]+("[^>]*>)/g,
  '$1session:asset$2',
);

/** 恢复能力只依赖发布入口；浏览器存储层以后只能消费这里守住的纯数据边界。 */
export async function runRecoveryJournalContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 可持久化操作日志与确定性恢复\x1b[0m');
  const input = load('sample-editor-add-slide.pptx');
  if (!check('找到同时覆盖版式、元素与 OPC 身份的恢复固件', !!input)) return;
  check('公开恢复版本、回放函数与 Editor 订阅入口',
    edit.EDITOR_RECOVERY_VERSION === 1
      && typeof edit.restoreRecoveryFrames === 'function');

  const sourcePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sourceDoc = edit.createDoc(sourcePresentation, { idPrefix: 'recovery-' });
  const source = new edit.Editor(sourceDoc);
  const frames = [];
  const reported = [];
  const previousReportError = globalThis.reportError;
  globalThis.reportError = (error) => reported.push(error);
  const unsubscribeBroken = source.subscribeRecovery((frame) => {
    frame.patches.length = 0;
    throw new Error('故意破坏恢复订阅者');
  });
  const unsubscribe = source.subscribeRecovery((frame) => frames.push(frame));

  const firstSlide = sourceDoc.slideOrder[0];
  source.select({ kind: 'elements', ids: [sourceDoc.slides[firstSlide].children[0]], enteredGroup: null });
  source.exec({
    type: 'AddShape', slideId: firstSlide, preset: 'roundRect',
    rect: { x: 123.25, y: 67.5, w: 211.75, h: 109.5 },
  });
  const shapeId = source.selection.ids[0];
  source.exec({
    type: 'AddImage', slideId: firstSlide, bytes: bytesOf(PNG_1PX), mime: 'image/png',
    rect: { x: 410, y: 80, w: 80, h: 80 },
  });
  const imageId = source.selection.ids[0];
  const layoutId = sourceDoc.layoutOrder[0];
  const added = source.exec({ type: 'AddSlide', layoutId, at: { after: firstSlide } });
  const addedSlideId = [...added.createdSlides][0];
  source.transaction((transaction) => {
    transaction.exec({ type: 'SetXfrm', id: shapeId, x: 177.5 });
    transaction.select({ kind: 'elements', ids: [shapeId], enteredGroup: null });
  }, '系统定位', { recordHistory: false, origin: 'system' });
  source.undo();
  source.redo();
  source.select({ kind: 'elements', ids: [imageId], enteredGroup: null });
  source.markSaved();
  source.exec({ type: 'SetXfrm', id: imageId, x: 430 });
  source.undo();

  unsubscribeBroken();
  unsubscribe();
  globalThis.reportError = previousReportError;
  const sourceModel = modelJson(sourceDoc);
  const sourceContent = contentJson(sourceDoc);
  const sourceSelection = JSON.stringify(source.selection);
  const sourceSvgs = ['html', 'svg'].flatMap((textMode) => sourceDoc.slideOrder.map((id, index) =>
    core.renderSlideToSvg(
      sourcePresentation, source.toSlide(id),
      { textMode, idPrefix: `recovery-${textMode}-${index}-` },
    )));

  check('事务、非历史写入、撤销、重做、选区与保存点各自产生一帧且异常被隔离',
    frames.some((frame) => frame.source === 'transaction' && frame.label === '系统定位')
      && frames.some((frame) => frame.source === 'undo')
      && frames.some((frame) => frame.source === 'redo')
      && frames.some((frame) => frame.source === 'selection')
      && frames.some((frame) => frame.source === 'savepoint')
      && reported.length === frames.length);
  check('第二个订阅者拿到未被第一个订阅者篡改的独立帧',
    frames.some((frame) => frame.patches.length > 0));
  check('恢复帧带严格递增序号、完整身份与当时脏状态', frames.every((frame, index) =>
    frame.version === 1 && frame.sequence === index + 1
      && frame.identity.prefix === 'recovery-' && typeof frame.dirty === 'boolean')
    && frames.at(-1).dirty === false);
  check('日志保留图片资源闭包而不是依赖会话 URL', JSON.stringify(frames).includes(PNG_1PX));

  const reentrantPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reentrantDoc = edit.createDoc(reentrantPresentation, { idPrefix: 'recovery-reentrant-' });
  const reentrantEditor = new edit.Editor(reentrantDoc);
  const reentrantElement = Object.values(reentrantDoc.elements)
    .find((record) => record.meta.editable !== 'none').id;
  const observedSequences = [];
  let reentered = false;
  reentrantEditor.subscribeRecovery(() => {
    if (reentered) return;
    reentered = true;
    reentrantEditor.select({ kind: 'elements', ids: [reentrantElement], enteredGroup: null });
  });
  reentrantEditor.subscribeRecovery((frame) => observedSequences.push(frame.sequence));
  reentrantEditor.exec({
    type: 'SetXfrm', id: reentrantElement,
    x: reentrantEditor.effectiveElement(reentrantElement).x + 1,
  });
  check('订阅者同步重入时其它订阅者仍按严格序号接收',
    JSON.stringify(observedSequences) === '[1,2]');
  edit.disposeDoc(reentrantDoc);

  const invalidTimePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const invalidTimeDoc = edit.createDoc(invalidTimePresentation, { idPrefix: 'recovery-time-' });
  const invalidTimeEditor = new edit.Editor(invalidTimeDoc);
  const invalidTimeElement = Object.values(invalidTimeDoc.elements)
    .find((record) => record.meta.editable !== 'none').id;
  const invalidTimeBefore = modelJson(invalidTimeDoc);
  const invalidTimeFrames = [];
  invalidTimeEditor.subscribeRecovery((frame) => invalidTimeFrames.push(frame));
  check('非有限事务时间在落模型前拒绝且不会广播不可 JSON 化的帧', rejected(() =>
    invalidTimeEditor.transaction((transaction) => transaction.exec({
      type: 'SetXfrm', id: invalidTimeElement,
      x: invalidTimeEditor.effectiveElement(invalidTimeElement).x + 1,
    }), '非法时间', { time: NaN }))
      && modelJson(invalidTimeDoc) === invalidTimeBefore && invalidTimeFrames.length === 0);
  edit.disposeDoc(invalidTimeDoc);

  const serialized = JSON.stringify(frames);
  const persisted = JSON.parse(serialized);
  check('完整日志可 JSON 往返且没有 TypedArray 退化',
    JSON.stringify(persisted) === serialized && !serialized.includes('"0":137'));

  const recoveredPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveredDoc = edit.createDoc(recoveredPresentation, { idPrefix: 'recovery-' });
  const recovered = new edit.Editor(recoveredDoc, { recoveryFrames: persisted });
  const recoveredSvgs = ['html', 'svg'].flatMap((textMode) => recoveredDoc.slideOrder.map((id, index) =>
    core.renderSlideToSvg(
      recoveredPresentation, recovered.toSlide(id),
      { textMode, idPrefix: `recovery-${textMode}-${index}-` },
    )));
  check('JSON 日志恢复出逐字段相同模型、选区与投影',
    modelJson(recoveredDoc) === sourceModel
      && JSON.stringify(recovered.selection) === sourceSelection
      && JSON.stringify(recoveredSvgs) === JSON.stringify(sourceSvgs));
  const recoveryOut = join(process.cwd(), 'out/edit/recovery');
  mkdirSync(recoveryOut, { recursive: true });
  const framesFile = join(recoveryOut, 'frames.json');
  writeFileSync(framesFile, serialized);
  const fingerprintArgs = [
    join(process.cwd(), 'tooling/lib/recovery-fingerprint.mjs'),
    join(process.cwd(), 'fixtures/sample-editor-add-slide.pptx'), framesFile, 'recovery-',
  ];
  const fingerprintA = execFileSync(process.execPath, fingerprintArgs, {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
  });
  const fingerprintB = execFileSync(process.execPath, fingerprintArgs, {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
  });
  const sourceDigest = createHash('sha256');
  for (const [index, svg] of sourceSvgs.entries()) {
    const textMode = index < sourceDoc.slideOrder.length ? 'html' : 'svg';
    const slideId = sourceDoc.slideOrder[index % sourceDoc.slideOrder.length];
    sourceDigest.update(`${textMode}\0${slideId}\0`);
    sourceDigest.update(svg);
  }
  const fingerprint = JSON.parse(fingerprintA);
  check('两个独立进程恢复指纹稳定且与崩溃前双文本路径一致',
    fingerprintA === fingerprintB && fingerprint.pages === sourceDoc.slideOrder.length
      && fingerprint.digest === sourceDigest.digest('hex'));
  check('恢复保存点脏状态但不伪造可撤销历史',
    !recovered.isDirty() && recovered.history.undoCount === 0 && recovered.history.redoCount === 0);

  const existingElementIds = new Set(Object.keys(recoveredDoc.elements));
  const existingSlideIds = new Set(recoveredDoc.slideOrder);
  const existingParts = new Set(recoveredDoc.slideOrder.map((id) => recoveredDoc.slides[id].origin.part));
  const existingSpids = new Set(Object.values(recoveredDoc.elements)
    .filter((record) => record.meta.origin?.part === recoveredDoc.slides[firstSlide].origin.part)
    .map((record) => record.meta.origin.spid));
  recovered.exec({
    type: 'AddShape', slideId: firstSlide, preset: 'ellipse',
    rect: { x: 10, y: 10, w: 30, h: 30 },
  });
  const nextShapeId = recovered.selection.ids[0];
  const nextSlide = recovered.exec({ type: 'AddSlide', layoutId, at: { after: addedSlideId } });
  const nextSlideId = [...nextSlide.createdSlides][0];
  check('恢复身份水位后继续新增不会复用元素、spid、页面或 OPC part',
    !existingElementIds.has(nextShapeId)
      && !existingSpids.has(recoveredDoc.elements[nextShapeId].meta.origin.spid)
      && !existingSlideIds.has(nextSlideId)
      && !existingParts.has(recoveredDoc.slides[nextSlideId].origin.part));
  recovered.undo();
  recovered.undo();
  check('恢复后的新编辑仍形成正常历史并可完整撤销',
    contentJson(recoveredDoc) === sourceContent && !recovered.isDirty()
      && recoveredDoc.identity.nextElement > sourceDoc.identity.nextElement);
  const saved = await recovered.save();
  writeFileSync(join(recoveryOut, 'recovered.pptx'), saved);
  const reparsed = await core.parse(saved, { edit: true, lazy: false, assets: 'defer' });
  const reparsedSvgs = ['html', 'svg'].flatMap((textMode) => reparsed.slides.map((slide, index) =>
    core.renderSlideToSvg(reparsed, slide, { textMode, idPrefix: `recovery-${textMode}-${index}-` })));
  const stableReparsedSvgs = reparsedSvgs.map(stableSessionUrls);
  const stableRecoveredSvgs = recoveredSvgs.map(stableSessionUrls);
  const savedMismatch = stableReparsedSvgs.findIndex((svg, index) => svg !== stableRecoveredSvgs[index]);
  check('恢复文档可继续保存重开且双文本路径除会话 URL 外逐字节一致',
    reparsed.slides.length === sourceDoc.slideOrder.length
      && savedMismatch < 0,
  savedMismatch < 0 ? '' : `首个差异页索引 ${savedMismatch}`);
  reparsed.dispose?.();

  const atomicPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const atomicDoc = edit.createDoc(atomicPresentation, { idPrefix: 'recovery-' });
  const atomicBefore = modelJson(atomicDoc);
  const wrongPrefix = structuredClone(persisted);
  wrongPrefix[0].identity.prefix = 'another-document-';
  const brokenTail = structuredClone(persisted);
  brokenTail.push({
    ...structuredClone(brokenTail.at(-1)), sequence: brokenTail.at(-1).sequence + 1,
    patches: [{ op: 'set', path: ['elements', 'missing', 'ovr', 'x'], value: 1, origin: 'broken' }],
  });
  const duplicateSequence = structuredClone(persisted);
  duplicateSequence[1].sequence = duplicateSequence[0].sequence;
  const invalidIdentity = structuredClone(persisted);
  invalidIdentity.at(-1).identity.nextElement = 0;
  const regressedIdentity = structuredClone(persisted);
  regressedIdentity.at(-1).identity.nextElement = atomicDoc.identity.nextElement;
  const underallocatedIdentity = structuredClone(persisted);
  for (const frame of underallocatedIdentity) {
    frame.identity.nextSlide = atomicDoc.identity.nextSlide;
    frame.identity.nextElement = atomicDoc.identity.nextElement;
    frame.identity.nextSpid = {};
    delete frame.identity.nextSlidePart;
    delete frame.identity.nextNotesPart;
    delete frame.identity.nextPresentationSlideId;
    delete frame.identity.nextPresentationRelationship;
  }
  const forgedStructuralIdentity = structuredClone(persisted);
  const forgedFrame = forgedStructuralIdentity.find((frame) => frame.patches.some((patch) =>
    patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2));
  const forgedPatch = forgedFrame.patches.find((patch) =>
    patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2);
  const forgedRecord = Object.values(forgedPatch.value.records)[0];
  const forgedPart = forgedRecord.meta.origin.part;
  forgedRecord.meta.created = false;
  forgedRecord.meta.editable = 'none';
  delete forgedRecord.meta.insertion;
  forgedRecord.meta.origin.spid = forgedFrame.identity.nextSpid[forgedPart];
  const invalidAnchor = structuredClone(persisted);
  const invalidAnchorPatch = invalidAnchor.flatMap((frame) => frame.patches).find((patch) =>
    patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2);
  Object.values(invalidAnchorPatch.value.records)[0].meta.origin.spid = null;
  const foreignOrigin = structuredClone(persisted);
  const foreignOriginPatch = foreignOrigin.flatMap((frame) => frame.patches).find((patch) =>
    patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2);
  Object.values(foreignOriginPatch.value.records)[0].meta.origin = {
    part: atomicDoc.layoutOrder[0], spid: 1_000_000,
  };
  const missingOrigin = structuredClone(persisted);
  const missingOriginFrame = missingOrigin.find((frame) => frame.patches.some((patch) =>
    patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2));
  const missingOriginPatch = missingOriginFrame.patches.find((patch) =>
    patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2);
  const missingOriginRecord = Object.values(missingOriginPatch.value.records)[0];
  const missingOriginPart = missingOriginRecord.meta.origin.part;
  delete missingOriginRecord.meta.origin;
  delete missingOriginRecord.meta.insertion;
  missingOriginRecord.meta.created = false;
  missingOriginRecord.meta.editable = 'none';
  delete missingOriginFrame.identity.nextSpid[missingOriginPart];
  const reusedPresentationIdentity = structuredClone(persisted);
  const reusedSlidePatch = reusedPresentationIdentity.flatMap((frame) => frame.patches)
    .find((patch) => patch.op === 'insert' && patch.path[0] === 'slides' && patch.path.length === 2);
  reusedSlidePatch.value.slide.creation.presentationSlideId = 900;
  reusedSlidePatch.value.slide.creation.presentationRelationshipId = 'rId40';
  const noncanonicalSelection = structuredClone(persisted);
  noncanonicalSelection[0].selection = { kind: 'elements', ids: [], enteredGroup: null };
  const unknownSelection = structuredClone(persisted);
  unknownSelection.at(-1).selection = { kind: 'future-selection' };
  check('错文档、非法尾帧、身份水位、选区和非递增序号全部拒绝',
    rejected(() => edit.restoreRecoveryFrames(atomicDoc, wrongPrefix))
      && rejected(() => edit.restoreRecoveryFrames(atomicDoc, brokenTail))
      && rejected(() => edit.restoreRecoveryFrames(atomicDoc, duplicateSequence))
      && rejected(() => edit.restoreRecoveryFrames(atomicDoc, invalidIdentity))
      && rejected(() => edit.restoreRecoveryFrames(atomicDoc, regressedIdentity))
      && rejected(() => edit.restoreRecoveryFrames(atomicDoc, underallocatedIdentity))
      && rejected(() => edit.restoreRecoveryFrames(atomicDoc, noncanonicalSelection))
      && rejected(() => edit.restoreRecoveryFrames(atomicDoc, unknownSelection)));
  check('结构快照不能靠伪造 created/editable 标志绕过 owning part 的 spid 下界',
    rejected(() => edit.restoreRecoveryFrames(atomicDoc, forgedStructuralIdentity)));
  check('结构快照中的非正安全整数 spid 被原子拒绝',
    rejected(() => edit.restoreRecoveryFrames(atomicDoc, invalidAnchor)));
  check('可写新结构不能把 anchor 伪装到版式 part 逃逸页面水位',
    rejected(() => edit.restoreRecoveryFrames(atomicDoc, foreignOrigin)));
  check('没有 anchor 的未知记录必须证明自己嵌在合法插入根中',
    rejected(() => edit.restoreRecoveryFrames(atomicDoc, missingOrigin)));
  check('新页面实际 presentation id/rId 必须越过原包身份下界',
    rejected(() => edit.restoreRecoveryFrames(atomicDoc, reusedPresentationIdentity)));
  check('任一帧损坏都不会给目标文档留下部分恢复状态', modelJson(atomicDoc) === atomicBefore);

  await runRecoveryAssetContract({ edit, core, load, check });

  const tableInput = load('sample-edit-basic.pptx');
  const tablePresentation = await core.parse(tableInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const tableDoc = edit.createDoc(tablePresentation, { idPrefix: 'recovery-table-' });
  const tableEditor = new edit.Editor(tableDoc);
  const textRecord = Object.values(tableDoc.elements).find((record) =>
    record.src.kind === 'shape' && record.meta.editable === 'full' && record.src.text);
  const tableRecord = Object.values(tableDoc.elements).find((record) => record.src.kind === 'table');
  const tableFrames = [];
  const stopTable = tableEditor.subscribeRecovery((frame) => tableFrames.push(frame));
  tableEditor.exec({
    type: 'EditText', id: textRecord.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '恢复文字：',
    }],
  });
  const insertedRow = tableEditor.exec({ type: 'InsertRow', id: tableRecord.id });
  const removedRowId = insertedRow.forward[0].path[4];
  tableEditor.undo();
  stopTable();
  const tableLog = JSON.parse(JSON.stringify(tableFrames));
  edit.disposeDoc(tableDoc);
  const recoveredTablePresentation = await core.parse(tableInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveredTableDoc = edit.createDoc(recoveredTablePresentation, { idPrefix: 'recovery-table-' });
  const recoveredTableEditor = new edit.Editor(recoveredTableDoc, { recoveryFrames: tableLog });
  const nextRow = recoveredTableEditor.exec({ type: 'InsertRow', id: tableRecord.id });
  const nextRowId = nextRow.forward[0].path[4];
  const recoveredText = recoveredTableEditor.effectiveElement(textRecord.id).text.paragraphs
    .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
  check('文字与表格行日志恢复后保留内容并越过已删除的行身份',
    recoveredText.startsWith('恢复文字：') && nextRowId !== removedRowId
      && recoveredTableEditor.history.undoCount === 1);
  const recoveredTableSaved = await recoveredTableEditor.save();
  const recoveredTableReparsed = await core.parse(recoveredTableSaved, { edit: true, lazy: false });
  const savedText = recoveredTableReparsed.slides.flatMap((slide) => slide.elements)
    .find((element) => element.kind === 'shape' && element.name === textRecord.src.name);
  check('恢复后的文字与表格行可保存重开且有效内容一致',
    savedText?.kind === 'shape'
      && savedText.text?.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text))
        .join('').startsWith('恢复文字：')
      && recoveredTableReparsed.slides.flatMap((slide) => slide.elements)
        .some((element) => element.kind === 'table'
          && element.rows.length === tableRecord.src.rows.length + 1));
  recoveredTableReparsed.dispose?.();

  await runRecoveryNotesIdentityContract({ edit, core, load, check });

  const blankPresentation = await core.parse(tableInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const blankLayout = blankPresentation.editInfo?.layouts.find((layout) => layout.elements.length === 0);
  check('找到没有任何元素记录的空白版式', !!blankLayout);
  if (blankLayout) {
    const blankDoc = edit.createDoc(blankPresentation, { idPrefix: 'recovery-blank-' });
    const blankEditor = new edit.Editor(blankDoc);
    const blankFrames = [];
    const stopBlank = blankEditor.subscribeRecovery((frame) => blankFrames.push(frame));
    const blankResult = blankEditor.exec({
      type: 'AddSlide', layoutId: blankLayout.id, at: { after: blankDoc.slideOrder.at(-1) },
    });
    stopBlank();
    const blankSlideId = [...blankResult.createdSlides][0];
    const blankPart = blankDoc.slides[blankSlideId].origin.part;
    const blankLog = JSON.parse(JSON.stringify(blankFrames));
    edit.disposeDoc(blankDoc);
    const freshBlankPresentation = await core.parse(tableInput, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const freshBlankDoc = edit.createDoc(freshBlankPresentation, { idPrefix: 'recovery-blank-' });
    const freshBlankEditor = new edit.Editor(freshBlankDoc, { recoveryFrames: blankLog });
    check('空白版式 AddSlide 日志以根组保留水位恢复，不读取尚不存在的新页 XML',
      freshBlankDoc.slides[blankSlideId]?.children.length === 0
        && freshBlankDoc.identity.nextSpid[blankPart] === 2
        && freshBlankEditor.history.undoCount === 0);
    const occupiedPartLog = structuredClone(blankLog);
    const occupiedPartFrame = occupiedPartLog.find((frame) => frame.patches.some((patch) =>
      patch.op === 'insert' && patch.path[0] === 'slides' && patch.path.length === 2));
    const occupiedPartPatch = occupiedPartFrame.patches.find((patch) =>
      patch.op === 'insert' && patch.path[0] === 'slides' && patch.path.length === 2);
    const occupiedPart = freshBlankDoc.slides[freshBlankDoc.slideOrder[0]].origin.part;
    occupiedPartPatch.value.slide.origin.part = occupiedPart;
    delete occupiedPartPatch.value.slide.creation;
    delete occupiedPartFrame.identity.nextSpid[blankPart];
    const occupiedPresentation = await core.parse(tableInput, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const occupiedDoc = edit.createDoc(occupiedPresentation, { idPrefix: 'recovery-blank-' });
    const occupiedBefore = modelJson(occupiedDoc);
    check('未知 SlideId 不能伪装成已占用 source part 且缺失 creation',
      rejected(() => edit.restoreRecoveryFrames(occupiedDoc, occupiedPartLog))
        && modelJson(occupiedDoc) === occupiedBefore);
    edit.disposeDoc(occupiedDoc);
    edit.disposeDoc(freshBlankDoc);
  } else blankPresentation.dispose?.();

  edit.disposeDoc(recoveredTableDoc);
  edit.disposeDoc(atomicDoc);
  edit.disposeDoc(recoveredDoc);
  edit.disposeDoc(sourceDoc);
}
