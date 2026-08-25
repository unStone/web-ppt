import { diffPackageBytes } from '../diff-package.mjs';

const decode = (parts, name) => new TextDecoder().decode(parts[name]);
const count = (source, needle) => source.split(needle).length - 1;
const fieldTexts = (element) => {
  if (!element) return [];
  const bodies = element.kind === 'shape' ? [element.text]
    : element.kind === 'table' ? element.rows.flatMap((row) => row.cells.map((cell) => cell.text)) : [];
  return bodies.flatMap((body) => body?.paragraphs ?? [])
    .flatMap((paragraph) => paragraph.runs)
    .filter((run) => run.field?.toLowerCase() === 'slidenum').map((run) => run.text);
};

/** MoveSlide 保存只从公开命令、OPC 差异、重开与独立进程渲染取证。 */
export async function runMoveSlideSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ MoveSlide 最小保存、section 与重开\x1b[0m');
  const file = 'sample-editor-move-slide.pptx';
  const input = load(file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'move-slide-save-' });
  const editor = new edit.Editor(doc);
  const byPart = (part) => doc.slideOrder.find((id) => doc.slides[id].origin?.part === part);
  const first = byPart('ppt/slides/slide1.xml');
  const second = byPart('ppt/slides/slide2.xml');
  const third = byPart('ppt/slides/slide3.xml');
  check('页码索引覆盖普通文本框、表格与页码占位符',
    doc.elements[doc.slides[first].dynamicSlideNumbers[0]].meta.ph === undefined
      && doc.elements[doc.slides[second].dynamicSlideNumbers[0]].src.kind === 'table'
      && doc.elements[doc.slides[third].dynamicSlideNumbers[0]].meta.ph?.type === 'sldNum');
  editor.exec({ type: 'MoveSlide', id: second, at: { after: null } });
  editor.exec({ type: 'MoveSlide', id: third, at: { after: second } });
  check('普通文本框与表格中的动态页码随投影即时刷新',
    fieldTexts(editor.toSlide(second).elements.find((element) => element.kind === 'table')).join() === '1'
      && editor.toSlide(third).elements.flatMap(fieldTexts).join() === '2'
      && editor.toSlide(first).elements.flatMap(fieldTexts).join() === '3');
  const saveStartedAt = performance.now();
  const saved = await editor.saveDetailed();
  const saveElapsedMs = performance.now() - saveStartedAt;
  console.log(`  MoveSlide 单次保存实测：${saveElapsedMs.toFixed(1)} ms（3 页、4 个变更 part）`);
  check('单次保存耗时已实测并可记录', Number.isFinite(saveElapsedMs) && saveElapsedMs >= 0);
  const artifact = saveArtifact('move-slide.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('保存只改 presentation 与三个页码字段宿主页',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === [
        'ppt/presentation.xml', 'ppt/slides/slide1.xml',
        'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml',
      ].join(','));

  const presentationXml = decode(saved.package.parts, 'ppt/presentation.xml');
  const firstAt = presentationXml.indexOf('id="905" r:id="rId72"');
  const secondAt = presentationXml.indexOf('id="990" r:id="rId101"');
  const thirdAt = presentationXml.indexOf('id="900" r:id="rId40"');
  check('p:sldId 只重排节点，数值 id、rId、未知属性与扩展保持原身份',
    firstAt >= 0 && firstAt < secondAt && secondAt < thirdAt
      && count(presentationXml, 'fixture:slot=') === 3
      && presentationXml.includes('fixture:keep="A" id="900"')
      && presentationXml.includes('value="presentation-tail"'));
  check('section 成员不跨节，节内顺序跟随最终全局页序',
    /name="前两页"[\s\S]*?<p14:sldId[^>]*id="905"\/><p14:sldId[^>]*id="900"\/>/.test(presentationXml)
      && /name="末页"[\s\S]*?<p14:sldId id="990"\/>/.test(presentationXml));
  check('presentation 关系、notes、Content Types 与未知 part 逐字节保持',
    [
      '[Content_Types].xml', 'ppt/_rels/presentation.xml.rels', 'customXml/keep.xml',
      'ppt/notesSlides/notesSlide1.xml', 'ppt/notesSlides/notesSlide2.xml',
      'ppt/notesSlides/notesSlide3.xml',
    ].every((part) => saved.package.parts[part] === presentation.package.parts[part]));
  check('页码字段缓存按最终页序刷新且只改文字值',
    decode(saved.package.parts, 'ppt/slides/slide2.xml').includes('<a:t>1</a:t>')
      && decode(saved.package.parts, 'ppt/slides/slide3.xml').includes('<a:t>2</a:t>')
      && decode(saved.package.parts, 'ppt/slides/slide1.xml').includes('<a:t>3</a:t>'));

  const reopened = await core.parse(saved.bytes, { lazy: false, assets: 'defer' });
  const slideText = (slide) => JSON.stringify(slide.elements);
  check('保存重开恢复最终页序、notes 归属与可渲染页码',
    reopened.slides.length === 3
      && slideText(reopened.slides[0]).includes('稳定页面 2')
      && slideText(reopened.slides[1]).includes('稳定页面 3')
      && slideText(reopened.slides[2]).includes('稳定页面 1')
      && reopened.slides.map((slide) => slide.notes).join('|')
        === '页面 2 的备注不可变化|页面 3 的备注不可变化|页面 1 的备注不可变化');

  const scenario = {
    type: 'moveSlide',
    moves: [
      { part: 'ppt/slides/slide2.xml', afterPart: null },
      { part: 'ppt/slides/slide3.xml', afterPart: 'ppt/slides/slide2.xml' },
    ],
  };
  for (let resultSlideIndex = 0; resultSlideIndex < 3; resultSlideIndex++) {
    const fingerprintScenario = { ...scenario, resultSlideIndex };
    const projected = renderFingerprint(file, 'projected', fingerprintScenario);
    const materialized = renderFingerprint(artifact, 'saved', fingerprintScenario);
    for (const mode of ['html', 'svg']) {
      eq(`重排第 ${resultSlideIndex + 1} 页 ${mode} 保存指纹等于独立进程投影`,
        materialized[mode], projected[mode]);
    }
  }

  const savedAgain = await editor.saveDetailed();
  check('连续保存进入 identity 且不再次压缩任何 part',
    savedAgain.mode === 'identity' && savedAgain.bytes === saved.bytes);
  editor.undo();
  editor.undo();
  const restored = await editor.saveDetailed();
  check('保存后连续撤销恢复原包每个字节', diffPackageBytes(input, restored.bytes).equal);
  editor.redo();
  editor.redo();
  const redone = await editor.saveDetailed();
  check('重做恢复相同页序与确定性包内容', diffPackageBytes(saved.bytes, redone.bytes).equal);

  const editedFieldPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const editedFieldDoc = edit.createDoc(editedFieldPresentation, { idPrefix: 'move-slide-field-edit-' });
  const editedFieldEditor = new edit.Editor(editedFieldDoc);
  const editedFieldFirst = editedFieldDoc.slideOrder[0];
  const editedFieldId = editedFieldDoc.slides[editedFieldFirst].dynamicSlideNumbers[0];
  editedFieldEditor.exec({
    type: 'EditText', id: editedFieldId,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 },
      text: '自定义页码',
    }],
  });
  const editedFieldOnlySaved = await editedFieldEditor.saveDetailed();
  let editedFieldMove = null;
  const unsubscribeEditedField = editedFieldEditor.subscribe((change) => {
    if (change.source === 'transaction') editedFieldMove = change;
  });
  const editedFieldMoveResult = editedFieldEditor.exec({
    type: 'MoveSlide', id: editedFieldFirst,
    at: { after: editedFieldDoc.slideOrder.at(-1) },
  });
  unsubscribeEditedField();
  const editedFieldProjected = JSON.stringify(editedFieldEditor.toSlide(editedFieldFirst).elements);
  const editedFieldSaved = await editedFieldEditor.saveDetailed();
  const editedFieldMoveDiff = diffPackageBytes(editedFieldOnlySaved.bytes, editedFieldSaved.bytes);
  const editedFieldXml = decode(editedFieldSaved.package.parts, 'ppt/slides/slide1.xml');
  const editedFieldReopened = await core.parse(editedFieldSaved.bytes, { lazy: false, assets: 'defer' });
  check('显式编辑页码字段会转为普通文本，重排投影与保存重开保持一致',
    editedFieldProjected.includes('自定义页码') && !editedFieldProjected.includes('"field":"slidenum"')
      && editedFieldXml.includes('自定义页码') && !editedFieldXml.includes('type="slidenum"')
      && JSON.stringify(editedFieldReopened.slides.at(-1)?.elements).includes('自定义页码'));
  check('普通化后的页码字段不再进入重排失效或页面字段保存集合',
    !editedFieldMoveResult.dirtyElements.has(editedFieldId)
      && !editedFieldMove?.dirtyElements.has(editedFieldId)
      && !editedFieldMove?.renderElements.has(editedFieldId)
      && editedFieldMoveDiff.changed.join(',') === [
        'ppt/presentation.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml',
      ].join(','));

  editedFieldReopened.dispose?.();
  edit.disposeDoc(editedFieldDoc);
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
