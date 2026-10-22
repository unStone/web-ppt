import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, 'out'), { recursive: true });
const temporary = mkdtempSync(join(root, 'out/bench-source-'));
const moved = [];
try {
  for (const name of ['core', 'edit-core']) {
    const source = join(root, 'packages', name, 'dist');
    if (!existsSync(source)) continue;
    const saved = join(temporary, name);
    renameSync(source, saved); moved.push({ source, saved });
  }
  const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', join(root, 'tooling/bench.mjs'), '1', '--edit', '--json'], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
  }));
  assert.equal(result.mode, 'edit');
  assert.equal(result.pages, 7);
  assert.equal(result.defaultState.package, true);
  assert.equal(result.editDoc.recoveryFrames, 1000);
  assert.equal(result.editDoc.opcSaveDirtyParts, 3);
  assert(result.editDoc.opcSaveOutputBytes > 0);
  console.log('编辑基准无 dist：源码自引用、恢复与保存全部通过');
} finally {
  for (const { source, saved } of moved.reverse()) renameSync(saved, source);
  rmSync(temporary, { recursive: true });
}
