/**
 * 发布前把仓库根的 LICENSE（以及 core 的 README）复制进包目录。
 *
 * npm 的 tarball 不跟随符号链接，且 `files` 里列了不存在的文件会静默漏掉
 * —— 结果是包发上去了但 npm 页面空白。由 prepack 触发，产物已 gitignore。
 */
import { copyFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = process.cwd();
const name = basename(pkgDir);

copyFileSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'));

// core 就是这个项目本体，直接用仓库根的 README；其余包各自维护
if (name === 'core') copyFileSync(join(root, 'README.md'), join(pkgDir, 'README.md'));
else if (!existsSync(join(pkgDir, 'README.md'))) {
  throw new Error(`${name} 缺少 README.md —— 发上去 npm 页面会是空白的`);
}

console.log(`  ${name}: 文档已同步`);
