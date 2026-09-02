const pointer = (type, pointerType, point, pointerId) => new PointerEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0,
  buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
  clientX: point.x, clientY: point.y, pointerId, pointerType, isPrimary: true,
});

function tap(point, pointerType, pointerId) {
  const target = document.elementFromPoint(point.x, point.y);
  if (!target) throw new Error('触屏命中探针落在视口外');
  target.dispatchEvent(pointer('pointerdown', pointerType, point, pointerId));
  target.dispatchEvent(pointer('pointerup', pointerType, point, pointerId));
}

export async function runEditorTouchBrowserContract({ openEditor, load, mount }) {
  const session = await openEditor(await load('sample-editor-touch.pptx'), { idPrefix: 'touch-browser-' });
  const view = session.mount(mount, { mode: 'edit', textMode: 'svg', zoom: 0.75 });
  mount.scrollIntoView({ block: 'start' });
  const outline = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === 'touch-thin-outline');
  if (!outline) throw new Error('触屏固件缺少细描边对象');
  const outlineNode = mount.querySelector(`[data-edit-id="${outline.id}"]`);
  const outlineRect = outlineNode.getBoundingClientRect();
  const point = { x: outlineRect.left + outlineRect.width / 2, y: outlineRect.top + 6 };
  const selected = () => session.editor.selection.kind === 'elements'
    && session.editor.selection.ids[0] === outline.id;
  const historyBefore = session.editor.history.undoCount;

  session.editor.select({ kind: 'none' });
  tap(point, 'mouse', 81);
  const mouseExact = session.editor.selection.kind === 'none';
  session.editor.select({ kind: 'none' });
  tap(point, 'pen', 82);
  const penExact = session.editor.selection.kind === 'none';
  session.editor.select({ kind: 'none' });
  tap(point, 'touch', 83);
  const touchTolerant = selected();
  if (!mouseExact || !penExact || !touchTolerant
    || session.editor.history.undoCount !== historyBefore) {
    throw new Error(`触屏细描边命中失败：mouse=${mouseExact} pen=${penExact} touch=${touchTolerant}`
      + ` point=${JSON.stringify(point)}`);
  }
  view.destroy();
  session.dispose();
  return { hitDistance: 6 };
}
