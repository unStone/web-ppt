import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = readFileSync(join(root, 'packages/editor/dist/editor.js'));
// 070 开工前同一锁文件、同一 Vite 配置的主入口基线；独立扩展不得贡献一个字节。
const baseline = { raw: 256_631, gzip: 63_305 };
const actual = { raw: bytes.length, gzip: gzipSync(bytes).length };
if (actual.raw !== baseline.raw || actual.gzip !== baseline.gzip) {
  throw new Error(`editor 主入口体积回归：${JSON.stringify({ baseline, actual })}`);
}
console.log(`editor 主入口零增长：${actual.raw} bytes / ${actual.gzip} bytes gzip`);
