import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import Arborist from '@npmcli/arborist';
import mapWorkspaces from '@npmcli/map-workspaces';
import packlist from 'npm-packlist';

const templateExtensions = new Set([
  '.ppt',
  '.pptx',
  '.pptm',
  '.pot',
  '.potx',
  '.potm',
  '.pps',
  '.ppsx',
  '.ppsm',
  '.ppa',
  '.ppam',
  '.sldx',
  '.sldm',
  '.thmx',
  '.odp',
  '.otp',
]);

export async function auditPublishedTemplateBinaries(directory) {
  const root = resolve(directory);
  const readPackage = (path) => JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const workspaces = await mapWorkspaces({ cwd: root, pkg: readPackage(root) });
  const publicWorkspaces = [];
  for (const [name, directory] of [...workspaces].sort(([a], [b]) => a.localeCompare(b))) {
    const path = resolve(directory);
    const manifest = readPackage(path);
    if (manifest.name !== name || (manifest.private !== undefined && typeof manifest.private !== 'boolean')) {
      throw new Error(`npm workspace 发布声明无效：${path}；预期 name=${name} 和布尔 private`);
    }
    if (manifest.private === true) continue;
    publicWorkspaces.push({ name, path });
  }
  if (publicWorkspaces.length === 0) throw new Error(`没有可发布的 npm workspace：${root}；预期至少一个非 private 包`);

  const workspacePaths = publicWorkspaces.map(({ path }) => path);
  const packages = [];
  for (const { name, path } of publicWorkspaces) {
    // 独立加载待发布目录，避免把 workspace 的普通依赖误作 bundled dependency。
    const tree = await new Arborist({ path }).loadActual();
    // 三个路径参数保留 npm 对 workspace 祖先忽略规则的实际处理。
    const files = await packlist(tree, { path, prefix: root, workspaces: workspacePaths });
    if (!Array.isArray(files) || files.length === 0 || files.some((file) => typeof file !== 'string' || file.length === 0)) {
      throw new Error(`npm-packlist 缺少有效文件清单：${path} / ${name}`);
    }
    packages.push({ name, files });
  }
  const binaries = packages.flatMap(({ name, files }) =>
    files.filter((path) => templateExtensions.has(extname(path).toLowerCase())).map((path) => `${name}: ${path}`),
  );
  if (binaries.length) throw new Error(`npm 发布包包含固定演示稿或模板二进制：${binaries.join(', ')}`);
  return packages;
}
