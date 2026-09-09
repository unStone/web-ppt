import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
import {build} from 'vite';
import {withChartBrowser} from './lib/chart-browser-lab.mjs';

const root=resolve('.'),out=resolve(root,'out/font-glyphs');
mkdirSync(out,{recursive:true});
const paths=ts.readConfigFile(resolve(root,'tsconfig.json'),ts.sys.readFile).config.compilerOptions.paths;
const alias=Object.entries(paths).sort(([a],[b])=>b.length-a.length).map(([find,[path]])=>({find,replacement:resolve(root,path)}));
await build({configFile:false,root,base:'/out/font-glyphs/proof/',resolve:{alias},worker:{format:'es'},
  esbuild:{supported:{'top-level-await':true}},build:{outDir:resolve(out,'proof'),emptyOutDir:true,target:'es2020',
    lib:{entry:resolve(root,'tooling/lib/font-proof-browser.mjs'),formats:['es'],fileName:()=> 'proof.mjs'}}});
const result=await withChartBrowser(root,async browser=>{
  const value=await browser.evaluate("import('/out/font-glyphs/proof/proof.mjs').then(module=>module.fontProofBrowser())");
  const {targetInfos}=await browser.request('Target.getTargets');
  if(targetInfos.some(target=>target.type==='worker'))throw new Error('证明结束后 Worker 未退出');
  return {...value,browser:browser.version.product};
});
const {pdf,toUnicode,svg,...report}=result;
writeFileSync(resolve(out,'font-proof.pdf'),new Uint8Array(pdf));
writeFileSync(resolve(out,'font-proof-tounicode.pdf'),new Uint8Array(toUnicode));
writeFileSync(resolve(out,'font-proof.svg'),svg);
writeFileSync(resolve(out,'proof-browser.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({browser:report.browser,rows:report.rows.length,glyphs:report.rows.reduce((count,row)=>count+row.glyphs.length,0)}));
