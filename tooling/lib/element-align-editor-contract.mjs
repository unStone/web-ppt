import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 对齐只从发布的 openEditor、DOM 分区与 headless 历史取证。 */
export async function runElementAlignEditorContract({ check, lib, root }) {
  console.log('\n\x1b[36m▸ 元素对齐增量 DOM\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-align.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-align-' });
  const container = document.createElement('div');
  const view = session.mount(container, { mode: 'edit', textMode: 'svg', snapping: false });
  const byName = (name) => Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === name);
  const plain = byName('align-plain');
  const rotated = byName('align-rotated');
  const group = byName('align-group');
  const frame = byName('align-frame');
  const staticLayer = container.querySelector('[data-ppt-layer="static"]');
  const interactionLayer = container.querySelector('[data-ppt-layer="interaction"]');
  const node = (id) => staticLayer.querySelector(`[data-edit-id="${id}"]`);
  const identities = new Map([plain, rotated, group, frame].map((record) => [record.id, node(record.id)]));
  const svg = staticLayer.querySelector('svg');
  const defs = staticLayer.querySelector('defs');
  session.editor.select({ kind: 'elements', ids: [plain.id, rotated.id], enteredGroup: null });
  const selectionBefore = interactionLayer.querySelector('[data-edit-selection-frame]');
  const historyBefore = session.editor.history.undoCount;
  session.editor.exec({ type: 'AlignElements', ids: [plain.id, rotated.id], edge: 'left' });
  const selection = session.editor.selection;
  check('对齐只替换实际移动元素并保持整页、defs 与未触碰兄弟身份',
    node(plain.id) === identities.get(plain.id)
      && node(rotated.id) !== identities.get(rotated.id)
      && node(group.id) === identities.get(group.id)
      && node(frame.id) === identities.get(frame.id)
      && staticLayer.querySelector('svg') === svg && staticLayer.querySelector('defs') === defs
      && interactionLayer.querySelector('[data-edit-selection-frame]') !== selectionBefore
      && selection.kind === 'elements' && selection.ids.join(',') === `${plain.id},${rotated.id}`
      && session.editor.history.undoCount === historyBefore + 1);

  const movedNode = node(rotated.id);
  session.editor.undo();
  check('对齐撤销继续增量回显且恢复选区',
    node(rotated.id) !== movedNode && node(plain.id) === identities.get(plain.id)
      && staticLayer.querySelector('svg') === svg && staticLayer.querySelector('defs') === defs
      && session.editor.selection.kind === 'elements');
  session.editor.redo();
  check('对齐重做不重建未触碰 DOM', node(plain.id) === identities.get(plain.id)
    && node(group.id) === identities.get(group.id) && staticLayer.querySelector('svg') === svg);

  const frameBefore = node(frame.id);
  session.editor.exec({ type: 'AlignElements', ids: [frame.id], edge: 'bottom' });
  check('frame 对齐使用同一增量 DOM 路径', node(frame.id) !== frameBefore
    && node(group.id) === identities.get(group.id) && staticLayer.querySelector('svg') === svg);
  view.destroy();
  session.dispose();
}
