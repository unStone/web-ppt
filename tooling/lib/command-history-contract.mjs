/** 命令与历史只通过 edit-core 公共入口验证；预期来自技术方案的 src/ovr 与双向 patch 语义。 */
export async function runCommandHistoryContract({ edit, core, load, check, eq }) {
  console.log('\n\x1b[36m▸ 命令、事务与双向 Patch 历史\x1b[0m');
  if (!check('公开无 DOM Editor 命令入口', typeof edit.Editor === 'function')) return;

  const bytes = load('sample-edit-basic.pptx');
  if (!check('找到命令测试固件', !!bytes)) return;
  const pres = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(pres, { idPrefix: 'command-' });
  check('公开模型不变量校验入口', typeof edit.validateEditDoc === 'function');
  const records = Object.values(doc.elements);
  const target = records.find((record) => record.src.name === '普通形状');
  const group = records.find((record) => record.src.kind === 'group');
  const groupChild = group?.children?.length ? doc.elements[group.children[0]] : null;
  const frame = records.find((record) => record.meta.editable === 'frame');
  const kinds = new Set(records.map((record) => record.src.kind));
  if (!check('确定性固件覆盖全部元素种类、嵌套组与框架对象', !!target && !!groupChild && !!frame
    && ['shape', 'image', 'group', 'table', 'unsupported'].every((kind) => kinds.has(kind)))) return;

  const editor = new edit.Editor(doc);
  const x = target.src.x + 17;
  const y = target.src.y + 9;
  const result = editor.exec({ type: 'SetXfrm', id: target.id, x, y });
  eq('SetXfrm 只把显式 x 写入覆盖层', target.ovr.x, x);
  eq('SetXfrm 只把显式 y 写入覆盖层', target.ovr.y, y);
  eq('SetXfrm 不修改源值', target.src.x, x - 17);
  check('SetXfrm 返回可 JSON 序列化的正逆 patch', result.forward.length === 2
    && result.inverse.length === 2
    && JSON.stringify(result.forward).includes('elements'));
  check('SetXfrm 精确报告目标元素与所属页', result.dirtyElements.has(target.id)
    && result.dirtySlides.has(edit.slideOfElement(doc, target.id)));
  eq('有效投影立即反映命令结果', edit.effectiveElement(doc, target.id).x, x);

  const groupChildX = groupChild.src.x + 5;
  const frameX = frame.src.x + 11;
  editor.exec({ type: 'SetXfrm', id: groupChild.id, x: groupChildX });
  editor.exec({ type: 'SetXfrm', id: frame.id, x: frameX });
  check('SetXfrm 同时支持组内元素与仅框架可编辑对象', groupChild.ovr.x === groupChildX
    && frame.ovr.x === frameX);
  const beforeUnknown = JSON.stringify(target.ovr);
  let unknownRejected = false;
  try { editor.exec({ type: 'Unknown', id: target.id, x: target.src.x + 99 }); } catch { unknownRejected = true; }
  check('运行时拒绝未知命令且不留下修改', unknownRejected && JSON.stringify(target.ovr) === beforeUnknown);

  const beforeAtomic = { ...target.ovr };
  let atomicRejected = false;
  try {
    editor.exec(
      { type: 'SetXfrm', id: target.id, x: x + 100 },
      { type: 'SetXfrm', id: 'missing-element', y: 1 },
    );
  } catch {
    atomicRejected = true;
  }
  check('同一次 exec 任一命令失败会整体回滚', atomicRejected
    && JSON.stringify(target.ovr) === JSON.stringify(beforeAtomic));

  if (check('公开事务、选择与历史入口', typeof editor.transaction === 'function'
    && typeof editor.select === 'function' && !!editor.history)) {
    editor.history.clear();
    const selBefore = { kind: 'none' };
    const selAfter = { kind: 'elements', ids: [target.id], enteredGroup: null };
    editor.select(selBefore);
    const historyBefore = target.ovr.x;
    editor.transaction((tx) => {
      tx.exec({ type: 'SetXfrm', id: target.id, x: historyBefore + 23 });
      tx.select(selAfter);
    }, '移动元素');
    eq('一次事务形成一个撤销单元', editor.history.undoCount, 1);
    check('历史记录和选择均可 JSON 序列化', JSON.stringify(editor.history.undoEntries)
      .includes('移动元素'));
    const undo = editor.undo();
    check('撤销应用逆 patch 并恢复操作前选择', !!undo && target.ovr.x === historyBefore
      && editor.selection.kind === 'none' && editor.history.redoCount === 1);
    const redo = editor.redo();
    check('重做应用正 patch 并恢复操作后选择', !!redo && target.ovr.x === historyBefore + 23
      && editor.selection.kind === 'elements' && editor.selection.ids[0] === target.id);

    editor.history.clear();
    const mergeStart = target.ovr.x;
    editor.transaction((tx) => tx.exec({ type: 'SetXfrm', id: target.id, x: mergeStart + 1 }),
      '面板位置', { mergeKey: `x:${target.id}`, time: 1000 });
    editor.transaction((tx) => tx.exec({ type: 'SetXfrm', id: target.id, x: mergeStart + 2 }),
      '面板位置', { mergeKey: `x:${target.id}`, time: 1499 });
    eq('同页相邻属性在 500ms 内合并为一个撤销单元', editor.history.undoCount, 1);
    editor.undo();
    eq('合并事务撤销回到整组最早值', target.ovr.x, mergeStart);
    editor.redo();
    eq('合并事务重做到整组最终值', target.ovr.x, mergeStart + 2);

    const limited = new edit.Editor(doc, { historyLimit: 3 });
    for (let i = 1; i <= 4; i++) {
      limited.exec({ type: 'SetXfrm', id: target.id, x: mergeStart + 10 + i });
    }
    eq('历史超过配置深度时丢弃最旧撤销单元', limited.history.undoCount, 3);

    const beforePatchBatch = { ...target.ovr };
    const path = (field) => ['elements', target.id, 'ovr', field];
    let invalidPatchRejected = false;
    try {
      edit.applyPatches(doc, [
        { op: 'set', path: path('x'), value: target.ovr.x + 100, origin: 'remote' },
        { op: 'set', path: path('w'), value: -1, origin: 'remote' },
      ]);
    } catch {
      invalidPatchRejected = true;
    }
    check('公开 patch 回放整批预校验，非法尾项不会留下前半段修改', invalidPatchRejected
      && JSON.stringify(target.ovr) === JSON.stringify(beforePatchBatch));

    if (check('公开细粒度订阅入口', typeof editor.subscribe === 'function')) {
      const events = [];
      const unsubscribe = editor.subscribe((event) => events.push(event));
      editor.select({ kind: 'none' });
      const historyCount = editor.history.undoCount;
      editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
      const eventX = target.ovr.x;
      editor.transaction((tx) => tx.exec(
        { type: 'SetXfrm', id: target.id, x: eventX + 1 },
        { type: 'SetXfrm', id: target.id, y: target.src.y + 3 },
      ), '一次批量变换');
      check('选择变化不占历史且事务只广播一次精确失效', editor.history.undoCount === historyCount + 1
        && events.filter((event) => event.source === 'selection').length === 2
        && events.filter((event) => event.source === 'transaction').length === 1
        && events.at(-1).dirtyElements.has(target.id));
      const beforeFailedEvents = events.length;
      try { editor.exec({ type: 'SetXfrm', id: 'missing', x: 1 }); } catch { /* 预期 */ }
      eq('失败事务不广播半成品事件', events.length, beforeFailedEvents);
      unsubscribe();
      editor.select({ kind: 'none' });
      eq('取消订阅后停止广播', events.length, beforeFailedEvents);
    }

    if (check('公开保存点脏状态入口', typeof editor.isDirty === 'function'
      && typeof editor.markSaved === 'function')) {
      editor.markSaved();
      check('标记保存点后文档干净', !editor.isDirty());
      editor.exec({ type: 'SetXfrm', id: target.id, x: target.ovr.x + 7 });
      check('新事务使文档变脏', editor.isDirty());
      editor.undo();
      check('撤销回保存点后恢复干净', !editor.isDirty());
      editor.redo();
      check('重做离开保存点后再次变脏', editor.isDirty());
    }
  }

  edit.disposeDoc(doc);
}
