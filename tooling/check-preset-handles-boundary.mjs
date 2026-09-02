/** 句柄定义约 21KB gzip；一旦进入默认入口，tree-shaking 已经来不及补救。 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const read = (path) => readFileSync(join(root, path), 'utf8');
// 预设名本来就在默认路径表；公式元组才是生成式句柄表独有内容。
const containsHandleFormula = (source) => /adj1"\s*,\s*"val 18750/.test(source);

if (target === 'core') {
  const names = readdirSync(join(root, 'packages/core/dist'));
  const defaults = names.filter((name) => name.endsWith('.js') && name !== 'geometry-handles.js')
    .map((name) => read(`packages/core/dist/${name}`));
  const optional = read('packages/core/dist/geometry-handles.js');
  if (names.some((name) => name.startsWith('guides-'))
    || defaults.some(containsHandleFormula) || !containsHandleFormula(optional)) {
    throw new Error('预设句柄定义没有只留在 core/geometry/handles 按需入口');
  }
} else if (target === 'edit-core') {
  const source = read('packages/edit-core/dist/edit-core.js');
  if (containsHandleFormula(source) || source.includes('@web-ppt/core/geometry/handles')) {
    throw new Error('edit-core 默认入口意外加载了预设句柄定义');
  }
} else throw new Error('请指定 core 或 edit-core 边界');

console.log(`${target} 预设句柄按需入口边界通过`);
