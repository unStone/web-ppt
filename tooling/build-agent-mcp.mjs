import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { moduleClosure } from './lib/module-closure.mjs';

const root = resolve(import.meta.dirname, '..');
const packages = ['core', 'edit-core', 'viewer-core', 'editor', 'react', 'vue', 'fonts', 'collab'];
const snapshot = () =>
  Object.fromEntries(
    packages.map((name) => {
      const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
      const entry = join(root, 'packages', name, manifest.main.replace('./', ''));
      const closure = moduleClosure(entry);
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
execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: join(root, 'packages/agent-mcp'),
  stdio: 'inherit',
});
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
  cwd: join(root, 'packages/agent-mcp'),
  stdio: 'inherit',
});
const after = snapshot();
assert.deepEqual(after, before, 'agent-mcp 构建不得改变八个既有包默认入口的任一静态产物字节');
mkdirSync(join(root, 'out/agent-mcp'), { recursive: true });
writeFileSync(join(root, 'out/agent-mcp/default-entry-proof.json'), `${JSON.stringify({ before, after }, null, 2)}\n`);
console.log('agent-mcp 独立构建：八个既有包默认入口闭包逐字节不变');
