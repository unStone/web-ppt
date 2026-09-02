import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = readFileSync(join(root, 'packages/editor/dist/editor.js'));
// 006 触屏交互后实测基线；viewer 零增量，顶点/调节柄等独立扩展仍不得进入主入口。
const baseline = { raw: 278_318, gzip: 68_526 };
const actual = { raw: bytes.length, gzip: gzipSync(bytes).length };
if (actual.raw !== baseline.raw || actual.gzip !== baseline.gzip) {
  throw new Error(`editor 主入口体积回归：${JSON.stringify({ baseline, actual })}`);
}
console.log(`editor 主入口体积基线匹配：${actual.raw} bytes / ${actual.gzip} bytes gzip`);
