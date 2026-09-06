import { runSiteEditorLanguageContract } from './site-editor-language-contract.mjs';
import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';
import { runSiteI18nFilesContract } from './site-i18n-files-contract.mjs';
import { runSiteI18nErrorsContract, runSiteI18nConversionContract } from './site-i18n-errors-contract.mjs';
import { runSiteI18nTemplateContract } from './site-i18n-template-contract.mjs';
import { runSiteI18nRecoveryContract } from './site-i18n-recovery-contract.mjs';
import { runSiteI18nStartupContract, runSiteI18nDictionaryFailureContract } from './site-i18n-startup-contract.mjs';
import { runSiteI18nViewerContract } from './site-i18n-viewer-contract.mjs';
import { runSiteI18nGalleryContract } from './site-i18n-gallery-contract.mjs';
import { runSiteI18nMediaContract } from './site-i18n-media-contract.mjs';
import { runSiteI18nHomeContract } from './site-i18n-home-contract.mjs';
import { runSiteI18nChartContract } from './site-i18n-chart-contract.mjs';
import { runSiteI18nProductToolsContract } from './site-i18n-product-tools-contract.mjs';
import { runSiteI18nSlideToolsContract } from './site-i18n-slide-tools-contract.mjs';
import { runSiteI18nInspectorContract } from './site-i18n-inspector-contract.mjs';
import { runSiteI18nImageContract } from './site-i18n-image-contract.mjs';
import { runSiteI18nTextContract } from './site-i18n-text-contract.mjs';
import { runSiteI18nContentContract } from './site-i18n-content-contract.mjs';
import { runSiteI18nFeedbackContract } from './site-i18n-feedback-contract.mjs';
import { runSiteI18nAccessibilityContract } from './site-i18n-accessibility-contract.mjs';

export async function runSiteI18nProductionContract(context) {
  const only = process.env.SITE_I18N_ONLY;
  if (only) {
    const contract = { inspector: runSiteI18nInspectorContract, image: runSiteI18nImageContract,
      text: runSiteI18nTextContract, content: runSiteI18nContentContract, feedback: runSiteI18nFeedbackContract,
      slides: runSiteI18nSlideToolsContract, accessibility: runSiteI18nAccessibilityContract }[only];
    if (!contract) throw new Error(`未知的官网专项：${only}`);
    await contract(context); return;
  }
  const { evaluate, request, waitFor, click, dictionaryUrls } = context;
  if (await evaluate(`performance.getEntriesByType('resource').some((entry) =>
    ${JSON.stringify(dictionaryUrls)}.includes(new URL(entry.name).pathname))`)) {
    throw new Error('中文默认页面不应下载英文目录');
  }
  await runSiteI18nFilesContract(context);
  await runSiteI18nErrorsContract(context);
  await runSiteI18nConversionContract(context);
  await runSiteI18nTemplateContract(context);
  await runSiteI18nRecoveryContract(context);
  await runSiteI18nMediaContract(context);
  await runSiteI18nChartContract(context);
  await runSiteI18nProductToolsContract(context);
  await runSiteI18nSlideToolsContract(context);
  await runSiteI18nInspectorContract(context);
  await runSiteI18nImageContract(context);
  await runSiteI18nTextContract(context);
  await runSiteI18nContentContract(context);
  await runSiteI18nFeedbackContract(context);
  await runSiteI18nAccessibilityContract(context);
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
  await runSiteI18nStartupContract(context);
  await runSiteI18nDictionaryFailureContract(context);
  await runSiteI18nViewerContract(context);
  await runSiteI18nGalleryContract(context);
  await runSiteI18nHomeContract(context);
}
