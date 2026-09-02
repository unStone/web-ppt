export async function runPresetAdjustmentEditorContract({ adjustments, check, lib, root }) {
  console.log('\n\x1b[36m▸ 预设形状调节柄独立扩展\x1b[0m');
  check('主编辑入口不携带预设调节柄扩展运行时代码',
    lib.createPresetAdjustmentEditor === undefined);
  check('editor/adjustments 发布独立扩展工厂',
    typeof adjustments.createPresetAdjustmentEditor === 'function');
  if (typeof adjustments.createPresetAdjustmentEditor !== 'function') return;
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const session = await lib.openEditor(new Uint8Array(readFileSync(
    join(root, 'fixtures/sample-editor-preset-shape.pptx'),
  )), { idPrefix: 'preset-adjustment-extension-' });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'preset-source');
  const mount = document.createElement('div');
  const view = session.mount(mount, { mode: 'edit', slideId: record.parent });
  session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
  const extension = adjustments.createPresetAdjustmentEditor(session, view);
  check('扩展只在 interaction layer 绘制规范调节柄', extension.start()
    && extension.geometry?.preset === 'roundRect' && extension.handles.length === 1
    && mount.querySelector('[data-ppt-layer="static"] [data-ppt-preset-adjustments]') === null
    && mount.querySelectorAll(
      '[data-ppt-layer="interaction"] [data-ppt-preset-handle]',
    ).length === 1);
  check('扩展切换预设只形成一个 SetPreset 历史单元', extension.setPreset('hexagon')
    && extension.geometry?.preset === 'hexagon'
    && session.editor.history.undoCount === 1);
  extension.destroy();
  check('销毁扩展只清理自己的交互层节点',
    !mount.querySelector('[data-ppt-preset-adjustments]') && !view.destroyed && !session.disposed);
  session.dispose();
}
