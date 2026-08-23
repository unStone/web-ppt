/** 坐标 API 是手柄、拖动与框架适配层的共用 seam；用固件实值而非内部矩阵重算做 oracle。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;

export async function runEditorSpaceContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 编辑器统一坐标空间\x1b[0m');
  const names = [
    'elementFrameToSlideMatrix', 'elementFrameToSlidePoint', 'slideToElementFramePoint',
    'elementParentToSlideMatrix', 'elementParentToSlidePoint', 'slideToElementParentPoint',
    'slideToScreenPoint', 'screenToSlidePoint',
  ];
  const exported = names.every((name) => typeof lib[name] === 'function');
  if (!check('发布入口公开统一坐标 seam', exported)) return;

  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-xfrm.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-space-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  const child = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === '组内形状');
  const matrix = lib.elementFrameToSlideMatrix(session.editor.doc, child.id);
  const origin = lib.elementFrameToSlidePoint(session.editor.doc, child.id, { x: 0, y: 0 });
  const local = lib.slideToElementFramePoint(session.editor.doc, child.id, origin);
  const screen = lib.slideToScreenPoint({ x: 10, y: 15 }, { left: 24, top: 40, zoom: 2 });
  const slide = lib.screenToSlidePoint(screen, { left: 24, top: 40, zoom: 2 });
  check('嵌套元素矩阵对偶 core 组变换，局部/幻灯片/屏幕坐标可逆',
    near(origin.x, 433.2621236566) && near(origin.y, 98.4132329581)
    && near(local.x, 0) && near(local.y, 0)
    && near(screen.x, 44) && near(screen.y, 70)
    && near(slide.x, 10) && near(slide.y, 15)
    && Object.values(matrix).every(Number.isFinite),
  `origin=${origin.x.toFixed(9)},${origin.y.toFixed(9)} local=${local.x.toFixed(9)},${local.y.toFixed(9)}`);

  const staticSvg = container.querySelector('[data-ppt-layer="static"] svg');
  session.editor.select({ kind: 'elements', ids: [child.id], enteredGroup: child.parent });
  const interaction = container.querySelector('[data-ppt-layer="interaction"]');
  const frame = interaction.querySelector('[data-edit-selection-frame]');
  const points = (frame?.getAttribute('points') ?? '').trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
  const expected = [
    [433.2621236566, 98.4132329581], [669.6160043796, 140.0887955982],
    [645.3052595062, 277.9618803533], [408.9513787832, 236.2863177132],
  ];
  const cornersMatch = points.length === 4 && points.every((point, index) =>
    near(point.x, expected[index][0], 1e-3) && near(point.y, expected[index][1], 1e-3));
  const handlesBefore = [...interaction.querySelectorAll('[data-edit-handle]')];
  view.setZoom(2);
  const handlesAfter = [...interaction.querySelectorAll('[data-edit-handle]')];
  const scaleHandles = handlesAfter.filter((handle) => handle.dataset.editHandle !== 'rotate');
  check('嵌套旋转元素在交互层绘制精确 OBB、8 个缩放柄和旋转柄', cornersMatch
    && handlesBefore.length === 9 && handlesAfter.length === 9 && scaleHandles.length === 8
    && scaleHandles.every((handle) => near(Number(handle.getAttribute('width')), 4))
    && near(Number(interaction.querySelector('[data-edit-selection-frame]')?.getAttribute('stroke-width')), 0.75)
    && container.querySelector('[data-ppt-layer="static"] svg') === staticSvg);
  session.dispose();

  const spaceBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-space.pptx')));
  const spaceSession = await lib.openEditor(spaceBytes, { idPrefix: 'editor-space-property-' });
  const byName = (name) => Object.values(spaceSession.editor.doc.elements)
    .find((record) => record.src.name === name);
  const records = [byName('space-plain'), byName('space-rotated-flipped'), byName('space-nested-leaf')];
  let maxRoundTripError = 0;
  let maxParentRoundTripError = 0;
  for (const record of records) {
    for (let index = 0; index < 100; index++) {
      const point = {
        x: record.src.w * ((index * 37 % 101) / 100),
        y: record.src.h * ((index * 61 % 103) / 102),
      };
      const world = lib.elementFrameToSlidePoint(spaceSession.editor.doc, record.id, point);
      const returned = lib.slideToElementFramePoint(spaceSession.editor.doc, record.id, world);
      maxRoundTripError = Math.max(maxRoundTripError, Math.abs(returned.x - point.x), Math.abs(returned.y - point.y));
      const parentWorld = lib.elementParentToSlidePoint(spaceSession.editor.doc, record.id, point);
      const parentReturned = lib.slideToElementParentPoint(spaceSession.editor.doc, record.id, parentWorld);
      maxParentRoundTripError = Math.max(
        maxParentRoundTripError,
        Math.abs(parentReturned.x - point.x),
        Math.abs(parentReturned.y - point.y),
      );
    }
  }
  const topLevelParent = lib.elementParentToSlidePoint(
    spaceSession.editor.doc, records[1].id, { x: 17, y: 29 },
  );
  check('普通、旋转翻转与两层组的元素/父空间 600 个坐标点往返稳定',
    maxRoundTripError <= 1e-9 && maxParentRoundTripError <= 1e-9
    && near(topLevelParent.x, 17) && near(topLevelParent.y, 29),
  `frame=${maxRoundTripError} parent=${maxParentRoundTripError}`);

  const spaceContainer = document.createElement('div');
  spaceSession.mount(spaceContainer, { mode: 'edit', textMode: 'svg' });
  const plain = records[0];
  const flipped = records[1];
  spaceSession.editor.select({ kind: 'elements', ids: [flipped.id], enteredGroup: null });
  const flippedPoints = spaceContainer.querySelector('[data-edit-selection-frame]')
    ?.getAttribute('points').trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
  const flippedExpected = [
    [398.9524996182, 44.2966287334], [580.2140570255, 128.8202810815],
    [521.0475003818, 255.7033712666], [339.7859429745, 171.1797189185],
  ];
  const flippedMatches = flippedPoints?.every((point, index) =>
    near(point[0], flippedExpected[index][0], 1e-3) && near(point[1], flippedExpected[index][1], 1e-3));
  spaceSession.editor.select({ kind: 'elements', ids: [plain.id, flipped.id], enteredGroup: null });
  const multiFrame = spaceContainer.querySelector('[data-edit-selection-frame]');
  const multiPoints = multiFrame?.getAttribute('points');
  const multiValues = multiPoints?.trim().split(/\s+/).flatMap((pair) => pair.split(',').map(Number));
  const multiExpected = [
    80, 44.2966287334, 580.2140570255, 44.2966287334,
    580.2140570255, 255.7033712666, 80, 255.7033712666,
  ];
  check('目标自身翻转不改变选择框，多选使用各 OBB 的世界系 AABB 并集', flippedMatches
    && multiValues?.every((value, index) => near(value, multiExpected[index], 1e-3))
    && spaceContainer.querySelectorAll('[data-edit-handle]').length === 9
    && !spaceContainer.querySelector('[data-edit-selection-id]'),
  `flipped=${flippedMatches} multi=${multiPoints}`);
  spaceSession.dispose();
}
