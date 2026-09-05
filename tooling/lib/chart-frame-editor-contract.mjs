import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runChartFrameEditorContract({ check, lib, root }) {
  const session = await lib.openEditor(new Uint8Array(readFileSync(
    join(root, 'fixtures/sample-chart-data.pptx'),
  )), { idPrefix: 'chart-frame-dom-' });
  const editor = session.editor;
  const slideId = editor.doc.slideOrder[0];
  const ids = editor.doc.slides[slideId].children;
  const chartId = ids.find((id) => editor.doc.elements[id].meta.editable === 'frame');
  const siblingId = ids.find((id) => editor.doc.elements[id].src.kind === 'shape');
  editor.exec({ type: 'SetZ', id: siblingId, to: 'front' });
  editor.exec({ type: 'Group', ids: [chartId, siblingId] });
  const groupId = editor.selection.ids[0];
  const mount = document.createElement('div');
  document.body.append(mount);
  const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
  const layer = mount.querySelector('[data-ppt-layer="static"]');
  const chart = () => layer.querySelector(`[data-edit-id="${chartId}"]`);
  const sibling = () => layer.querySelector(`[data-edit-id="${siblingId}"]`);
  const before = sibling();
  const text = before?.textContent;
  editor.exec({ type: 'SetXfrm', id: groupId, x: editor.effectiveElement(groupId).x + 10 });
  check('包含图表的组增量重绘后，后继形状身份不被图表内部节点挤占',
    !!chart() && !!sibling() && sibling() !== before && sibling().textContent === text
      && chart().querySelectorAll('[data-edit-id]').length === 0);
  view.destroy();
  session.dispose();
  mount.remove();

  const diagram = await lib.openEditor(new Uint8Array(readFileSync(
    join(root, 'fixtures/sample-smartart.pptx'),
  )), { idPrefix: 'smartart-frame-dom-' });
  const diagramMount = document.createElement('div');
  document.body.append(diagramMount);
  diagram.mount(diagramMount, { mode: 'edit', textMode: 'svg' });
  check('SmartArt 内部源形状 ID 不占用 frame 外的编辑身份',
    diagramMount.querySelectorAll('[data-ppt-layer="static"] [data-edit-id]').length > 0);
  diagram.dispose();
  diagramMount.remove();
}
