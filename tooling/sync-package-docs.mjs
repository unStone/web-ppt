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
// 更新日志两个包共用一份：装了包的人看不到 git log，只能靠它知道版本间的变化
copyFileSync(join(root, 'CHANGELOG.md'), join(pkgDir, 'CHANGELOG.md'));

// core 就是这个项目本体，直接用仓库根的 README —— 取英文版。
// npm 页面的读者以国际开发者为主，GitHub 首页则留给中文社区，两边各自面向
// 自己的人群；两份 README 顶部互链，谁都不会走丢。
if (name === 'core') copyFileSync(join(root, 'README.en.md'), join(pkgDir, 'README.md'));
else if (!existsSync(join(pkgDir, 'README.md'))) {
  throw new Error(`${name} 缺少 README.md —— 发上去 npm 页面会是空白的`);
}

console.log(`  ${name}: 文档已同步`);
