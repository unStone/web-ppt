import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = readFileSync(join(root, 'packages/editor/dist/editor.js'));
// 008 集成接缝后实测基线；viewer 零增量，图片 ZIP、顶点/调节柄仍不得进入主入口。
const baseline = { raw: 282_240, gzip: 69_718 };
const actual = { raw: bytes.length, gzip: gzipSync(bytes).length };
if (actual.raw !== baseline.raw || actual.gzip !== baseline.gzip) {
  throw new Error(`editor 主入口体积回归：${JSON.stringify({ baseline, actual })}`);
}
console.log(`editor 主入口体积基线匹配：${actual.raw} bytes / ${actual.gzip} bytes gzip`);
