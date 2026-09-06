import { changeValue, openFixture, selectPaneObject, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
import { doubleClickAt } from './browser-double-click.mjs';
import { withDelayedFileRead } from './file-read-boundary.mjs';

export async function runSiteI18nTextContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-text.pptx', '<文字 & 原文>.pptx');
  await selectText(context);
  await changeValue(context, '#textBulletKind', 'char');
  await click('#textBulletFont');
  await request('Input.insertText', { text: '<字体 & 原文>' });
  await evaluate(`(() => {
    const input = document.querySelector('#textBulletFont'); input.setSelectionRange(1, 3);
    input.dataset.languageChanges = '0';
    input.addEventListener('change', () => { input.dataset.languageChanges = '1'; }, { once: true });
  })()`);
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.activeElement === document.querySelector('#textBulletFont')
    && document.activeElement.value === '<字体 & 原文>' && document.activeElement.selectionStart === 1
    && document.activeElement.selectionEnd === 3 && document.activeElement.dataset.languageChanges === '0'
    && !document.querySelector('#textInspector').hidden`)) throw new Error('文字工具切语言提交了输入，或丢失原始字体/编辑选区');
  // 先以真实输入撤回尚未提交的草稿；点击撤销本身会 blur，不能用它判断切语言有无提交。
  await evaluate("document.querySelector('#textBulletFont').select()");
  await request('Input.insertText', { text: '' });
  await click('#undo');
  await waitFor("document.querySelector('#textBulletKind').value === 'none' && document.querySelector('#undo').disabled", '切语言未隐式提交字体输入');
  await click('#redo');
  await click('#textBulletChar'); await evaluate("document.querySelector('#textBulletChar').select()");
  await request('Input.insertText', { text: 'ab' });
  await click('#textFontSize');
  await waitFor("document.querySelector('#statusText').textContent === '项目符号必须是一个字符'", '真实输入非法项目符号');
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#statusText').textContent === 'A bullet must be one character'", '本地文字校验完整切英文');
  await click('#undo'); await waitFor("document.querySelector('#undo').disabled", '非法项目符号没有增加历史');
  await click('#redo');
  await click('#textBulletChar'); await evaluate("document.querySelector('#textBulletChar').select()");
  await request('Input.insertText', { text: '→' });
  await click('#textFontSize');
  await waitFor("document.querySelector('#statusText').textContent === 'Bullets updated'", '合法项目符号恢复成功状态');
  await changeValue(context, '#textBulletFont', '<字体 & 原文>');
  await evaluate(`(() => {
    const files = new DataTransfer(); files.items.add(new File(['not an image'], '不支持.txt', { type: 'text/plain' }));
    const input = document.querySelector('#textBulletImageInput'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#statusText').textContent === 'Picture bullets support PNG, JPEG, GIF or WebP only'", '图片项目符号类型英文校验');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '图片项目符号仅支持 PNG、JPEG、GIF 或 WebP'", '图片项目符号校验切中文');
  if (!await evaluate("document.querySelector('#textBulletChar').value === '→' && document.querySelector('#textBulletFont').value === '<字体 & 原文>'")) throw new Error('文字校验改变了有效样式');
  await withDelayedFileRead(context, '项目符号.png', async (read) => {
    await uploadBullet(context); await read.wait();
    await click('[data-site-locale="en"]'); await read.finish();
    await waitFor("document.querySelector('#textBulletKind').value === 'image' && document.querySelector('#statusText').textContent === 'Bullets updated'", '合法图片项目符号清除旧错误');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent === '项目符号已更新'", '图片项目符号成功状态切中文');
    await click('#undo'); await waitFor("document.querySelector('#textBulletChar').value === '→'", '图片项目符号撤销恢复原样式');
  });
  await changeValue(context, '#textUnderlineStyle', 'wavyDbl');
  await changeValue(context, '#textStrikeStyle', 'dblStrike');
  await click('[data-site-locale="en"]');
  if (!await evaluate(`document.querySelector('#textUnderlineStyle').selectedOptions[0].textContent === 'Double wavy'
    && document.querySelector('#textStrikeStyle').value === 'dblStrike'
    && document.querySelector('#textBulletFont').value === '<字体 & 原文>'`)) throw new Error('字符格式枚举或原始字体被翻译');
  await click('#textClearFormat');
  await waitFor("document.querySelector('#textUnderlineStyle').value !== 'wavyDbl'", '双语清除字符格式');
  await click('#undo'); await waitFor("document.querySelector('#textUnderlineStyle').value === 'wavyDbl'", '清除字符格式撤销');
  await captureSaveAndReopen(context, 'text-language-saved.pptx');
  await selectText(context);
  if (!await evaluate(`document.querySelector('#textBulletChar').value === '→'
    && document.querySelector('#textBulletFont').value === '<字体 & 原文>'
    && document.querySelector('#textUnderlineStyle').value === 'wavyDbl'
    && document.querySelector('#textStrikeStyle').value === 'dblStrike'
    && document.querySelector('#undo').disabled && document.querySelector('[data-ppt-text-editor]').textContent.includes('同')`)) throw new Error('双语文字样式或原文未保存重开');
  await withDelayedFileRead(context, '项目符号.png', async (read) => {
    await uploadBullet(context); await read.wait();
    await selectText(context, '中段格式');
    await click('[data-site-locale="zh-CN"]'); await read.finish();
    await waitFor("document.querySelector('#statusText').textContent === '编辑状态已变化，请重新选择图片项目符号'", '迟到图片项目符号不写入新选区');
    if (!await evaluate(`document.querySelector('#textBulletKind').value === 'none' && document.querySelector('#undo').disabled
      && document.querySelector('#textBulletImageInput').value === ''`)) throw new Error('迟到图片改变新选区/历史，或未允许重选同一文件');
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('#statusText').textContent === 'Editing state changed; select the picture bullet again'", '选区变化提示切英文');
  });
  await withDelayedFileRead(context, '项目符号.png', async (read) => {
    await uploadBullet(context); await read.wait();
    await uploadBullet(context); await read.wait(2);
    await evaluate("globalThis.__chosenBulletFile = document.querySelector('#textBulletImageInput').files[0]");
    try {
      await read.finish();
      if (!await evaluate(`document.querySelector('#textBulletImageInput').files[0] === globalThis.__chosenBulletFile
        && document.querySelector('#undo').disabled && document.querySelector('#textBulletKind').value === 'none'`)) throw new Error('过期图片读取清除了新文件选择或写入旧结果');
      await read.finish(1);
      await waitFor("document.querySelector('#textBulletKind').value === 'image' && document.querySelector('#statusText').textContent === 'Bullets updated'", '最新图片项目符号正常应用');
      await click('#undo'); await waitFor("document.querySelector('#undo').disabled", '并发图片读取仅最新任务产生历史');
    } finally { await evaluate('delete globalThis.__chosenBulletFile'); }
  });
}

async function uploadBullet({ evaluate }) {
  await evaluate(`(async () => {
    const bytes = await fetch('/assets/replacement.png').then((response) => response.arrayBuffer());
    const files = new DataTransfer(); files.items.add(new File([bytes], '项目符号.png', { type: 'image/png' }));
    const input = document.querySelector('#textBulletImageInput'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
}

async function selectText(context, name = '重复格式') {
  const { evaluate, request, waitFor } = context;
  await selectPaneObject(context, name);
  await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
  const point = await evaluate(`(() => {
    const id = document.querySelector('[data-pane-element][aria-selected="true"]').dataset.paneElement;
    const rect = document.querySelector('[data-edit-id="' + CSS.escape(id) + '"]').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await doubleClickAt(context, point);
  await waitFor("!!document.querySelector('[data-ppt-text-editor]') && !document.querySelector('#textInspector').hidden", '真实双击进入文字编辑');
  const key = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 4 };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}
