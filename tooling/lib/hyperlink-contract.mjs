const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

/** 链接面板只依赖稳定领域值；页码、关系 id 与 OOXML action 不得穿过发布入口。 */
export async function runHyperlinkContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 元素超链接领域命令与查询\x1b[0m');
  const presentation = await core.parse(load('sample-editor-hyperlinks.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'hyperlink-' });
  const editor = new edit.Editor(doc);
  const source = Object.values(doc.elements).find((record) => record.src.name === 'link-shared-a');
  if (!check('找到带来源外链的可编辑元素', !!source)) return;

  const sourceState = edit.queryElementLink(doc, [source.id]);
  check('来源外链通过公开查询返回规范领域值且不伪造覆盖',
    JSON.stringify(sourceState.value) === JSON.stringify({
      kind: 'external', href: 'https://example.com/shared',
    })
      && JSON.stringify(sourceState.source) === JSON.stringify(sourceState.value)
      && sourceState.mixed === false && sourceState.direct === false
      && sourceState.sourceReadonly === false && sourceState.followable === true);

  const sourceLink = source.src.link;
  editor.exec({ type: 'SetLink', id: source.id, target: { kind: 'none' } });
  const removed = edit.queryElementLink(doc, [source.id]);
  check('显式移除与来源外链身份不同且投影不再可点击',
    removed.value === null && removed.direct === true && removed.followable === false
      && removed.source?.kind === 'external'
      && own(doc.elements[source.id].ovr, 'link')
      && edit.effectiveElement(doc, source.id).link === undefined
      && source.src.link === sourceLink);

  editor.exec({ type: 'SetLink', id: source.id, target: null });
  const restored = edit.queryElementLink(doc, [source.id]);
  check('target:null 删除覆盖并严格恢复来源',
    restored.direct === false && restored.value?.kind === 'external'
      && !own(doc.elements[source.id].ovr, 'link'));

  const targetSlideId = doc.slideOrder[1];
  const historyBefore = editor.history.undoCount;
  const changed = editor.exec({
    type: 'SetLink', id: source.id, target: { kind: 'slide', slideId: targetSlideId },
  });
  const internal = edit.queryElementLink(doc, [source.id]);
  check('内部链接持有稳定 SlideId 并仅在投影时解析当前页码',
    internal.value?.kind === 'slide' && internal.value.slideId === targetSlideId
      && internal.direct === true && internal.followable === true
      && edit.effectiveElement(doc, source.id).link === 'slide:2'
      && changed.dirtyElements.has(source.id)
      && editor.history.undoCount === historyBefore + 1);

  editor.exec({ type: 'MoveSlide', id: targetSlideId, at: { after: null } });
  check('页面重排不改变内部目标身份并刷新链接投影',
    edit.queryElementLink(doc, [source.id]).value?.slideId === targetSlideId
      && edit.effectiveElement(doc, source.id).link === 'slide:1');

  editor.exec({ type: 'RemoveSlide', id: targetSlideId });
  const missing = edit.queryElementLink(doc, [source.id]);
  check('目标页删除后明确不可跟随且不产生错误页跳转',
    missing.value?.kind === 'slide' && missing.value.slideId === targetSlideId
      && missing.followable === false
      && edit.effectiveElement(doc, source.id).link === undefined);
  editor.undo();
  check('撤销目标页删除后稳定链接自动恢复可跟随',
    edit.queryElementLink(doc, [source.id]).followable === true
      && edit.effectiveElement(doc, source.id).link === 'slide:1');

  const unsafe = Object.values(doc.elements).find((record) => record.src.name === 'link-unsafe-source');
  const relative = Object.values(doc.elements).find((record) => record.src.name === 'link-relative-next');
  const picture = Object.values(doc.elements).find((record) => record.src.name === 'link-picture');
  const unsafeState = edit.queryElementLink(doc, [unsafe.id]);
  const relativeState = edit.queryElementLink(doc, [relative.id]);
  const pictureState = edit.queryElementLink(doc, [picture.id]);
  check('危险与未知来源只显示只读占位，不能进入可点击投影',
    unsafeState.value?.kind === 'unsupported' && unsafeState.sourceReadonly === true
      && unsafeState.followable === false && edit.effectiveElement(doc, unsafe.id).link === undefined);
  check('相对动作保留为只读领域语义，图片内链映射稳定目标页',
    relativeState.value?.kind === 'relative' && relativeState.value.action === 'next'
      && relativeState.sourceReadonly === true && relativeState.followable === true
      && pictureState.value?.kind === 'slide' && pictureState.value.slideId === doc.slideOrder[2]);

  const beforeReject = JSON.stringify(doc);
  check('危险外链、凭据、控制字符、超限值与未知字段在提交前原子拒绝',
    rejected(() => editor.exec({
      type: 'SetLink', id: source.id, target: { kind: 'external', href: 'javascript:alert(1)' },
    }))
      && rejected(() => editor.exec({
        type: 'SetLink', id: source.id, target: { kind: 'external', href: 'https://user:pw@example.com' },
      }))
      && rejected(() => editor.exec({
        type: 'SetLink', id: source.id, target: { kind: 'external', href: 'https://example.com/\u0000' },
      }))
      && rejected(() => editor.exec({
        type: 'SetLink', id: source.id,
        target: { kind: 'external', href: `https://example.com/${'a'.repeat(4096)}` },
      }))
      && rejected(() => editor.exec({
        type: 'SetLink', id: source.id, target: { kind: 'external', href: 'https://example.com' }, extra: true,
      }))
      && JSON.stringify(doc) === beforeReject);

  edit.disposeDoc(doc);

  const textPresentation = await core.parse(load('sample-editor-hyperlinks.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const textDoc = edit.createDoc(textPresentation, { idPrefix: 'hyperlink-text-' });
  const textEditor = new edit.Editor(textDoc);
  const textRecord = Object.values(textDoc.elements).find((record) =>
    record.src.name === 'link-text-runs');
  if (!check('找到带来源外链的文字 run', !!textRecord)) return;
  let paragraphIndex = -1;
  let runIndex = -1;
  for (let p = 0; p < textRecord.src.text.paragraphs.length; p++) {
    const r = textRecord.src.text.paragraphs[p].runs.findIndex((run) => run.link?.startsWith('http'));
    if (r >= 0) { paragraphIndex = p; runIndex = r; break; }
  }
  const sourceRun = textRecord.src.text.paragraphs[paragraphIndex].runs[runIndex];
  const range = {
    from: { p: paragraphIndex, r: runIndex, off: 0 },
    to: { p: paragraphIndex, r: runIndex, off: sourceRun.text.length },
  };
  const sourceRunState = edit.queryRunLink(textDoc, textRecord.id, range);
  check('文字来源链接通过独立查询 seam 返回且不污染字体状态',
    sourceRunState.value?.kind === 'external'
      && sourceRunState.direct === false && sourceRunState.followable === true
      && !own(edit.queryRunProps(textDoc, textRecord.id, range), 'link'));
  const unsafeRunIndex = textRecord.src.text.paragraphs[0].runs.findIndex((run) =>
    run.editInfo?.readonlyLink);
  const unsafeRun = textRecord.src.text.paragraphs[0].runs[unsafeRunIndex];
  const unsafeRunState = edit.queryRunLink(textDoc, textRecord.id, {
    from: { p: 0, r: unsafeRunIndex, off: 0 },
    to: { p: 0, r: unsafeRunIndex, off: unsafeRun.text.length },
  });
  check('危险 run 来源同样只暴露不可跟随占位',
    unsafeRunState.value?.kind === 'unsupported'
      && unsafeRunState.sourceReadonly === true && unsafeRunState.followable === false);

  textEditor.exec({
    type: 'SetRunProps', id: textRecord.id, range, props: { link: { kind: 'none' } },
  });
  const removedRun = edit.queryRunLink(textDoc, textRecord.id, range);
  const projectedRemovedRun = edit.effectiveElement(textDoc, textRecord.id).text
    .paragraphs[paragraphIndex].runs[runIndex];
  check('SetRunProps.link 明确移除选区链接并保持来源可查询',
    removedRun.value === null && removedRun.source?.kind === 'external'
      && removedRun.direct === true && projectedRemovedRun.link === undefined);

  textEditor.exec({
    type: 'SetRunProps', id: textRecord.id, range, props: { link: null },
  });
  check('文字 link:null 恢复来源而不是显式无链接',
    edit.queryRunLink(textDoc, textRecord.id, range).direct === false
      && edit.effectiveElement(textDoc, textRecord.id).text
        .paragraphs[paragraphIndex].runs[runIndex].link === sourceRun.link);

  const textTargetSlideId = textDoc.slideOrder.at(-1);
  textEditor.exec({
    type: 'SetRunProps', id: textRecord.id, range,
    props: { link: { kind: 'slide', slideId: textTargetSlideId } },
  });
  const directRun = edit.queryRunLink(textDoc, textRecord.id, range);
  check('文字内部链接同样持有稳定 SlideId 并投影为当前页码',
    directRun.value?.kind === 'slide' && directRun.value.slideId === textTargetSlideId
      && directRun.direct === true
      && edit.effectiveElement(textDoc, textRecord.id).text
        .paragraphs[paragraphIndex].runs[runIndex].link === `slide:${textDoc.slideOrder.length}`);

  const half = Math.max(1, Math.floor(sourceRun.text.length / 2));
  textEditor.exec({
    type: 'SetRunProps', id: textRecord.id,
    range: {
      from: { p: paragraphIndex, r: 0, off: 0 },
      to: { p: paragraphIndex, r: 0, off: half },
    },
    props: { link: { kind: 'external', href: ' HTTPS://Example.com:443/mixed ' } },
  });
  const paragraph = edit.effectiveElement(textDoc, textRecord.id).text.paragraphs[paragraphIndex];
  const mixedRange = {
    from: { p: paragraphIndex, r: 0, off: 0 },
    to: { p: paragraphIndex, r: paragraph.runs.length - 1, off: paragraph.runs.at(-1).text.length },
  };
  const mixedRun = edit.queryRunLink(textDoc, textRecord.id, mixedRange);
  check('局部链接切分 run、规范化 URL 并让跨格式选区报告 mixed',
    paragraph.runs[0].link === 'https://example.com/mixed'
      && mixedRun.mixed === true && mixedRun.direct === true);

  const textRejectBefore = JSON.stringify(textDoc);
  check('文字链接复用同一安全边界并原子拒绝不存在页面',
    rejected(() => textEditor.exec({
      type: 'SetRunProps', id: textRecord.id, range,
      props: { link: { kind: 'external', href: 'data:text/html,unsafe' } },
    }))
      && rejected(() => textEditor.exec({
        type: 'SetRunProps', id: textRecord.id, range,
        props: { link: { kind: 'slide', slideId: 'missing-slide' } },
      }))
      && JSON.stringify(textDoc) === textRejectBefore);
  edit.disposeDoc(textDoc);

  const clipboardPresentation = await core.parse(load('sample-editor-hyperlinks.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clipboardDoc = edit.createDoc(clipboardPresentation, { idPrefix: 'hyperlink-clipboard-' });
  const clipboardEditor = new edit.Editor(clipboardDoc);
  const clipboardTarget = clipboardDoc.slideOrder[2];
  const clipboardPicture = Object.values(clipboardDoc.elements).find((record) =>
    record.src.name === 'link-picture');
  const picturePayload = edit.copyElements(clipboardDoc, [clipboardPicture.id]);
  const clipboardText = Object.values(clipboardDoc.elements).find((record) =>
    record.src.name === 'link-text-runs');
  const textPayload = edit.copyElements(clipboardDoc, [clipboardText.id]);
  clipboardEditor.exec({ type: 'MoveSlide', id: clipboardTarget, at: { after: null } });
  clipboardEditor.exec({
    type: 'PasteElements', payload: picturePayload,
    at: { parentId: clipboardDoc.slideOrder[1], x: 40, y: 40 },
  });
  const pastedPictureId = clipboardEditor.selection.kind === 'elements'
    ? clipboardEditor.selection.ids[0] : '';
  const pastedPictureLink = edit.queryElementLink(clipboardDoc, [pastedPictureId]);
  check('元素复制后即使目标页重排也按稳定身份粘贴内部链接',
    pastedPictureLink.value?.kind === 'slide'
      && pastedPictureLink.value.slideId === clipboardTarget
      && edit.effectiveElement(clipboardDoc, pastedPictureId).link === 'slide:1');

  clipboardEditor.exec({
    type: 'PasteElements', payload: textPayload,
    at: { parentId: clipboardDoc.slideOrder[1], x: 80, y: 80 },
  });
  const pastedTextId = clipboardEditor.selection.kind === 'elements'
    ? clipboardEditor.selection.ids[0] : '';
  const pastedText = edit.effectiveElement(clipboardDoc, pastedTextId).text;
  const internalRunIndex = pastedText.paragraphs[0].runs.findIndex((run) => run.text === '内部第三页');
  const pastedInternalRun = pastedText.paragraphs[0].runs[internalRunIndex];
  const pastedTextLink = edit.queryRunLink(clipboardDoc, pastedTextId, {
    from: { p: 0, r: internalRunIndex, off: 0 },
    to: { p: 0, r: internalRunIndex, off: pastedInternalRun.text.length },
  });
  check('文字内部链接随元素复制粘贴保持稳定目标',
    pastedTextLink.value?.kind === 'slide'
      && pastedTextLink.value.slideId === clipboardTarget
      && pastedInternalRun.link === 'slide:1');

  clipboardEditor.exec({ type: 'RemoveSlide', id: clipboardTarget });
  clipboardEditor.exec({
    type: 'PasteElements', payload: picturePayload,
    at: { parentId: clipboardDoc.slideOrder[0], x: 120, y: 120 },
  });
  const missingPasteId = clipboardEditor.selection.kind === 'elements'
    ? clipboardEditor.selection.ids[0] : '';
  const missingPaste = edit.queryElementLink(clipboardDoc, [missingPasteId]);
  check('粘贴时目标页已删除会保留缺失身份但明确不可跟随',
    missingPaste.value?.kind === 'slide' && missingPaste.value.slideId === clipboardTarget
      && missingPaste.followable === false
      && edit.effectiveElement(clipboardDoc, missingPasteId).link === undefined);

  const crossPresentation = await core.parse(load('sample-editor-hyperlinks.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const crossDoc = edit.createDoc(crossPresentation, { idPrefix: 'hyperlink-cross-doc-' });
  const crossEditor = new edit.Editor(crossDoc);
  const crossTarget = crossDoc.slideOrder[2];
  crossEditor.exec({ type: 'MoveSlide', id: crossTarget, at: { after: null } });
  crossEditor.exec({
    type: 'PasteElements', payload: picturePayload,
    at: { parentId: crossDoc.slideOrder[1], x: 160, y: 160 },
  });
  const crossPasteId = crossEditor.selection.kind === 'elements'
    ? crossEditor.selection.ids[0] : '';
  const crossPaste = edit.queryElementLink(crossDoc, [crossPasteId]);
  check('跨文档粘贴用 OPC 目标身份映射到目标文档 SlideId',
    crossPaste.value?.kind === 'slide' && crossPaste.value.slideId === crossTarget
      && crossPaste.value.slideId !== clipboardTarget
      && edit.effectiveElement(crossDoc, crossPasteId).link === 'slide:1');
  edit.disposeDoc(crossDoc);
  edit.disposeDoc(clipboardDoc);
}
