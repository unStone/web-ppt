/** 固定种子属性测试：验证历史往返、patch 回放、边界规则与非法命令健壮性。 */
export async function runCommandPropertyContract({ edit, core, load, check, eq }) {
  console.log('\n\x1b[36m▸ 命令历史属性与模糊测试\x1b[0m');
  const bytes = load('sample-edit-basic.pptx');
  if (!check('属性测试固件存在', !!bytes)) return;
  const pres = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(pres, { idPrefix: 'property-' });
  const editable = Object.values(doc.elements).filter((record) => record.meta.editable !== 'none');
  if (!check('属性测试有多个可编辑目标', editable.length >= 3)) return;

  const initial = structuredClone(doc);
  const initialJson = JSON.stringify(initial);
  const editor = new edit.Editor(doc, { historyLimit: 200 });
  let seed = 0x12ab34cd;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const fields = ['x', 'y', 'w', 'h', 'rot'];
  for (let i = 0; i < 200; i++) {
    const target = editable[random() % editable.length];
    const field = fields[random() % fields.length];
    const current = edit.effectiveElement(doc, target.id)[field];
    let value = field === 'w' || field === 'h'
      ? (random() % 50000) / 100
      : field === 'rot'
        ? (random() % 36000) / 100
        : (random() % 160000) / 100 - 200;
    if (Object.is(value, current)) value += 0.01;
    editor.exec({ type: 'SetXfrm', id: target.id, [field]: value });
  }
  const finalJson = JSON.stringify(doc);
  const entries = JSON.parse(JSON.stringify(editor.history.undoEntries));
  eq('固定种子生成 200 个独立撤销单元', editor.history.undoCount, 200);
  check('公开历史不泄漏内部状态 token', !JSON.stringify(entries).includes('beforeState')
    && !JSON.stringify(entries).includes('afterState'));

  while (editor.undo()) { /* 全量撤销 */ }
  check('随机 200 条命令全部撤销后 EditDoc 深度全等', JSON.stringify(doc) === initialJson);
  while (editor.redo()) { /* 全量重做 */ }
  check('随机 200 条命令全部重做后 EditDoc 深度全等', JSON.stringify(doc) === finalJson);

  const replay = structuredClone(initial);
  for (const entry of entries) edit.applyPatches(replay, entry.forward);
  check('JSON 回放全部正 patch 得到相同最终文档', JSON.stringify(replay) === finalJson);
  for (const entry of entries.toReversed()) edit.applyPatches(replay, entry.inverse);
  check('JSON 回放全部逆 patch 恢复初始文档', JSON.stringify(replay) === initialJson);

  const beforeFuzz = JSON.stringify(doc);
  let rejected = 0;
  for (let i = 0; i < 500; i++) {
    const target = editable[i % editable.length];
    const variants = [
      { type: 'SetXfrm', id: 'missing', x: i },
      { type: 'SetXfrm', id: target.id, x: Number.NaN },
      { type: 'SetXfrm', id: target.id, rot: Number.POSITIVE_INFINITY },
      { type: 'SetXfrm', id: target.id, w: -1 - i },
      { type: 'SetXfrm', id: target.id },
      { type: 'Unknown', id: target.id, x: i },
      { type: 'SetXfrm', id: target.id, x: i, callback: () => i },
    ];
    try { editor.exec(variants[i % variants.length]); } catch { rejected++; }
  }
  check('五百条非法命令全部被拒绝且不污染文档', rejected === 500 && JSON.stringify(doc) === beforeFuzz);

  const boundaryDoc = edit.createDoc(pres, { idPrefix: 'boundary-' });
  const target = Object.values(boundaryDoc.elements).find((record) => record.src.name === '普通形状');
  const secondPageTarget = Object.values(boundaryDoc.elements).find((record) => record.src.name === '第二页形状');
  if (!check('边界规则找到跨页目标', !!target && !!secondPageTarget)) return;
  const boundary = new edit.Editor(boundaryDoc);
  const commitPanelEdit = (field, value, time, mergeKey = 'panel') => boundary.transaction(
    (tx) => tx.exec({ type: 'SetXfrm', id: target.id, [field]: value }),
    '属性面板', { time, mergeKey },
  );

  commitPanelEdit('x', target.src.x + 1, 1000);
  commitPanelEdit('x', target.src.x + 2, 1501);
  eq('相隔超过 500ms 的同属性改动不合并', boundary.history.undoCount, 2);
  boundary.history.clear();
  commitPanelEdit('x', target.src.x + 3, 2000);
  commitPanelEdit('y', target.src.y + 3, 2100);
  eq('路径不相邻的改动不合并', boundary.history.undoCount, 2);

  boundary.history.clear();
  const commitCrossPage = (offset, time) => boundary.transaction((tx) => {
    tx.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + offset });
    tx.exec({ type: 'SetXfrm', id: secondPageTarget.id, x: secondPageTarget.src.x + offset });
  }, '跨页移动', { mergeKey: 'cross-page', time });
  commitCrossPage(10, 2200);
  commitCrossPage(11, 2300);
  eq('跨页事务即使路径相邻也不合并', boundary.history.undoCount, 2);

  boundary.history.clear();
  const remote = boundary.transaction(
    (tx) => tx.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 4 }),
    '远端移动', { origin: 'peer' },
  );
  check('远端 origin 应用但不进入本地历史', boundary.history.undoCount === 0
    && remote.forward.every((patch) => patch.origin === 'peer'));

  boundary.history.clear();
  commitPanelEdit('x', target.src.x + 20, 4000, 'remote-gap');
  boundary.transaction((tx) => tx.exec(
    { type: 'SetXfrm', id: target.id, x: target.src.x + 21 },
  ), '远端插入', { origin: 'peer', time: 4100, mergeKey: 'remote-gap' });
  commitPanelEdit('x', target.src.x + 22, 4200, 'remote-gap');
  eq('远端改动会剔除旧冲突路径并截断两侧本地历史合并', boundary.history.undoCount, 1);

  const selectiveDoc = structuredClone(boundaryDoc);
  const selective = new edit.Editor(selectiveDoc, { origin: 'me' });
  const selectiveTarget = selectiveDoc.elements[target.id];
  selective.exec({ type: 'SetXfrm', id: target.id, x: 1 });
  selective.transaction((tx) => tx.exec(
    { type: 'SetXfrm', id: target.id, x: 2 },
  ), '远端覆盖', { origin: 'peer' });
  selective.exec({ type: 'SetXfrm', id: target.id, x: 3 });
  selective.undo();
  selective.undo();
  check('连续撤销只移除自己的效果且不覆盖远端值', selectiveTarget.ovr.x === 2
    && selective.history.undoCount === 0);

  const selectiveFieldsDoc = structuredClone(boundaryDoc);
  const selectiveFields = new edit.Editor(selectiveFieldsDoc, { origin: 'me' });
  const selectiveFieldsTarget = selectiveFieldsDoc.elements[target.id];
  const originalY = edit.effectiveElement(selectiveFieldsDoc, target.id).y;
  selectiveFields.transaction((tx) => tx.exec(
    { type: 'SetXfrm', id: target.id, x: 31, y: originalY + 1 },
  ), '本地双字段');
  selectiveFields.transaction((tx) => tx.exec(
    { type: 'SetXfrm', id: target.id, x: 32 },
  ), '远端单字段', { origin: 'peer' });
  selectiveFields.undo();
  check('远端 rebase 只剔除冲突路径并保留其它本地字段可撤销', selectiveFieldsTarget.ovr.x === 32
    && edit.effectiveElement(selectiveFieldsDoc, target.id).y === originalY);

  const savedRebaseDoc = structuredClone(boundaryDoc);
  const savedRebase = new edit.Editor(savedRebaseDoc, { origin: 'me' });
  const savedTarget = savedRebaseDoc.elements[target.id];
  const savedY = edit.effectiveElement(savedRebaseDoc, target.id).y + 12;
  savedRebase.exec({ type: 'SetXfrm', id: target.id, y: savedY });
  savedRebase.transaction((tx) => tx.exec(
    { type: 'SetXfrm', id: target.id, x: 52 },
  ), '远端独立字段', { origin: 'peer' });
  savedRebase.markSaved();
  savedRebase.undo();
  const dirtyAfterUndo = savedRebase.isDirty();
  savedRebase.redo();
  check('远端 rebase 后撤销再重做能准确回到保存点', dirtyAfterUndo && !savedRebase.isDirty()
    && savedTarget.ovr.x === 52 && edit.effectiveElement(savedRebaseDoc, target.id).y === savedY);

  boundary.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 5 });
  boundary.undo();
  boundary.exec({ type: 'SetXfrm', id: target.id, y: target.src.y + 5 });
  eq('撤销后新编辑清空重做栈', boundary.history.redoCount, 0);

  boundary.history.clear();
  commitPanelEdit('x', target.src.x + 6, 3000, 'saved-x');
  boundary.markSaved();
  commitPanelEdit('x', target.src.x + 7, 3100, 'saved-x');
  eq('保存点会截断后续 500ms 历史合并', boundary.history.undoCount, 2);
  boundary.undo();
  check('撤销到保存点恢复干净状态', !boundary.isDirty());

  boundary.history.clear();
  const beforeExposed = edit.effectiveElement(boundaryDoc, target.id).x;
  boundary.exec({ type: 'SetXfrm', id: target.id, x: beforeExposed + 8 });
  const exposed = boundary.history.undoEntries[0];
  exposed.inverse.length = 0;
  boundary.undo();
  eq('修改公开历史副本不会破坏内部撤销数据', edit.effectiveElement(boundaryDoc, target.id).x, beforeExposed);

  const selectedIds = [target.id];
  boundary.select({ kind: 'elements', ids: selectedIds, enteredGroup: null });
  selectedIds[0] = 'missing';
  check('选区复制调用方数组避免外部突变', boundary.selection.kind === 'elements'
    && boundary.selection.ids[0] === target.id);
  let textSelectionRejected = false;
  try {
    boundary.select({
      kind: 'text', id: target.id,
      anchor: { p: 0, r: 0, off: 999 }, focus: { p: 0, r: 0, off: 999 },
    });
  } catch { textSelectionRejected = true; }
  check('文本选区拒绝越界的 UTF-16 光标位置', textSelectionRejected);

  const tiny = new edit.Editor(structuredClone(boundaryDoc), { historyByteLimit: 1 });
  tiny.exec({ type: 'SetXfrm', id: target.id, x: beforeExposed + 9 });
  eq('历史超过字节预算时立即丢弃最旧单元', tiny.history.undoCount, 0);

  const defaultDepth = new edit.Editor(structuredClone(boundaryDoc));
  for (let i = 1; i <= 201; i++) {
    defaultDepth.exec({ type: 'SetXfrm', id: target.id, x: beforeExposed + 100 + i });
  }
  eq('默认历史深度固定为 200 组', defaultDepth.history.undoCount, 200);
  const defaultBytes = new edit.Editor(structuredClone(boundaryDoc));
  defaultBytes.transaction((tx) => tx.exec(
    { type: 'SetXfrm', id: target.id, x: beforeExposed + 400 },
  ), `超大标签${'x'.repeat(8 * 1024 * 1024)}`);
  eq('默认历史字节预算固定为 8MB', defaultBytes.history.undoCount, 0);

  boundary.history.clear();
  let events = 0;
  const unsubscribe = boundary.subscribe(() => { events++; });
  const noOp = boundary.exec({ type: 'SetXfrm', id: target.id, x: edit.effectiveElement(boundaryDoc, target.id).x });
  unsubscribe();
  check('无效值相同的命令不占历史也不广播', noOp.forward.length === 0
    && boundary.history.undoCount === 0 && events === 0);

  let subscriberBubbled = false;
  let laterSubscriberEvents = 0;
  let reportedSubscriberErrors = 0;
  const previousReportError = globalThis.reportError;
  globalThis.reportError = () => { reportedSubscriberErrors++; };
  const stopThrowing = boundary.subscribe(() => { throw new Error('listener failed'); });
  const stopLater = boundary.subscribe(() => { laterSubscriberEvents++; });
  try { boundary.exec({ type: 'SetXfrm', id: target.id, x: beforeExposed + 10 }); } catch {
    subscriberBubbled = true;
  }
  stopThrowing();
  stopLater();
  if (previousReportError) globalThis.reportError = previousReportError;
  else delete globalThis.reportError;
  check('订阅者异常不伪装成事务失败且不阻断后续订阅者', !subscriberBubbled
    && laterSubscriberEvents === 1 && reportedSubscriberErrors === 1
    && edit.effectiveElement(boundaryDoc, target.id).x === beforeExposed + 10);

  const beforeSelectionFailure = JSON.stringify(target.ovr);
  let selectionFailure = false;
  try {
    boundary.transaction((tx) => {
      tx.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 100 });
      tx.select({ kind: 'elements', ids: ['missing'], enteredGroup: null });
    }, '非法选择');
  } catch { selectionFailure = true; }
  check('事务末尾选择校验失败也会回滚全部命令', selectionFailure
    && JSON.stringify(target.ovr) === beforeSelectionFailure);

  for (const kind of ['locked', 'none', 'readonly']) {
    const protectedDoc = structuredClone(boundaryDoc);
    if (kind === 'locked') protectedDoc.elements[target.id].meta.locked = true;
    if (kind === 'none') protectedDoc.elements[target.id].meta.editable = 'none';
    if (kind === 'readonly') protectedDoc.meta.readonly = true;
    const protectedEditor = new edit.Editor(protectedDoc);
    let wasRejected = false;
    try { protectedEditor.exec({ type: 'SetXfrm', id: target.id, x: 1 }); } catch { wasRejected = true; }
    check(`SetXfrm 拒绝 ${kind} 目标`, wasRejected);
  }

  edit.disposeDoc(doc);
  edit.disposeDoc(boundaryDoc);
}
