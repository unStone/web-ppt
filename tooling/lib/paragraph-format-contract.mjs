/** 只从发布命令、有效投影和保存重开观察段落格式。 */
export async function runParagraphFormatContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 文字段落格式\x1b[0m');
  const presentation = await core.parse(load('sample-editor-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'paragraph-format-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.name === '文本综合');
  const sourceAlign = record.src.text.paragraphs[0].align;
  const caret = { p: 0, r: 0, off: 1 };
  const cross = {
    from: caret,
    to: { p: 1, r: 0, off: record.src.text.paragraphs[1].runs[0].text.length },
  };
  const beforeState = edit.queryParaProps(doc, record.id, cross);
  check('跨段查询以逐属性三态报告真实混合对齐',
    beforeState.align.value === 'left' && beforeState.align.mixed);
  const result = editor.exec({
    type: 'SetParaProps', id: record.id,
    range: { from: caret, to: caret }, props: { align: 'justify' },
  });
  check('折叠文字选区立即修改当前段且不改变来源',
    editor.effectiveElement(record.id).text.paragraphs[0].align === 'justify'
      && record.src.text.paragraphs[0].align === sourceAlign
      && result.forward.length === 1 && result.dirtyElements.has(record.id)
      && editor.history.undoCount === 1);

  const paragraphs = Object.values(doc.elements).find((candidate) => candidate.src.name === '段落格式');
  const inheritedEnd = paragraphs.src.text.paragraphs[1].runs[0].text.length;
  const inheritedRange = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 1, r: 0, off: inheritedEnd },
  };
  const paragraphState = edit.queryParaProps(doc, paragraphs.id, inheritedRange);
  check('段落查询覆盖全部 P0 属性并识别直接值与 lstStyle 继承的混合态',
    paragraphState.align.mixed && paragraphState.align.value === 'center'
      && paragraphState.lineHeight.mixed && paragraphState.lineHeight.value === 1.6
      && paragraphState.spaceBefore.mixed && paragraphState.spaceBefore.value === 12
      && paragraphState.spaceAfter.mixed && paragraphState.spaceAfter.value === 6
      && paragraphState.marginLeft.mixed && paragraphState.marginLeft.value === 40
      && paragraphState.indent.mixed && paragraphState.indent.value === -20,
    JSON.stringify(paragraphState));
  const sameDirect = editor.exec({
    type: 'SetParaProps', id: paragraphs.id,
    range: { from: { p: 0, r: 0, off: 1 }, to: { p: 0, r: 0, off: 1 } },
    props: {
      align: 'center', lineHeight: 1.6, spaceBefore: 12, spaceAfter: 6,
      marginLeft: 40, indent: -20,
    },
  });
  check('重复设置当前有效段落格式是严格 no-op',
    sameDirect.forward.length === 0 && editor.history.undoCount === 1 && !paragraphs.ovr.text);
  const inheritedNoop = editor.exec({
    type: 'SetParaProps', id: paragraphs.id,
    range: { from: { p: 1, r: 0, off: 1 }, to: { p: 1, r: 0, off: 1 } },
    props: {
      align: null, lineHeight: null, spaceBefore: null, spaceAfter: null,
      marginLeft: null, indent: null,
    },
  });
  check('清除原本不存在的直接段落格式是严格 no-op',
    inheritedNoop.forward.length === 0 && editor.history.undoCount === 1 && !paragraphs.ovr.text);
  const invalidBaseline = JSON.stringify(doc);
  const invalidHistory = editor.history.undoCount;
  const invalidProps = [
    {}, { align: 'start' }, { lineHeight: 0.49 }, { spaceBefore: -1 },
    { spaceAfter: Infinity }, { marginLeft: -1 }, { indent: NaN },
    { align: 'left', level: 1 },
  ];
  const rejected = invalidProps.every((props) => {
    try {
      editor.exec({ type: 'SetParaProps', id: paragraphs.id, range: inheritedRange, props });
      return false;
    } catch {
      return true;
    }
  });
  check('非法段落格式在命令边界原子拒绝且不污染模型或历史',
    rejected && JSON.stringify(doc) === invalidBaseline && editor.history.undoCount === invalidHistory);
  const allParagraphs = {
    from: { p: 0, r: 0, off: 2 }, to: { p: 2, r: 0, off: 0 },
  };
  const formatResult = editor.exec({
    type: 'SetParaProps', id: paragraphs.id, range: allParagraphs,
    props: {
      align: 'left', lineHeight: 2.1, spaceBefore: 14, spaceAfter: 7,
      marginLeft: 30, indent: -12,
    },
  });
  const formatted = editor.effectiveElement(paragraphs.id).text.paragraphs;
  const formattedState = edit.queryParaProps(doc, paragraphs.id, allParagraphs);
  check('跨段命令一次设置全部 P0 属性并包含空段',
    formatted.slice(0, 3).every((paragraph) => paragraph.align === 'left' && paragraph.lineHeight === 2.1
      && paragraph.spaceBefore === 14 && paragraph.spaceAfter === 7
      && paragraph.marL === 30 && paragraph.indent === -12)
      && formatted[3].align === 'right'
      && Object.values(formattedState).every((state) => !state.mixed)
      && formatResult.forward.length === 1 && editor.history.undoCount === 2,
    JSON.stringify({ formatted: formatted.map((paragraph) => ({
      align: paragraph.align, lineHeight: paragraph.lineHeight,
      spaceBefore: paragraph.spaceBefore, spaceAfter: paragraph.spaceAfter,
      marginLeft: paragraph.marL, indent: paragraph.indent,
    })), formattedState }));
  const remoteDoc = structuredClone(doc);
  const remoteValue = structuredClone(paragraphs.ovr.text);
  remoteValue.paragraphs[0].paragraphOverrides.level = 1;
  const remoteBaseline = JSON.stringify(remoteDoc);
  let remoteRejected = false;
  try {
    edit.applyPatches(remoteDoc, [{
      op: 'set', path: ['elements', paragraphs.id, 'ovr', 'text'],
      value: remoteValue, origin: 'peer',
    }]);
  } catch {
    remoteRejected = true;
  }
  check('远端文本 Patch 不能绕过段落格式字段白名单且保持原子失败',
    remoteRejected && JSON.stringify(remoteDoc) === remoteBaseline);
  const resetResult = editor.exec({
    type: 'SetParaProps', id: paragraphs.id,
    range: { from: { p: 0, r: 0, off: 1 }, to: { p: 0, r: 0, off: 1 } },
    props: {
      align: null, lineHeight: null, spaceBefore: null, spaceAfter: null,
      marginLeft: null, indent: null,
    },
  });
  const reset = editor.effectiveElement(paragraphs.id).text.paragraphs[0];
  check('null 删除直接段落格式并恢复 lstStyle 继承值',
    reset.align === 'right' && reset.lineHeight === 1.5
      && reset.spaceBefore === 8 && reset.spaceAfter === 4
      && reset.marL === 20 && reset.indent === -10
      && resetResult.forward.length === 1 && editor.history.undoCount === 3);
  editor.undo();
  const undoReset = editor.effectiveElement(paragraphs.id).text.paragraphs[0];
  check('撤销恢复段落覆盖且重做再次恢复继承',
    undoReset.align === 'left' && undoReset.lineHeight === 2.1
      && editor.redo()
      && editor.effectiveElement(paragraphs.id).text.paragraphs[0].align === 'right');

  const saved = await editor.saveDetailed();
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedParagraphs = reopened.slides[0].elements
    .find((element) => element.name === '段落格式').text.paragraphs;
  const slideXml = new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']);
  const inherited = reopenedParagraphs[0];
  check('段落格式只改目标页并在保存重开后保持覆盖与继承语义',
    saved.rewrittenEntries === 1
      && inherited.align === 'right' && inherited.lineHeight === 1.5
      && inherited.spaceBefore === 8 && inherited.spaceAfter === 4
      && inherited.marL === 20 && inherited.indent === -10
      && reopenedParagraphs.slice(1, 3).every((paragraph) => paragraph.align === 'left'
        && paragraph.lineHeight === 2.1 && paragraph.spaceBefore === 14
        && paragraph.spaceAfter === 7 && paragraph.marL === 30 && paragraph.indent === -12)
      && reopenedParagraphs[3].align === 'right' && reopenedParagraphs[3].marL === 20,
    JSON.stringify(reopenedParagraphs.map((paragraph) => ({
      align: paragraph.align, lineHeight: paragraph.lineHeight,
      spaceBefore: paragraph.spaceBefore, spaceAfter: paragraph.spaceAfter,
      marginLeft: paragraph.marL, indent: paragraph.indent,
    }))));
  check('pPr 最小写回保留未知节点词法并按规范换算六个属性',
    slideXml.includes('<?paragraph  keep = "yes"?>')
      && slideXml.includes('<!--paragraph-props:  keep-->')
      && slideXml.includes('<!--unselected-ppr:  keep-->')
      && slideXml.includes('<?unselected-ppr  keep = "yes"?>')
      && slideXml.includes('<x:keep xmlns:x="urn:web-ppt:test" value="yes"/>')
      && (slideXml.match(/<a:spcPct val="175000"\/>/g) ?? []).length === 2
      && (slideXml.match(/marL="285750"/g) ?? []).length === 2
      && (slideXml.match(/indent="-114300"/g) ?? []).length === 2
      && (slideXml.match(/<a:spcPts val="1050"\/>/g) ?? []).length === 2
      && (slideXml.match(/<a:spcPts val="525"\/>/g) ?? []).length === 2);
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
