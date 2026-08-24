const near = (actual, expected, epsilon = 1e-8) => Math.abs(actual - expected) <= epsilon;

function bounds(edit, doc, id) {
  const element = edit.effectiveElement(doc, id);
  const points = [
    { x: 0, y: 0 }, { x: element.w, y: 0 },
    { x: element.w, y: element.h }, { x: 0, y: element.h },
  ].map((point) => edit.elementFrameToSlidePoint(doc, id, point));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs), center: (Math.min(...xs) + Math.max(...xs)) / 2, right: Math.max(...xs),
    top: Math.min(...ys), middle: (Math.min(...ys) + Math.max(...ys)) / 2, bottom: Math.max(...ys),
  };
}

async function docFrom(edit, core, bytes, suffix) {
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  return edit.createDoc(presentation, { idPrefix: `align-${suffix}-` });
}

/** 只通过发布的命令、投影与坐标 seam 验证用户可见的对齐结果。 */
export async function runElementAlignContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ AlignElements 元素视觉对齐\x1b[0m');
  if (!check('edit-core 发布视觉坐标 seam',
    typeof edit.elementFrameToSlidePoint === 'function'
      && typeof edit.slideToElementParentPoint === 'function')) return;
  const bytes = load('sample-editor-space.pptx');
  if (!check('找到确定性元素对齐固件', !!bytes)) return;

  const doc = await docFrom(edit, core, bytes, 'multi');
  const editor = new edit.Editor(doc);
  const byName = (name) => Object.values(doc.elements).find((record) => record.src.name === name);
  const plain = byName('space-plain');
  const rotated = byName('space-rotated-flipped');
  if (!check('对齐固件含普通与旋转翻转元素', !!plain && !!rotated)) return;
  const plainBefore = bounds(edit, doc, plain.id);
  const rotatedBefore = bounds(edit, doc, rotated.id);
  const historyBefore = editor.history.undoCount;
  const result = editor.exec({ type: 'AlignElements', ids: [plain.id, rotated.id], edge: 'left' });
  const plainAfter = bounds(edit, doc, plain.id);
  const rotatedAfter = bounds(edit, doc, rotated.id);
  check('多元素按旋转后世界 AABB 左边对齐且只移动必要目标',
    near(plainAfter.left, 80) && near(rotatedAfter.left, 80)
      && near(editor.effectiveElement(rotated.id).x, 100.21405702547954, 1e-6)
      && result.forward.length === 1 && result.forward[0].path[3] === 'x'
      && editor.history.undoCount === historyBefore + 1);
  editor.undo();
  check('视觉对齐撤销恢复来源值并清除覆盖',
    near(bounds(edit, doc, plain.id).left, plainBefore.left)
      && near(bounds(edit, doc, rotated.id).left, rotatedBefore.left)
      && !Object.hasOwn(doc.elements[rotated.id].ovr, 'x'));
  editor.redo();
  check('视觉对齐重做恢复同一几何结果', near(bounds(edit, doc, rotated.id).left, 80));
  const historyAfterRedo = editor.history.undoCount;
  const noOp = editor.exec({ type: 'AlignElements', ids: [plain.id, rotated.id], edge: 'left' });
  check('已经对齐的命令不产生空历史', noOp.forward.length === 0
    && editor.history.undoCount === historyAfterRedo);

  const edges = [
    ['left', 'left', 0], ['center', 'center', doc.meta.width / 2], ['right', 'right', doc.meta.width],
    ['top', 'top', 0], ['middle', 'middle', doc.meta.height / 2], ['bottom', 'bottom', doc.meta.height],
  ];
  for (const [edge, field, expected] of edges) {
    const singleDoc = await docFrom(edit, core, bytes, `single-${edge}`);
    const singleEditor = new edit.Editor(singleDoc);
    const target = Object.values(singleDoc.elements)
      .find((record) => record.src.name === 'space-rotated-45');
    singleEditor.exec({ type: 'AlignElements', ids: [target.id], edge });
    check(`单元素 ${edge} 对齐幻灯片`, near(bounds(edit, singleDoc, target.id)[field], expected, 1e-6));
    edit.disposeDoc(singleDoc);
  }

  const nestedDoc = await docFrom(edit, core, bytes, 'nested');
  const nestedEditor = new edit.Editor(nestedDoc);
  const nestedByName = (name) => Object.values(nestedDoc.elements)
    .find((record) => record.src.name === name);
  const nestedPlain = nestedByName('space-plain');
  const leaf = nestedByName('space-nested-leaf');
  const leafBefore = nestedEditor.effectiveElement(leaf.id);
  nestedEditor.exec({ type: 'AlignElements', ids: [nestedPlain.id, leaf.id], edge: 'left' });
  const leafAfter = nestedEditor.effectiveElement(leaf.id);
  check('跨父级对齐把世界位移精确反算到旋转缩放组合的局部坐标',
    near(bounds(edit, nestedDoc, nestedPlain.id).left, bounds(edit, nestedDoc, leaf.id).left, 1e-6)
      && !near(leafAfter.x, leafBefore.x) && !near(leafAfter.y, leafBefore.y));

  const beforeReject = JSON.stringify(nestedDoc.elements);
  let duplicateRejected = false;
  try {
    nestedEditor.exec({ type: 'AlignElements', ids: [leaf.id, leaf.id], edge: 'left' });
  } catch { duplicateRejected = true; }
  let lockedRejected = false;
  nestedDoc.elements[leaf.id].meta.locked = true;
  try {
    nestedEditor.exec({ type: 'AlignElements', ids: [nestedPlain.id, leaf.id], edge: 'top' });
  } catch { lockedRejected = true; }
  delete nestedDoc.elements[leaf.id].meta.locked;
  check('重复与锁定目标在落模前整体拒绝', duplicateRejected && lockedRejected
    && JSON.stringify(nestedDoc.elements) === beforeReject);

  edit.disposeDoc(nestedDoc);
  edit.disposeDoc(doc);

  const coverageBytes = load('sample-editor-align.pptx');
  if (!check('专用对齐固件由生成脚本进入验收', !!coverageBytes)) return;
  const coverageDoc = await docFrom(edit, core, coverageBytes, 'coverage');
  const coverageEditor = new edit.Editor(coverageDoc);
  const coverageByName = (name) => Object.values(coverageDoc.elements)
    .find((record) => record.src.name === name);
  const coveragePlain = coverageByName('align-plain');
  const coverageGroup = coverageByName('align-group');
  const coverageLeaf = coverageByName('align-group-leaf');
  const coverageFrame = coverageByName('align-frame');
  const coverageLocked = coverageByName('align-locked');
  const inherited = coverageByName('align-inherited');
  const secondPage = coverageByName('align-second-page');
  check('专用固件覆盖组合、框架对象、来源移动锁、继承只读与跨页目标',
    coverageGroup?.children?.includes(coverageLeaf?.id)
      && coverageFrame?.meta.editable === 'frame'
      && coverageLocked?.meta.moveLocked === true
      && inherited?.meta.editable === 'none'
      && secondPage && edit.slideOfElement(coverageDoc, coveragePlain.id)
        !== edit.slideOfElement(coverageDoc, secondPage.id));

  const childBeforeRootAlign = coverageEditor.effectiveElement(coverageLeaf.id);
  const rootResult = coverageEditor.exec({
    type: 'AlignElements', ids: [coverageGroup.id, coverageLeaf.id], edge: 'right',
  });
  check('祖先与后代同时传入时只移动最外层根',
    rootResult.forward.every((patch) => patch.path[1] === coverageGroup.id)
      && !Object.hasOwn(coverageDoc.elements[coverageLeaf.id].ovr, 'x')
      && !Object.hasOwn(coverageDoc.elements[coverageLeaf.id].ovr, 'y')
      && coverageEditor.effectiveElement(coverageLeaf.id).x === childBeforeRootAlign.x);

  coverageEditor.exec({ type: 'AlignElements', ids: [coverageFrame.id], edge: 'bottom' });
  check('仅框架可编辑对象复用位置变换并对齐到幻灯片',
    near(bounds(edit, coverageDoc, coverageFrame.id).bottom, coverageDoc.meta.height, 1e-6));

  const coverageBeforeReject = JSON.stringify(coverageDoc.elements);
  let crossSlideRejected = false;
  try {
    coverageEditor.exec({
      type: 'AlignElements', ids: [coveragePlain.id, secondPage.id], edge: 'left',
    });
  } catch { crossSlideRejected = true; }
  let inheritedRejected = false;
  try {
    coverageEditor.exec({ type: 'AlignElements', ids: [inherited.id], edge: 'top' });
  } catch { inheritedRejected = true; }
  let lockedFixtureRejected = false;
  try {
    coverageEditor.exec({ type: 'AlignElements', ids: [coverageLocked.id], edge: 'left' });
  } catch { lockedFixtureRejected = true; }
  let extraIdRejected = false;
  try {
    coverageEditor.exec({
      type: 'AlignElements', id: 'not-part-of-align-command', ids: [coveragePlain.id], edge: 'left',
    });
  } catch { extraIdRejected = true; }
  let unknownFieldRejected = false;
  try {
    coverageEditor.exec({
      type: 'AlignElements', ids: [coveragePlain.id], edge: 'left', callback: () => {},
    });
  } catch { unknownFieldRejected = true; }
  check('跨页、只读、来源锁定与规格外字段在落模前整体拒绝',
    crossSlideRejected && inheritedRejected && lockedFixtureRejected && extraIdRejected && unknownFieldRejected
      && JSON.stringify(coverageDoc.elements) === coverageBeforeReject);
  edit.disposeDoc(coverageDoc);
}
