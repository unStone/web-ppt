import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';

const templateExtensions = new Set([
  '.ppt', '.pptx', '.pptm', '.pot', '.potx', '.potm', '.pps', '.ppsx', '.ppsm',
  '.ppa', '.ppam', '.sldx', '.sldm', '.thmx', '.odp', '.otp',
]);

export function auditPublishedTemplateBinaries(root) {
  const npmJson = (args) => {
    const output = execFileSync('npm', [...args, '--ignore-scripts', '--cache', join(root, 'out/agent-eval/npm-publish-audit-cache')], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000,
    });
    try {
      return JSON.parse(output);
    } catch (cause) {
      throw new Error(`npm 发布清单不是有效 JSON：${root} / npm ${args.join(' ')}`, { cause });
    }
  };
  const workspaces = npmJson(['pkg', 'get', 'name', 'private', '--workspaces', '--json', '--include-workspace-root=false']);
  if (!workspaces || typeof workspaces !== 'object' || Array.isArray(workspaces)) {
    throw new Error(`npm workspace 清单无效：${root}；预期包名到 name/private 的映射`);
  }
  const names = Object.entries(workspaces).flatMap(([key, value]) => {
    if (!value || value.name !== key || (value.private !== undefined && typeof value.private !== 'boolean')) {
      throw new Error(`npm workspace 发布声明无效：${root} / ${key}；预期相同 name 和布尔 private`);
    }
    return value.private === true ? [] : [value.name];
  }).sort();
  if (names.length === 0) throw new Error(`没有可发布的 npm workspace：${root}；预期至少一个非 private 包`);

  // 仓库内的自测证据可以是二进制；交付边界必须由 npm 自身的打包规则判定。
  const packed = npmJson(['pack', '--dry-run', '--json', '--include-workspace-root=false', ...names.flatMap((name) => ['--workspace', name])]);
  if (!Array.isArray(packed) || packed.length !== names.length ||
      new Set(packed.map((entry) => entry?.name)).size !== names.length ||
      packed.some((entry) => !names.includes(entry?.name))) {
    throw new Error(`npm pack 发布包集合不符：${root}；预期 ${names.join(', ')}`);
  }
  const packages = packed.map((entry) => {
    if (!Array.isArray(entry.files) || entry.files.length === 0 ||
        entry.files.some((file) => !file || typeof file.path !== 'string' || file.path.length === 0)) {
      throw new Error(`npm pack 缺少有效文件清单：${root} / ${entry.name}`);
    }
    return { name: entry.name, files: entry.files.map(({ path }) => path) };
  });
  const binaries = packages.flatMap(({ name, files }) => files
    .filter((path) => templateExtensions.has(extname(path).toLowerCase()))
    .map((path) => `${name}: ${path}`));
  if (binaries.length) throw new Error(`npm 发布包包含固定演示稿或模板二进制：${binaries.join(', ')}`);
  return packages;
}
