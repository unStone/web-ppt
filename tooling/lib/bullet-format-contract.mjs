/** 只从发布命令、公开查询和有效投影观察项目符号语义。 */
export async function runBulletFormatContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 项目符号与自动编号编辑\x1b[0m');
  const presentation = await core.parse(load('sample-editor-list-level.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'bullet-format-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements)
    .find((candidate) => candidate.src.name === '多级列表');
  const range = { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 } };

  const result = editor.exec({
    type: 'SetParaProps', id: record.id, range,
    props: { bullet: { kind: 'char', char: '→', font: 'Arial' } },
  });
  const state = edit.queryParaProps(doc, record.id, range);
  const paragraph = editor.effectiveElement(record.id).text.paragraphs[0];
  check('字符项目符号通过公开命令、查询和投影形成一个历史单元',
    paragraph.bullet === '→' && paragraph.bulletFont === 'Arial'
      && JSON.stringify(state.bullet.value)
        === JSON.stringify({ kind: 'char', char: '→', font: 'Arial' })
      && !state.bullet.mixed && result.forward.length === 1
      && editor.history.undoCount === 1,
    JSON.stringify({ paragraph, state: state.bullet, patches: result.forward.length }));

  editor.exec({
    type: 'SetParaProps', id: record.id, range, props: { bullet: { kind: 'none' } },
  });
  const noneState = edit.queryParaProps(doc, record.id, range).bullet;
  const noneParagraph = editor.effectiveElement(record.id).text.paragraphs[0];
  const undoNone = editor.undo()
    && editor.effectiveElement(record.id).text.paragraphs[0].bullet === '→';
  editor.redo();
  editor.exec({
    type: 'SetParaProps', id: record.id, range, props: { bullet: null },
  });
  const restored = editor.effectiveElement(record.id).text.paragraphs[0];
  check('显式 none 屏蔽继承且 null 删除覆盖恢复自动编号来源',
    noneParagraph.bullet === null
      && JSON.stringify(noneState.value) === JSON.stringify({ kind: 'none' })
      && !noneState.mixed && undoNone && restored.bullet === '1.'
      && !Object.prototype.hasOwnProperty.call(
        record.ovr.text.paragraphs[0].paragraphOverrides ?? {}, 'bullet',
      ),
    JSON.stringify({ none: noneParagraph.bullet, noneState, restored: restored.bullet }));

  const numberedRange = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 },
  };
  editor.exec({
    type: 'SetParaProps', id: record.id, range: numberedRange,
    props: { bullet: { kind: 'autoNum', type: 'romanLcPeriod', startAt: 3 } },
  });
  const numbered = editor.effectiveElement(record.id).text.paragraphs.slice(0, 2);
  const numberedState = edit.queryParaProps(doc, record.id, numberedRange).bullet;
  check('自动编号跨段按 startAt 连续求值且查询保留结构语义',
    JSON.stringify(numbered.map((paragraph) => paragraph.bullet))
      === JSON.stringify(['iii.', 'iv.'])
      && JSON.stringify(numberedState.value)
        === JSON.stringify({ kind: 'autoNum', type: 'romanLcPeriod', startAt: 3 })
      && !numberedState.mixed,
    JSON.stringify({ bullets: numbered.map((paragraph) => paragraph.bullet), numberedState }));

  edit.disposeDoc(doc);
  presentation.dispose?.();

  const sourcePresentation = await core.parse(load('sample-editor-bullets.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sourceDoc = edit.createDoc(sourcePresentation, { idPrefix: 'bullet-source-' });
  const sourceRecord = Object.values(sourceDoc.elements)
    .find((candidate) => candidate.src.name === '项目符号编辑');
  const sourceStates = [0, 1, 2, 3, 4].map((p) =>
    edit.queryParaProps(sourceDoc, sourceRecord.id,
      { from: { p, r: 0, off: 0 }, to: { p, r: 0, off: 0 } }).bullet.value);
  check('查询保留继承、none、字符、自动编号与图片的来源结构语义',
    JSON.stringify(sourceStates) === JSON.stringify([
      { kind: 'autoNum', type: 'arabicPeriod', startAt: 1 },
      { kind: 'none' },
      {
        kind: 'char', char: '', color: 'rgb(192,0,0)', font: 'Wingdings',
        size: { kind: 'percent', value: 1.25 },
      },
      { kind: 'autoNum', type: 'romanLcPeriod', startAt: 4 },
      { kind: 'blip', image: { src: sourceRecord.src.text.paragraphs[4].bulletImage } },
    ]), JSON.stringify(sourceStates));
  const sourceBullets = sourceRecord.src.text.paragraphs.slice(0, 4)
    .map((paragraph) => paragraph.bullet);
  check('none 与字符项目符号会断开同级自动编号并让后续 startAt 生效',
    JSON.stringify(sourceBullets) === JSON.stringify(['1.', null, '▪', 'iv.']),
    JSON.stringify(sourceBullets));
  const styledChar = edit.queryParaProps(sourceDoc, sourceRecord.id,
    { from: { p: 2, r: 0, off: 0 }, to: { p: 2, r: 0, off: 0 } }).bullet.value;
  const absoluteChar = edit.queryParaProps(sourceDoc, sourceRecord.id,
    { from: { p: 5, r: 0, off: 0 }, to: { p: 5, r: 0, off: 0 } }).bullet.value;
  check('项目符号查询区分独立颜色、字体、相对字号与绝对字号',
    JSON.stringify(styledChar) === JSON.stringify({
      kind: 'char', char: '', color: 'rgb(192,0,0)', font: 'Wingdings',
      size: { kind: 'percent', value: 1.25 },
    }) && JSON.stringify(absoluteChar) === JSON.stringify({
      kind: 'char', char: '◆', size: { kind: 'points', value: 24 },
    }), JSON.stringify({ styledChar, absoluteChar }));
  const sourceEditor = new edit.Editor(sourceDoc);
  const importedImage = sourceStates[4];
  sourceEditor.exec({
    type: 'SetParaProps', id: sourceRecord.id,
    range: { from: { p: 4, r: 0, off: 0 }, to: { p: 4, r: 0, off: 0 } },
    props: { bullet: {
      ...importedImage, font: 'Arial', color: '#336699',
      size: { kind: 'percent', value: 1.35 },
    } },
  });
  const restyledImportedImage = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[4];
  check('查询返回的 OOXML 图片来源可直接提升资源闭包并更新独立样式',
    importedImage?.kind === 'blip'
      && restyledImportedImage.bulletImage?.startsWith('data:image/png;base64,')
      && restyledImportedImage.bulletFont === 'Arial'
      && restyledImportedImage.bulletColor === 'rgb(51,102,153)'
      && restyledImportedImage.bulletSize === 1.35
      && Object.keys(sourceDoc.imageResources).length === 1,
    JSON.stringify({ importedImage, restyledImportedImage }));
  sourceEditor.undo();
  sourceEditor.history.clear();
  sourceEditor.exec({
    type: 'ApplyFormat', from: sourceRecord.id, to: sourceRecord.id,
    fromRange: { from: { p: 4, r: 0, off: 0 }, to: { p: 4, r: 0, off: 0 } },
    toRange: { from: { p: 1, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } },
    mask: ['paragraph'],
  });
  const sourcePaintedImage = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[1];
  const sourcePaintedResourceCount = Object.keys(sourceDoc.imageResources).length;
  const sourcePaintedUndo = sourceEditor.undo();
  const sourcePaintedUndoResources = Object.keys(sourceDoc.imageResources).length;
  sourceEditor.history.clear();
  check('格式刷可把来源 OOXML 图片项目符号提升为可撤销资源闭包',
    sourcePaintedImage.bulletImage?.startsWith('data:image/png;base64,')
      && sourcePaintedResourceCount === 1 && sourcePaintedUndo
      && sourcePaintedUndoResources === 1 && Object.keys(sourceDoc.imageResources).length === 0
      && sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[1].bullet === null,
    JSON.stringify({ image: sourcePaintedImage.bulletImage, sourcePaintedResourceCount,
      sourcePaintedUndo, sourcePaintedUndoResources,
      afterResources: Object.keys(sourceDoc.imageResources).length,
      afterBullet: sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[1].bullet }));
  const charSourceParagraph = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[2];
  const charFragment = edit.textFragmentFromRange(
    { ...sourceEditor.effectiveElement(sourceRecord.id).text, paragraphs: [charSourceParagraph] },
    { from: { p: 0, r: 0, off: 0 }, to: {
      p: 0, r: charSourceParagraph.runs.length - 1,
      off: charSourceParagraph.runs.at(-1).text.length,
    } },
  );
  const charTarget = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[1];
  sourceEditor.exec({
    type: 'EditText', id: sourceRecord.id, ops: [{
      type: 'replaceFragment',
      from: { p: 1, r: 0, off: 0 }, to: {
        p: 1, r: charTarget.runs.length - 1, off: charTarget.runs.at(-1).text.length,
      }, fragment: charFragment,
    }],
  });
  const pastedChar = edit.queryParaProps(sourceDoc, sourceRecord.id,
    { from: { p: 1, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } }).bullet.value;
  check('完整段落富文本片段携带项目符号，局部模型不泄漏 OOXML 身份',
    JSON.stringify(pastedChar) === JSON.stringify(styledChar)
      && !JSON.stringify(charFragment).includes('sourceParagraph'),
    JSON.stringify({ fragment: charFragment, pastedChar }));
  sourceEditor.undo();
  sourceEditor.exec({
    type: 'ApplyFormat', from: sourceRecord.id, to: sourceRecord.id,
    fromRange: { from: { p: 2, r: 0, off: 0 }, to: { p: 2, r: 0, off: 0 } },
    toRange: { from: { p: 1, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } },
    mask: ['paragraph'],
  });
  const paintedBullet = edit.queryParaProps(sourceDoc, sourceRecord.id,
    { from: { p: 1, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } }).bullet.value;
  check('段落格式刷复制项目符号结构与独立样式',
    JSON.stringify(paintedBullet) === JSON.stringify(styledChar),
    JSON.stringify({ source: styledChar, target: paintedBullet }));
  sourceEditor.exec({
    type: 'SetParaProps', id: sourceRecord.id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 } },
    props: { bullet: {
      kind: 'char', char: '✓', font: null, color: '#336699',
      size: { kind: 'percent', value: 1.5 },
    } },
  });
  const styledProjection = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[0];
  const styledState = edit.queryParaProps(sourceDoc, sourceRecord.id,
    { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 } }).bullet;
  check('命令归一项目符号独立样式并同步公开查询与有效投影',
    styledProjection.bullet === '✓' && styledProjection.bulletFont === null
      && styledProjection.bulletColor === 'rgb(51,102,153)'
      && styledProjection.bulletSize === 1.5
      && JSON.stringify(styledState.value) === JSON.stringify({
        kind: 'char', char: '✓', font: null, color: 'rgb(51,102,153)',
        size: { kind: 'percent', value: 1.5 },
      }), JSON.stringify({ projection: {
      bullet: styledProjection.bullet, font: styledProjection.bulletFont,
      color: styledProjection.bulletColor, size: styledProjection.bulletSize,
    }, styledState }));
  sourceEditor.exec({
    type: 'SetParaProps', id: sourceRecord.id,
    range: { from: { p: 2, r: 0, off: 0 }, to: { p: 2, r: 0, off: 0 } },
    props: { bullet: null },
  });
  const clearedDirect = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[2];
  const clearedState = edit.queryParaProps(sourceDoc, sourceRecord.id,
    { from: { p: 2, r: 0, off: 0 }, to: { p: 2, r: 0, off: 0 } }).bullet;
  check('bullet:null 删除来源直设并让投影与查询共同恢复继承编号',
    clearedDirect.bullet === '1.'
      && JSON.stringify(clearedState.value)
        === JSON.stringify({ kind: 'autoNum', type: 'arabicPeriod', startAt: 1 })
      && sourceRecord.ovr.text.paragraphs[2].paragraphOverrides.bullet === null,
    JSON.stringify({ projected: clearedDirect.bullet, clearedState }));

  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ));
  const historyBeforeImage = sourceEditor.history.undoCount;
  const imageResult = sourceEditor.exec({
    type: 'SetParaProps', id: sourceRecord.id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } },
    props: { bullet: {
      kind: 'blip', image: { bytes: png, mime: 'image/png' },
      font: 'Wingdings', color: '#336699', size: { kind: 'percent', value: 1.35 },
    } },
  });
  const imageParagraphs = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs.slice(0, 2);
  const imageState = edit.queryParaProps(sourceDoc, sourceRecord.id,
    { from: { p: 0, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } }).bullet;
  const resources = Object.values(sourceDoc.imageResources);
  check('上传图片项目符号在一个历史单元中去重资源并同步投影与查询',
    imageResult.forward.length === 2 && sourceEditor.history.undoCount === historyBeforeImage + 1
      && resources.length === 1 && imageParagraphs.every((paragraph) =>
        paragraph.bullet === null && paragraph.bulletImage?.startsWith('data:image/png;base64,'))
      && imageState.value?.kind === 'blip'
      && imageState.value.image.src === imageParagraphs[0].bulletImage
      && imageState.value.font === 'Wingdings' && imageState.value.color === 'rgb(51,102,153)'
      && imageState.value.size?.kind === 'percent' && imageState.value.size.value === 1.35
      && !imageState.mixed,
    JSON.stringify({ patches: imageResult.forward.length, history: sourceEditor.history.undoCount,
      resources: resources.length, imageState, images: imageParagraphs.map((p) => p.bulletImage) }));
  sourceEditor.exec({
    type: 'SetParaProps', id: sourceRecord.id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } },
    props: { bullet: { ...imageState.value, font: 'Arial' } },
  });
  const restyledImageState = edit.queryParaProps(sourceDoc, sourceRecord.id,
    { from: { p: 0, r: 0, off: 0 }, to: { p: 1, r: 0, off: 0 } }).bullet;
  check('查询返回的图片来源可直接复用并只更新项目符号样式',
    restyledImageState.value?.kind === 'blip'
      && restyledImageState.value.font === 'Arial'
      && restyledImageState.value.image.src === imageState.value.image.src
      && Object.keys(sourceDoc.imageResources).length === 1,
    JSON.stringify(restyledImageState));
  const imageText = sourceEditor.effectiveElement(sourceRecord.id).text;
  const imageSourceParagraph = imageText.paragraphs[0];
  const imageFragment = edit.textFragmentFromRange(
    { ...imageText, paragraphs: [imageSourceParagraph] },
    { from: { p: 0, r: 0, off: 0 }, to: {
      p: 0, r: imageSourceParagraph.runs.length - 1,
      off: imageSourceParagraph.runs.at(-1).text.length,
    } },
  );
  const imageTarget = imageText.paragraphs[3];
  sourceEditor.exec({
    type: 'EditText', id: sourceRecord.id, ops: [{
      type: 'replaceFragment', from: { p: 3, r: 0, off: 0 },
      to: { p: 3, r: imageTarget.runs.length - 1, off: imageTarget.runs.at(-1).text.length },
      fragment: imageFragment,
    }],
  });
  const pastedImage = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[3];
  check('图片项目符号富文本粘贴复用内容寻址字节并新建关系闭包',
    pastedImage.bulletImage === imageParagraphs[0].bulletImage
      && pastedImage.bulletFont === 'Arial'
      && pastedImage.bulletColor === 'rgb(51,102,153)'
      && pastedImage.bulletSize === 1.35
      && imageFragment.paragraphs[0].bullet?.kind === 'blip'
      && imageFragment.paragraphs[0].bullet.font === 'Arial'
      && imageFragment.paragraphs[0].bullet.color === 'rgb(51,102,153)'
      && imageFragment.paragraphs[0].bullet.size?.value === 1.35
      && Object.keys(sourceDoc.imageResources).length === 1,
    JSON.stringify({ pastedImage: {
      image: pastedImage.bulletImage, font: pastedImage.bulletFont,
      color: pastedImage.bulletColor, size: pastedImage.bulletSize,
    }, fragment: imageFragment }));
  sourceEditor.undo();
  sourceEditor.exec({
    type: 'ApplyFormat', from: sourceRecord.id, to: sourceRecord.id,
    fromRange: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 } },
    toRange: { from: { p: 2, r: 0, off: 0 }, to: { p: 2, r: 0, off: 0 } },
    mask: ['paragraph'],
  });
  const paintedImage = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[2];
  check('段落格式刷复用图片项目符号字节并建立目标关系闭包',
    paintedImage.bulletImage === imageParagraphs[0].bulletImage
      && Object.keys(sourceDoc.imageResources).length === 1,
    JSON.stringify({ paintedImage: paintedImage.bulletImage,
      resources: Object.keys(sourceDoc.imageResources).length }));
  const imageUndo = sourceEditor.undo()
    && sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[2].bullet === '1.'
    && sourceEditor.undo()
    && sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[0].bulletImage
      === imageParagraphs[0].bulletImage
    && sourceEditor.undo()
    && sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[0].bullet === '✓'
    && sourceEditor.redo()
    && sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[0].bulletImage
      === imageParagraphs[0].bulletImage
    && sourceEditor.redo()
    && sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[0].editInfo?.bullet.font === 'Arial'
    && sourceEditor.redo()
    && sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[2].bulletImage
      === imageParagraphs[0].bulletImage;
  check('图片项目符号撤销重做不依赖会话 URL', !!imageUndo);
  sourceEditor.exec({
    type: 'SetParaProps', id: sourceRecord.id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 } },
    props: { bullet: { kind: 'autoNum', type: 'romanLcPeriod', startAt: 2 } },
  });
  sourceEditor.exec({
    type: 'EditText', id: sourceRecord.id,
    ops: [{ type: 'splitParagraph', at: { p: 0, r: 0, off: 1 } }],
  });
  const splitBullets = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs
    .slice(0, 2).map((paragraph) => paragraph.bullet);
  sourceEditor.exec({
    type: 'EditText', id: sourceRecord.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 1 },
      to: { p: 1, r: 0, off: 0 }, text: '',
    }],
  });
  const mergedBullet = sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[0].bullet;
  check('拆分与合并段落会从结构语义重新连续编号',
    JSON.stringify(splitBullets) === JSON.stringify(['ii.', 'iii.']) && mergedBullet === 'ii.',
    JSON.stringify({ splitBullets, mergedBullet }));
  const replaceMatch = edit.findText(sourceDoc, {
    query: '自动', scope: { kind: 'slide', slideId: sourceRecord.parent },
    matchCase: true, wholeWord: false,
  })[0];
  sourceEditor.exec({
    type: 'ReplaceText', from: '自动', to: '连续', matchCase: true, wholeWord: false,
    scope: { kind: 'match', match: {
      slideId: replaceMatch.slideId, id: replaceMatch.id, range: replaceMatch.range,
    } },
  });
  check('查找替换只改文字内容并保持自动编号结构语义',
    sourceEditor.effectiveElement(sourceRecord.id).text.paragraphs[0].bullet === 'ii.'
      && edit.textBodyEditText(sourceEditor.effectiveElement(sourceRecord.id).text).includes('连续编号'));

  const invalidHistory = sourceEditor.history.undoCount;
  const invalidBullets = [
    { kind: 'char', char: 'ab' },
    { kind: 'autoNum', type: 'unknown' },
    { kind: 'autoNum', type: 'arabicPeriod', startAt: 0 },
    { kind: 'char', char: '•', size: { kind: 'percent', value: .1 } },
    { kind: 'blip', image: { src: 'https://invalid.example/bullet.png' } },
    { kind: 'blip', image: { bytes: png, mime: 'image/jpeg' } },
    { kind: 'none', extra: true },
  ];
  let rejected = 0;
  for (const bullet of invalidBullets) try {
    sourceEditor.exec({ type: 'SetParaProps', id: sourceRecord.id, range, props: { bullet } });
  } catch { rejected++; }
  check('非法字符、制式、起点、大小、来源、魔数与多余字段原子拒绝',
    rejected === invalidBullets.length && sourceEditor.history.undoCount === invalidHistory,
    JSON.stringify({ rejected, expected: invalidBullets.length,
      history: sourceEditor.history.undoCount, invalidHistory }));
  edit.disposeDoc(sourceDoc);
  sourcePresentation.dispose?.();

  const recoveryPresentation = await core.parse(load('sample-editor-bullets.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'bullet-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryRecord = Object.values(recoveryDoc.elements)
    .find((candidate) => candidate.src.name === '项目符号编辑');
  const frames = [];
  const stopRecovery = recoveryEditor.subscribeRecovery((frame) => frames.push(frame));
  recoveryEditor.exec({
    type: 'SetParaProps', id: recoveryRecord.id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 } },
    props: { bullet: { kind: 'blip', image: {
      bytes: Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      )),
      mime: 'image/png',
    } } },
  });
  stopRecovery();
  const restoredPresentation = await core.parse(load('sample-editor-bullets.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const restoredDoc = edit.createDoc(restoredPresentation, { idPrefix: 'bullet-recovery-' });
  const restoredEditor = new edit.Editor(restoredDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(frames)),
  });
  const restoredRecord = Object.values(restoredDoc.elements)
    .find((candidate) => candidate.src.name === '项目符号编辑');
  const restoredBullet = restoredEditor.effectiveElement(restoredRecord.id).text.paragraphs[0];
  check('图片项目符号恢复帧以纯数据闭包重建资源与投影',
    frames.length === 1 && Object.keys(restoredDoc.imageResources).length === 1
      && restoredBullet.bulletImage?.startsWith('data:image/png;base64,'),
    JSON.stringify({ frames: frames.length, resources: Object.keys(restoredDoc.imageResources).length,
      bulletImage: restoredBullet.bulletImage }));
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(restoredDoc);
}
