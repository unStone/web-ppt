import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMixedEditingContract } from './lib/mixed-editing-contract.mjs';

const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'out/v08-dist');
mkdirSync(out, { recursive: true });
let passed = 0;
await runMixedEditingContract({ root, out, dist: true,
  check(label, condition) { assert(condition, label); passed++; },
  eq(label, actual, expected) { assert.deepEqual(actual, expected, label); passed++; },
});
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ passed, packageConsumption: true }) + '\n');
console.log(`0.8 包名产物混合契约通过：${passed} 项`);
