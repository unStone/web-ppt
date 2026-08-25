import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();

/** 已有 notesSlide 的编辑必须是最小 part 写回，并可从首次基线撤销。 */
export async function runSlideNotesSaveContract({ core, edit, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 演讲者备注最小保存与重开\x1b[0m');
  const input = load('sample-editor-notes.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'slide-notes-save-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const slidePart = doc.slides[slideId].origin.part;
  const notesPart = 'ppt/notesSlides/notesSlide1.xml';
  const notesRelsPart = 'ppt/notesSlides/_rels/notesSlide1.xml.rels';
  const sourceRels = presentation.package.parts[notesRelsPart];

  editor.exec({ type: 'SetNotes', id: slideId, text: '第一段\n第二段' });
  const saved = await editor.saveDetailed();
  saveArtifact('slide-notes.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const notesXml = decoder.decode(saved.package.parts[notesPart]);
  check('已有备注只改 notesSlide 正文 part，其它 OPC 关系与页面逐字直通',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === notesPart
      && saved.package.parts[notesRelsPart] === sourceRels
      && saved.package.parts[slidePart] === presentation.package.parts[slidePart],
  `changed=${diff.changed}`);
  check('多行纯文本映射为段落并保留来源 body 占位符与直接格式',
    notesXml.includes('<p:ph type="body" idx="1"/>')
      && notesXml.includes('<a:rPr sz="1200"/>')
      && notesXml.includes('<a:t>第一段</a:t>')
      && notesXml.includes('<a:t>第二段</a:t>')
      && notesXml.includes('页脚不得进入备注正文')
      && notesXml.includes('unknown-extension'));
  const reopened = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  check('保存重开恢复两段备注', reopened.slides[0].notes === '第一段\n第二段');

  const identity = await editor.saveDetailed();
  check('备注连续保存进入包 identity', identity.mode === 'identity' && identity.bytes === saved.bytes);
  editor.undo();
  const restored = await editor.saveDetailed();
  check('保存后撤销从首次备注基线恢复原包', diffPackageBytes(input, restored.bytes).equal);
  edit.disposeDoc(doc);

  const absentInput = load('sample-editor-add-slide.pptx');
  const absentPresentation = await core.parse(absentInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const absentDoc = edit.createDoc(absentPresentation, { idPrefix: 'slide-notes-absent-save-' });
  const absentEditor = new edit.Editor(absentDoc);
  const absentSlideId = absentDoc.slideOrder[0];
  const absentSlidePart = absentDoc.slides[absentSlideId].origin.part;
  absentEditor.exec({ type: 'SetNotes', id: absentSlideId, text: '旧页首次备注' });
  const absentSaved = await absentEditor.saveDetailed();
  const absentDiff = diffPackageBytes(absentInput, absentSaved.bytes);
  const absentReopened = await core.parse(absentSaved.bytes, { lazy: false, assets: 'defer' });
  check('无 notes 的旧页首次保存只创建必要 OPC 闭包并可重开',
    absentDiff.added.sort().join(',') === [
      'ppt/notesSlides/_rels/notesSlide1.xml.rels',
      'ppt/notesSlides/notesSlide1.xml',
    ].join(',')
      && absentDiff.changed.sort().join(',') === [
        '[Content_Types].xml', `ppt/slides/_rels/${absentSlidePart.split('/').at(-1)}.rels`,
      ].sort().join(',')
      && absentReopened.slides[0].notes === '旧页首次备注');
  const absentAgain = await absentEditor.saveDetailed();
  check('首次创建 notes 后连续保存进入 identity',
    absentAgain.mode === 'identity' && absentAgain.bytes === absentSaved.bytes);
  absentEditor.undo();
  const absentRestored = await absentEditor.saveDetailed();
  check('保存后撤销首次备注会清理关系、Content Type 与两个新 part',
    diffPackageBytes(absentInput, absentRestored.bytes).equal);
  absentEditor.redo();
  const absentRedone = await absentEditor.saveDetailed();
  check('重做首次备注复用同一 OPC 身份并得到确定性包',
    diffPackageBytes(absentSaved.bytes, absentRedone.bytes).equal);
  edit.disposeDoc(absentDoc);

  const sharedInput = load('sample-editor-remove-slide-shared-notes.pptx');
  const sharedPresentation = await core.parse(sharedInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sharedDoc = edit.createDoc(sharedPresentation, { idPrefix: 'slide-notes-shared-save-' });
  const sharedEditor = new edit.Editor(sharedDoc);
  sharedEditor.exec({ type: 'SetNotes', id: sharedDoc.slideOrder[2], text: '第三页独立备注' });
  const sharedSaved = await sharedEditor.saveDetailed();
  const sharedDiff = diffPackageBytes(sharedInput, sharedSaved.bytes);
  const sharedReopened = await core.parse(sharedSaved.bytes, { lazy: false, assets: 'defer' });
  check('共享 notes 保存会克隆完整来源闭包并只重定向被编辑页',
    sharedDiff.added.sort().join(',') === [
      'ppt/notesSlides/_rels/notesSlide5.xml.rels',
      'ppt/notesSlides/notesSlide5.xml',
    ].join(',')
      && sharedDiff.changed.sort().join(',') === [
        '[Content_Types].xml', 'ppt/slides/_rels/slide3.xml.rels',
      ].sort().join(',')
      && sharedSaved.package.parts['ppt/notesSlides/notesSlide2.xml']
        === sharedPresentation.package.parts['ppt/notesSlides/notesSlide2.xml']
      && sharedReopened.slides[1].notes === '页面 2 的独立备注'
      && sharedReopened.slides[2].notes === '第三页独立备注');
  sharedEditor.undo();
  const sharedRestored = await sharedEditor.saveDetailed();
  check('保存后撤销共享备注分叉恢复原共享关系且不残留克隆 part',
    diffPackageBytes(sharedInput, sharedRestored.bytes).equal);
  edit.disposeDoc(sharedDoc);

  const newPresentation = await core.parse(absentInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const newDoc = edit.createDoc(newPresentation, { idPrefix: 'slide-notes-new-save-' });
  const newEditor = new edit.Editor(newDoc);
  const added = newEditor.exec({
    type: 'AddSlide', layoutId: newDoc.layoutOrder[0], at: { after: newDoc.slideOrder[0] },
  });
  const newId = [...added.createdSlides][0];
  newEditor.exec({ type: 'SetNotes', id: newId, text: '会话新页备注' });
  const newSaved = await newEditor.saveDetailed();
  const newReopened = await core.parse(newSaved.bytes, { lazy: false, assets: 'defer' });
  check('会话新页与备注在一次保存中共同物化并保持页面归属',
    newReopened.slides.length === 2 && newReopened.slides[1].notes === '会话新页备注');
  edit.disposeDoc(newDoc);

  const duplicateInput = load('sample-editor-duplicate-slide.pptx');
  const duplicatePresentation = await core.parse(duplicateInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const duplicateDoc = edit.createDoc(duplicatePresentation, { idPrefix: 'slide-notes-copy-save-' });
  const duplicateEditor = new edit.Editor(duplicateDoc);
  const duplicateSourceId = duplicateDoc.slideOrder[1];
  const duplicated = duplicateEditor.exec({ type: 'DuplicateSlide', id: duplicateSourceId });
  const duplicateId = [...duplicated.createdSlides][0];
  duplicateEditor.exec({ type: 'SetNotes', id: duplicateId, text: '副本独立备注' });
  const duplicateSaved = await duplicateEditor.saveDetailed();
  const duplicateReopened = await core.parse(duplicateSaved.bytes, { lazy: false, assets: 'defer' });
  const duplicateIndex = duplicateDoc.slideOrder.indexOf(duplicateId);
  check('复制页克隆非规范 notes 来源后可独立编辑且不改变来源页',
    duplicateReopened.slides[1].notes === '页面 2 的独立备注'
      && duplicateReopened.slides[duplicateIndex].notes === '副本独立备注');
  edit.disposeDoc(duplicateDoc);
}
