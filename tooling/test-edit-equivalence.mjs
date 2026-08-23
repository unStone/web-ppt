/** 全固件、独立进程的 M0 只读/编辑投影等价门禁。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(root, 'fixtures');
const outDir = join(root, 'out/edit-equivalence');
const entry = join(root, 'tooling/lib/edit-equivalence-entry.ts');
const bundle = join(outDir, 'runtime.mjs');
const worker = join(root, 'tooling/lib/edit-fingerprint.mjs');
const password = 'web-ppt-2024';

mkdirSync(outDir, { recursive: true });
execFileSync('npx', [
  'esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
  `--alias:@web-ppt/core/geometry=${join(root, 'packages/core/src/geometry/index.ts')}`,
  `--alias:@web-ppt/core=${join(root, 'packages/core/src/index.ts')}`,
  `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });

const fixtures = readdirSync(fixturesDir)
  .filter((name) => /\.(?:pptx|ppt)$/i.test(name))
  .sort();
if (!fixtures.length) throw new Error('没有找到可验证的 PPT 固件');

function fingerprint(name, mode) {
  const file = join(fixturesDir, name);
  const args = [worker, bundle, file, mode];
  if (name.includes('encrypted')) args.push(password);
  const text = execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  return JSON.parse(text);
}

const failures = [];
let pages = 0;
let svgCount = 0;
console.log('\n\x1b[36m▸ M0 独立进程渲染等价\x1b[0m');
for (const name of fixtures) {
  const readonly = fingerprint(name, 'readonly');
  const editable = fingerprint(name, 'edit');
  const sameMeta = readonly.width === editable.width
    && readonly.height === editable.height
    && readonly.source === editable.source
    && readonly.pages === editable.pages;
  if (!sameMeta) failures.push(`${name}: 文稿元数据不同`);

  const count = Math.min(readonly.slides.length, editable.slides.length);
  for (let page = 0; page < count; page++) {
    for (const key of ['hidden', 'notes', 'html', 'svg']) {
      if (readonly.slides[page][key] !== editable.slides[page][key]) {
        failures.push(`${name} 第 ${page + 1} 页 ${key} 不同`);
      }
    }
  }
  pages += count;
  svgCount += count * 2;
  console.log(`  ✓ ${name} · ${count} 页`);
}

console.log('─'.repeat(60));
if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 项 M0 等价失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32m✓ ${fixtures.length} 份固件 / ${pages} 页 / ${svgCount} 对原始 SVG 指纹完全一致\x1b[0m`);
}
