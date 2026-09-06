import { runCommentsExportContract } from './lib/comments-export-contract.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { runCommentsSaveContract } from './lib/comments-save-contract.mjs';
import { recordCount } from './lib/measured.mjs';

const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/comments');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as comments from ${JSON.stringify(join(root, 'packages/viewer-core/src/comments.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};`);
const { core, edit, comments } = process.argv.includes('--dist') ? {
  comments: await import('@web-ppt/viewer-core/comments'), core: await import('@web-ppt/core'), edit: await import('@web-ppt/edit-core'),
} : await bundleBrowser({ root, entry, output: join(out, 'contract.mjs'), aliases: [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
] });
let passed = 0;
await runCommentsSaveContract({ core, edit, out, load: (name) => readFileSync(join(root, 'fixtures', name)),
  check: (label, condition) => { assert(condition, label); passed++; } });
passed += await runCommentsExportContract({ core, comments, load: (name) => readFileSync(join(root, 'fixtures', name)) });
writeFileSync(join(out, process.argv.includes('--dist') ? 'dist-report.json' : 'source-report.json'), JSON.stringify({ passed }) + '\n');
if (!process.argv.includes('--dist')) recordCount('comments', passed);
console.log(`批注保存、导出与面板契约通过：${passed} 项`);
