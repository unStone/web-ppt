import { resolve, join } from 'node:path';
import { mergeResults, readJson, writeJson } from './results.mjs';

const root = resolve(import.meta.dirname, '../..');
const [phase, ...unknown] = process.argv.slice(2);
if (unknown.length || !['source', 'dist', 'external', 'all'].includes(phase)) {
  throw new Error('用法：node tooling/ci/merge-results.mjs source|dist|external|all');
}
const scripts = readJson(join(root, 'package.json')).scripts;
const result = mergeResults({ root, scripts, phase });
writeJson(join(root, 'out/verify/counts.json'), result.counts);
writeJson(join(root, 'out/ci-results', `${phase}-summary.json`), result);
console.table(result.summaries);
console.log(`已验证 ${result.summaries.length} 个分组，合并 ${Object.keys(result.counts).length} 个实测计数`);
