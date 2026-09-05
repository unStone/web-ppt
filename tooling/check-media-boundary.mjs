/** 递归检查静态依赖，避免媒体签名校验躲进共享 chunk 后漏过默认入口检查。 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sentinels = ['音频不是完整的 PCM WAV 文件', '视频不是完整的自包含 MP4 文件'];
const seen = new Set();
function inspect(path) {
  if (seen.has(path)) return;
  seen.add(path);
  const source = readFileSync(path, 'utf8');
  if (sentinels.some((sentinel) => source.includes(sentinel))) throw new Error(`媒体上传校验静态泄漏：${path}`);
  for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](\.[^"']+)["']/g)) {
    inspect(resolve(dirname(path), match[1]));
  }
}
for (const name of ['edit-core', 'editor', 'react', 'vue']) {
  inspect(join(root, 'packages', name, 'dist', `${name}.js`));
}
const entry = readFileSync(join(root, 'packages/edit-core/dist/media.js'), 'utf8');
if (!sentinels.every((sentinel) => entry.includes(sentinel)) || !entry.includes('createMediaEditor')) {
  throw new Error('media 子入口缺少上传实现');
}
console.log(`媒体按需入口边界通过：${seen.size} 个默认静态模块没有上传实现`);
