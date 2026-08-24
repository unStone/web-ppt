const EMU_PER_PX = 9525;

const textOf = (element) => element.text.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

const endOf = (text) => {
  const p = text.paragraphs.length - 1;
  const r = text.paragraphs[p].runs.length - 1;
  return { p, r, off: text.paragraphs[p].runs[r].text.length };
};

const anchorFraction = (element) => {
  const logical = element.text.anchor === 'middle' ? 0.5 : element.text.anchor === 'bottom' ? 1 : 0;
  return element.flipV ? 1 - logical : logical;
};

const anchorInParent = (edit, element) => edit.transformSpacePoint(
  edit.elementFrameToParentMatrix(element),
  { x: element.w / 2, y: anchorFraction(element) * element.h },
);

const nearPoint = (left, right) => Math.hypot(left.x - right.x, left.y - right.y) <= 1 / EMU_PER_PX;
const quantizedHeight = (core, element) => Math.ceil(
  core.fitTextShapeHeight(element.text, element.w) * EMU_PER_PX - 1e-7,
) / EMU_PER_PX;

async function open(edit, core, load, prefix) {
  const presentation = await core.parse(load('sample-editor-sp-autofit.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: prefix });
  return { doc, editor: new edit.Editor(doc) };
}

function byName(doc, name) {
  return Object.values(doc.elements).find((record) => record.src.name === name);
}

/** spAutoFit 改高是纯数据命令：文字与几何同事务提交，DOM 只消费结果。 */
export async function runShapeAutofitEditContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ spAutoFit 文字形状改高\x1b[0m');
  const { doc, editor } = await open(edit, core, load, 'shape-autofit-');
  const names = [
    'sp-autofit-top', 'sp-autofit-middle', 'sp-autofit-bottom', 'sp-autofit-rotated',
    'sp-autofit-flipped', 'sp-autofit-nested', 'sp-autofit-columns', 'sp-autofit-vertical',
  ];
  const direct = byName(doc, 'sp-autofit-top');
  const directResult = editor.exec({ type: 'FitTextShape', id: direct.id });
  check('公开 FitTextShape 可独立把现有内容归一到 EMU 高度',
    editor.effectiveElement(direct.id).h === quantizedHeight(core, editor.effectiveElement(direct.id))
      && directResult.forward.filter((patch) => patch.path[3] === 'h').length === 1);
  for (const name of names) {
    const record = byName(doc, name);
    const sourceGeometry = JSON.stringify({ x: record.src.x, y: record.src.y, h: record.src.h });
    const before = editor.effectiveElement(record.id);
    const fixedAnchor = anchorInParent(edit, before);
    const end = endOf(before.text);
    const result = editor.exec({
      type: 'EditText', id: record.id,
      ops: [{ type: 'replace', from: end, to: end, text: '自动增高，'.repeat(70) }],
    });
    const after = editor.effectiveElement(record.id);
    const expected = quantizedHeight(core, after);
    check(`${name} 的文字与改高在一个原子事务内完成`,
      after.h > before.h
        && after.h === expected
        && after.w === before.w
        && after.rot === before.rot
        && nearPoint(fixedAnchor, anchorInParent(edit, after))
        && JSON.stringify({ x: record.src.x, y: record.src.y, h: record.src.h }) === sourceGeometry
        && result.forward.some((patch) => patch.path[3] === 'text')
        && result.forward.filter((patch) => patch.path[3] === 'h').length === 1,
    `h=${before.h}/${after.h}/${expected}`);
  }

  const disabled = byName(doc, 'sp-autofit-disabled');
  const disabledBefore = editor.effectiveElement(disabled.id);
  const disabledEnd = endOf(disabledBefore.text);
  editor.exec({
    type: 'EditText', id: disabled.id,
    ops: [{ type: 'replace', from: disabledEnd, to: disabledEnd, text: '不应改高'.repeat(80) }],
  });
  check('没有 spAutoFit 的形状只改文字', editor.effectiveElement(disabled.id).h === disabledBefore.h);

  let rejected = 0;
  for (const command of [
    { type: 'FitTextShape', id: disabled.id },
    { type: 'FitTextShape', id: 'missing-element' },
    { type: 'FitTextShape', id: names[0], dom: document.body },
  ]) {
    try { editor.exec(command); } catch { rejected++; }
  }
  check('显式改高拒绝无能力目标、缺失目标和非纯数据命令', rejected === 3);

  const top = byName(doc, 'sp-autofit-top');
  const beforeFormat = editor.effectiveElement(top.id);
  const whole = { from: { p: 0, r: 0, off: 0 }, to: endOf(beforeFormat.text) };
  const runResult = editor.exec({ type: 'SetRunProps', id: top.id, range: whole, props: { size: 30 } });
  const afterRun = editor.effectiveElement(top.id);
  const paraResult = editor.exec({ type: 'SetParaProps', id: top.id, range: whole, props: { lineHeight: 42 } });
  const afterPara = editor.effectiveElement(top.id);
  check('字符和段落格式命令也各自只派生一次改高',
    afterRun.h > beforeFormat.h && afterPara.h > afterRun.h
      && runResult.forward.filter((patch) => patch.path[3] === 'h').length === 1
      && paraResult.forward.filter((patch) => patch.path[3] === 'h').length === 1);

  edit.disposeDoc(doc);

  const merged = await open(edit, core, load, 'shape-autofit-merge-');
  const mergedRecord = byName(merged.doc, 'sp-autofit-middle');
  const sourceText = textOf(mergedRecord.src);
  const sourceGeometry = { x: mergedRecord.src.x, y: mergedRecord.src.y, h: mergedRecord.src.h };
  for (let index = 0; index < 2; index++) {
    const element = merged.editor.effectiveElement(mergedRecord.id);
    const end = endOf(element.text);
    merged.editor.transaction((tx) => tx.exec({
      type: 'EditText', id: mergedRecord.id,
      ops: [{ type: 'replace', from: end, to: end, text: '连续输入'.repeat(40) }],
    }), '连续输入', { mergeKey: `text:${mergedRecord.id}`, time: 1000 + index });
  }
  const grown = merged.editor.effectiveElement(mergedRecord.id);
  const redoGeometry = { x: grown.x, y: grown.y, h: grown.h };
  merged.editor.undo();
  const undone = merged.editor.effectiveElement(mergedRecord.id);
  merged.editor.redo();
  const redone = merged.editor.effectiveElement(mergedRecord.id);
  check('连续输入合并后一次撤销与重做同时覆盖文字和锚点几何',
    merged.editor.history.undoCount === 1
      && textOf(undone) === sourceText
      && JSON.stringify({ x: undone.x, y: undone.y, h: undone.h }) === JSON.stringify(sourceGeometry)
      && JSON.stringify({ x: redone.x, y: redone.y, h: redone.h }) === JSON.stringify(redoGeometry));
  edit.disposeDoc(merged.doc);

  const remote = await open(edit, core, load, 'shape-autofit-remote-');
  const remoteRecord = byName(remote.doc, 'sp-autofit-middle');
  const localElement = remote.editor.effectiveElement(remoteRecord.id);
  const localEnd = endOf(localElement.text);
  remote.editor.transaction((tx) => tx.exec({
    type: 'EditText', id: remoteRecord.id,
    ops: [{ type: 'replace', from: localEnd, to: localEnd, text: '本地输入'.repeat(30) }],
  }), '本地输入');
  const beforeRemote = remote.editor.effectiveElement(remoteRecord.id);
  const remoteEnd = endOf(beforeRemote.text);
  remote.editor.transaction((tx) => tx.exec({
    type: 'EditText', id: remoteRecord.id,
    ops: [{
      type: 'replace',
      from: { ...remoteEnd, off: remoteEnd.off - 1 }, to: remoteEnd, text: '远',
    }],
  }), '远端输入', { recordHistory: false, origin: 'remote' });
  const remoteElement = remote.editor.effectiveElement(remoteRecord.id);
  check('同高度的非记录文字写入也让文本与派生几何一起胜出并清除冲突历史',
    textOf(remoteElement).includes('本地输入') && textOf(remoteElement).endsWith('远')
      && remoteElement.h === beforeRemote.h
      && remoteElement.h === quantizedHeight(core, remoteElement)
      && remote.editor.history.undoCount === 0 && remote.editor.undo() === null);
  edit.disposeDoc(remote.doc);

  const mixed = await open(edit, core, load, 'shape-autofit-mixed-');
  const mixedAuto = byName(mixed.doc, 'sp-autofit-top');
  const mixedOther = byName(mixed.doc, 'sp-autofit-disabled');
  mixed.editor.exec({ type: 'FitTextShape', id: mixedAuto.id });
  mixed.editor.history.clear();
  const autoSourceX = mixed.editor.effectiveElement(mixedAuto.id).x;
  const otherSourceX = mixed.editor.effectiveElement(mixedOther.id).x;
  mixed.editor.transaction((tx) => {
    tx.exec({ type: 'SetXfrm', id: mixedAuto.id, x: autoSourceX + 5 });
    tx.exec({ type: 'SetXfrm', id: mixedOther.id, x: otherSourceX + 5 });
  }, '两个独立移动');
  const sameWidthText = mixed.editor.effectiveElement(mixedAuto.id).text;
  mixed.editor.transaction((tx) => {
    tx.exec({
      type: 'EditText', id: mixedAuto.id,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 }, text: '另',
      }],
    });
    tx.exec({ type: 'SetXfrm', id: mixedOther.id, x: otherSourceX + 10 });
  }, '远端混合写入', { recordHistory: false, origin: 'remote' });
  const mixedHeight = mixed.editor.effectiveElement(mixedAuto.id).h;
  mixed.editor.undo();
  check('多目标混合 rebase 只移除实际冲突路径，不把无因果关系的移动一起删除',
    mixed.editor.effectiveElement(mixedAuto.id).x === autoSourceX
      && mixed.editor.effectiveElement(mixedAuto.id).h === mixedHeight
      && mixed.editor.effectiveElement(mixedOther.id).x === otherSourceX + 10
      && textOf(mixed.editor.effectiveElement(mixedAuto.id)).startsWith('另')
      && sameWidthText.paragraphs[0].runs[0].text.length > 0);
  edit.disposeDoc(mixed.doc);
}
