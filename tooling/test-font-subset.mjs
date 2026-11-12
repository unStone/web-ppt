/**
 * 导出字体子集化引擎（@web-ppt/fonts/subset）自测。
 *
 *   node tooling/test-font-subset.mjs [--dist]
 *
 * 用真实 harfbuzz-subset.wasm 对固件字体跑完整闭环：覆盖正确性（自实现 cmap 读取，
 * 与 font-glyph 样本工程同一做法）、确定性、输入不变、容器拒绝、畸形输入不抛、
 * dispose 语义；另有 pyftsubset 交叉验证（本机有 fontTools 时执行，不计入断言数）。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { countedAssert } from './lib/counted-assert.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { fontSample } from './lib/font-glyph-samples.mjs';

const { assert, record } = countedAssert('fontSubset');
const root = resolve('.');
const out = join(root, 'out/font-subset');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, "export * from '@web-ppt/fonts/subset';");
const api = process.argv.includes('--dist')
  ? await import('@web-ppt/fonts/subset')
  : await bundleBrowser({
      root,
      entry,
      output: join(out, 'contract.mjs'),
      aliases: [['@web-ppt/fonts/subset', join(root, 'packages/fonts/src/subset/index.ts')]],
    });

/* ── 测试侧 cmap 读取（format 4 / 12）：与 font-glyph 固件工程同一做法，只做验收 ── */
function cmapCodepoints(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cmapRecord = -1;
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(record, record + 4)) === 'cmap') {
      cmapRecord = record;
      break;
    }
  }
  if (cmapRecord < 0) throw new Error('字体缺少 cmap 表');
  const cmapOff = view.getUint32(cmapRecord + 8);
  const subCount = view.getUint16(cmapOff + 2);
  let best = null;
  for (let i = 0; i < subCount; i++) {
    const sub = cmapOff + 4 + i * 8;
    const platform = view.getUint16(sub),
      encoding = view.getUint16(sub + 2);
    const offset = cmapOff + view.getUint32(sub + 4);
    const score = platform === 3 ? (encoding === 10 ? 3 : encoding === 1 ? 2 : 0) : platform === 0 ? 1 : 0;
    if (score && (!best || score > best.score)) best = { score, offset };
  }
  if (!best) throw new Error('没有 Unicode cmap 子表');
  const off = best.offset;
  const format = view.getUint16(off);
  const codes = new Set();
  if (format === 4) {
    const segCount = view.getUint16(off + 6) / 2;
    const endBase = off + 14,
      startBase = off + 16 + segCount * 2,
      deltaBase = off + 16 + segCount * 4,
      rangeBase = off + 16 + segCount * 6;
    for (let seg = 0; seg < segCount; seg++) {
      const end = view.getUint16(endBase + seg * 2),
        start = view.getUint16(startBase + seg * 2);
      if (start === 0xffff) continue;
      const delta = view.getInt16(deltaBase + seg * 2),
        rangeOff = view.getUint16(rangeBase + seg * 2);
      for (let c = start; c <= end && c < 0xffff; c++) {
        const glyph = rangeOff === 0 ? (c + delta) & 0xffff : view.getUint16(off + rangeBase + seg * 2 + rangeOff + (c - start) * 2);
        if (glyph !== 0) codes.add(c);
      }
    }
  } else if (format === 12) {
    for (let g = 0; g < view.getUint32(off + 12); g++) {
      const base = off + 16 + g * 12;
      const start = view.getUint32(base),
        end = view.getUint32(base + 4);
      if (view.getUint32(base + 8) !== 0) for (let c = start; c <= end; c++) codes.add(c);
    }
  } else {
    throw new Error(`验收读取不支持 cmap format ${format}`);
  }
  return codes;
}

const subsetter = await api.createHarfBuzzSubsetter(readFileSync(join(root, 'node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm')));
assert.equal(typeof subsetter.subset, 'function', 'wasm 字节能构造出 FontSubsetter');

/* ── 中文精确子集 ── */
const chinese = fontSample('chinese.ttf');
const requested = '你好世界字体导出';
const expected = new Set([...requested].map((c) => c.codePointAt(0)).filter((c) => cmapCodepoints(chinese).has(c)));
const ask = (bytes, mime, chars) => subsetter.subset({ bytes, mime, chars, family: '验收', bold: false, italic: false });
const first = await ask(chinese, 'font/ttf', requested);
assert.equal(first.ok, true, '中文 sfnt 可子集化');
assert.ok(
  first.ok && first.bytes.length < chinese.length,
  `子集显著小于原字体（${first.ok ? first.bytes.length : 0} < ${chinese.length}）`,
);
assert.ok(
  first.ok && first.bytes[0] === 0 && first.bytes[1] === 1 && first.bytes[2] === 0 && first.bytes[3] === 0,
  '子集仍是 TrueType sfnt',
);
assert.deepEqual(
  first.ok && [...cmapCodepoints(first.bytes)],
  [...expected].sort((a, b) => a - b),
  '子集 cmap 恰好等于请求字符与原字体的交集',
);

/* ── 确定性与输入不变 ── */
const chineseCopy = chinese.slice();
const second = await ask(chinese, 'font/ttf', requested);
assert.deepEqual(second.ok && second.bytes, first.ok && first.bytes, '同输入两次子集化字节一致');
assert.deepEqual(chinese, chineseCopy, '子集化不修改输入字体字节');

/* ── CFF 轮廓 OTF ── */
const cff = fontSample('cff.otf');
const cffChars = [...cmapCodepoints(cff)].slice(0, 3);
const cffResult = await ask(cff, 'font/otf', String.fromCodePoint(...cffChars));
assert.equal(cffResult.ok, true, 'CFF 轮廓 OTF 可子集化');
assert.ok(cffResult.ok && cffResult.bytes[0] === 0x4f && cffResult.bytes[1] === 0x54, 'OTF 子集保留 OTTO 魔数');

/* ── 容器与畸形输入 ── */
assert.deepEqual(
  await ask(new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]), 'font/woff', 'A'),
  { ok: false, reason: 'subset-failed' },
  'WOFF 容器明确失败（引擎只认 sfnt）',
);
const garbage = await ask(new Uint8Array(64).fill(0x7f), 'font/ttf', 'A');
assert.equal(garbage.ok, false, '畸形 sfnt 返回失败而不是抛错');

/* ── dispose 语义 ── */
subsetter.dispose();
await assert.rejects(() => ask(chinese, 'font/ttf', requested), /已释放/, '释放后的引擎调用立即失败');
record();

/* ── pyftsubset 交叉验证：本机有 fontTools 时执行，不计入断言数 ── */
try {
  const pyft = join(out, 'pyft.ttf');
  execFileSync(
    'python3',
    ['-m', 'fontTools.subset', join(root, 'tooling/font-glyph-samples/chinese.ttf'), `--text=${requested}`, `--output-file=${pyft}`],
    { stdio: 'pipe' },
  );
  const cross = new Set(cmapCodepoints(new Uint8Array(readFileSync(pyft))));
  if (first.ok) {
    const mine = new Set(cmapCodepoints(first.bytes));
    if (cross.size !== mine.size || [...cross].some((c) => !mine.has(c))) {
      throw new Error(
        `pyftsubset 与 hb-subset 覆盖不一致：pyft=${[...cross].map((c) => c.toString(16))} hb=${[...mine].map((c) => c.toString(16))}`,
      );
    }
    console.log('  pyftsubset 交叉验证：覆盖一致');
  }
} catch (error) {
  if (/No module named/.test(String(error.message))) console.log('  本机缺少 fontTools，跳过 pyftsubset 交叉验证');
  else throw error;
}
console.log('字体子集化引擎断言通过');
