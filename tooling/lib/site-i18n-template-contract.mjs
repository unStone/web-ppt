import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';

export async function runSiteI18nTemplateContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await waitFor("document.documentElement.lang === 'en'", '模板流程使用英文');
  await click('#newFile');
  await waitFor("document.querySelector('#templateDialog')?.open", '按需模板对话框');
  await waitFor("document.querySelector('#templateDialogTitle').textContent === 'New presentation'", '英文模板标题');
  const before = await evaluate(`(() => {
    globalThis.__languageTemplateDialog = document.querySelector('#templateDialog');
    globalThis.__languageTemplateCanvas = document.querySelector('#canvasMount').firstElementChild;
    return document.querySelector('#fileName').textContent;
  })()`);
  const cards = await evaluate("[...document.querySelectorAll('.template-card > strong')].map((node) => node.textContent)");
  if (cards.join(',') !== 'Blank,Aurora,Editorial,Midnight') throw new Error(`内置模板产品名未翻译：${cards}`);
  if (!await evaluate("document.querySelector('#closeTemplateDialog').getAttribute('aria-label') === 'Close template picker'")) {
    throw new Error('模板关闭控件缺少英文可访问名称');
  }
  await click('#templateDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#templateDialogTitle').textContent === '新建演示文稿'", '对话框内原地切中文');
  if (!await evaluate(`globalThis.__languageTemplateDialog === document.querySelector('#templateDialog')
    && globalThis.__languageTemplateCanvas === document.querySelector('#canvasMount').firstElementChild
    && document.querySelector('#fileName').textContent === ${JSON.stringify(before)}`)) throw new Error('模板切换语言不能重建对话框或替换当前文稿');
  await click('#templateDialog [data-site-locale="en"]');
  await waitFor("document.querySelector('#templateDialogTitle').textContent === 'New presentation'", '模板切回英文');
  await runSiteLanguageInputContract(context, '模板对话框');
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor("!document.querySelector('#templateDialog') && !globalThis.__languageTemplateDialog.open && !globalThis.__languageTemplateDialog.isConnected && !!document.querySelector('.app-header #siteLanguage')", '键盘取消模板后释放窗口并归还语言入口');
  if (!await evaluate(`globalThis.__languageTemplateCanvas === document.querySelector('#canvasMount').firstElementChild
    && document.querySelector('#fileName').textContent === ${JSON.stringify(before)}`)) throw new Error('取消模板不能替换文稿');
  await click('#newFile');
  await waitFor("document.querySelector('#templateDialog')?.open", '取消后重新打开模板');
  await click('[data-template-id="aurora"]');
  await waitFor("document.querySelector('#fileName').textContent === 'Aurora presentation.pptx' && !document.querySelector('#editorApp').dataset.loading", '英文模板新建文稿');
  if (!await evaluate("!!document.querySelector('.app-header #siteLanguage')")) throw new Error('关闭模板后语言控件必须返回页头');
  await click('[data-site-locale="zh-CN"]');
}
