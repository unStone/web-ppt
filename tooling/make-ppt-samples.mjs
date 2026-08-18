/**
 * 用 LibreOffice 把 pptx 测试文件转成 .ppt 二进制格式样本。
 *
 *   node tooling/make-ppt-samples.mjs
 *
 * .ppt 无法像 pptx 那样手写生成（OfficeArt 记录树过于复杂），
 * 因此用 LibreOffice 转换，产物提交进仓库供测试使用。
 * 每次 pptx fixture 有实质变化后应重跑此脚本，否则 .ppt 侧测试覆盖会滞后。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOFFICE = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
].find((p) => existsSync(p));

if (!SOFFICE) {
  console.log('未找到 LibreOffice，跳过 .ppt 样本生成（仓库里已有的样本保持不变）');
  console.log('  macOS 安装：brew install --cask libreoffice');
  process.exit(0);
}

const TARGETS = ['showcase.pptx', 'sample-chart.pptx', 'sample-hidden.pptx'];
const tmp = join(root, 'out/pptconv');

for (const name of TARGETS) {
  const src = join(root, 'fixtures', name);
  if (!existsSync(src)) {
    console.log(`跳过 ${name}（不存在，先运行 npm run fixtures）`);
    continue;
  }
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'ppt', '--outdir', tmp, src], {
    stdio: 'ignore',
    timeout: 300_000,
  });
  const hit = readdirSync(tmp).find((f) => f.endsWith('.ppt'));
  if (!hit) {
    console.log(`转换失败：${name}`);
    continue;
  }
  const dest = join(root, 'fixtures', name.replace(/\.pptx$/, '.ppt'));
  renameSync(join(tmp, hit), dest);
  console.log(`fixtures/${name.replace(/\.pptx$/, '.ppt')} 已生成`);
}
rmSync(tmp, { recursive: true, force: true });
