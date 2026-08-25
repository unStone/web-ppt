/** 独立 Viewer 也必须让无 href 的内部 SVG 链接具备真实键盘路径。 */
export async function runViewerHyperlinkBrowserContract({ Viewer, parse, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const events = [];
  const prototype = EventTarget.prototype;
  const originalAdd = prototype.addEventListener;
  const originalRemove = prototype.removeEventListener;
  prototype.addEventListener = function add(type, handler, options) {
    if (this === mount) events.push(['add', type]);
    return originalAdd.call(this, type, handler, options);
  };
  prototype.removeEventListener = function remove(type, handler, options) {
    if (this === mount) events.push(['remove', type]);
    return originalRemove.call(this, type, handler, options);
  };
  let presentation;
  let viewer;
  try {
    presentation = await parse(await load('sample-editor-hyperlinks.pptx'), { lazy: false });
    viewer = new Viewer(mount, presentation, { index: 0, textMode: 'html' });
    const anchor = mount.querySelector('[data-slide="3"]');
    if (!anchor || anchor.getAttribute('tabindex') !== '0' || anchor.getAttribute('role') !== 'link') {
      throw new Error('Viewer 内部链接没有原生焦点语义');
    }
    anchor.focus();
    const focused = document.activeElement === anchor;
    const accepted = anchor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
    if (!focused || accepted || viewer.index !== 2) {
      throw new Error(`Viewer Enter 路由失败：${JSON.stringify({
        focused, accepted, index: viewer.index,
      })}`);
    }
    viewer.destroy();
    viewer = null;
    const installed = events.filter(([action]) => action === 'add').map(([, type]) => type);
    const removed = events.filter(([action]) => action === 'remove').map(([, type]) => type);
    if (!installed.includes('click') || !installed.includes('keydown')
      || !removed.includes('click') || !removed.includes('keydown')) {
      throw new Error(`Viewer 链接监听器没有对称释放：${JSON.stringify(events)}`);
    }
  } finally {
    viewer?.destroy();
    presentation?.dispose?.();
    prototype.addEventListener = originalAdd;
    prototype.removeEventListener = originalRemove;
    mount.remove();
  }
}
