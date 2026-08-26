/** 查找替换只从公开查询/命令与有效投影观察，不耦合索引或 patch 内部结构。 */
export async function runFindReplaceContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 文档级查找稳定顺序\x1b[0m');
  const presentation = await core.parse(load('sample-editor-find-replace.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'find-replace-' });
  const matches = edit.findText(doc, {
    query: 'Needle', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
  });
  const names = matches.map((match) => doc.elements[match.id]?.src.name);
  check('跨 run、组、表格和跨页命中按稳定绘制顺序返回且跳过字段/公式边界',
    names.join(',') === 'find-rich,find-group-child,find-table,find-page-two,find-page-two'
      && matches[2].cell?.r === 0 && matches[2].cell?.c === 0
      && matches.every((match) => match.text === 'Needle')
      && matches.every((match) => match.range.from.p === match.range.to.p));
  const greekFolded = edit.findText(doc, {
    query: 'ΟΣ', scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  });
  const greekExact = edit.findText(doc, {
    query: 'ΟΣ', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
  });
  check('Unicode 大小写折叠遵循整串上下文规则并保留 UTF-16 范围',
    greekFolded.length === 2 && greekExact.length === 1
      && greekFolded.map((match) => match.text).join(',') === 'ΟΣ,ος');
  check('动态页码字段的可见值不会被当成普通文字命中', edit.findText(doc, {
    query: '1', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
  }).length === 0);

  console.log('\n\x1b[36m▸ 替换当前精确命中\x1b[0m');
  const editor = new edit.Editor(doc);
  const hiddenGroup = Object.values(doc.elements).find((record) => record.src.name === 'find-group');
  editor.exec({ type: 'SetElementHidden', id: hiddenGroup.id, hidden: true });
  check('隐藏元素及其组后代不会进入可见文字结果', edit.findText(doc, {
    query: 'Needle', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
  }).length === 4);
  editor.undo();
  check('恢复组可见性后其后代重新进入查找结果', edit.findText(doc, {
    query: 'Needle', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
  }).length === 5);
  const current = matches[0];
  const historyBefore = editor.history.undoCount;
  const result = editor.exec({
    type: 'ReplaceText', from: 'Needle', to: '替换', matchCase: true, wholeWord: true,
    scope: {
      kind: 'match', match: {
        slideId: current.slideId, id: current.id, range: current.range,
      },
    },
  });
  const rich = editor.effectiveElement(current.id);
  const replaced = edit.textBodyEditText(rich.text);
  const replacedParagraph = rich.text.paragraphs[1].runs
    .map((run) => run.math?.length ? edit.TEXT_ATOM : run.text).join('');
  const replacementRange = edit.findText(doc, {
    query: '替换', scope: { kind: 'slide', slideId: current.slideId },
    matchCase: true, wholeWord: true,
  })[0]?.range;
  const replacementProps = replacementRange
    ? edit.queryRunProps(doc, current.id, replacementRange) : null;
  check('ReplaceText 精确替换跨 run 命中、继承起点格式且只形成一个历史单元',
    replaced.includes('替换') && replacedParagraph === '替换'
      && replacementProps?.b.value === true && replacementProps?.i.value === false
      && result.forward.length === 1 && result.dirtyElements.has(current.id)
      && editor.history.undoCount === historyBefore + 1);
  let staleRejected = false;
  try {
    editor.exec({
      type: 'ReplaceText', from: 'Needle', to: '失效', matchCase: true, wholeWord: true,
      scope: { kind: 'match', match: { slideId: current.slideId, id: current.id, range: current.range } },
    });
  } catch { staleRejected = true; }
  check('精确命中内容变化后旧范围明确失效而非替换相邻文字', staleRejected);
  editor.undo();
  check('撤销当前替换逐字符恢复原跨 run 内容',
    editor.effectiveElement(current.id).text.paragraphs[1].runs
      .map((run) => run.math?.length ? edit.TEXT_ATOM : run.text).join('') === 'Needle');

  console.log('\n\x1b[36m▸ 全部替换原子性与命令关系\x1b[0m');
  const insensitive = edit.findText(doc, {
    query: 'NEEDLE', scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  });
  const partial = edit.findText(doc, {
    query: 'needle', scope: { kind: 'document' }, matchCase: false, wholeWord: false,
  });
  check('Unicode 字面量大小写折叠与整词边界不误吞 NeedleCase',
    insensitive.length === 6 && partial.length === 7);
  const table = Object.values(doc.elements).find((record) => record.src.name === 'find-table');
  editor.exec({ type: 'SetLocked', id: table.id, locked: true });
  const beforeLocked = JSON.stringify(insensitive.map((match) => match.key));
  const lockedHistory = editor.history.undoCount;
  let lockedRejected = false;
  try {
    editor.exec({
      type: 'ReplaceText', from: 'Needle', to: '锁定不应写入',
      scope: { kind: 'document' }, matchCase: false, wholeWord: true,
    });
  } catch { lockedRejected = true; }
  check('任一批量目标锁定时全部替换在落模前原子拒绝',
    lockedRejected && editor.history.undoCount === lockedHistory
      && JSON.stringify(edit.findText(doc, {
        query: 'NEEDLE', scope: { kind: 'document' }, matchCase: false, wholeWord: true,
      }).map((match) => match.key)) === beforeLocked);
  editor.exec({ type: 'SetLocked', id: table.id, locked: false });
  const batchHistory = editor.history.undoCount;
  const batch = editor.exec({
    type: 'ReplaceText', from: 'Needle', to: 'Needle++',
    scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  });
  const pageTwo = Object.values(doc.elements).find((record) => record.src.name === 'find-page-two');
  const pageTwoText = edit.textBodyEditText(editor.effectiveElement(pageTwo.id).text);
  check('全部替换按执行前快照一次完成、跨页与单元格合成一个历史单元',
    batch.forward.length === 5 && editor.history.undoCount === batchHistory + 1
      && pageTwoText === 'Needle++ middle Needle++ NeedleCase'
      && !pageTwoText.includes('Needle++++')
      && batch.dirtySlides.size === 2);
  editor.undo();
  check('一次撤销原子恢复全部六处命中', edit.findText(doc, {
    query: 'NEEDLE', scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  }).length === 6);

  const pageTwoBeforeDelete = edit.textBodyEditText(editor.effectiveElement(pageTwo.id).text);
  const deleteHistory = editor.history.undoCount;
  const deletion = editor.exec({
    type: 'ReplaceText', from: 'Needle', to: '',
    scope: { kind: 'slides', slideIds: [pageTwo.parent] }, matchCase: true, wholeWord: true,
  });
  check('指定页面范围支持空替换且只形成一个历史单元',
    deletion.forward.length === 1 && editor.history.undoCount === deleteHistory + 1
      && edit.textBodyEditText(editor.effectiveElement(pageTwo.id).text) === ' middle  NeedleCase'
      && edit.findText(doc, {
        query: 'NEEDLE', scope: { kind: 'document' }, matchCase: false, wholeWord: true,
      }).length === 4);
  editor.undo();
  check('撤销空替换恢复指定页面的完整原文',
    edit.textBodyEditText(editor.effectiveElement(pageTwo.id).text) === pageTwoBeforeDelete);

  const recoveryPresentation = await core.parse(load('sample-editor-find-replace.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'find-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const frames = [];
  const stopRecovery = recoveryEditor.subscribeRecovery((frame) => frames.push(frame));
  recoveryEditor.exec({
    type: 'ReplaceText', from: 'Needle', to: '恢复替换',
    scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  });
  stopRecovery();
  const recoveredPresentation = await core.parse(load('sample-editor-find-replace.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveredDoc = edit.createDoc(recoveredPresentation, { idPrefix: 'find-recovery-' });
  const recoveredEditor = new edit.Editor(recoveredDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(frames)),
  });
  check('全部替换恢复帧可 JSON 回放且得到同一跨页结果',
    frames.length === 1
      && edit.findText(recoveryDoc, {
        query: '恢复替换', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
      }).length === 6
      && edit.findText(recoveredDoc, {
        query: '恢复替换', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
      }).length === 6
      && recoveredEditor.isDirty());
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(recoveredDoc);

  const relationPresentation = await core.parse(load('sample-editor-find-replace.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const relationDoc = edit.createDoc(relationPresentation, { idPrefix: 'find-relation-' });
  const relationEditor = new edit.Editor(relationDoc);
  const group = Object.values(relationDoc.elements).find((record) => record.src.name === 'find-group');
  let relationRejected = false;
  try {
    relationEditor.transaction((transaction) => {
      transaction.exec({ type: 'RemoveElement', id: group.id });
      transaction.exec({
        type: 'ReplaceText', from: 'Needle', to: '冲突', scope: { kind: 'document' },
        matchCase: true, wholeWord: true,
      });
    }, '删除与全部替换冲突');
  } catch { relationRejected = true; }
  check('全部替换与同事务删除的依赖在任何模型修改前拒绝',
    relationRejected && !!relationDoc.elements[group.id]);
  edit.disposeDoc(relationDoc);

  const readonlyPresentation = await core.parse(load('sample-editor-find-replace.pptx'), {
    edit: true, keepPackage: false, lazy: false, assets: 'defer',
  });
  const readonlyDoc = edit.createDoc(readonlyPresentation, { idPrefix: 'find-readonly-' });
  const readonlyEditor = new edit.Editor(readonlyDoc);
  const readonlyHistory = readonlyEditor.history.undoCount;
  let readonlyRejected = false;
  try {
    readonlyEditor.exec({
      type: 'ReplaceText', from: 'Needle', to: '只读禁止',
      scope: { kind: 'document' }, matchCase: true, wholeWord: true,
    });
  } catch { readonlyRejected = true; }
  check('只读来源在落模前原子拒绝替换',
    readonlyDoc.meta.readonly && readonlyRejected
      && readonlyEditor.history.undoCount === readonlyHistory
      && edit.findText(readonlyDoc, {
        query: 'Needle', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
      }).length === 5);
  edit.disposeDoc(readonlyDoc);

  console.log('\n\x1b[36m▸ 查找替换严格纯数据边界\x1b[0m');
  const rejected = (run) => { try { run(); return false; } catch { return true; } };
  check('查询与命令拒绝显式 undefined、稀疏页面和原型对象',
    rejected(() => edit.findText(doc, {
      query: 'Needle', scope: { kind: 'document' }, matchCase: undefined,
    }))
      && rejected(() => editor.exec({
        type: 'ReplaceText', from: 'Needle', to: 'x', scope: { kind: 'document' },
        wholeWord: undefined,
      }))
      && rejected(() => edit.findText(doc, {
        query: 'Needle', scope: { kind: 'slides', slideIds: [doc.slideOrder[0], , doc.slideOrder[1]] },
      }))
      && rejected(() => edit.findText(doc, {
        query: 'Needle', scope: Object.assign(Object.create({ polluted: true }), { kind: 'document' }),
      })));
  edit.disposeDoc(doc);

  console.log('\n\x1b[36m▸ 替换文字驱动 spAutoFit\x1b[0m');
  const fitPresentation = await core.parse(load('sample-editor-sp-autofit.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const fitDoc = edit.createDoc(fitPresentation, { idPrefix: 'find-fit-' });
  const fitEditor = new edit.Editor(fitDoc);
  const fitTarget = Object.values(fitDoc.elements)
    .find((record) => record.src.name === 'sp-autofit-top');
  const fitBefore = fitEditor.effectiveElement(fitTarget.id);
  const fitResult = fitEditor.exec({
    type: 'ReplaceText', from: '顶部锚点', to: '查找替换自动增高'.repeat(60),
    scope: { kind: 'slide', slideId: fitDoc.slideOrder[0] },
    matchCase: true, wholeWord: false,
  });
  const fitAfter = fitEditor.effectiveElement(fitTarget.id);
  check('ReplaceText 的文字与 spAutoFit 几何在同一历史事务提交',
    fitAfter.h > fitBefore.h
      && fitResult.forward.some((patch) => patch.path[3] === 'text')
      && fitResult.forward.filter((patch) => patch.path[3] === 'h').length === 1
      && fitEditor.history.undoCount === 1);
  edit.disposeDoc(fitDoc);
}
