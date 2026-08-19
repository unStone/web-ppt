/**
 * 用 LibreOffice 把 pptx 测试文件转成 .ppt 二进制格式样本。
 *
 *   node tooling/make-ppt-samples.mjs
 *
 * .ppt 无法像 pptx 那样手写生成（OfficeArt 记录树过于复杂），
 * 因此用 LibreOffice 转换，产物提交进仓库供测试使用。
 * 每次 pptx fixture 有实质变化后应重跑此脚本，否则 .ppt 侧测试覆盖会滞后。
 *
 * LibreOffice 的转换不是字节确定性的（CFB 里带时间戳等易变字段），
 * 同一份输入重跑两次产物就不一样。若无条件覆盖，任何人跑一次这个脚本
 * 都会带进一堆与内容无关的 diff，甚至造成快照漂移。
 * 所以这里比较的是「渲染结果」而不是字节：只有当解析+渲染的输出真的变了，
 * 才用新产物替换旧的。
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 渲染结果指纹。每次都开子进程算 —— 渲染器的 defs id 来自跨解析累加的
 * 全局计数器，同进程里连算两份必然不等，详见 lib/ppt-fingerprint.mjs。
 */
function fingerprint(bundle, file) {
  return execFileSync(process.execPath,
    [join(root, 'tooling/lib/ppt-fingerprint.mjs'), bundle, file],
    { cwd: root, encoding: 'utf8' });
}

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

// 比较渲染结果要真的跑一遍解析与渲染，和测试用同一套环境
mkdirSync(join(root, 'out/pptbundle'), { recursive: true });
const bundle = 'out/pptbundle/lib.mjs';
execFileSync('npx', ['esbuild', join(root, 'packages/core/src/index.ts'), '--bundle', '--format=esm',
  '--platform=browser', '--log-level=error', `--outfile=${join(root, bundle)}`], { cwd: root, stdio: 'inherit' });

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
  const rel = `fixtures/${name.replace(/\.pptx$/, '.ppt')}`;
  const dest = join(root, rel);
  const fresh = join(tmp, hit);

  if (existsSync(dest)) {
    let same = false;
    try {
      same = fingerprint(bundle, dest) === fingerprint(bundle, fresh);
    } catch (e) {
      // 旧产物解析不了（例如格式支持刚修好），那就该换
      console.log(`  ${rel} 旧产物无法比较（${e.message}），直接替换`);
    }
    if (same) {
      console.log(`${rel} 渲染结果无变化，保留原文件`);
      continue;
    }
  }
  copyFileSync(fresh, dest);
  console.log(`${rel} 已更新`);
}
rmSync(tmp, { recursive: true, force: true });
