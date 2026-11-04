import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { unzipSync } from 'fflate';
import { bundleNode } from './lib/bundle-node.mjs';
import { countedAssert } from './lib/counted-assert.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/zip-security');
mkdirSync(out, { recursive: true });
const dist = process.argv.includes('--dist');
const { assert, record } = countedAssert('zipSecurity');
const zip = dist ? await import('@web-ppt/core/zip') : await bundleNode({
  root, entry: join(root, 'packages/core/src/zip.ts'), output: join(out, 'zip-source.mjs'),
});
const core = dist ? await import('@web-ppt/core') : await bundleNode({
  root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'core-source.mjs'),
});
const opc = dist ? await import('@web-ppt/edit-core/opc') : await bundleNode({
  root, entry: join(root, 'packages/edit-core/src/opc/index.ts'), output: join(out, 'opc-source.mjs'),
});
const ole = dist ? await import('@web-ppt/edit-core/ole') : await bundleNode({
  root, entry: join(root, 'packages/edit-core/src/ole/index.ts'), output: join(out, 'ole-source.mjs'),
});
const { safeUnzipSync, ZipSafetyError } = zip;
const fixture = name => new Uint8Array(readFileSync(join(root,
  name.startsWith('sample-zip-') ? 'fixtures/zip-security' : 'fixtures', name)));
const reasonOf = fn => {
  try { fn(); } catch (error) {
    assert(error instanceof ZipSafetyError, `必须抛出 ZipSafetyError：${error}`);
    return error.reason;
  }
  throw new Error('恶意 ZIP 未被拒绝');
};

const sample = fixture('sample.pptx');
const expected = unzipSync(sample);
const actual = safeUnzipSync(sample);
assert.equal(Object.getPrototypeOf(actual), Object.prototype, '解压结果保持普通对象原型');
assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), '合法固件条目保持不变');
for (const name of Object.keys(expected)) assert.deepEqual(actual[name], expected[name], `合法 part 字节不变：${name}`);
const withNewline = new Uint8Array(sample.length + 1);
withNewline.set(sample);
withNewline[sample.length] = 0x0a;
assert.deepEqual(safeUnzipSync(withNewline), expected, '真实语料的 EOCD 尾随 LF 保持兼容');
const newlinePresentation = await core.parse(withNewline, { lazy: false });
assert(newlinePresentation.slides.length > 0, '尾随 LF 的真实 parse 结果不变');
newlinePresentation.dispose();

const cases = [
  ['sample-zip-bomb.pptx', 'zip-entry-too-large', { maxEntryBytes: 1024 * 1024 }],
  ['sample-zip-entry-count.pptx', 'zip-too-many-entries', { maxEntries: 10 }],
  ['sample-zip-duplicate-case.pptx', 'zip-duplicate-name'],
  ['sample-zip-duplicate-separator.pptx', 'zip-duplicate-name'],
  ['sample-zip-traversal.pptx', 'zip-invalid-name'],
  ['sample-zip-forged-size.pptx', 'zip-size-mismatch'],
  ['sample-zip-64.pptx', 'zip64-unsupported'],
  ['sample-zip-invalid-eocd.pptx', 'zip-invalid-structure'],
];
for (const [name, reason, limits] of cases) {
  const bytes = fixture(name);
  let directReason;
  try { directReason = reasonOf(() => safeUnzipSync(bytes, { limits })); }
  catch (error) { throw new Error(`${name} 直接读取失败：${error.message}`); }
  assert.equal(directReason, reason, `${name} 直接读取`);
  assert.equal(await core.parse(bytes, { lazy: false, zip: limits }).then(() => '(未抛错)', error => error.reason), reason,
    `${name} 真实 parse 入口`);
}

assert.equal(reasonOf(() => safeUnzipSync(sample, { limits: { maxTotalBytes: 1024 } })), 'zip-total-too-large');
assert.equal(reasonOf(() => safeUnzipSync(sample, { limits: { maxCompressionRatio: 1 } })), 'zip-compression-ratio');
assert.equal(reasonOf(() => safeUnzipSync(sample, { limits: { maxEntryBytes: 0 } })), 'zip-invalid-limit');
const presentation = await core.parse(sample, { keepPackage: true, lazy: false });
assert(presentation.slides.length > 0, 'keepPackage 的合法解析结果不变');
presentation.dispose();

const rawReason = fn => {
  try { fn(); } catch (error) { return error.reason; }
  throw new Error('边界入口未拒绝恶意 ZIP');
};
const duplicate = fixture('sample-zip-duplicate-case.pptx');
const duplicateParts = unzipSync(duplicate);
const borrowed = { format: 'pptx', bytes: duplicate, parts: duplicateParts, disposed: false };
assert.equal(rawReason(() => opc.patchOpcPackage(borrowed, { 'ppt/presentation.xml': new Uint8Array(0) })),
  'zip-duplicate-name', '保存前重新校验外部构造的原包');
assert.equal(rawReason(() => ole.readEmbeddedPackage(duplicate)), 'zip-duplicate-name', 'OLE 内嵌包共享同一名称边界');

if (typeof globalThis.gc !== 'function') throw new Error('内存断言需要 node --expose-gc');
globalThis.gc();
const before = process.memoryUsage().heapUsed;
const heapCapacityBefore = getHeapStatistics().total_heap_size;
assert.equal(reasonOf(() => safeUnzipSync(fixture('sample-zip-forged-size.pptx'))), 'zip-size-mismatch');
const heapCapacityGrowth = getHeapStatistics().total_heap_size - heapCapacityBefore;
assert(heapCapacityGrowth < 2 * 1024 * 1024,
  `伪造 8MB 输出的堆容量增长必须有界，growth=${heapCapacityGrowth}`);
globalThis.gc();
const retained = process.memoryUsage().heapUsed - before;
assert(retained < 2 * 1024 * 1024, `伪造 8MB 输出在 16 字节声明处终止， retained=${retained}`);

record();
console.log(`ZIP 安全：声明预检、实际输出、路径与真实 parse 入口通过（${dist ? 'dist' : '源码'}，retained=${retained}）`);
