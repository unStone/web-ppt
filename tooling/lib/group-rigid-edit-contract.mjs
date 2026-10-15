/**
 * 非等比组合里的旋转子元素：渲染按刚体外框画（宽高按象限承接组缩放），编辑几何必须是同一个刚体。
 * 只通过发布的坐标 seam 与命令验证，渲染外框（renderedFrameToSlideMatrix）是独立的对照。
 */
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const maxError = (left, right) => Math.max(...left.map((point, index) => distance(point, right[index])));
const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

export async function runGroupRigidEditContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 非等比组合内旋转元素的刚体编辑几何\x1b[0m');
  const bytes = load('sample-group-scale.pptx');
  if (!check('找到组合缩放固件', !!bytes)) return;
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation, { idPrefix: 'group-rigid-' });
  const editor = new edit.Editor(doc);
  const byName = (name) => Object.values(doc.elements).find((record) => record.src.name === name);
  const group = byName('旋转翻转组合');
  const child30 = byName('30° 子元素');
  const child120 = byName('120° 子元素');
  const leaf = byName('嵌套叶节点');
  if (!check('固件含非等比（1.5×0.75）且旋转翻转的组合与 30° / 120° 子元素', !!group && !!child30 && !!child120 && !!leaf)) return;

  // 模型局部坐标映射到幻灯片后，四角必须与渲染外框重合，且是矩形而不是斜切的平行四边形。
  const modelCorners = (id) => {
    const element = edit.effectiveElement(doc, id);
    return box(element.w, element.h).map((point) => edit.transformSpacePoint(edit.elementFrameToSlideMatrix(doc, id), point));
  };
  const renderedCorners = (id) => {
    const element = edit.renderedElement(doc, id);
    return box(element.w, element.h).map((point) => edit.transformSpacePoint(edit.renderedFrameToSlideMatrix(doc, id), point));
  };
  const rightAngle = (corners) => {
    const ax = corners[1].x - corners[0].x;
    const ay = corners[1].y - corners[0].y;
    const bx = corners[3].x - corners[0].x;
    const by = corners[3].y - corners[0].y;
    return Math.abs(ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
  };
  for (const record of [child30, child120, leaf]) {
    const model = modelCorners(record.id);
    check(`${record.src.name}：模型局部四角与渲染外框重合且为矩形`,
      maxError(model, renderedCorners(record.id)) < 1e-6 && rightAngle(model) < 1e-9,
      `误差 ${maxError(model, renderedCorners(record.id))} 直角余弦 ${rightAngle(model)}`);
    const roundTrip = edit.editFrameToModelFrame(doc, record.id, edit.elementEditFrame(doc, record.id));
    const source = edit.effectiveElement(doc, record.id);
    check(`${record.src.name}：编辑外框换算回模型与原值一致`,
      ['x', 'y', 'w', 'h', 'rot'].every((field) => Math.abs(roundTrip[field] - source[field]) < 1e-9),
      JSON.stringify({ roundTrip, source: { x: source.x, y: source.y, w: source.w, h: source.h, rot: source.rot } }));
    // 平移类命令在模型父空间里换算位移，子元素中心必须落在渲染外框中心。
    const center = edit.transformSpacePoint(edit.elementParentToSlideMatrix(doc, record.id), {
      x: source.x + source.w / 2, y: source.y + source.h / 2,
    });
    const rendered = renderedCorners(record.id);
    check(`${record.src.name}：模型父空间映射的中心与渲染中心一致`,
      distance(center, { x: (rendered[0].x + rendered[2].x) / 2, y: (rendered[0].y + rendered[2].y) / 2 }) < 1e-6);
  }

  // 旋转保持画面宽高：30° → 60° 跨过 45° 后，组缩放承接的轴互换，由模型宽高吸收。
  const before = edit.renderedElement(doc, child30.id);
  const beforeModel = edit.effectiveElement(doc, child30.id);
  const beforeCenter = renderedCorners(child30.id);
  const rotatedModel = edit.editFrameToModelFrame(doc, child30.id, { ...edit.elementEditFrame(doc, child30.id), rot: 60 });
  editor.exec({ type: 'SetXfrm', id: child30.id, ...rotatedModel });
  const after = edit.renderedElement(doc, child30.id);
  const afterCenter = renderedCorners(child30.id);
  const centerOf = (corners) => ({ x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 });
  check('跨 45° 旋转后画面宽高与中心不变，模型宽高随象限换算',
    Math.abs(after.w - before.w) < 1e-6 && Math.abs(after.h - before.h) < 1e-6 && after.rot === 60
      && distance(centerOf(afterCenter), centerOf(beforeCenter)) < 1e-6
      && Math.abs(edit.effectiveElement(doc, child30.id).w - beforeModel.w) > 1,
    `画面 ${before.w}×${before.h} → ${after.w}×${after.h}；模型 ${beforeModel.w}×${beforeModel.h} → ${edit.effectiveElement(doc, child30.id).w}×${edit.effectiveElement(doc, child30.id).h}`);
  editor.undo();
  check('撤销后恢复原模型外框', Math.abs(edit.effectiveElement(doc, child30.id).w - beforeModel.w) < 1e-9
    && edit.effectiveElement(doc, child30.id).rot === beforeModel.rot);

  // 粘贴进同一个非等比组合与粘贴到页面：落点外框都与来源画面同尺寸、同角度，不产生斜切。
  const payload = edit.copyElements(doc, [child120.id]);
  const source = edit.renderedElement(doc, child120.id);
  const sourceSlideCorners = renderedCorners(child120.id);
  const at = {
    x: Math.min(...sourceSlideCorners.map((point) => point.x)) + 30,
    y: Math.min(...sourceSlideCorners.map((point) => point.y)) + 20,
  };
  editor.exec({ type: 'PasteElements', payload, at: { parentId: group.id, ...at } });
  const pastedInGroup = editor.selection.ids[0];
  const pastedRendered = edit.renderedElement(doc, pastedInGroup);
  const pastedCorners = renderedCorners(pastedInGroup);
  check('粘贴进非等比组合：画面外框与来源同尺寸、同角度，并按落点平移',
    doc.elements[pastedInGroup].parent === group.id
      && Math.abs(pastedRendered.w - source.w) < 1e-6 && Math.abs(pastedRendered.h - source.h) < 1e-6
      && maxError(pastedCorners, sourceSlideCorners.map((point) => ({ x: point.x + 30, y: point.y + 20 }))) < 1e-6
      && maxError(modelCorners(pastedInGroup), pastedCorners) < 1e-6,
    `${pastedRendered.w}×${pastedRendered.h} vs ${source.w}×${source.h}`);
  // 来源组合带 flipH：粘贴到页面后反射变成元素自身的翻转，所以按含翻转的内容坐标比较画面位置。
  const contentCorners = (id) => {
    const element = edit.renderedElement(doc, id);
    return box(element.w, element.h).map((point) => edit.transformSpacePoint(edit.renderedContentToSlideMatrix(doc, id), point));
  };
  const sourceContent = contentCorners(child120.id);
  editor.exec({ type: 'PasteElements', payload, at: { parentId: doc.elements[group.id].parent, ...at } });
  const pastedOnSlide = editor.selection.ids[0];
  check('从非等比组合复制到页面：画面内容与来源一致（含翻转），只按落点平移',
    edit.effectiveElement(doc, pastedOnSlide).flipH !== child120.src.flipH
      && maxError(contentCorners(pastedOnSlide), sourceContent.map((point) => ({ x: point.x + 30, y: point.y + 20 }))) < 1e-6,
    `误差 ${maxError(contentCorners(pastedOnSlide), sourceContent.map((point) => ({ x: point.x + 30, y: point.y + 20 })))}`);

  editor.dispose?.();
  edit.disposeDoc(doc);
  presentation.dispose();
}
