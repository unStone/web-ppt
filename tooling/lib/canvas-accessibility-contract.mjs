import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleBrowser } from './bundle-browser.mjs';

export async function runCanvasAccessibilityContract({ check, lib, root }) {
  const { createCanvasAccessibility } = await bundleBrowser({ root,
    entry: join(root, 'packages/editor/src/canvas-accessibility.ts'), output: join(root, 'out/editor/accessibility.mjs'),
    aliases: [['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
      ['@web-ppt/core', join(root, 'packages/core/src/index.ts')], ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')]],
  });
  const session = await lib.openEditor(new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-appearance.pptx'))));
  const container = document.createElement('div'); document.body.append(container);
  const view = session.mount(container, { textMode: 'svg' });
  const accessibility = createCanvasAccessibility(session, view);
  const picture = Object.values(session.editor.doc.elements).find((record) => record.src.name === 'picture-901');
  const lookup = () => [...view.element.querySelectorAll('[data-ppt-accessible-id]')]
    .find((node) => node.dataset.pptAccessibleId === picture.id);
  check('编辑画布暴露独立对象列表与替代文字', view.element.role === 'application'
    && lookup().textContent.includes('灰阶渐变图片') && lookup().getAttribute('aria-selected') === 'false');
  session.editor.select({ kind: 'elements', ids: [picture.id], enteredGroup: null });
  const node = lookup();
  check('键盘焦点与选择对象的 AT 身份同步', view.element.getAttribute('aria-activedescendant') === node.id
    && node.getAttribute('aria-selected') === 'true');
  session.editor.exec({ type: 'SetAltText', id: picture.id, title: '', descr: '更新后的描述' });
  check('替代文字修改更新标签且保留 AT 节点', lookup() === node && node.textContent.includes('更新后的描述'));
  session.editor.exec({ type: 'SetElementHidden', id: picture.id, hidden: true });
  check('隐藏对象退出阅读树和活动后代', !lookup() && view.element.getAttribute('aria-activedescendant') !== node.id);
  session.editor.undo();
  check('撤销隐藏恢复阅读树', !!lookup());
  const shape = Object.values(session.editor.doc.elements).find((record) => record.src.name === 'plain-shape');
  session.editor.exec({ type: 'Group', ids: [picture.id, shape.id] });
  const groupId = session.editor.doc.elements[picture.id].parent;
  const groupedNode = lookup(); groupedNode.click();
  check('组合后辅助激活进入当前父组', session.editor.selection.enteredGroup === groupId);
  session.editor.exec({ type: 'Ungroup', id: groupId });
  groupedNode.click();
  check('解组后同一辅助节点激活当前页面对象', lookup() === groupedNode && session.editor.selection.enteredGroup === null);
  session.editor.undo(); groupedNode.click();
  check('撤销解组后辅助节点恢复父组导航', session.editor.selection.enteredGroup === groupId);
  view.setMode('view');
  await Promise.resolve();
  check('查看模式使用文档阅读并恢复原始链接与文本', view.element.role === 'document'
    && view.element.querySelector('[data-ppt-accessibility]').hidden
    && view.element.querySelector('[data-ppt-layer=static]').getAttribute('aria-hidden') === 'false');
  view.setMode('edit');
  await Promise.resolve();
  check('切回编辑模式恢复对象导航', view.element.role === 'application' && !view.element.querySelector('[data-ppt-accessibility]').hidden);
  accessibility.dispose(); session.dispose(); container.remove();
}
