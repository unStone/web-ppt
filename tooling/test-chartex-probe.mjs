/** 调查工具自身的契约；临时对照包不作为 Office 生产者证据，也不纳入固件分发。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'fixtures/chartex-corpus.json'), 'utf8'));
const source = manifest.files.find((file) => file.name === 'funnel-pp1.pptx');
const input = resolve(root, process.argv[2] ?? source.downloadPath);
const bytes = readFileSync(input);
assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, '对照必须使用已登记的原始 PPTX');
const probe = (...args) => spawnSync(process.execPath, [join(root, 'tooling/probe-chartex.mjs'), ...args],
  { cwd: root, encoding: 'utf8', timeout: 15000 });
const inspect = (path) => {
  const result = probe('--expect-fallback', path);
  assert.equal(result.error, undefined, result.error?.message);
  assert.ok(result.stdout, result.stderr);
  return { status: result.status, report: JSON.parse(result.stdout) };
};

assert.equal(probe().status, 2, '缺参数必须明确失败');
assert.equal(probe('--unknown', input).status, 2, '未知参数不可静默忽略');
const first = inspect(input);
const second = inspect(input);
assert.deepEqual(first, second, '调查报告不受全局 SVG ID 或临时 URL 影响');
assert.equal(first.report.provenance.url, source.url, '来源只由原始字节哈希认定');

const parts = unzipSync(bytes);
const slidePart = 'ppt/slides/slide1.xml';
const original = new TextDecoder().decode(parts[slidePart]);
const choice = original.match(/<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>/);
assert.ok(choice, '固定来源的 Choice 结构发生变化');
// 保留 ChartEx 引用让探针仍识别该 envelope；缺失 frame 变换使旧解析器走空结果回退。
const emptyFrame = choice[0].replace(/<p:xfrm>[\s\S]*?<\/p:xfrm>/, '');
assert.notEqual(emptyFrame, choice[0], '正对照必须移除 Choice frame 的变换');
const fallbackOnly = original.replace(choice[0], emptyFrame);
const duplicate = fallbackOnly.replace('</p:spTree>', `${choice[1]}</p:spTree>`);
assert.notEqual(duplicate, fallbackOnly, '重复身份对照必须改变输入');
const temporary = mkdtempSync(join(tmpdir(), 'web-ppt-chartex-probe-'));
try {
  const paths = ['fallback-only.pptx', 'duplicate-object.pptx'].map((name) => join(temporary, name));
  for (const [index, xml] of [fallbackOnly, duplicate].entries()) {
    writeFileSync(paths[index], makeZip(Object.entries({ ...parts, [slidePart]: new TextEncoder().encode(xml) })));
  }
  const positive = inspect(paths[0]);
  assert.equal(positive.status, 0, '只有图片的对照必须被接受');
  assert.equal(positive.report.provenance, null, '改写后的对照不能冒充原始 Office 文件');
  assert.equal(positive.report.rendering[0].expectedImageSha256,
    '855f488a5d14106adab0adc1d4a547863f09f2e737fc347dacf493b80ed63096');
  const negative = inspect(paths[1]);
  assert.deepEqual(negative.report.rendering[0].actualKinds, ['image', 'unsupported']);
  assert.equal(negative.status, 1, '图片和占位同时输出不能通过回退契约');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('ChartEx 探针契约通过：确定性、来源哈希、正对照、重复占位反例与 CLI 用法');
