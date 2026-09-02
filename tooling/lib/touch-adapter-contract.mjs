function touch(type, pointerId, x, y, isPrimary = pointerId === 1) {
  const event = new MouseEvent(type, {
    bubbles: true, composed: true, cancelable: true, button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: x, clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, pointerType: { value: 'touch' }, isPrimary: { value: isPrimary },
  });
  return event;
}

export async function runTouchAdapterContract({ check, lib, load }) {
  console.log('\n\x1b[36m▸ 触屏导航 adapter seam\x1b[0m');
  const session = await lib.openEditor(load('sample-editor-touch.pptx'), { idPrefix: 'touch-adapter-' });
  const navigation = [];
  const viewChanges = [];
  const contexts = [];
  const adapter = lib.createWebPptAdapter({
    onTouchNavigate: (change) => navigation.push(change),
    onViewChange: (change) => viewChanges.push(change),
    onContextRequest: (request) => contexts.push(request),
  });
  const container = document.createElement('div');
  adapter.attach(container);
  await adapter.setDocument({ session, ownership: 'external' });
  const view = adapter.snapshot.view;
  const stage = container.querySelector('[data-ppt-stage]');
  stage.getBoundingClientRect = () => ({
    left: 100, top: 50, right: 1380, bottom: 770, width: 1280, height: 720, x: 100, y: 50,
    toJSON() {},
  });
  view.element.dispatchEvent(touch('pointerdown', 1, 300, 250, true));
  view.element.dispatchEvent(touch('pointerdown', 2, 500, 250, false));
  view.element.dispatchEvent(touch('pointermove', 1, 250, 300, true));
  view.element.dispatchEvent(touch('pointermove', 2, 550, 300, false));
  view.element.dispatchEvent(touch('pointerup', 2, 550, 300, false));
  view.element.dispatchEvent(touch('pointerup', 1, 250, 300, true));
  const lastNavigation = navigation.at(-1);
  const lastView = viewChanges.at(-1);
  check('adapter 同步触屏缩放状态并向宿主发布 viewport 与受控视图变化',
    lastNavigation?.phase === 'end' && Math.abs(lastNavigation.viewport.zoom - 1.5) < 1e-6
      && adapter.snapshot.zoom === 1.5 && adapter.snapshot.view.zoom === 1.5
      && lastView?.zoom === 1.5 && lastView.slideId === adapter.snapshot.slideId,
  `navigation=${JSON.stringify(navigation)} snapshot=${adapter.snapshot.zoom}`
    + ` viewChanges=${JSON.stringify(viewChanges)}`);
  const outline = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === 'touch-thin-outline');
  const target = container.querySelector(`[data-edit-id="${outline.id}"]`);
  target.dispatchEvent(touch('pointerdown', 3, 250, 160, true));
  await new Promise((resolve) => setTimeout(resolve, 520));
  target.dispatchEvent(touch('pointerup', 3, 250, 160, true));
  check('adapter 透传长按上下文请求，不替产品层创建菜单',
    contexts.length === 1 && contexts[0].source === 'touch'
      && contexts[0].targetId === outline.id && container.querySelectorAll('[role="menu"]').length === 0,
  `contexts=${JSON.stringify(contexts)}`);
  adapter.dispose();
  session.dispose();
}
