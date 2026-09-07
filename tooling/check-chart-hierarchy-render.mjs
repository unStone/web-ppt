import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out=resolve('out/chart-hierarchy');
if(process.argv[2]==='--worker'){
  const core=process.argv.includes('--dist')?await import('@web-ppt/core'):(await import(pathToFileURL(`${out}/contract.mjs`))).core;
  const file=process.argv[3],name=process.argv[4],p=await core.parse(readFileSync(file),{keepPackage:true,lazy:false});
  const result=[];
  for(const [index,slide] of p.slides.entries())for(const textMode of ['html','svg']){
    const svg=core.renderSlideToSvg(p,slide,{textMode});
    writeFileSync(`${out}/${name}-${index+1}-${textMode}.svg`,svg);
    result.push({page:index+1,textMode,bytes:Buffer.byteLength(svg),sha256:createHash('sha256').update(svg).digest('hex')});
  }
  p.dispose();process.stdout.write(JSON.stringify(result));
}else{
  const run=(file,name)=>JSON.parse(execFileSync(process.execPath,[import.meta.filename,'--worker',file,name,...(process.argv.includes('--dist')?['--dist']:[])],{encoding:'utf8'}));
  const source=run('fixtures/sample-chart-hierarchy.pptx','source'),unchanged=run(`${out}/unchanged-generated.pptx`,'unchanged');
  const patched=run(`${out}/patched.pptx`,'patched'),generated=run(`${out}/generated.pptx`,'generated');
  writeFileSync(`${out}/render-proof.json`,JSON.stringify({source,unchanged,patched,generated},null,2)+'\n');
  assert.deepEqual(source,unchanged,'未编辑生成保存两条文字路径逐字节一致');
  assert.deepEqual(patched,generated,'已编辑补丁与生成保存两条文字路径逐字节一致');
  console.log('多级类别：独立进程 12 对 SVG 逐字节一致');
}
