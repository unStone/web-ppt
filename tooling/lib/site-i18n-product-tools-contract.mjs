import { openFixture, captureSaveAndReopen, selectPaneObject } from './site-editor-browser-helpers.mjs';
import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';

export async function runSiteI18nProductToolsContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-find-replace.pptx', '<查找 & 原文>.pptx');
  await click('#replaceText');
  await waitFor("document.activeElement === document.querySelector('#searchQuery')", '查找输入获得焦点');
  await request('Input.insertText', { text: '不存在的词' });
  await waitFor("document.querySelector('#searchCount').value === '0 results'", '无匹配结果英文计数');
  await evaluate("document.querySelector('#searchQuery').select()");
  await request('Input.insertText', { text: 'Needle' });
  await waitFor("document.querySelector('#searchCount').value === '1 / 7'", '确定性文稿七处可编辑匹配');
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate("document.querySelector('#searchCount').value === '1 / 7' && document.querySelector('#searchQuery').value === 'Needle'")) {
    throw new Error('切语言恢复了静态计数或改写了搜索词');
  }
  await click('#searchReplacement');
  await request('Input.insertText', { text: '<复制 & 替换>' });
  await evaluate(`(() => {
    globalThis.__searchLanguageCanvas = document.querySelector('#canvasMount').firstElementChild;
    document.activeElement.setSelectionRange(1, 3);
  })()`);
  await click('[data-site-locale="en"]');
  if (!await evaluate(`document.activeElement === document.querySelector('#searchReplacement')
    && document.activeElement.value === '<复制 & 替换>' && document.activeElement.selectionStart === 1
    && document.activeElement.selectionEnd === 3 && document.querySelector('#undo').disabled
    && document.querySelector('#canvasMount').firstElementChild === globalThis.__searchLanguageCanvas`)) {
    throw new Error('查找工具切语言丢失真实输入、光标或重建了画布');
  }
  await runSiteLanguageInputContract(context, '查找与替换');
  await runInvalidSearchInput(context);
  await click('#searchNext');
  await waitFor("document.querySelector('#searchCount').value === '2 / 7'", '下一个匹配');
  await click('#searchPrevious');
  await waitFor("document.querySelector('#searchCount').value === '1 / 7'", '上一个匹配');
  await click('#replaceCurrent');
  await waitFor("document.querySelector('#statusText').textContent === 'Current match replaced'", '当前替换英文提示');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '已替换当前匹配'", '当前替换提示切中文');
  await click('#undo');
  await waitFor("document.querySelector('#searchCount').value.endsWith(' / 7')", '替换撤销恢复七处');
  await click('#redo');
  await waitFor("document.querySelector('#searchCount').value.endsWith(' / 6')", '替换重做保留六处');
  await click('[data-site-locale="en"]');
  await click('#replaceAll');
  await waitFor("document.querySelector('#statusText').textContent === 'Replaced 6 matches' && document.querySelector('#searchCount').value === '0 results'", '批量替换英文数量');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '已替换 6 处' && document.querySelector('#searchCount').value === '0 个结果'", '批量替换提示切中文');
  if (!await evaluate("document.querySelector('#replaceAll').disabled && document.querySelector('#searchQuery').value === 'Needle' && document.querySelector('#searchReplacement').value === '<复制 & 替换>'")) throw new Error('空结果禁用或原始输入错误');
  await click('#undo');
  await waitFor("document.querySelector('#searchCount').value.endsWith(' / 6')", '批量替换单步撤销');
  await click('#redo');
  await waitFor("document.querySelector('#searchCount').value === '0 个结果'", '批量替换单步重做');
  await captureSaveAndReopen(context, 'search-language-saved.pptx');
  await click('#findText');
  await waitFor("document.activeElement === document.querySelector('#searchQuery')", '重开后查找输入');
  await request('Input.insertText', { text: '<复制 & 替换>' });
  await waitFor("document.querySelector('#searchCount').value === '1 / 7'", '重开后原文替换内容七处');
  await click('#searchPrevious');
  await waitFor("document.querySelector('#searchCount').value === '7 / 7'", '跨页导航末条');
  const page = await evaluate("document.querySelector('#slideList [aria-current=\"true\"]')?.dataset.slideId");
  await click('[data-site-locale="en"]');
  if (!page || !await evaluate(`document.querySelector('#slideList [aria-current="true"]').dataset.slideId === ${JSON.stringify(page)}
    && document.querySelector('#searchCount').value === '7 / 7'
    && document.querySelector('#searchQuery').value === '<复制 & 替换>' && document.querySelector('#undo').disabled`)) throw new Error('切语言改变了跨页命中或历史');
  await click('#viewMode');
  await click('#replaceText');
  if (!await evaluate("document.querySelector('#replaceCurrent').disabled && document.querySelector('#replaceAll').disabled")) throw new Error('双语查看模式不得开放替换');
  await click('#editMode');
  await click('#closeSearch');
  await runPainter(context);
}

async function runInvalidSearchInput({ evaluate, click, waitFor, request }) {
  for (const [selector, valid, detail] of [
    ['#searchQuery', 'Needle', '文字搜索 query 必须是不含换行与公式占位符的字符串'],
    ['#searchReplacement', '<复制 & 替换>', '文字搜索 replacement 必须是不含换行与公式占位符的字符串'],
  ]) {
    await click(selector);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
    await request('Input.insertText', { text: '\uFFFC' });
    await waitFor(`document.querySelector('#statusText').textContent === ${JSON.stringify('Invalid text input: ' + detail)}`, '真实非法输入显示英文摘要与原始诊断');
    await click('[data-site-locale="zh-CN"]');
    if (!await evaluate(`document.querySelector(${JSON.stringify(selector)}).value === '\uFFFC'
      && document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-invalid') === 'true'
      && document.querySelector('#statusText').textContent === ${JSON.stringify('文字输入无效：' + detail)}
      && document.querySelector('#replaceCurrent').disabled && document.querySelector('#replaceAll').disabled
      && document.querySelector('#undo').disabled`)) throw new Error('无效输入未保留、未禁用替换或错误原文被翻译');
    if (selector === '#searchQuery' && !await evaluate(`document.querySelector('#searchNext').disabled
      && document.querySelector('#searchPrevious').disabled && document.querySelector('#searchCount').value === '查询无效'`)) {
      throw new Error('无效查询仍展示或导航旧命中');
    }
    const page = await evaluate("document.querySelector('#slideList [aria-current=\"true\"]').dataset.slideId");
    await evaluate("document.querySelector('#canvasMount [data-text-search]').focus()");
    const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    for (const modifiers of [8, 0]) {
      await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, ...enter });
      await request('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...enter });
      if (selector === '#searchQuery') {
        if (!await evaluate(`document.querySelector('#slideList [aria-current="true"]').dataset.slideId === ${JSON.stringify(page)}
          && document.querySelector('#canvasMount [data-text-search]').dataset.textSearchCount === '0'`)) {
          throw new Error('无效查询仍能用画布 Enter / Shift+Enter 导航旧命中');
        }
      } else {
        await waitFor(`document.querySelector('#searchCount').value === '${modifiers ? '7 / 7' : '1 / 7'}'`, '无效替换不影响合法查询的键盘导航');
      }
    }
    await click('#replaceAll');
    await click(selector);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
    await request('Input.insertText', { text: valid });
    await click('[data-site-locale="en"]');
    if (!await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-invalid') !== 'true'
      && !document.querySelector('#replaceCurrent').disabled && !document.querySelector('#replaceAll').disabled
      && !document.querySelector('#searchNext').disabled && document.querySelector('#searchCount').value === '1 / 7'
      && document.querySelector('#statusText').textContent === 'Input is valid again' && document.querySelector('#undo').disabled`)) {
      throw new Error('有效输入未恢复，或禁用替换仍然修改了文稿');
    }
  }
}

async function runPainter(context) {
  const { evaluate, click, waitFor, request } = context;
  await openFixture(context, '/fixtures/sample-editor-format-painter.pptx', '<格式 & 原文>.pptx');
  await click('#formatPainter');
  await waitFor("document.querySelector('#statusText').textContent === 'Select one element or a text range first'", '格式刷无来源英文提示');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '请先单选一个元素，或在文字编辑中选择一段文字'", '格式刷无来源中文提示');
  await selectPaneObject(context, 'format-source');
  await click('#formatPainter');
  await waitFor("document.querySelector('#statusText').textContent === '格式刷已启用；点击一个目标应用'", '中文启用单次格式刷');
  await evaluate("globalThis.__painterLanguageCanvas = document.querySelector('#canvasMount').firstElementChild");
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#statusText').textContent === 'Format painter enabled; click a target to apply'", '单次格式刷状态切英文');
  if (!await evaluate(`document.querySelector('#formatPainter').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#canvasMount').firstElementChild === globalThis.__painterLanguageCanvas
    && document.querySelector('#undo').disabled`)) throw new Error('切语言丢失格式刷模式或引入历史');
  const target = await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')].find((item) => item.querySelector('[data-pane-name]').textContent === 'format-target-local');
    return '[data-edit-id="' + CSS.escape(row.dataset.paneElement) + '"]';
  })()`);
  const fill = `document.querySelector(${JSON.stringify(target + ' [fill]')}).getAttribute('fill')`;
  const before = await evaluate(fill);
  await click(target);
  await waitFor(`document.querySelector('#formatPainter').getAttribute('aria-pressed') === 'false' && ${fill} !== ${JSON.stringify(before)}`, '切语言后实际应用格式刷');
  if (!await evaluate(`document.querySelector(${JSON.stringify(target)}).textContent.includes('目标内容不变')`)) throw new Error('格式刷翻译或改写了目标文字');
  await click('#undo'); await waitFor(`${fill} === ${JSON.stringify(before)}`, '双语格式刷撤销');
  await click('#redo'); await waitFor(`${fill} !== ${JSON.stringify(before)}`, '双语格式刷重做');
  await selectPaneObject(context, 'format-source');
  await click('#formatPainterContinuous');
  await waitFor("document.querySelector('#statusText').textContent === 'Continuous format painter enabled; press Esc to exit'", '连续格式刷英文提示');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '连续格式刷已启用；按 Esc 退出'", '连续格式刷切中文');
  await click(target);
  if (!await evaluate("document.querySelector('#formatPainterContinuous').getAttribute('aria-pressed') === 'true'")) throw new Error('连续格式刷被语言切换取消');
  const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await waitFor("document.querySelector('#formatPainterContinuous').getAttribute('aria-pressed') === 'false'", '语言切换后真实 Escape 退出');
  await click('[data-site-locale="en"]');
}
