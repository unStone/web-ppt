import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out=resolve('out/portable-rich-text');
if(process.argv[2]==='--worker'){
  const core=process.argv.includes('--dist') ? await import('@web-ppt/core') : (await import(pathToFileURL(`${out}/contract.mjs`))).core;
  const file=process.argv[3],name=process.argv[4];
  const p=await core.parse(readFileSync(file),{keepPackage:true,lazy:false});
  const result=[];
  for(const [index,slide] of p.slides.entries())for(const textMode of ['html','svg']){
    let svg=core.renderSlideToSvg(p,slide,{textMode});
    // URL 是每次解析的会话地址；比较实际资源字节，defs id 仍保持未经归一的原始值。
    for(const [url,asset] of Object.entries(p.package.assets ?? {}))svg=svg.replaceAll(url,`data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`);
    writeFileSync(`${out}/${name}-${index+1}-${textMode}.svg`,svg);
    result.push({page:index+1,textMode,bytes:Buffer.byteLength(svg),sha256:createHash('sha256').update(svg).digest('hex')});
  }
  p.dispose();process.stdout.write(JSON.stringify(result));
}else{
  const run=(file,name)=>JSON.parse(execFileSync(process.execPath,[import.meta.filename,'--worker',file,name,...(process.argv.includes('--dist')?['--dist']:[])],{encoding:'utf8'}));
  const source=run('fixtures/sample-portable-rich-text.pptx','source');
  const generated=run(`${out}/generated.pptx`,'generated');
  writeFileSync(`${out}/render-proof.json`,JSON.stringify({source,generated},null,2)+'\n');
  assert.deepEqual(generated,source,'独立进程两条文字路径渲染一致');
  console.log('高级文本生成前后：独立进程 6 张 SVG 逐字节一致');
}
