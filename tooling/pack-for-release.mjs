import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

if (process.argv.length !== 2) throw new Error('用法: node tooling/pack-for-release.mjs（在已完成构建和 verify 的包目录运行）');
const root = resolve(import.meta.dirname, '..');
const cwd = process.cwd();
const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
const { name, version } = manifest;
if (typeof name !== 'string' || !name || typeof version !== 'string' || !version) {
  throw new Error(`${cwd}/package.json 必须声明非空 name 和 version`);
}
const label = `${name}@${version}`;
const directory = join(root, 'out/npm-release');
mkdirSync(directory, { recursive: true });
const output = mkdtempSync(join(directory, 'pack-'));
// prepack 同步 README / LICENSE；目录 publish 的 prepublishOnly 会把已验证的 dist 再构建一遍。
const packedText = execFileSync('npm', ['pack', '--json', '--foreground-scripts=false', '--pack-destination', output], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024,
});
const packed = JSON.parse(packedText);
if (!Array.isArray(packed) || packed.length !== 1) {
  throw new Error(`${label} 打包必须返回一个工件，实际 ${Array.isArray(packed) ? packed.length : typeof packed}`);
}
const artifact = packed[0];
if (artifact.name !== name || artifact.version !== version) {
  throw new Error(`${label} 打包身份不符，实际 ${artifact.name}@${artifact.version}`);
}
const filename = artifact.filename;
if (typeof filename !== 'string' || basename(filename) !== filename || !filename.endsWith('.tgz')) {
  throw new Error(`${label} 打包文件名无效: ${filename}`);
}
const tarball = resolve(output, filename);
if (!existsSync(tarball) || !statSync(tarball).isFile()) throw new Error(`${label} 打包文件不存在: ${tarball}`);
const bytes = readFileSync(tarball);
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const shasum = createHash('sha1').update(bytes).digest('hex');
if (artifact.integrity !== integrity || artifact.shasum !== shasum || artifact.size !== bytes.length) {
  throw new Error(`${label} 打包文件的完整性摘要或大小与 npm 元数据不符: ${tarball}`);
}
if (!Array.isArray(artifact.files)) throw new Error(`${label} 打包元数据缺少 files 清单`);
const files = new Set(artifact.files.map(file => file.path));
const required = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'];
const targets = value => {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'object') return Object.values(value).flatMap(targets);
  throw new Error(`${label} 发布入口必须是字符串、条件对象或数组，实际 ${typeof value}`);
};
required.push(...targets(manifest.exports), ...targets(manifest.bin));
for (const field of ['main', 'module', 'types', 'typings']) required.push(...targets(manifest[field]));
for (const target of required) {
  const path = target.startsWith('./') ? target.slice(2) : target;
  if (!files.has(path)) throw new Error(`${label} 打包缺少必需发布文件: ${target}`);
}
writeFileSync(join(output, 'metadata.json'), `${packedText.trim()}\n`);
console.log(tarball);
