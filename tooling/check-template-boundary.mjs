/** 内置配方必须只存在于 edit-core/templates 动态入口，默认入口不能靠 tree-shaking 碰运气。 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const sentinel = '极光主光晕';
const templateEntry = 'packages/edit-core/dist/templates.js';
if (!existsSync(join(root, templateEntry)) || !read(templateEntry).includes(sentinel)) {
  throw new Error('edit-core/templates 没有包含内置模板配方');
}

const defaults = [
  'packages/core/dist/core.js',
  'packages/edit-core/dist/edit-core.js',
  'packages/edit-core/dist/generate.js',
  'packages/editor/dist/editor.js',
  'packages/react/dist/react.js',
  'packages/vue/dist/vue.js',
];
const leaked = defaults.filter((path) => read(path).includes(sentinel));
if (leaked.length) throw new Error(`内置模板配方泄漏到默认入口：${leaked.join('、')}`);

const editCoreMain = readFileSync(join(root, 'packages/edit-core/dist/edit-core.js'));
const editCoreGzip = gzipSync(editCoreMain).length;
if (editCoreGzip > 82_503) {
  throw new Error(`edit-core 默认入口由模板功能增大：${editCoreGzip}B gzip > 82503B`);
}

for (const path of [
  'packages/editor/dist/templates.js',
  'packages/react/dist/templates.js',
  'packages/vue/dist/templates.js',
]) {
  if (!existsSync(join(root, path)) || read(path).includes(sentinel)) {
    throw new Error(`${path} 必须只转发模板入口，不能复制配方`);
  }
}

console.log(`内置模板按需入口边界通过；edit-core 默认入口 ${editCoreGzip}B gzip`);
