import nativeAssert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { bundleNode } from './lib/bundle-node.mjs';
import { recordCount } from './lib/measured.mjs';

let assertions = 0;
const assert = new Proxy(nativeAssert, {
  apply(target, receiver, args) {
    const result = Reflect.apply(target, receiver, args);
    assertions++;
    return result;
  },
  get(target, key) {
    const value = Reflect.get(target, key);
    return typeof value === 'function'
      ? (...args) => {
          const result = Reflect.apply(value, target, args);
          assertions++;
          return result;
        }
      : value;
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'out/agent-eval/metafile-fixture-regression');
mkdirSync(work, { recursive: true });
const dist = process.argv.includes('--dist');
assert(
  process.argv.slice(2).every((argument) => argument === '--dist'),
  '仅支持 --dist',
);
const { detectMetafile, metafileToSvg } = dist
  ? await import('@web-ppt/core')
  : await bundleNode({ root, entry: join(root, 'packages/core/src/image/index.ts'), output: join(work, 'image-source.mjs') });
const project = mkdtempSync(join(work, 'run-'));
const expectedFixtureHash = '8f042fece7c31a68f832bdd2d6bfb8c491d9f3a101b71120a928778931efa99b';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assetDirectory = join(project, 'tooling/metafile-assets');
const fixture = join(project, 'fixtures/sample-metafile.pptx');
assert.equal(sha256(readFileSync(join(root, 'fixtures/sample-metafile.pptx'))), expectedFixtureHash);
const manifest = JSON.parse(readFileSync(join(root, 'tooling/metafile-assets/manifest.json'), 'utf8'));
assert.equal(manifest.source.sha256, expectedFixtureHash);
assert.equal(manifest.source.commit, '88c8df92ee853fa2dc45a413fa38316527b20025');
assert.deepEqual(
  manifest.assets.map(({ name }) => name),
  ['showcase.emf', 'showcase.wmf'],
);

mkdirSync(join(project, 'tooling/lib'), { recursive: true });
mkdirSync(join(project, 'fixtures'), { recursive: true });
for (const name of [
  'make-metafile-fixture.mjs',
  'make-metafile-assets.mjs',
  'make-emf-plus-fixture.mjs',
  'lib/ooxml.mjs',
  'lib/metafile-assets.mjs',
  'lib/emf-plus-fixture.mjs',
]) {
  cpSync(join(root, 'tooling', name), join(project, 'tooling', name));
}
cpSync(join(root, 'tooling/metafile-assets'), assetDirectory, { recursive: true });
const run = (script, args = []) =>
  spawnSync(process.execPath, [join(project, 'tooling', script), ...args], { cwd: project, encoding: 'utf8' });
const succeed = (result) => assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
const fail = (result, expression) => {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, expression);
  assert.deepEqual(readFileSync(fixture), first, '失败必须发生在写出固件之前');
};
const build = () => {
  succeed(run('make-metafile-fixture.mjs'));
  const bytes = readFileSync(fixture);
  assert.equal(bytes.length, 580673);
  assert.equal(sha256(bytes), expectedFixtureHash);
  return bytes;
};

// 在隔离项目中污染和删除缓存，避免测试本身改动其他套件的转换产物。
assert.equal(existsSync(join(project, 'out/metafile')), false);
const first = build();
const cache = join(project, 'out/metafile');
mkdirSync(cache, { recursive: true });
writeFileSync(join(cache, 'showcase.emf'), 'arbitrary local EMF cache');
writeFileSync(join(cache, 'showcase.wmf'), new Uint8Array([0, 1, 2, 3]));
assert.deepEqual(build(), first);
rmSync(join(cache, 'showcase.wmf'));
assert.deepEqual(build(), first);
rmSync(cache, { recursive: true });
assert.deepEqual(build(), first);
succeed(run('make-emf-plus-fixture.mjs'));
assert.deepEqual(readFileSync(join(project, 'fixtures/sample-emf-plus.pptx')), readFileSync(join(root, 'fixtures/sample-emf-plus.pptx')));

const zip = unzipSync(first);
assert.equal(Object.keys(zip).length, 13);
for (const asset of manifest.assets) {
  const bytes = readFileSync(join(assetDirectory, asset.name));
  assert.equal(bytes.length, asset.bytes);
  assert.equal(sha256(bytes), asset.sha256);
  assert.deepEqual(Buffer.from(zip[asset.part]), bytes);
  assert.equal(detectMetafile(bytes), asset.name.endsWith('.emf') ? 'emf' : 'wmf');
  const svg = metafileToSvg(bytes, { width: 1280, height: 720 });
  assert.equal(typeof svg, 'string', `${asset.name} 必须真实解码`);
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
  const window = new JSDOM(svg, { contentType: 'image/svg+xml' }).window;
  const document = window.document;
  assert.equal(document.documentElement.localName, 'svg');
  assert.equal(document.documentElement.getAttribute('width'), '1280');
  assert.equal(document.documentElement.getAttribute('height'), '720');
  assert.ok(document.querySelectorAll('path, rect').length > 200, `${asset.name} 原有复杂矢量内容不得减少`);
  assert.ok(document.querySelectorAll('text').length > 0, `${asset.name} 原有文字不得减少`);
  const viewBox = document.documentElement.getAttribute('viewBox').split(/\s+/).map(Number);
  assert.equal(viewBox.length, 4);
  assert.ok(viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0);
  window.close();
}

// 提取器在独立进程中重建两次，输出媒体和清单都必须稳定。
const originalManifest = readFileSync(join(assetDirectory, 'manifest.json'));
for (let iteration = 0; iteration < 2; iteration++) {
  rmSync(assetDirectory, { recursive: true });
  succeed(run('make-metafile-assets.mjs'));
  assert.deepEqual(readFileSync(join(assetDirectory, 'manifest.json')), originalManifest);
  for (const asset of manifest.assets) assert.deepEqual(readFileSync(join(assetDirectory, asset.name)), Buffer.from(zip[asset.part]));
}
succeed(run('make-metafile-assets.mjs', ['--check']));
fail(run('make-metafile-assets.mjs', ['--unknown']), /未知参数/);
const invalidSource = join(project, 'fixtures/changed.pptx');
writeFileSync(invalidSource, new Uint8Array([80, 75, 0]));
fail(run('make-metafile-assets.mjs', ['--source-pptx', invalidSource]), /基线.*SHA256/);
assert.deepEqual(readFileSync(join(assetDirectory, 'manifest.json')), originalManifest);

for (const asset of manifest.assets) {
  const path = join(assetDirectory, asset.name);
  const bytes = readFileSync(path);
  rmSync(path);
  fail(run('make-metafile-fixture.mjs'), new RegExp(`缺少.*${asset.name.replace('.', '\\.')}`));
  writeFileSync(path, bytes.subarray(1));
  fail(run('make-metafile-fixture.mjs'), /字节数不符/);
  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  writeFileSync(path, changed);
  fail(run('make-metafile-fixture.mjs'), /SHA256 不符/);
  fail(run('make-metafile-assets.mjs', ['--check']), /不一致/);
  writeFileSync(path, bytes);
}
rmSync(join(assetDirectory, 'manifest.json'));
fail(run('make-metafile-fixture.mjs'), /缺少.*manifest\.json/);
writeFileSync(join(assetDirectory, 'manifest.json'), '{');
fail(run('make-metafile-fixture.mjs'), /JSON/);
for (const invalid of [
  null,
  { ...manifest, version: 0 },
  { ...manifest, source: { ...manifest.source, commit: 'unknown' } },
  { ...manifest, assets: [] },
  { ...manifest, assets: manifest.assets.map((asset) => ({ ...asset, sha256: 'invalid' })) },
]) {
  writeFileSync(join(assetDirectory, 'manifest.json'), JSON.stringify(invalid));
  fail(run('make-metafile-fixture.mjs'), /清单无效|资产记录无效/);
}
writeFileSync(join(assetDirectory, 'manifest.json'), originalManifest);
assert.deepEqual(build(), first);
recordCount('metafileFixture', assertions);
console.log(`Metafile 固件 ${assertions} 项断言：基线媒体、缓存独立、资产校验与确定性通过${dist ? '（发布入口）' : '（源码）'}`);
