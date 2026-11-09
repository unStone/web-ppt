import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'out/release-pack');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(output, 'case-'));
const cwd = join(temporary, 'package');
const wrappers = join(temporary, 'bin');
mkdirSync(cwd);
mkdirSync(wrappers);
const helper = join(root, 'tooling/publish-if-new.sh');
const trace = join(temporary, 'trace.jsonl');
const lifecycle = join(cwd, 'lifecycle.txt');
const env = {
  ...process.env, PATH: `${wrappers}${delimiter}${process.env.PATH}`,
  RELEASE_TEST_REAL_PATH: process.env.PATH, RELEASE_TEST_TRACE: trace,
  npm_config_cache: join(temporary, 'npm-cache'),
};
// npm 在 dry-run 之前也可能尝试 OIDC；发布测试不能继承 CI 的交换入口或令牌。
for (const key of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_ID_TOKEN', 'SIGSTORE_ID_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) delete env[key];
writeFileSync(join(wrappers, 'npm'), `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
appendFileSync(process.env.RELEASE_TEST_TRACE, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
if (args[0] === 'view') process.exit(process.env.RELEASE_TEST_EXISTS === 'true' ? 0 : 1);
if (!['pack', 'publish'].includes(args[0])) throw new Error('禁止未声明的 npm 命令');
if (args[0] === 'publish' && process.env.RELEASE_TEST_PUBLISH !== 'dry-run') process.exit(0);
if (args[0] === 'publish') args.push('--dry-run', '--offline', '--json');
const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, PATH: process.env.RELEASE_TEST_REAL_PATH } });
if (result.error) throw result.error;
if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status ?? 1); }
if (args[0] === 'pack' && process.env.RELEASE_TEST_CORRUPT) {
  const value = JSON.parse(result.stdout);
  const mode = process.env.RELEASE_TEST_CORRUPT;
  if (mode === 'name') value[0].name = '@other/package';
  if (mode === 'version') value[0].version = '9.9.9';
  if (mode === 'filename') value[0].filename = '../unsafe.tgz';
  if (mode === 'missing-file') value[0].filename = 'absent.tgz';
  if (mode === 'duplicate') value.push(value[0]);
  if (mode === 'license') value[0].files = value[0].files.filter(file => file.path !== 'LICENSE');
  if (mode === 'integrity') value[0].integrity = 'sha512-invalid';
  process.stdout.write(JSON.stringify(value));
} else process.stdout.write(result.stdout);
`);
chmodSync(join(wrappers, 'npm'), 0o755);
writeFileSync(join(wrappers, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(join(cwd, 'lifecycle.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
const event = process.argv[2];
appendFileSync('lifecycle.txt', event + '\\n');
if (event === 'prepublishOnly') throw new Error('prepublishOnly 构建哨兵');
for (const name of ['README.md', 'CHANGELOG.md', 'LICENSE']) writeFileSync(name, event + ':' + name);
`);
mkdirSync(join(cwd, 'dist'));
writeFileSync(join(cwd, 'dist/index.js'), 'export const ready = true;\n');
writeFileSync(join(cwd, 'dist/index.d.ts'), 'export declare const ready: boolean;\n');
const manifest = {
  name: '@web-ppt/release-lifecycle-proof', version: '1.0.0', type: 'module',
  main: './dist/index.js', types: './dist/index.d.ts',
  exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './package.json': './package.json' },
  files: ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE'], publishConfig: { access: 'public' },
  scripts: { prepublishOnly: 'node lifecycle.mjs prepublishOnly', prepack: 'node lifecycle.mjs prepack' },
};
const setVersion = version => {
  manifest.version = version;
  writeFileSync(join(cwd, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};
const events = () => existsSync(lifecycle) ? readFileSync(lifecycle, 'utf8').trim().split('\n') : [];
const traceEntries = () => existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
const reset = () => { rmSync(trace, { force: true }); rmSync(lifecycle, { force: true }); };
const run = (args = [], extra = {}) => spawnSync('bash', [helper, ...args], {
  cwd, env: { ...env, ...extra }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
let passed = 0;
const checks = [];
const check = (name, fn) => { reset(); fn(); passed++; checks.push(name); };
const hashDist = () => Object.fromEntries(readdirSync(join(cwd, 'dist')).map(name => {
  const file = join(cwd, 'dist', name);
  return [name, [createHash('sha256').update(readFileSync(file)).digest('hex'), String(statSync(file, { bigint: true }).mtimeNs)]];
}));
try {
  setVersion('1.0.0');
  for (const args of [['--unknown'], ['--verified-build', '--verified-build'], ['--verified-build', '--unknown']]) {
    check(`无效参数 ${args.join(' ')} 在网络和打包前失败`, () => {
      const result = run(args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /参数|用法/);
      assert.deepEqual(traceEntries(), []);
    });
  }
  for (const args of [[], ['--verified-build']]) check(`${args.length ? '复用' : '默认'}模式已存在版本不打包`, () => {
    assert.equal(run(args, { RELEASE_TEST_EXISTS: 'true' }).status, 0);
    assert.deepEqual(traceEntries().map(entry => entry.args[0]), ['view']);
    assert.deepEqual(events(), []);
  });
  for (const [version, tag] of [['1.0.0', 'latest'], ['1.0.0-beta.1', 'next']]) {
    check(`默认 ${version} 保持目录 publish 与 ${tag}`, () => {
      setVersion(version);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(traceEntries().map(entry => entry.args), [
        ['view', `${manifest.name}@${version}`, 'version'], ['publish', '--tag', tag],
      ]);
      assert.ok(traceEntries().every(entry => entry.cwd === cwd));
    });
    check(`已验证 ${version} 只打包一次并 dry-run 明确 tgz 与 ${tag}`, () => {
      setVersion(version);
      const before = hashDist();
      const result = run(['--verified-build'], { RELEASE_TEST_PUBLISH: 'dry-run' });
      assert.equal(result.status, 0, result.stderr);
      const entries = traceEntries();
      assert.deepEqual(entries.map(entry => entry.args[0]), ['view', 'pack', 'publish']);
      const publish = entries.at(-1).args;
      assert.ok(publish[1].endsWith('.tgz'));
      assert.deepEqual(publish.slice(2), ['--tag', tag]);
      assert.ok(entries.every(entry => entry.cwd === cwd));
      assert.deepEqual(events(), ['prepack']);
      assert.deepEqual(hashDist(), before);
      writeFileSync(join(output, 'last-dry-run.log'), result.stdout);
      const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
      const data = report.name === manifest.name ? report : report[manifest.name];
      assert.ok(data, 'npm dry-run 必须包含当前包的元数据');
      assert.equal(data.name, manifest.name);
      assert.equal(data.version, version);
      const [metadata] = JSON.parse(readFileSync(join(dirname(publish[1]), 'metadata.json'), 'utf8'));
      for (const field of ['integrity', 'shasum', 'size', 'files']) assert.deepEqual(data[field], metadata[field]);
      for (const name of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
        assert.equal(execFileSync('tar', ['-xOf', publish[1], `package/${name}`], { encoding: 'utf8' }), `prepack:${name}`);
      }
    });
  }
  check('普通目录 publish dry-run 仍执行 prepublishOnly 构建哨兵', () => {
    const result = spawnSync('npm', ['publish', '--dry-run', '--offline', '--tag', 'next'], {
      cwd, env: { ...env, PATH: process.env.PATH }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /prepublishOnly 构建哨兵/);
    assert.deepEqual(events(), ['prepublishOnly']);
  });
  for (const mode of ['name', 'version', 'filename', 'missing-file', 'duplicate', 'license', 'integrity']) {
    check(`打包元数据 ${mode} 异常时不进入 publish`, () => {
      const result = run(['--verified-build'], { RELEASE_TEST_CORRUPT: mode });
      assert.notEqual(result.status, 0);
      assert.ok(!traceEntries().some(entry => entry.args[0] === 'publish'));
    });
  }
  check('缺失已声明发布入口时不进入 publish', () => {
    manifest.exports['./missing'] = './dist/missing.js';
    setVersion('1.0.0');
    const result = run(['--verified-build']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing\.js/);
    assert.ok(!traceEntries().some(entry => entry.args[0] === 'publish'));
    delete manifest.exports['./missing'];
    setVersion('1.0.0');
  });
  check('release 九包仅在根构建和 verify 后显式复用已验产物', () => {
    const release = parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8'));
    const steps = release.jobs.publish.steps;
    const build = steps.findIndex(step => step.run === 'npm run build');
    const verify = steps.findIndex(step => step.run === 'npm run verify');
    const publish = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.run?.includes('publish-if-new.sh'));
    assert.equal(publish.length, 9);
    for (const { step, index } of publish) {
      assert.equal(step.run, 'bash ../../tooling/publish-if-new.sh --verified-build');
      assert.ok(build >= 0 && verify > build && index > verify);
      const pkg = JSON.parse(readFileSync(join(root, step['working-directory'], 'package.json'), 'utf8'));
      assert.equal(pkg.scripts.prepublishOnly, 'npm run build');
    }
  });
  writeFileSync(join(output, 'validation.json'), `${JSON.stringify({ passed, checks, actualPublishing: false,
    actualOidcExchange: false }, null, 2)}\n`);
  console.log(`发布复用构建：${passed} 项生命周期、参数、工件和标签契约通过（未真实发布或交换 OIDC）`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
