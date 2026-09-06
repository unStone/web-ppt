import { openFixture, changeValue, selectPaneObject, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';

export async function runSiteI18nSlideToolsContract(context) {
  const { evaluate, click, waitFor } = context;
  await openFixture(context, '/fixtures/sample-editor-animations.pptx', '<动画 & 原文>.pptx');
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#transitionType option[value=\"fade\"]').textContent === 'Fade'", '切换效果英文名称');
  const types = await evaluate("[...document.querySelector('#transitionType').options].map((node) => node.value)");
  if (types.length !== 41 || !await evaluate("document.querySelector('#transitionType option[value=\"morph\"]').textContent === 'Morph' && document.querySelector('#animationEffect option[value=\"appear\"]').textContent === 'Appear'")) throw new Error('切换与动画目录没有完整显示产品名称');
  await changeValue(context, '#transitionType', 'split');
  await changeValue(context, '#transitionDirection', 'vert-in');
  if (!await evaluate("document.querySelector('#transitionDirection option[value=\"vert-in\"]').textContent === 'Vertical in'")) throw new Error('切换方向英文名称缺失');
  await evaluate("globalThis.__transitionOptions = [...document.querySelector('#transitionType').options]");
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.querySelector('#transitionType').value === 'split'
    && document.querySelector('#transitionDirection').value === 'vert-in'
    && document.querySelector('#transitionDirection option[value="vert-in"]').textContent === '垂直向内'
    && document.querySelector('#transitionDirection option[value=""]').textContent === '默认'
    && [...document.querySelector('#transitionType').options].every((node, i) => node === globalThis.__transitionOptions[i] && /\\p{Script=Han}/u.test(node.textContent))
    && document.querySelector('#undo').disabled`)) throw new Error('切语言重建选项、丢失未应用参数或缺少中文名称');
  await click('[data-site-locale="en"]');
  if (JSON.stringify(await evaluate("[...document.querySelector('#transitionType').options].map((node) => node.value)")) !== JSON.stringify(types)) throw new Error('产品翻译改写了切换枚举');
  await click('#slideList [data-slide-id]:nth-child(2)');
  await changeValue(context, '#animationKind', 'emphasis');
  if (!await evaluate("document.querySelector('#animationEffect').options.length === 2 && document.querySelector('#animationEffect option[value=\"spin\"]').textContent === 'Spin' && document.querySelector('#animationEffect option[value=\"grow\"]').textContent === 'Grow/shrink'")) throw new Error('强调效果动态选项没有翻译');
  await changeValue(context, '#animationKind', 'entrance');
  await changeValue(context, '#transitionType', 'none');
  await click('[data-site-locale="zh-CN"]');
  await changeValue(context, '#transitionType', 'split');
  if (!await evaluate("document.querySelector('#transitionDirection option[value=\"vert-in\"]').textContent === '垂直向内'")) throw new Error('方向选项在隐藏期间切语言，重新显示时仍是旧语言');
  await changeValue(context, '#animationKind', 'emphasis');
  if (!await evaluate("document.querySelector('#animationEffect option[value=\"spin\"]').textContent === '旋转' && document.querySelector('#animationEffect option[value=\"grow\"]').textContent === '放大/缩小'")) throw new Error('强调选项在隐藏期间切语言，重新显示时仍是旧语言');
  await click('[data-site-locale="en"]');
  await runPageEdits(context);
  await runTimeline(context);
}

async function runTimeline(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('#slideList [data-slide-id]:nth-child(1)');
  await waitFor("document.querySelector('#animationTimeline li:last-child > span').textContent === '3. source-a · Motion path'", '来源运动路径英文时间线');
  if (!await evaluate("!document.querySelector('#animationReadonly').hidden && document.querySelector('#addAnimation').disabled && !document.querySelector('#previewTimeline').disabled && [...document.querySelectorAll('#animationTimeline button')].every((node) => node.disabled)")) throw new Error('翻译不得解除来源动画只读限制');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#animationTimeline li:last-child > span').textContent === '3. source-a · 运动路径'", '来源运动路径切中文');
  await click('#slideList [data-slide-id]:nth-child(2)');
  await selectPaneObject(context, 'plain-a');
  await evaluate("document.querySelector('[data-pane-element][aria-selected=\"true\"] [data-pane-name]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
  await request('Input.insertText', { text: '<复制 & 目标>' });
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await changeValue(context, '#animationKind', 'emphasis');
  await changeValue(context, '#animationEffect', 'spin');
  await click('[data-site-locale="en"]');
  await click('#addAnimation');
  await waitFor("document.querySelector('#statusText').textContent === 'Animation timeline updated' && document.querySelector('#animationTimeline li > span').textContent === '1. <复制 & 目标> · Emphasis/Spin'", '添加动画并保留目标原名');
  await evaluate("globalThis.__timelineLanguageRow = document.querySelector('#animationTimeline li')");
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.querySelector('#animationTimeline li') === globalThis.__timelineLanguageRow
    && document.querySelector('#animationTimeline li > span').textContent === '1. <复制 & 目标> · 强调/旋转'
    && document.querySelector('#animationTimeline li > span').children.length === 0
    && document.querySelector('#animationTimeline li button:nth-child(3)').getAttribute('aria-label') === '删除动画：1. <复制 & 目标> · 强调/旋转'
    && document.querySelector('#statusText').textContent === '动画时间线已更新'`)) throw new Error('动画切语言重建行、解释原名为 HTML 或缺少可访问操作名称');
  await click('[data-site-locale="en"]');
  const target = await evaluate("[...document.querySelector('#animationTarget').options].find((node) => node.textContent === 'plain-b').value");
  await changeValue(context, '#animationTarget', target);
  await changeValue(context, '#animationKind', 'entrance');
  await changeValue(context, '#animationEffect', 'fade');
  await click('#addAnimation');
  await waitFor("document.querySelectorAll('#animationTimeline li').length === 2", '英文新增第二个动画');
  await click('#animationTimeline li:first-child button:nth-child(2)');
  await waitFor("document.querySelector('#animationTimeline li:first-child > span').textContent === '1. plain-b · Entrance/Fade'", '双语时间线下移');
  await click('#animationTimeline li:last-child button:first-child');
  await waitFor("document.querySelector('#animationTimeline li:first-child > span').textContent === '1. <复制 & 目标> · Emphasis/Spin'", '双语时间线上移');
  await click('#animationTimeline li:first-child button:nth-child(3)');
  await waitFor("document.querySelectorAll('#animationTimeline li').length === 1", '双语删除动画');
  await click('#undo'); await waitFor("document.querySelectorAll('#animationTimeline li').length === 2", '删除动画撤销');
  await click('#redo'); await waitFor("document.querySelectorAll('#animationTimeline li').length === 1", '删除动画重做');
  await click('#undo');
  await captureSaveAndReopen(context, 'slide-language-saved.pptx');
  await click('#slideList [data-slide-id]:nth-child(2)');
  await waitFor("document.querySelectorAll('#animationTimeline li').length === 2 && document.querySelector('#slideNotes').value === '<复制 & 演讲者备注>'", '双语页面工具保存重开');
  if (!await evaluate("document.querySelector('#transitionType').value === 'split' && document.querySelector('#transitionDirection').value === 'vert-in' && document.querySelector('#transitionDuration').value === '920' && document.querySelector('#animationTimeline li > span').textContent === '1. <复制 & 目标> · Emphasis/Spin' && document.querySelector('#undo').disabled")) throw new Error('保存重开丢失页面参数、目标名称或动画顺序');
}

async function runPageEdits(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('#slideNotes');
  await request('Input.insertText', { text: '<复制 & 演讲者备注>' });
  await evaluate('document.activeElement.setSelectionRange(1, 3)');
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.activeElement === document.querySelector('#slideNotes')
    && document.activeElement.value === '<复制 & 演讲者备注>' && document.activeElement.selectionStart === 1
    && document.activeElement.selectionEnd === 3 && document.querySelector('#undo').disabled`)) throw new Error('切语言丢失未保存备注或光标');
  await click('[data-site-locale="en"]');
  await click('#applyNotes');
  await waitFor("document.querySelector('#statusText').textContent === 'Notes saved'", '备注保存英文状态');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '备注已保存'", '备注保存切中文');
  await click('#undo'); await waitFor("document.querySelector('#slideNotes').value === ''", '备注原文撤销');
  await click('#redo'); await waitFor("document.querySelector('#slideNotes').value === '<复制 & 演讲者备注>'", '备注原文重做');
  await changeValue(context, '#transitionType', 'split');
  await changeValue(context, '#transitionDirection', 'vert-in');
  await changeValue(context, '#transitionDuration', '920');
  await click('[data-site-locale="en"]');
  await click('#applyTransition');
  await waitFor("document.querySelector('#statusText').textContent === 'Slide transition updated'", '页面切换英文成功');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '页面切换已更新'", '页面切换成功切中文');
  await click('#undo'); await waitFor("document.querySelector('#transitionType').value === 'none'", '切换参数撤销');
  await click('#redo');
  await waitFor("document.querySelector('#transitionType').value === 'split' && document.querySelector('#transitionDirection').value === 'vert-in' && document.querySelector('#transitionDuration').value === '920'", '切换参数重做');
  await changeValue(context, '#transitionDuration', '79');
  await click('#applyTransition');
  await waitFor("document.querySelector('#statusText').textContent.startsWith('页面操作失败：') && document.querySelector('#statusText').textContent.includes('durationMs')", '真实引擎拒绝过短时长');
  const detail = await evaluate("document.querySelector('#statusText').textContent.slice('页面操作失败：'.length)");
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector('#statusText').textContent === ${JSON.stringify('Slide action failed: ' + detail)}`, '页面错误摘要切语言保留诊断');
  await click('#undo'); await waitFor("document.querySelector('#transitionType').value === 'none'", '失败没有插入历史');
  await click('#redo'); await waitFor("document.querySelector('#transitionDuration').value === '920'", '失败后仍可重做合法参数');
}
