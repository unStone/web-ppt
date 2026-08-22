/**
 * 发布前把仓库根的 LICENSE（以及 core 的 README）复制进包目录。
 *
 * npm 的 tarball 不跟随符号链接，且 `files` 里列了不存在的文件会静默漏掉
 * —— 结果是包发上去了但 npm 页面空白。由 prepack 触发，产物已 gitignore。
 */
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * npm 认哪个文件当 README，不是「就叫 README.md 的那个」。
 *
 * `@npmcli/package-json` 用 `{README,README.*}` 去 glob，取第一个像 markdown
 * 的命中——`README.zh-CN.md` 同样匹配 `README.*`，而且实测会排在 `README.md`
 * 前面。于是 tarball 里躺着英文版（`files` 挡住了别的），npm 页面上显示的
 * 却是中文版，两边不一致，`npm view <pkg> readme` 才看得出来。
 *
 * 本地化的 README 因此一律用连字符：`README-zh-CN.md` 不匹配 `README.*`。
 * 这里守住，别再让它悄悄跑回去。
 */
function assertReadmeUnambiguous(dir, name) {
  const rogue = readdirSync(dir).filter((f) => /^readme\..+/i.test(f) && f !== 'README.md');
  if (rogue.length) {
    throw new Error(
      `${name}: ${rogue.join(' / ')} 会被 npm 当成 README 顶掉 README.md —— ` +
      `本地化版本改用连字符（README-zh-CN.md）`,
    );
  }
}

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

assertReadmeUnambiguous(pkgDir, name);

console.log(`  ${name}: 文档已同步`);
