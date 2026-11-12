/**
 * 把全部发布包改到同一版本：`npm run release:version -- 0.9.0-beta.1`
 *
 * 九个包必须同版本，包之间的 peer 依赖因此写精确版本——宿主混装
 * `@web-ppt/editor@0.9.0` 与 `@web-ppt/core@0.8.0` 时，npm 在安装阶段报冲突，
 * 而不是到运行时才因缺少新导出崩溃。`^0.8.0` 这类范围会放行同一次版本线里的
 * 不同修订版，与「必须同版本」矛盾。
 *
 * 只改 package.json 与 package-lock.json；CHANGELOG 与发布记录由人工撰写。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv[2];
const version = semver.valid(requested);
if (!version) {
  throw new Error(`版本号「${requested ?? '（未提供）'}」不是合法的 semver；用法：npm run release:version -- 0.9.0`);
}

const manifests = readdirSync(join(root, 'packages'))
  .sort()
  .map((dir) => join(root, 'packages', dir, 'package.json'))
  .filter((file) => existsSync(file))
  .map((file) => ({ file, json: JSON.parse(readFileSync(file, 'utf8')) }))
  .filter(({ json }) => !json.private);
const ownNames = new Set(manifests.map(({ json }) => json.name));

for (const { file, json } of manifests) {
  json.version = version;
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const name of Object.keys(json[field] ?? {})) {
      if (ownNames.has(name)) json[field][name] = version;
    }
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: root, stdio: 'inherit' });
console.log(`${manifests.length} 个发布包已改为 ${version}：${[...ownNames].join('、')}`);
