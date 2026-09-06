import { captureSaveAndReopen, openFixture } from './site-editor-browser-helpers.mjs';
import { doubleClickElement } from './browser-double-click.mjs';

export async function runSiteI18nPlaceholderContract(context) {
  const { evaluate, click, waitFor, request } = context;
  const hint = (type) => `document.querySelector('[data-edit-placeholder-type="${type}"] + text')?.textContent`;
  const escape = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await request('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
  };
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-add-slide.pptx', '<占位符 & 原文>.pptx');
  if (!await evaluate(`document.querySelector('#canvasMount').textContent.includes('现有页面')`)) throw new Error('占位符提示翻译不能改变真实页面文字');
  await click('#addSlide');
  await waitFor(`${hint('title')} === 'Add title' && ${hint('body')} === 'Add body text' && ${hint('pic')} === 'Add picture'`, '空占位符英文提示');
  await evaluate(`globalThis.__placeholderLanguage = {
    canvas: document.querySelector('#canvasMount').firstElementChild,
    title: document.querySelector('[data-edit-placeholder-type="title"]'),
    hint: document.querySelector('[data-edit-placeholder-type="title"] + text'),
  }`);
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`${hint('title')} === '添加标题' && ${hint('body')} === '添加正文' && ${hint('pic')} === '添加图片'`, '空占位符中文提示');
  if (!await evaluate(`globalThis.__placeholderLanguage.canvas === document.querySelector('#canvasMount').firstElementChild
    && globalThis.__placeholderLanguage.title === document.querySelector('[data-edit-placeholder-type="title"]')
    && globalThis.__placeholderLanguage.hint === document.querySelector('[data-edit-placeholder-type="title"] + text')`)) {
    throw new Error('切语言重建了占位符命中框或画布');
  }
  await click('#viewMode');
  await waitFor("!document.querySelector('[data-edit-placeholder-layer]')", '查看模式不暴露编辑提示');
  await click('[data-site-locale="en"]');
  await click('#editMode');
  await click('#zoomIn');
  await waitFor(`${hint('title')} === 'Add title'`, '模式与缩放重建仍使用当前语言');
  await doubleClickElement(context, '[data-edit-placeholder-type="title"]');
  await waitFor("!!document.querySelector('[data-ppt-text-editor]')", '空占位符真实双击编辑');
  await request('Input.insertText', { text: '<占位符 & 原文>' });
  await escape();
  await waitFor(`!document.querySelector('[data-edit-placeholder-type="title"]')
    && document.querySelector('#canvasMount [data-ppt-layer="static"]').textContent.includes('<占位符 & 原文>')`, '实际文字替代产品提示');
  await click('#undo');
  await escape();
  await waitFor(`${hint('title')} === 'Add title'`, '撤销输入恢复空占位符提示');
  await click('#redo');
  await escape();
  await captureSaveAndReopen(context, 'placeholder-labels-saved.pptx');
  await click('#nextSlide');
  await waitFor(`document.querySelector('#canvasMount [data-ppt-layer="static"]').textContent.includes('<占位符 & 原文>')
    && !document.querySelector('[data-edit-placeholder-type="title"]') && ${hint('body')} === 'Add body text'
    && document.querySelector('#undo').disabled`, '保存只写用户内容，重开重新绑定空提示');
  await evaluate('delete globalThis.__placeholderLanguage');
}
