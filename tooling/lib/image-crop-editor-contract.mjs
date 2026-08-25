import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const near = (actual, expected, epsilon = 1e-5) => Math.abs(actual - expected) <= epsilon;
const pointer = (type, x, y) => new MouseEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y,
});
const center = (node) => ({
  x: Number(node?.getAttribute('x')) + Number(node?.getAttribute('width')) / 2,
  y: Number(node?.getAttribute('y')) + Number(node?.getAttribute('height')) / 2,
});
const points = (node) => (node?.getAttribute('points') ?? '').split(' ').filter(Boolean)
  .map((pair) => { const [x, y] = pair.split(',').map(Number); return { x, y }; });
const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);

/** 图片裁剪必须经过发布视图和真实 DOM 事件，约束模式、预览、历史与坐标。 */
export async function runImageCropEditorContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 图片双矩形裁剪交互\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-image-content.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-image-crop-' });
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  const editView = session.mount(editMount, { mode: 'edit', textMode: 'svg', snapping: false });
  const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', snapping: false });
  if (!check('SlideEditor 公开可编排的裁剪模式入口',
    typeof editView.startImageCrop === 'function'
      && typeof editView.endImageCrop === 'function'
      && typeof editView.replaceImage === 'function'
      && typeof editView.chooseReplacementImage === 'function')) {
    session.dispose();
    return;
  }
  const picture = byName(session.editor.doc, 'image-webp');
  const sibling = byName(session.editor.doc, 'image-shared-a');
  const editStatic = editMount.querySelector('[data-ppt-layer="static"]');
  const staticSvg = editStatic.querySelector('svg');
  const siblingNode = editStatic.querySelector(`[data-edit-id="${sibling.id}"]`);
  editStatic.querySelector(`[data-edit-id="${picture.id}"]`).dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true, composed: true, cancelable: true,
  }));
  const cropGroup = editMount.querySelector(`[data-edit-crop-id="${picture.id}"]`);
  const visuals = [...editMount.querySelectorAll('[data-edit-crop-handle]')];
  const hits = [...editMount.querySelectorAll('[data-edit-crop-hit]')];
  check('双击普通图片进入双矩形模式并提供 8 个恒屏幕命中手柄',
    !!cropGroup && !!cropGroup.querySelector('[data-edit-crop-source-frame]')
      && !!cropGroup.querySelector('[data-edit-crop-frame]')
      && visuals.length === 8 && hits.length === 8
      && visuals.every((node) => near(Number(node.getAttribute('width')), 8))
      && hits.every((node) => near(Number(node.getAttribute('width')), 16)
        && node.style.pointerEvents === 'all')
      && !editMount.querySelector('[data-edit-selection-ids]'));
  check('查看模式不安装裁剪交互 DOM',
    !viewMount.querySelector('[data-edit-crop-id]')
      && viewMount.querySelector('[data-ppt-layer="interaction"]').style.display === 'none');

  const west = cropGroup.querySelector('[data-edit-crop-hit="w"]');
  const start = center(west);
  const sourceCrop = structuredClone(session.editor.effectiveElement(picture.id).crop);
  const history = session.editor.history.undoCount;
  west.dispatchEvent(pointer('pointerdown', start.x, start.y));
  editView.element.dispatchEvent(pointer('pointermove', start.x + 30, start.y));
  const preview = center(editMount.querySelector('[data-edit-crop-handle="w"]'));
  const previewOnly = JSON.stringify(session.editor.effectiveElement(picture.id).crop)
    === JSON.stringify(sourceCrop)
    && near(preview.x, start.x + 30) && session.editor.history.undoCount === history;
  editView.element.dispatchEvent(pointer('pointerup', start.x + 30, start.y));
  const cropped = lib.queryElementCrop(session.editor.doc, [picture.id]);
  check('裁剪拖动只更新交互层，松手形成一个历史单元并增量替换图片',
    previewOnly && cropped.direct && near(cropped.value.l, 30 / picture.src.w)
      && near(cropped.value.t, 0) && near(cropped.value.r, 0) && near(cropped.value.b, 0)
      && session.editor.history.undoCount === history + 1
      && session.editor.history.undoEntries.at(-1)?.label === '裁剪图片'
      && editStatic.querySelector('svg') === staticSvg
      && editStatic.querySelector(`[data-edit-id="${sibling.id}"]`) === siblingNode
      && !!editMount.querySelector(`[data-edit-crop-id="${picture.id}"]`));

  editView.setZoom(2);
  check('zoom=2 时 SVG 手柄尺寸减半而屏幕尺寸保持不变',
    [...editMount.querySelectorAll('[data-edit-crop-handle]')]
      .every((node) => near(Number(node.getAttribute('width')), 4))
      && [...editMount.querySelectorAll('[data-edit-crop-hit]')]
        .every((node) => near(Number(node.getAttribute('width')), 8)));
  editView.endImageCrop();
  session.editor.exec({ type: 'SetXfrm', id: picture.id, rot: 30 });
  editView.startImageCrop(picture.id);
  const frame = points(editMount.querySelector('[data-edit-crop-frame]'));
  const sourceFrame = points(editMount.querySelector('[data-edit-crop-source-frame]'));
  const image = session.editor.effectiveElement(picture.id);
  const expected = [
    { x: 0, y: 0 }, { x: image.w, y: 0 },
    { x: image.w, y: image.h }, { x: 0, y: image.h },
  ].map((point) => lib.elementFrameToSlidePoint(session.editor.doc, picture.id, point));
  const sourceW = image.w / (1 - cropped.value.l - cropped.value.r);
  const sourceH = image.h / (1 - cropped.value.t - cropped.value.b);
  const expectedSource = [
    { x: -cropped.value.l * sourceW, y: -cropped.value.t * sourceH },
    { x: (1 - cropped.value.l) * sourceW, y: -cropped.value.t * sourceH },
    { x: (1 - cropped.value.l) * sourceW, y: (1 - cropped.value.t) * sourceH },
    { x: -cropped.value.l * sourceW, y: (1 - cropped.value.t) * sourceH },
  ].map((point) => lib.elementFrameToSlidePoint(session.editor.doc, picture.id, point));
  check('旋转图片的元素框与实际原图范围分别投影到幻灯片',
    frame.length === 4 && frame.every((point, index) =>
      near(point.x, expected[index].x) && near(point.y, expected[index].y))
      && sourceFrame.length === 4 && sourceFrame.every((point, index) =>
        near(point.x, expectedSource[index].x) && near(point.y, expectedSource[index].y)));

  const cancelHistory = session.editor.history.undoCount;
  const east = editMount.querySelector('[data-edit-crop-hit="e"]');
  const eastStart = center(east);
  east.dispatchEvent(pointer('pointerdown', eastStart.x * 2, eastStart.y * 2));
  editView.element.dispatchEvent(pointer('pointermove', eastStart.x * 2 - 30, eastStart.y * 2));
  editView.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  check('Esc 同时取消未提交裁剪并退出模式',
    !editMount.querySelector('[data-edit-crop-id]')
      && session.editor.history.undoCount === cancelHistory
      && JSON.stringify(lib.queryElementCrop(session.editor.doc, [picture.id]).value)
        === JSON.stringify(cropped.value));

  editView.startImageCrop(picture.id);
  const enterHistory = session.editor.history.undoCount;
  const enterWest = editMount.querySelector('[data-edit-crop-hit="w"]');
  const enterStart = center(enterWest);
  enterWest.dispatchEvent(pointer('pointerdown', enterStart.x * 2, enterStart.y * 2));
  editView.element.dispatchEvent(pointer('pointermove', enterStart.x * 2 + 20, enterStart.y * 2));
  editView.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true,
  }));
  check('Enter 提交活动裁剪手势并退出模式',
    !editMount.querySelector('[data-edit-crop-id]')
      && session.editor.history.undoCount === enterHistory + 1
      && lib.queryElementCrop(session.editor.doc, [picture.id]).value.l > cropped.value.l);
  editView.setMode('view');
  editStatic.querySelector(`[data-edit-id="${picture.id}"]`).dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true, composed: true, cancelable: true,
  }));
  check('切换 view 后双击图片没有编辑副作用', !editMount.querySelector('[data-edit-crop-id]'));

  editView.destroy();
  viewView.destroy();
  session.dispose();
}
