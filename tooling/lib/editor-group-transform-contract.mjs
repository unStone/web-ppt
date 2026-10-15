/** 组变换折算进子元素外框后，编辑器的增量重绘、文字覆盖层与拖动预览必须与整页渲染同一坐标。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;

export async function runEditorGroupTransformContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ 编辑器组合外框折算\x1b[0m');
  if (!check('编辑入口公开渲染外框 seam', ['renderedElement', 'renderedFrameToSlideMatrix',
    'renderedContentToSlideMatrix', 'elementParentToRenderedParentMatrix'].every((name) => typeof lib[name] === 'function'))) return;

  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-group-scale.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-group-transform-' });
  const doc = session.editor.doc;
  const byName = (name) => Object.values(doc.elements).find((record) => record.src.name === name);
  const child = byName('缩放组合内形状');
  const reference = byName('对照形状');
  const leaf = byName('嵌套叶节点');
  if (!check('1.5 倍与嵌套组合固件可编辑解析', !!child && !!reference && !!leaf)) {
    session.dispose();
    return;
  }

  const placed = lib.renderedElement(doc, child.id);
  const origin = lib.transformSpacePoint(lib.renderedFrameToSlideMatrix(doc, child.id), { x: 0, y: 0 });
  check('组内子元素的渲染外框按 1.5 倍折算，矩阵不再携带缩放',
    near(placed.w, 450) && near(placed.h, 225) && near(origin.x, 80) && near(origin.y, 120)
      && near(lib.renderedFrameToSlideMatrix(doc, child.id).a, 1),
    `w=${placed.w} h=${placed.h} origin=${origin.x},${origin.y}`);
  const toRendered = lib.elementParentToRenderedParentMatrix(doc, child.id);
  check('父组子坐标到渲染坐标的换算等于组缩放与 chOff 平移',
    near(toRendered.a, 1.5) && near(toRendered.d, 1.5) && near(toRendered.e, -60) && near(toRendered.f, -45),
    JSON.stringify(toRendered));
  const nestedLeaf = lib.renderedElement(doc, leaf.id);
  const nestedOrigin = lib.transformSpacePoint(lib.renderedFrameToSlideMatrix(doc, leaf.id), { x: 0, y: 0 });
  check('嵌套组合逐层折算后叶节点外框与对照形状同尺寸',
    near(nestedLeaf.w, 480) && near(nestedLeaf.h, 200) && near(nestedOrigin.x, 120) && near(nestedOrigin.y, 140),
    `w=${nestedLeaf.w} h=${nestedLeaf.h} origin=${nestedOrigin.x},${nestedOrigin.y}`);

  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  view.setSlide(session.editor.doc.slideOrder[3]);
  session.editor.exec({ type: 'SetXfrm', id: child.id, x: session.editor.effectiveElement(child.id).x + 10 });
  const partition = container.querySelector(`[data-edit-id="${child.id}"]`);
  const markup = partition?.outerHTML ?? '';
  check('组内元素增量重绘使用折算外框：位移 ×1.5、几何 450 宽、描边保持 6px',
    /translate\(15 0\)/.test(markup) && /L 450 0/.test(markup) && /stroke-width="6"/.test(markup)
      && !/scale\(1\.5/.test(markup) && !partition.closest('[transform*="scale(1.5"]'),
    markup.slice(0, 400));

  session.editor.select({ kind: 'elements', ids: [child.id], enteredGroup: child.parent });
  container.querySelector(`[data-edit-id="${child.id}"]`)
    .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
  const editor = container.querySelector(`[data-ppt-text-editor="${child.id}"]`);
  const overlay = editor?.closest('[style*="matrix("]') ?? editor;
  check('组内文字编辑覆盖层按折算外框排版，不再被组缩放放大',
    !!editor && overlay.style.width === '450px' && overlay.style.height === '225px'
      && /^matrix\(1,0,0,1,/.test(overlay.style.transform) && editor.innerHTML.includes('font-size:32px'),
    `${overlay?.style.width}×${overlay?.style.height} ${overlay?.style.transform}`);
  view.destroy();
  container.remove();
  session.dispose();
}
