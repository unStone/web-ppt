import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TASKS } from './agent-eval/tasks.mjs';
import { buildFixture, buildReferenceSolution } from './agent-eval/fixtures.mjs';

const directory = resolve(import.meta.dirname, 'agent-eval/fixtures');
const check = process.argv.includes('--check');
assert(process.argv.slice(2).every(value => value === '--check'), '仅支持 --check');
mkdirSync(directory, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = { version: 1, generator: 'tooling/make-agent-eval-fixture.mjs', tasks: [] };
for (const task of TASKS) {
  const input = buildFixture(task.id), reference = buildReferenceSolution(task.id);
  assert.deepEqual(input, buildFixture(task.id), `${task.id} 输入生成不可重复`);
  assert.deepEqual(reference, buildReferenceSolution(task.id), `${task.id} 参考生成不可重复`);
  for (const [name, bytes] of [[task.fixtureName, input], [task.referenceName, reference]]) {
    const path = join(directory, name);
    if (check) assert.deepEqual(readFileSync(path), Buffer.from(bytes), `${name} 与生成器不一致`);
    else writeFileSync(path, bytes);
  }
  manifest.tasks.push({ ...task, inputSha256: hash(input), referenceSha256: hash(reference) });
}
const path = join(directory, 'manifest.json');
const json = `${JSON.stringify(manifest, null, 2)}\n`;
if (check) assert.equal(readFileSync(path, 'utf8'), json, '评测固件清单与生成器不一致');
else writeFileSync(path, json);
console.log(`Agent eval ${TASKS.length} 类任务、${TASKS.length * 2} 份确定性文稿${check ? '核验' : '生成'}通过`);
