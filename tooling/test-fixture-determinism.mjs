import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'fixtures');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }).sort();
}

function snapshot() {
  return Object.fromEntries(files(fixtures).map((file) => [
    relative(fixtures, file), createHash('sha256').update(readFileSync(file)).digest('hex'),
  ]));
}

function generate() {
  execFileSync('npm', ['run', 'fixtures'], { cwd: root, stdio: 'inherit' });
  return snapshot();
}

const first = generate();
const second = generate();
if (JSON.stringify(first) !== JSON.stringify(second)) {
  const names = new Set([...Object.keys(first), ...Object.keys(second)]);
  const changed = [...names].filter((name) => first[name] !== second[name]);
  throw new Error(`固件连续生成不确定：${changed.join(', ')}`);
}
console.log(`\x1b[32m✓ ${Object.keys(second).length} 份固件连续生成两次逐字节一致\x1b[0m`);
