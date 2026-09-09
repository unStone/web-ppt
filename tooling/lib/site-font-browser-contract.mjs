import assert from 'node:assert/strict';
import {openFixture} from './site-editor-browser-helpers.mjs';

/** 使用完整站点产物和真实文件入口，覆盖 Vite 的 Worker / WASM URL 与语言分块。 */
export async function runSiteFontBrowserContract(context){
  const {evaluate,request,waitFor,click}=context;
  const before=await request('Target.getTargets');
  const existingWorkers=new Set(before.result.targetInfos.filter(target=>target.type==='worker').map(target=>target.targetId));
  await openFixture(context,'/fixtures/sample-font-glyphs.pptx','sample-font-glyphs.pptx');
  assert.equal(await evaluate(`(()=>{
    const canvas=document.createElement('canvas').getContext('2d');
    canvas.font='100px "WebPPT Glyph Latin"';return Math.round(canvas.measureText('AV office ffi ﬃ').width);
  })()`),669,'生产打开链路必须在画布挂载前安装对应字体');
  await click('#fontTools');
  await waitFor("document.querySelector('#fontDialog') && !document.querySelector('#checkFonts').disabled",'生产字体检查完成',400);
  assert.equal(await evaluate("document.querySelector('#fontError').textContent"),'');
  assert.equal(await evaluate("document.querySelector('#fontIssues').textContent.includes('😀')"),true);
  const active=await request('Target.getTargets');
  // 未附加调试会话的 Worker 可以没有 URL，按本次文稿创建的真实 target 身份取证。
  assert.equal(active.result.targetInfos.filter(target=>target.type==='worker'&&!existingWorkers.has(target.targetId)).length,1,
    `生产缺字检查必须加载实际独占 Worker：${JSON.stringify(active.result.targetInfos)}；诊断：${await evaluate("document.querySelector('#fontIssues').textContent")}`);
  assert.equal(await evaluate("document.querySelectorAll('#fontIssues > li').length"),7,
    '合法 Latin / Han / 连字与组合音标不应被报告为整形失败');
  await click('#fontDialog [data-site-locale="en"]');
  await waitFor("document.querySelector('#fontDialogTitle').textContent==='Fonts and missing glyphs'",'生产字体英文目录');
  assert.equal(await evaluate("document.querySelector('#embeddedFontStatus').textContent.includes('preview and printing')"),true);
  await evaluate(`(async()=>{
    const bytes=await fetch('/fixtures/font-latin.ttf').then(response=>response.arrayBuffer());
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],'chosen-latin.ttf',{type:'font/ttf'}));
    document.querySelector('#fontFile').files=transfer.files;
    document.querySelector('#fontFamily').value='WebPPT Glyph Preview';
    document.querySelector('#fontFileForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  })()`,true);
  await waitFor("!document.querySelector('#applyFontFile').disabled",'生产本机字体替换');
  assert.equal(await evaluate("document.querySelector('#fontError').textContent"),'');
  assert.equal(await evaluate("document.querySelector('#fontScopeHint').textContent.includes('not written to the PPTX')"),true);
  await click('#fontDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#fontDialogTitle').textContent==='字体与缺字'",'生产字体切回中文');
  await click('#closeFontDialog');
  await openFixture(context,'/fixtures/sample-editor-text.pptx','sample-editor-text.pptx');
  assert.equal(await evaluate("[...document.fonts].filter(face=>face.family.startsWith('WebPPT Glyph')).length"),0,
    '切换文稿后旧字体必须从真实浏览器字体集释放');
  const closed=await request('Target.getTargets');
  assert(!closed.result.targetInfos.some(target=>target.type==='worker'&&!existingWorkers.has(target.targetId)),
    '切换文稿后生产字体 Worker 必须退出');
  console.log('  生产字体打开、真实 Worker 整形、中英文缺字工具、本机替换与文稿切换释放通过');
}
