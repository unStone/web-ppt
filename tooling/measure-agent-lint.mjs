import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {moduleClosure} from './lib/module-closure.mjs';
const root=resolve(import.meta.dirname,'..');
if(process.argv.includes('--child')){
 const memory=process.memoryUsage().heapUsed,start=performance.now();
 const lint=await import('@web-ppt/edit-core/lint'),loaded=performance.now();
 const core=await import('@web-ppt/core'),edit=await import('@web-ppt/edit-core');
 const input=JSON.parse(readFileSync('out/agent-lint/performance-input.json','utf8'));
 const p=await core.parse(readFileSync('fixtures/sample-agent-lint.pptx'),{edit:true,keepPackage:true,lazy:false}),doc=edit.createDoc(p,{idPrefix:'lint-'});
 const begin=performance.now();
 const report=await lint.lintPresentation(doc,{fonts:{available:['WebPPT Glyph Latin'],embedded:[]},
  resolveContrast:c=>input.samples[JSON.stringify([c.slideNumber,c.elementId,c.textIndex,c.paragraphIndex,c.runIndex])],
  measureText:(t,r,s)=>{const value=input.metrics[JSON.stringify([t,r.fonts,r.size,!!r.b,!!r.i,r.baseline??0,r.spacing??0,s])];if(value===undefined)throw new Error('缺少真实字宽');return value;},
 });
 const result={coldImportMs:loaded-start,lintMs:performance.now()-begin,heapDeltaBytes:process.memoryUsage().heapUsed-memory,elements:report.totalElements,issues:report.issues.length};
 edit.disposeDoc(doc);p.dispose();process.stdout.write(JSON.stringify(result));
}else{
 const input=JSON.parse(readFileSync('out/agent-lint/corpus-input.json','utf8'))['sample-agent-lint.pptx'];
 writeFileSync('out/agent-lint/performance-input.json',JSON.stringify(input));
 const trials=Array.from({length:5},()=>JSON.parse(execFileSync(process.execPath,[import.meta.filename,'--child'],{cwd:root,encoding:'utf8'})));
 const lint=moduleClosure(join(root,'packages/edit-core/dist/lint.js')),sampler=moduleClosure(join(root,'packages/edit-core/dist/lint-sampler.js'));
 const output={node:process.version,trials,lintGzipBytes:lint.gzip,samplerGzipBytes:sampler.gzip};
 writeFileSync('out/agent-lint/performance.json',JSON.stringify(output,null,2));
 const median=key=>trials.map(t=>t[key]).sort((a,b)=>a-b)[2];
 console.log(`lint ${lint.gzip}B / sampler ${sampler.gzip}B gzip；5 进程中位数：冷加载 ${median('coldImportMs').toFixed(2)}ms，检查 ${median('lintMs').toFixed(2)}ms（真实字宽/采样已准备），堆增长 ${median('heapDeltaBytes')}B（含 peer 与解析）`);
}
