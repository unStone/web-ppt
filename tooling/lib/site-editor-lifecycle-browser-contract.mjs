import assert from 'node:assert/strict';
import { openFixture } from './site-editor-browser-helpers.mjs';

export async function runSiteEditorLifecycleBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  const source = '/fixtures/sample-chart-shared.pptx';
  await openFixture(context, source, 'lifecycle-first.pptx');
  const slideCount = () => evaluate("document.querySelectorAll('#slideList [data-slide-id]').length");
  const original = await slideCount();
  await click('#addSlide');
  assert.equal(await slideCount(), original + 1);
  await click('#undo');
  assert.equal(await slideCount(), original);

  // 在宿主 DOM 边界制造失败：画布已挂载，但对象列表还没挂载成功。
  await evaluate(`(() => {
    const original = Element.prototype.append;
    globalThis.__restoreMount = () => { Element.prototype.append = original; };
    Element.prototype.append = function (...nodes) {
      if (this.id === 'objectList') {
        globalThis.__restoreMount();
        throw new Error('验收模拟挂载失败');
      }
      return original.apply(this, nodes);
    };
  })()`);
  try {
    await evaluate(`(async () => {
      const bytes = await fetch('${source}').then(response => response.arrayBuffer());
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'lifecycle-failed.pptx'));
      const input = document.querySelector('#fileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor("document.querySelector('#statusText').textContent.includes('验收模拟挂载失败')", '挂载失败反馈');
    await waitFor("!document.querySelector('#canvasMount').children.length && !document.querySelector('#objectList').children.length", '失败文稿的画布与对象列表已卸载');
    assert.equal(await evaluate("document.querySelector('#undo').disabled && document.querySelector('#saveFile').disabled"), true);
  } finally {
    await evaluate('globalThis.__restoreMount(); delete globalThis.__restoreMount');
  }

  for (const name of ['lifecycle-retry.pptx', 'lifecycle-replace.pptx']) {
    await openFixture(context, source, name);
    await click('#addSlide');
    assert.equal(await slideCount(), original + 1, '切换后一次按钮只发出一条命令');
    await click('#undo');
    assert.equal(await slideCount(), original);
    assert.equal(await evaluate("document.querySelector('#canvasMount').children.length"), 1);
    assert.equal(await evaluate("document.querySelector('#objectList').children.length"), 1);
  }
  await evaluate(`(async () => {
    const bytes = await fetch('${source}').then(response => response.arrayBuffer());
    for (const name of ['lifecycle-obsolete.pptx', 'lifecycle-latest.pptx']) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name));
      const input = document.querySelector('#fileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`, true);
  await waitFor("document.querySelector('#fileName').textContent === 'lifecycle-latest.pptx' && !document.querySelector('#editorApp').dataset.loading", '连续打开以最后一次意图为准');
  assert.equal(await slideCount(), original);

  await evaluate(`(async () => {
    const bytes = await fetch('${source}').then(response => response.arrayBuffer());
    const append = Element.prototype.append, remove = Element.prototype.remove;
    const Observer = window.MutationObserver, observers = [];
    globalThis.__lifecycleRelease = null;
    globalThis.__restoreLifecycle = () => {
      Element.prototype.append = append; Element.prototype.remove = remove;
      window.MutationObserver = Observer;
    };
    window.MutationObserver = class extends Observer {
      observe(target, options) {
        const canvas = document.querySelector('#canvasMount').firstElementChild;
        if (canvas?.contains(target)) observers.push({ observer: this, canvas });
        return super.observe(target, options);
      }
      disconnect() { this.released = true; return super.disconnect(); }
    };
    const open = name => {
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], name));
      const input = document.querySelector('#fileInput'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    Element.prototype.append = function (...nodes) {
      const result = append.apply(this, nodes);
      if (this.id === 'objectList') {
        Element.prototype.append = append;
        globalThis.__obsoleteCanvas = document.querySelector('#canvasMount').firstElementChild;
        open('lifecycle-during-mount-latest.pptx');
      }
      return result;
    };
    Element.prototype.remove = function () {
      if (this === globalThis.__obsoleteCanvas) {
        const owned = observers.filter(record => record.canvas === this);
        globalThis.__lifecycleRelease = { count: owned.length,
          released: owned.every(record => record.observer.released === true) };
      }
      return remove.call(this);
    };
    open('lifecycle-during-mount-obsolete.pptx');
  })()`, true);
  try {
    await waitFor("document.querySelector('#fileName').textContent === 'lifecycle-during-mount-latest.pptx' && !document.querySelector('#editorApp').dataset.loading", '已开始挂载的旧文稿被新打开取代');
    assert.equal(await evaluate('globalThis.__obsoleteCanvas.isConnected'), false);
    const released = await evaluate('globalThis.__lifecycleRelease');
    assert.ok(released?.count > 0, '确实观察到旧画布文稿工具创建的观察器');
    assert.equal(released.released, true, '旧画布移除前已释放工具观察器');
    await click('#addSlide');
    assert.equal(await slideCount(), original + 1);
    await click('#undo');
    assert.equal(await slideCount(), original);
  } finally {
    await evaluate('globalThis.__restoreLifecycle(); delete globalThis.__restoreLifecycle; delete globalThis.__obsoleteCanvas; delete globalThis.__lifecycleRelease');
  }
  await click('#newFile');
  await waitFor("!!document.querySelector('#templateDialog[open]')", '新建模板选择已打开');
  await openFixture(context, source, 'lifecycle-replaces-template.pptx');
  assert.equal(await evaluate("!!document.querySelector('#templateDialog[open]')"), false,
    '新的文件意图取消旧模板选择');
  assert.equal(await evaluate("!!document.querySelector('#templateDialog')?.contains(document.querySelector('#siteLanguage'))"), false,
    '取消模板选择归还同一语言入口');
  console.log('编辑器产品生命周期：挂载失败清理、重试、反复替换、挂载中取消、工具先卸载、模板取消及单次命令通过');
}
