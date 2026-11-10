import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { moduleClosure } from './lib/module-closure.mjs';

const root = resolve(import.meta.dirname, '..');
const snapshot = () =>
  Object.fromEntries(
    ['core', 'edit-core'].map((name) => {
      const closure = moduleClosure(join(root, `packages/${name}/dist/${name}.js`));
      return [
        name,
        {
          gzip: closure.gzip,
          hashes: Object.fromEntries(
            closure.files.map((file) => [relative(root, file), createHash('sha256').update(readFileSync(file)).digest('hex')]),
          ),
        },
      ];
    }),
  );
const before = snapshot();
execFileSync(process.execPath, [join(root, 'tooling/generate-template-fill-schema.mjs'), '--check'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.fill.config.ts'], {
  cwd: join(root, 'packages/edit-core'),
  stdio: 'inherit',
});
const after = snapshot();
assert.deepEqual(after, before, '模板填充独立构建不得改变 core/edit-core 默认入口的任何静态产物字节');
mkdirSync(join(root, 'out/template-fill'), { recursive: true });
writeFileSync(join(root, 'out/template-fill/default-entry-proof.json'), `${JSON.stringify({ before, after }, null, 2)}\n`);
console.log('模板填充独立构建：core/edit-core 默认闭包逐字节不变');
