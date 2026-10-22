import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { moduleClosure } from './lib/module-closure.mjs';

const root = resolve(import.meta.dirname, '..');
if (process.argv.includes('--child')) {
  const start = performance.now(), memory = process.memoryUsage().heapUsed;
  const { describePresentation } = await import('@web-ppt/edit-core/describe');
  const loaded = performance.now();
  const core = await import('@web-ppt/core'), edit = await import('@web-ppt/edit-core');
  const pres = await core.parse(readFileSync(join(root, 'fixtures/sample-agent-describe.pptx')), { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(pres, { idPrefix: 'measure-' });
  const beginRead = performance.now(), result = describePresentation(doc);
  const descriptionMs = performance.now() - beginRead;
  const heapDeltaBytes = process.memoryUsage().heapUsed - memory;
  pres.dispose(); edit.disposeDoc(doc);
  process.stdout.write(JSON.stringify({ coldImportMs: loaded - start, descriptionMs, heapDeltaBytes, elements: result.totalElements }));
} else {
  const trials = Array.from({ length: 5 }, () => JSON.parse(execFileSync(process.execPath, [import.meta.filename, '--child'], { cwd: root, encoding: 'utf8' })));
  const closure = moduleClosure(join(root, 'packages/edit-core/dist/describe.js'));
  const output = { node: process.version, trials, gzipBytes: closure.gzip, rawBytes: closure.raw };
  const directory = join(root, 'out/agent-describe');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'performance.json'), `${JSON.stringify(output, null, 2)}\n`);
  const median = (key) => trials.map((item) => item[key]).sort((a, b) => a - b)[2];
  console.log(`describe ${closure.gzip}B gzip；5 个独立进程中位数：冷加载 ${median('coldImportMs').toFixed(2)}ms，读出 ${median('descriptionMs').toFixed(2)}ms，堆增长 ${median('heapDeltaBytes')}B（含 peer 加载、解析与读出）`);
}
