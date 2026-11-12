import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {build} from 'vite';
import {withChartBrowser} from './lib/chart-browser-lab.mjs';
import {recordCount} from './lib/measured.mjs';

const root=resolve('.'),dist=process.argv.includes('--dist'),directory=dist?'browser-dist':'browser';
const out=resolve(root,`out/font-glyphs/${directory}`);
mkdirSync(out,{recursive:true});
const paths=ts.readConfigFile(resolve(root,'tsconfig.json'),ts.sys.readFile).config.compilerOptions.paths;
const alias=dist?[]:Object.entries(paths).sort(([a],[b])=>b.length-a.length).map(([find,[path]])=>({find,replacement:resolve(root,path)}));
await build({configFile:false,root,base:`/out/font-glyphs/${directory}/`,resolve:{alias},worker:{format:'es'},esbuild:{supported:{'top-level-await':true}},
  build:{outDir:out,emptyOutDir:true,target:'es2020',lib:{entry:resolve(root,'tooling/lib/font-document-browser.mjs'),formats:['es'],fileName:()=> 'contract.mjs'}}});
// 导出字体管线的浏览器验收（真实 wasm 引擎 + PNG 字节一致）同页执行，共用一次浏览器启动
await build({configFile:false,root,base:`/out/font-glyphs/${directory}/`,resolve:{alias},worker:{format:'es'},esbuild:{supported:{'top-level-await':true}},
  build:{outDir:out,emptyOutDir:false,target:'es2020',lib:{entry:resolve(root,'tooling/lib/export-font-browser.mjs'),formats:['es'],fileName:()=> 'export-contract.mjs'}}});
const report=await withChartBrowser(root,async browser=>{
  const value=await browser.evaluate(`import('/out/font-glyphs/${directory}/contract.mjs').then(module=>module.fontDocumentBrowserContract())`);
  const exportFonts=await browser.evaluate(`import('/out/font-glyphs/${directory}/export-contract.mjs').then(module=>module.exportFontBrowserContract())`);
  const targets=await browser.request('Target.getTargets');
  if(targets.targetInfos.some(target=>target.type==='worker'))throw new Error('文稿关闭后仍有 Worker target');
  return {browser:browser.version.product,...value,exportFonts,remainingWorkers:0};
});
for(const file of report.vectorExports.files){
  const directory=resolve(root,`out/font-glyphs/vector-pdf-${dist?'dist':'source'}/${file.mode}`);mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,'normalization.pdf'),new Uint8Array(file.bytes));
  writeFileSync(resolve(directory,'normalization-reference.json'),JSON.stringify({browser:report.browser,images:report.vectorExports.images})+'\n');
  execFileSync('python3',['tooling/inspect-vector-pdf-normalization.py',directory],{stdio:'inherit',
    env:{...process.env,PYTHONPATH:process.env.PYTHONPATH??resolve(root,'out/font-glyphs/python')}});
  file.byteLength=file.bytes.length;delete file.bytes;
}
delete report.vectorExports.images;
recordCount('fontBrowser',report.assertions);
recordCount('exportFontBrowser',report.exportFonts.assertions);
writeFileSync(resolve(root,`out/font-glyphs/browser-document${dist?'-dist':''}.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
