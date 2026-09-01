import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = readFileSync(join(root, 'packages/editor/dist/editor.js'));
// 002 内建列表快捷键与富文本语义后的实测基线；viewer 不依赖本包，独立扩展仍不得进入主入口。
const baseline = { raw: 256_769, gzip: 63_439 };
const actual = { raw: bytes.length, gzip: gzipSync(bytes).length };
if (actual.raw !== baseline.raw || actual.gzip !== baseline.gzip) {
  throw new Error(`editor 主入口体积回归：${JSON.stringify({ baseline, actual })}`);
}
console.log(`editor 主入口体积基线匹配：${actual.raw} bytes / ${actual.gzip} bytes gzip`);
