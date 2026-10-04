import { openFixture } from './site-editor-browser-helpers.mjs';

export async function runSiteEditorSidePanelBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  await click('[data-site-locale="zh-CN"]');
  await openFixture(context, '/demo/showcase.pptx', 'showcase.pptx');
  await click('#slideList [data-slide-id]:nth-child(2)');
  await waitFor("document.querySelector('#pageIndicator').textContent.startsWith('2 / ')", '对象较多的示例页');
  const layout = await evaluate(`(() => {
    const list = document.querySelector('#objectList').getBoundingClientRect();
    const inspector = document.querySelector('#editorInspector').getBoundingClientRect();
    return { names: [...document.querySelectorAll('[data-pane-name]')].map((node) => node.textContent),
      listHeight: list.height, inspectorHeight: inspector.height };
  })()`);
  if (!layout.names.some((name) => /^(文字|形状) \d+/.test(name))
    || layout.listHeight < 96 || layout.inspectorHeight < 180) {
    throw new Error(`对象名称或双区高度异常：${JSON.stringify(layout)}`);
  }
  await evaluate(`(() => {
    const search = document.querySelector('#objectSearch');
    search.value = 'sp'; search.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("document.querySelectorAll('[data-search-match]').length > 0", '对象列表查找结果');
  await click('#objectSearchNext');
  await waitFor("!!document.querySelector('[data-search-current][aria-selected=true]')", '查找命中并选择对象');
  if (!await evaluate("document.querySelector('#objectTaskTab').getAttribute('aria-selected') === 'true'")) {
    throw new Error('选择查找结果后未打开对象属性');
  }
  await evaluate(`(() => {
    const search = document.querySelector('#objectSearch');
    search.value = 'no-such-object-123'; search.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#objectSearchNext').disabled && document.querySelector('#objectSearchCount').textContent === '没有匹配对象'", '对象查找空结果');
  await evaluate(`(() => {
    const search = document.querySelector('#objectSearch');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  })()`);
  if (!await evaluate("document.querySelector('#objectSearch').value === '' && document.querySelectorAll('[data-search-match]').length === 0")) {
    throw new Error('取消查找后仍保留查询状态');
  }
  await click('#slideTaskTab');
  if (!await evaluate("!document.querySelector('#slideTaskPanel').hidden && document.querySelector('#objectTaskPanel').hidden")) {
    throw new Error('页面任务页签未切换面板');
  }
  await click('#presentTaskTab');
  if (!await evaluate("!document.querySelector('#presentTaskPanel').hidden && document.querySelector('#slideTaskPanel').hidden")) {
    throw new Error('放映任务页签未切换面板');
  }
  const resized = await evaluate(`(() => {
    const divider = document.querySelector('#objectDivider');
    const list = document.querySelector('#objectList');
    const before = list.getBoundingClientRect().height;
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    return { before, after: list.getBoundingClientRect().height, value: divider.getAttribute('aria-valuenow') };
  })()`);
  if (!(resized.after < resized.before - 5) || !resized.value) {
    throw new Error(`对象列表分界键盘调整失败：${JSON.stringify(resized)}`);
  }
  await click('#slideList [data-slide-id]:nth-child(1)');
  await click('#slideTaskTab');
  console.log('编辑器对象名称、列表查找、任务页签及可调分界通过');
}
