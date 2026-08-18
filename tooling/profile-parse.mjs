import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomEnv } from './lib/dom-env.mjs';
installDomEnv();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('npx',['esbuild',join(root,'packages/core/src/index.ts'),'--bundle','--format=esm','--platform=browser','--log-level=error',`--outfile=${join(root,'out/core/pf.mjs')}`],{cwd:root});
const lib=await import(`file://${join(root,'out/core/pf.mjs')}?t=${Date.now()}`);
const big=new Uint8Array(readFileSync(join(root,'out/core/big.pptx')));
console.log(`  样本: ${(big.length/1024/1024).toFixed(1)} MB`);

// 1. 解压
let t=Date.now();
const files=unzipSync(big);
const unzipMs=Date.now()-t;

// 2. XML 解析（把所有 slide part 过一遍 DOMParser）
const dec=new TextDecoder();
const slideXmls=Object.keys(files).filter(k=>/^ppt\/slides\/slide\d+\.xml$/.test(k));
t=Date.now();
for (const k of slideXmls) new DOMParser().parseFromString(dec.decode(files[k]),'application/xml');
const xmlMs=Date.now()-t;

// 3. 完整解析
t=Date.now();
const pres=await lib.parse(big);
const totalMs=Date.now()-t;

// 4. 渲染
t=Date.now();
for (const s of pres.slides) lib.renderSlideToSvg(pres,s);
const renderMs=Date.now()-t;

const n=pres.slides.length;
console.log(`  页数 ${n}`);
console.log(`  ├ 解压 zip            ${String(unzipMs).padStart(5)}ms  ${(unzipMs/totalMs*100).toFixed(0)}%`);
console.log(`  ├ XML 解析(仅slide)   ${String(xmlMs).padStart(5)}ms  ${(xmlMs/totalMs*100).toFixed(0)}%`);
console.log(`  ├ 其余(Schema 构建)   ${String(totalMs-unzipMs-xmlMs).padStart(5)}ms  ${((totalMs-unzipMs-xmlMs)/totalMs*100).toFixed(0)}%`);
console.log(`  └ 解析合计            ${String(totalMs).padStart(5)}ms  (${(totalMs/n).toFixed(1)}ms/页)`);
console.log(`  渲染全部              ${String(renderMs).padStart(5)}ms  (${(renderMs/n).toFixed(2)}ms/页)`);

// 5. 惰性解析能省多少：只解析第 1 页需要多久
t=Date.now();
const one=unzipSync(big);
const oneXml=new DOMParser().parseFromString(dec.decode(one['ppt/slides/slide1.xml']),'application/xml');
const lazyMs=Date.now()-t;
console.log(`\n  若惰性解析(只解第1页): 约 ${lazyMs}ms → 首屏快 ${(totalMs/lazyMs).toFixed(0)}×`);
void oneXml;
