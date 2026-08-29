export async function runVertexEditorContract({ check, lib, vertex, root }) {
  console.log('\n\x1b[36m▸ 顶点编辑独立扩展\x1b[0m');
  check('主编辑入口不携带顶点扩展运行时代码', lib.createVertexEditor === undefined);
  check('editor/vertex 发布独立扩展工厂', typeof vertex.createVertexEditor === 'function');
  if (typeof vertex.createVertexEditor !== 'function') return;
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const session = await lib.openEditor(new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-vertex.pptx'))), {
    idPrefix: 'vertex-extension-',
  });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'vertex-freeform');
  const mount = document.createElement('div');
  const view = session.mount(mount, { mode: 'edit', slideId: record.parent });
  session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
  const extension = vertex.createVertexEditor(session, view);
  check('扩展只在 interaction layer 绘制稳定顶点与控制柄', extension.start()
    && mount.querySelector('[data-ppt-layer="static"] [data-ppt-vertex-editor]') === null
    && mount.querySelectorAll('[data-ppt-layer="interaction"] [data-ppt-vertex-point]').length > 0);
  const path = extension.geometry.paths[0];
  extension.setClosed(path.id, !path.closed);
  check('扩展产品 seam 通过单一 SetGeometry 历史单元切换闭合',
    session.editor.doc.elements[record.id].ovr.geometry?.paths[0].closed === !path.closed
      && session.editor.history.undoCount === 1);
  extension.destroy();
  check('销毁扩展只清理自己的交互层节点',
    !mount.querySelector('[data-ppt-vertex-editor]') && !view.destroyed && !session.disposed);
  session.dispose();
}
