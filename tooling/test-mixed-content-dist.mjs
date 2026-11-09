import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { runMixedEditingContract } from './lib/mixed-editing-contract.mjs';

const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'out/v08-dist');
mkdirSync(out, { recursive: true });
let passed = 0;
const check = (label, condition) => { assert(condition, label); passed++; };

// 混合契约只有在固件真的覆盖全部现代布局与音视频、批注部件时才有意义
const fixture = unzipSync(readFileSync(resolve(root, 'fixtures/sample-editor-mixed.pptx')));
check('固件包含全部八种现代布局', ['treemap', 'sunburst', 'clusteredColumn', 'paretoLine', 'boxWhisker', 'waterfall', 'funnel', 'regionMap']
  .every((kind) => Object.entries(fixture).some(([name, bytes]) => /\/chartEx\d+\.xml$/.test(name) && strFromU8(bytes).includes(`layoutId="${kind}"`))));
check('同一固件包含音视频与批注部件', ['ppt/media/mixed.wav', 'ppt/media/mixed.mp4', 'ppt/comments/comment1.xml', 'ppt/commentAuthors.xml']
  .every((name) => fixture[name]?.length));

await runMixedEditingContract({ root, out, dist: true,
  check,
  eq(label, actual, expected) { assert.deepEqual(actual, expected, label); passed++; },
});
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ passed, packageConsumption: true }) + '\n');
console.log(`混合内容包名产物契约通过：${passed} 项`);
