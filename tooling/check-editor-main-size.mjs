import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = readFileSync(join(root, 'packages/editor/dist/editor.js'));
// 005 高频对象/页面工具栏 seam 后的实测基线；独立扩展仍不得进入主入口。
const baseline = { raw: 267_306, gzip: 65_721 };
const actual = { raw: bytes.length, gzip: gzipSync(bytes).length };
if (actual.raw !== baseline.raw || actual.gzip !== baseline.gzip) {
  throw new Error(`editor 主入口体积回归：${JSON.stringify({ baseline, actual })}`);
}
console.log(`editor 主入口体积基线匹配：${actual.raw} bytes / ${actual.gzip} bytes gzip`);
