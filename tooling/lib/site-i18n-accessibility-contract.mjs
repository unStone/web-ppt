import { captureSaveAndReopen, openFixture, selectPaneObject } from './site-editor-browser-helpers.mjs';

async function key(request, key, code, windowsVirtualKeyCode) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await request('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode });
  }
}

async function accessibleName(request, role, name) {
  const tree = await request('Accessibility.getFullAXTree');
  if (!tree.result.nodes.some(node => !node.ignored && node.role?.value === role && node.name?.value === name)) {
    throw new Error(`真实可访问树缺少 ${role}：${name}`);
  }
}

export async function runSiteI18nAccessibilityContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-selection-pane.pptx', '<无障碍 & 原文>.pptx');
  await selectPaneObject(context, '对象 & <一>');
  await waitFor(`document.querySelector('#objectList [role="tree"]').getAttribute('aria-label') === 'Objects on this slide'
    && document.querySelector('[data-pane-element][aria-selected="true"]').getAttribute('aria-label') === '对象 & <一>, Shape, Visible, Unlocked'`, '选择窗格英文可访问名称');
  await evaluate(`globalThis.__sitePaneIdentity = {
    tree: document.querySelector('#objectList [role="tree"]'),
    row: document.querySelector('[data-pane-element][aria-selected="true"]'),
    canvas: document.querySelector('#canvasMount').firstElementChild,
  }`);
  await accessibleName(request, 'treeitem', '对象 & <一>, Shape, Visible, Unlocked');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector('[data-pane-element][aria-selected="true"]').getAttribute('aria-label') === '对象 & <一>，形状，可见，未锁定'`, '对象标签切回中文但保留原名');
  if (!await evaluate(`document.querySelector('#objectList [role="tree"]') === globalThis.__sitePaneIdentity.tree
    && document.querySelector('[data-pane-element][aria-selected="true"]') === globalThis.__sitePaneIdentity.row
    && document.querySelector('#canvasMount').firstElementChild === globalThis.__sitePaneIdentity.canvas
    && document.querySelector('#undo').disabled
    && document.querySelector('[data-pane-element][aria-selected="true"] [data-pane-name]').textContent === '对象 & <一>'`)) {
    throw new Error('可访问名称切语言重建视图、丢失选择、产生历史或改写对象原名');
  }
  await accessibleName(request, 'treeitem', '对象 & <一>，形状，可见，未锁定');
  await rename(context);
  await groupActions(context);
}

async function rename(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await evaluate('globalThis.__sitePaneIdentity.row.focus()');
  await key(request, 'F2', 'F2', 113);
  await waitFor(`document.querySelector('[data-pane-element] input')?.getAttribute('aria-label') === 'Rename 对象 & <一>'`, 'F2 重命名英文名称');
  await accessibleName(request, 'textbox', 'Rename 对象 & <一>');
  await request('Input.insertText', { text: '<改名 & 原文>' });
  await evaluate('document.activeElement.setSelectionRange(1, 3)');
  await evaluate('globalThis.__siteRenameInput = document.activeElement');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.activeElement === globalThis.__siteRenameInput
    && document.activeElement.value === '<改名 & 原文>'
    && document.activeElement.selectionStart === 1 && document.activeElement.selectionEnd === 3
    && document.activeElement.getAttribute('aria-label') === '重命名 对象 & <一>'
    && document.querySelector('#undo').disabled`, '切语言保留重命名焦点和未提交草稿');
  await accessibleName(request, 'textbox', '重命名 对象 & <一>');
  await request('Emulation.setTouchEmulationEnabled', { enabled: true });
  try {
    const point = await evaluate(`(() => {
      const rect = document.querySelector('[data-site-locale="en"]').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await request('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFor(`document.activeElement === globalThis.__siteRenameInput
      && document.activeElement.value === '<改名 & 原文>'
      && document.activeElement.selectionStart === 1 && document.activeElement.selectionEnd === 3
      && document.activeElement.getAttribute('aria-label') === 'Rename 对象 & <一>'
      && document.querySelector('#undo').disabled`, '触屏切语言保留重命名草稿与光标');
  } finally { await request('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  await click('[data-site-locale="zh-CN"]');
  await key(request, 'Enter', 'Enter', 13);
  await waitFor(`globalThis.__sitePaneIdentity.row.getAttribute('aria-label') === '<改名 & 原文>，形状，可见，未锁定'`, '重命名后更新可访问名称');
  await click('[data-site-locale="en"]');
  await click('#undo');
  await waitFor(`globalThis.__sitePaneIdentity.row.getAttribute('aria-label') === '对象 & <一>, Shape, Visible, Unlocked'
    && document.querySelector('#undo').disabled`, '切语言不产生额外历史');
  await click('#redo');
  await waitFor(`globalThis.__sitePaneIdentity.row.getAttribute('aria-label') === '<改名 & 原文>, Shape, Visible, Unlocked'`, '重做恢复名称与英文标签');
  await captureSaveAndReopen(context, 'pane-renamed.pptx');
  await selectPaneObject(context, '<改名 & 原文>');
  await waitFor(`document.querySelector('[data-pane-element][aria-selected="true"]').getAttribute('aria-label') === '<改名 & 原文>, Shape, Visible, Unlocked'`, '保存重开保留原文而不写入翻译');
  await evaluate(`document.querySelector('[data-pane-element][aria-selected="true"]').focus()`);
  await key(request, 'F2', 'F2', 113);
  await waitFor(`!!document.querySelector('[data-pane-element] input')`, '再次重命名');
  await request('Input.insertText', { text: '取消此草稿' });
  await click('[data-site-locale="zh-CN"]');
  await key(request, 'Escape', 'Escape', 27);
  await waitFor(`!document.querySelector('[data-pane-element] input')
    && document.querySelector('[data-pane-element][aria-selected="true"] [data-pane-name]').textContent === '<改名 & 原文>'
    && document.querySelector('#undo').disabled`, '切语言后 Esc 取消不改名称和历史');
  await click('[data-site-locale="en"]');
}

async function groupActions(context) {
  const { evaluate, click, waitFor, request } = context;
  const row = async (name) => `[data-pane-element=${JSON.stringify(await evaluate(`
    [...document.querySelectorAll('[data-pane-element]')].find(node =>
      node.querySelector('[data-pane-name]')?.textContent === ${JSON.stringify(name)}).dataset.paneElement`))}]`;
  const outer = await row('pane-outer-group'), child = await row('pane-child');
  const expand = `${outer} [data-pane-action="expand"]`;
  const visibility = `${outer} [data-pane-action="visibility"]`;
  const lock = `${outer} [data-pane-action="lock"]`;
  await waitFor(`document.querySelector(${JSON.stringify(expand)}).getAttribute('aria-label') === 'Collapse pane-outer-group'`, '组合折叠按钮英文名称');
  await accessibleName(request, 'button', 'Collapse pane-outer-group');
  await evaluate(`document.querySelector(${JSON.stringify(outer)}).focus()`);
  await key(request, 'ArrowLeft', 'ArrowLeft', 37);
  await waitFor(`document.querySelector(${JSON.stringify(expand)}).getAttribute('aria-label') === 'Expand pane-outer-group'
    && document.querySelector(${JSON.stringify(child)}).hidden && document.querySelector('#undo').disabled`, '键盘折叠同步可访问名称且不产生历史');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector(${JSON.stringify(expand)}).getAttribute('aria-label') === '展开 pane-outer-group'`, '折叠状态切中文');
  await evaluate(`document.querySelector(${JSON.stringify(outer)}).focus()`);
  await key(request, 'ArrowRight', 'ArrowRight', 39);
  await waitFor(`document.querySelector(${JSON.stringify(expand)}).getAttribute('aria-label') === '折叠 pane-outer-group'
    && !document.querySelector(${JSON.stringify(child)}).hidden`, '键盘展开后仍使用当前语言');
  await key(request, ' ', 'Space', 32);
  await waitFor(`document.querySelector(${JSON.stringify(visibility)}).getAttribute('aria-label') === '显示对象：pane-outer-group'
    && document.querySelector(${JSON.stringify(child + ' [data-pane-action="visibility"]')}).title === '由上级隐藏'
    && document.querySelector(${JSON.stringify(child + ' [data-pane-action="visibility"]')}).disabled`, '隐藏继承中文标签与禁用状态');
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector(${JSON.stringify(visibility)}).getAttribute('aria-label') === 'Show object: pane-outer-group'
    && document.querySelector(${JSON.stringify(child)}).getAttribute('aria-label') === 'pane-child, Shape, Hidden, Unlocked'
    && document.querySelector(${JSON.stringify(child + ' [data-pane-action="visibility"]')}).getAttribute('aria-label') === 'Hidden by parent: pane-child'`, '隐藏继承英文名称保留原文');
  await accessibleName(request, 'button', 'Hidden by parent: pane-child');
  await click('#undo');
  await click(lock);
  await waitFor(`document.querySelector(${JSON.stringify(lock)}).getAttribute('aria-label') === 'Unlock object: pane-outer-group'
    && document.querySelector(${JSON.stringify(child + ' [data-pane-action="lock"]')}).getAttribute('aria-label') === 'Locked by parent: pane-child'
    && document.querySelector(${JSON.stringify(child + ' [data-pane-action="lock"]')}).disabled`, '锁定继承英文名称与禁用状态');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector(${JSON.stringify(child)}).getAttribute('aria-label') === 'pane-child，形状，可见，已锁定'
    && document.querySelector(${JSON.stringify(lock)}).title === '解锁对象'`, '锁定状态切中文');
  await click('#undo');
  await click('#viewMode');
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector(${JSON.stringify(visibility)}).disabled
    && document.querySelector(${JSON.stringify(lock)}).disabled
    && document.querySelector(${JSON.stringify(lock)}).getAttribute('aria-label') === 'Lock object: pane-outer-group'`, '只读控件仍保留双语名称');
  await click('#nextSlide');
  await waitFor(`document.querySelector('[data-pane-element]').getAttribute('aria-label') === 'pane-second-slide, Shape, Visible, Unlocked'`, '切页重建行也绑定当前语言');
  await click('[data-site-locale="zh-CN"]');
  await click('#prevSlide');
  await click('#editMode');
  await waitFor(`document.querySelector(${JSON.stringify(lock)}).getAttribute('aria-label') === '锁定对象：pane-outer-group'
    && !document.querySelector(${JSON.stringify(lock)}).disabled && document.querySelector('#undo').disabled`, '切页与模式往返不污染历史');
}
