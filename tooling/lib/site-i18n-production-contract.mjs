import { runSiteEditorLanguageContract } from './site-editor-language-contract.mjs';
import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';

export async function runSiteI18nProductionContract(context) {
  const { evaluate, request, waitFor, click, dictionaryUrls } = context;
  if (await evaluate(`performance.getEntriesByType('resource').some((entry) =>
    ${JSON.stringify(dictionaryUrls)}.includes(new URL(entry.name).pathname))`)) {
    throw new Error('中文默认页面不应下载英文目录');
  }
  await runSiteEditorLanguageContract(context);
  const directory = await evaluate("new URL('.', location.href).href");
  for (const page of ['index', 'samples', 'editor']) {
    const url = `${directory}${page}.en.html`;
    await request('Page.navigate', { url });
    await waitFor(`location.href === ${JSON.stringify(url)} && document.documentElement.lang === 'en'
      && document.querySelector('[data-site-locale="en"]')?.getAttribute('aria-current') === 'true'`, `${page} 英文生产页面`);
    if (page === 'editor') {
      const ready = "document.querySelector('#canvasMount').firstElementChild && !document.querySelector('#editorApp').dataset.loading";
      await waitFor(`!document.querySelector('#recoveryPrompt').hidden || (${ready})`, '编辑页恢复决策或就绪');
      if (await evaluate("!document.querySelector('#recoveryPrompt').hidden")) await click('#discardRecovery');
      await waitFor(ready, '英文文稿完成打开');
    }
    if (await evaluate("/\\p{Script=Han}/u.test(document.title)")) throw new Error(`${page} 英文标题未翻译`);
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.documentElement.lang === 'zh-CN'", `${page} 生产页面切回中文`);
    if (page === 'index') {
      await waitFor("document.querySelector('.stats li:nth-child(3) i').textContent === '个'", '静态英文空译文切回中文仍恢复单位');
      if (!await evaluate("document.querySelector('h1').textContent === '纯浏览器渲染 PPT'")) {
        throw new Error('生产首页切回中文没有恢复标题');
      }
    }
    await click('[data-site-locale="en"]');
    await waitFor("document.documentElement.lang === 'en'", `${page} 再切英文`);
    await runSiteLanguageInputContract(context, page);
  }
}
