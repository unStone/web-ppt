import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {moduleClosure} from './lib/module-closure.mjs';
const root=resolve(import.meta.dirname,'..'),out=join(root,'out/agent-lint');mkdirSync(out,{recursive:true});
for(const name of ['core','edit-core'])assert(!moduleClosure(join(root,`packages/${name}/dist/${name}.js`)).source.includes('lintPresentation'),'默认入口不能包含 lint');
const proof=JSON.parse(readFileSync(join(root,'out/agent-describe/default-entry-proof.json'),'utf8'));
for(const [entry,before]of Object.entries(proof.after)){
 const closure=moduleClosure(join(root,'packages',entry));
 const hashes=Object.fromEntries(closure.files.map(file=>[relative(root,file),createHash('sha256').update(readFileSync(file)).digest('hex')]));
 assert.deepEqual(hashes,before.hashes,'lint 独立构建不得改写默认入口的任何静态产物');
}
const own=moduleClosure(join(root,'packages/edit-core/dist/lint.js'));
assert(!/\bdocument\.|\bwindow\./.test(own.source),'lint 必须在无 DOM 环境运行');
const sampler=moduleClosure(join(root,'packages/edit-core/dist/lint-sampler.js'));
assert(!/\bdocument\.|\bwindow\./.test(sampler.source),'光栅化器由宿主注入，采样入口必须无 DOM');
const consumer=join(out,'consumer.ts');writeFileSync(consumer,`import {lintPresentation,prepareLintText,type LayoutLintReport} from '@web-ppt/edit-core/lint';import {createEmptyDoc} from '@web-ppt/edit-core';
const result:Promise<LayoutLintReport>=lintPresentation(createEmptyDoc({width:100,height:100}),{checks:['off-canvas']});void result;void prepareLintText;
// @ts-expect-error 未知检查项必须被类型拒绝
lintPresentation(createEmptyDoc({width:100,height:100}),{checks:['unknown']});`);
execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),consumer,'--noEmit','--strict','--skipLibCheck','--target','ES2020','--module','ESNext','--moduleResolution','bundler'],{stdio:'inherit'});
const manifest=JSON.parse(readFileSync(join(root,'packages/edit-core/package.json')));
assert.equal(manifest.exports['./lint/schema.json'],'./schemas/lint.schema.json');
const packed=JSON.parse(execFileSync('npm',['pack','--dry-run','--json','--ignore-scripts','--cache',join(root,'out/npm-cache')],{cwd:join(root,'packages/edit-core'),encoding:'utf8'}))[0];
for(const name of ['dist/lint.js','dist/lint-sampler.js','dist/lint/index.d.ts','dist/lint/sampler.d.ts','schemas/lint.schema.json'])assert(packed.files.some(f=>f.path===name),`发布包缺少 ${name}`);
console.log(`lint 按需闭包 ${own.gzip}B gzip，含颜色/空间索引/XML；外部类型调用和无 DOM 边界通过`);
