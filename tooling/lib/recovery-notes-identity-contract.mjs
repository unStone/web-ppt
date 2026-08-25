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

const rejected = (fn) => {
  try { fn(); return false; } catch { return true; }
};

/** notes part 是包级身份；复制页与共享备注分叉都不能只相信 next 水位。 */
export async function runRecoveryNotesIdentityContract({ edit, core, load, check }) {
  const notesInput = load('sample-editor-remove-slide.pptx');
  const notesPresentation = await core.parse(notesInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const notesDoc = edit.createDoc(notesPresentation, { idPrefix: 'recovery-notes-' });
  const notesEditor = new edit.Editor(notesDoc);
  const notesSource = notesDoc.slideOrder.find((id) => notesDoc.slides[id].notes);
  const notesFrames = [];
  const stopNotes = notesEditor.subscribeRecovery((frame) => notesFrames.push(frame));
  const duplicatedNotes = notesEditor.exec({ type: 'DuplicateSlide', id: notesSource });
  const duplicatedNotesId = [...duplicatedNotes.createdSlides][0];
  stopNotes();
  const notesLog = JSON.parse(JSON.stringify(notesFrames));
  const allocatedNotesPart = notesDoc.slides[duplicatedNotesId].notes.targetPart;
  edit.disposeDoc(notesDoc);

  const freshNotesPresentation = await core.parse(notesInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const freshNotesDoc = edit.createDoc(freshNotesPresentation, { idPrefix: 'recovery-notes-' });
  const freshNotesEditor = new edit.Editor(freshNotesDoc, { recoveryFrames: notesLog });
  check('复制页恢复时保留独立的新 notes part',
    freshNotesDoc.slides[duplicatedNotesId]?.notes?.targetPart === allocatedNotesPart
      && freshNotesEditor.history.undoCount === 0);
  const reusedNotesLog = structuredClone(notesLog);
  const reusedNotesPatch = reusedNotesLog.flatMap((frame) => frame.patches).find((patch) =>
    patch.op === 'insert' && patch.path[0] === 'slides' && patch.path.length === 2);
  const occupiedNotesPart = freshNotesDoc.slideOrder
    .map((id) => freshNotesDoc.slides[id].notes?.targetPart)
    .find((part) => part && part !== allocatedNotesPart);
  reusedNotesPatch.value.slide.creation.duplicateNotesPart = occupiedNotesPart;
  reusedNotesPatch.value.slide.notes.targetPart = occupiedNotesPart;
  const reusedNotesPresentation = await core.parse(notesInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reusedNotesDoc = edit.createDoc(reusedNotesPresentation, { idPrefix: 'recovery-notes-' });
  const reusedNotesBefore = modelJson(reusedNotesDoc);
  check('复制页实际 notes part 不能复用原包已有 part', !!occupiedNotesPart
    && rejected(() => edit.restoreRecoveryFrames(reusedNotesDoc, reusedNotesLog))
    && modelJson(reusedNotesDoc) === reusedNotesBefore);
  edit.disposeDoc(reusedNotesDoc);
  edit.disposeDoc(freshNotesDoc);

  const sharedNotesInput = load('sample-editor-remove-slide-shared-notes.pptx');
  const sharedNotesPresentation = await core.parse(sharedNotesInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sharedNotesDoc = edit.createDoc(sharedNotesPresentation, { idPrefix: 'recovery-shared-notes-' });
  const sharedNotesEditor = new edit.Editor(sharedNotesDoc);
  const sharedNotesSlide = sharedNotesDoc.slideOrder[2];
  const sharedSourcePart = sharedNotesDoc.slides[sharedNotesSlide].notes.targetPart;
  const sharedNotesFrames = [];
  const stopSharedNotes = sharedNotesEditor.subscribeRecovery((frame) => sharedNotesFrames.push(frame));
  sharedNotesEditor.exec({ type: 'SetNotes', id: sharedNotesSlide, text: '恢复后的独立备注' });
  stopSharedNotes();
  const sharedAllocatedPart = sharedNotesDoc.slides[sharedNotesSlide].notes.targetPart;
  const sharedNotesLog = JSON.parse(JSON.stringify(sharedNotesFrames));
  edit.disposeDoc(sharedNotesDoc);

  const freshBindingPresentation = await core.parse(sharedNotesInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const freshBindingDoc = edit.createDoc(freshBindingPresentation, { idPrefix: 'recovery-shared-notes-' });
  const freshBindingEditor = new edit.Editor(freshBindingDoc, { recoveryFrames: sharedNotesLog });
  check('SetNotes 分叉出的新绑定可恢复且保留备注内容',
    freshBindingDoc.slides[sharedNotesSlide].notes.targetPart === sharedAllocatedPart
      && freshBindingEditor.toSlide(sharedNotesSlide).notes === '恢复后的独立备注');
  edit.disposeDoc(freshBindingDoc);

  const reusedBindingLog = structuredClone(sharedNotesLog);
  const bindingPatch = reusedBindingLog.flatMap((frame) => frame.patches).find((patch) =>
    patch.op === 'set' && patch.path[0] === 'slides' && patch.path.length === 3
      && patch.path[2] === 'notes');
  bindingPatch.value.targetPart = sharedSourcePart;
  const bindingPresentation = await core.parse(sharedNotesInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const bindingDoc = edit.createDoc(bindingPresentation, { idPrefix: 'recovery-shared-notes-' });
  const bindingBefore = modelJson(bindingDoc);
  check('SetNotes 新建绑定路径同样不能复用原包 notes part',
    rejected(() => edit.restoreRecoveryFrames(bindingDoc, reusedBindingLog))
      && modelJson(bindingDoc) === bindingBefore);
  edit.disposeDoc(bindingDoc);
}
