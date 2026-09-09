import { openFixture } from './site-editor-browser-helpers.mjs';

export async function runSiteI18nFeedbackContract(context) {
  await runPreview(context);
  await runTouch(context);
  await runError(context);
}

async function runPreview(context) {
  const { evaluate, click, waitFor } = context;
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-animations.pptx', '<动画 & 原文>.pptx');
  // 只控制原生 WAAPI 时钟，不替换 SDK 预览或完成 Promise。
  await evaluate(`(() => {
    const original = Element.prototype.animate;
    const boundary = globalThis.__sitePreviewClock = { animations: [], restore: () => { Element.prototype.animate = original; } };
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (this.closest('#canvasMount')) { animation.pause(); boundary.animations.push(animation); }
      return animation;
    };
  })()`);
  const start = async () => {
    await evaluate('globalThis.__sitePreviewClock.animations = []');
    await click('#playAnimations');
    await waitFor('globalThis.__sitePreviewClock.animations.length === 3', '真实来源动画已创建');
  };
  const finish = () => evaluate(`globalThis.__sitePreviewClock.animations.forEach(animation => {
    if (animation.playState !== 'idle') animation.finish();
  })`);
  const expect = (text, label) => waitFor(`document.querySelector('#statusText').textContent === ${JSON.stringify(text)}`, label);
  try {
    await start();
    await expect('Playing animations on this slide', '动画执行期间立即显示英文进度');
    await click('[data-site-locale="zh-CN"]');
    await expect('正在播放当前页元素动画', '播放中切中文');
    if (!await evaluate(`globalThis.__sitePreviewClock.animations.every(animation => animation.playState === 'paused')
      && document.querySelector('#undo').disabled`)) throw new Error('语言切换中断动画或产生历史');
    await finish();
    await expect('动画预览已结束', '真实完成后不再显示正在播放');
    await click('[data-site-locale="en"]');
    await expect('Animation preview ended', '完成状态切英文');

    await start();
    await start();
    await expect('Playing animations on this slide', '旧预览取消不能覆盖新预览进度');
    await finish();
    await expect('Animation preview ended', '重复预览安全完成');

    await start();
    await click('#viewMode');
    await expect('Preview mode: follow links and play animations', '取消预览保留模式切换状态');
    await finish();
    await expect('Preview mode: follow links and play animations', '旧预览结束不能覆盖新操作');
    await click('#nextSlide'); await click('#playAnimations');
    await expect('This slide has no playable animations', '无动画页英文反馈');
    await click('[data-site-locale="zh-CN"]');
    await expect('当前页没有可播放的元素动画', '无动画页中文反馈');

    await click('#prevSlide'); await click('#editMode'); await start();
    await openFixture(context, '/fixtures/sample-editor-touch.pptx', '<触屏 & 原文>.pptx');
    await finish();
    await expect('<触屏 & 原文>.pptx 已就绪，可直接选择、拖动或双击编辑文字', '旧预览不能覆盖新文稿状态');
    if (!await evaluate("document.querySelector('#undo').disabled && !document.querySelector('#fileName').textContent.startsWith('●')")) throw new Error('预览写入文稿历史');
  } finally {
    await evaluate('globalThis.__sitePreviewClock.restore(); delete globalThis.__sitePreviewClock');
  }
}

async function runTouch(context) {
  const { request, evaluate, click, waitFor } = context;
  await click('[data-site-locale="en"]');
  await request('Emulation.setTouchEmulationEnabled', { enabled: true });
  const longPress = async (blank, text) => {
    const point = await evaluate(`(() => {
      const row = [...document.querySelectorAll('[data-pane-element]')]
        .find(node => node.querySelector('[data-pane-name]')?.textContent === 'touch-neighbour');
      const node = ${blank} ? document.querySelector('#canvasMount [data-ppt-layer="static"] svg')
        : document.querySelector('[data-edit-id="' + row.dataset.paneElement + '"]');
      const rect = node.getBoundingClientRect();
      return ${blank} ? { x: rect.right - 15, y: rect.bottom - 15 }
        : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await request('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...point }] });
    try { await waitFor(`document.querySelector('#statusText').textContent === ${JSON.stringify(text)}`, '真实长按反馈'); }
    finally { await request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  };
  try {
    await longPress(false, 'Object selected by long press; continue in the formatting panel');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent === '已长按选择对象；可用格式面板继续操作'", '对象长按反馈切中文');
    if (!await evaluate(`document.querySelector('[data-pane-element][aria-selected="true"] [data-pane-name]')?.textContent === 'touch-neighbour'
      && document.querySelector('#undo').disabled`)) throw new Error('长按切语言丢失选择或产生历史');
    await longPress(true, '已长按画布');
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('#statusText').textContent === 'Canvas long press detected'", '空白画布长按反馈切英文');
  } finally { await request('Emulation.setTouchEmulationEnabled', { enabled: false }); }
}

async function runError({ evaluate, click, waitFor }) {
  await evaluate(`(() => {
    const dataTransfer = new DataTransfer();
    const source = document.querySelector('[data-slide-id]');
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    dataTransfer.setData('text/x-web-ppt-slide', '<不存在 & 原文>');
    source.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  })()`);
  await waitFor("document.querySelector('#statusText').textContent.startsWith('Action failed: ')", '真实非法页拖放的错误摘要');
  const detail = await evaluate("document.querySelector('#statusText').textContent.slice('Action failed: '.length)");
  await click('[data-site-locale="zh-CN"]');
  if (!detail || !await evaluate(`document.querySelector('#statusText').textContent === ${JSON.stringify('操作失败：' + detail)}
    && document.querySelector('#statusText').dataset.tone === 'error' && document.querySelector('#undo').disabled`)) {
    throw new Error('通用错误摘要未翻译、诊断原文被改写或失败产生历史');
  }
}
