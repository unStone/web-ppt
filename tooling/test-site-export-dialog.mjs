import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';
import {installDomEnv} from './lib/dom-env.mjs';

const {window,dom}=installDomEnv();
dom.reconfigure({url:'https://web-ppt.test/?lang=zh-CN'});
for(const name of ['location','history','localStorage','navigator','AbortController','DOMException','FormData']){
  Object.defineProperty(globalThis,name,{value:window[name],configurable:true});
}
document.documentElement.lang='zh-CN';
document.head.innerHTML='<link rel="canonical" href="https://web-ppt.test/">';
document.body.innerHTML='<nav id="siteLanguage" data-site-language><a href="?lang=en" data-site-locale="en">English</a><a href="?lang=zh-CN" data-site-locale="zh-CN">中文</a></nav>';
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
const root=resolve('.'),out=resolve(root,'out/site-export-dialog');mkdirSync(out,{recursive:true});
const paths=ts.readConfigFile(resolve(root,'tsconfig.json'),ts.sys.readFile).config.compilerOptions.paths;
const alias=Object.fromEntries(Object.entries(paths).map(([name,[path]])=>[name,resolve(root,path)]));
const output=resolve(out,'dialog.mjs');
// 保留真实 import 拒绝边界；不替换导出函数，否则无法覆盖适配器尚未加载时的错误路径。
await build({stdin:{contents:"export {showDocumentExport} from './packages/site/src/editor-export-tools'; export {languageReady} from './packages/site/src/i18n/runtime';",resolveDir:root},
  bundle:true,format:'esm',platform:'browser',outfile:output,alias,logLevel:'error',
  plugins:[{name:'unavailable-vector-module',setup(b){b.onResolve({filter:/^\.\/editor-vector-pdf$/},()=>({path:'./unavailable-vector-module.mjs',external:true}));}}]});
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(test){for(let i=0;i<200;i++){if(test())return;await tick();}throw new Error('导出窗口没有完成预期状态转换');}
try{
  const {showDocumentExport,languageReady}=await import(pathToFileURL(output).href);await languageReady;
  const closed=showDocumentExport({width:100,height:100,slides:[]},'demo',false,async()=>new Uint8Array());
  const dialog=document.querySelector('#documentExportDialog'),format=dialog.querySelector('[name=format]');
  format.value='vector';format.dispatchEvent(new window.Event('change'));
  const submit=dialog.querySelector('[type=submit]'),status=dialog.querySelector('[role=status]');
  submit.click();await until(()=>!submit.disabled);
  assert.equal(status.textContent,'矢量 PDF 导出未完成，请重试或改用图片 PDF');
  document.querySelector('[data-site-locale=en]').click();await until(()=>status.textContent.includes('Vector PDF'));
  assert.equal(status.textContent,'Vector PDF export did not finish. Try again or use an image PDF');
  submit.click();await until(()=>!submit.disabled);
  assert.equal(status.textContent,'Vector PDF export did not finish. Try again or use an image PDF');
  dialog.querySelector('[data-close]').click();await closed;
  assert.equal(document.querySelector('#documentExportDialog'),null);
  assert.equal(document.querySelector('#siteLanguage').parentElement,document.body);
  console.log('导出模块加载失败：中英文提示、可重试和窗口资源释放通过');
}finally{dom.window.close();}
