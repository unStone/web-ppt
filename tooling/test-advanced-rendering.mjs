import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { join, resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { example } from './lib/emf-plus-fixture.mjs';
import { recordCount } from './lib/measured.mjs';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = resolve('.');
const out = join(root, 'out/advanced-rendering');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export { prepareAdvancedRendering } from '${root}/packages/core/src/advanced-rendering.ts';
export * as core from '${root}/packages/core/src/index.ts';`);
const bundled = await bundleBrowser({
  root,
  entry,
  output: join(out, 'contract.mjs'),
  aliases: [['@web-ppt/core', join(root, 'packages/core/src/index.ts')]],
});
const dist = process.argv.includes('--dist');
const { prepareAdvancedRendering } = dist
  ? await import('@web-ppt/core/advanced-rendering')
  : bundled;
const core = dist ? await import('@web-ppt/core') : bundled.core;
const emfFile = readFileSync(join(root, 'fixtures/sample-emf-plus.pptx'));

let count = 0;
const check = (condition, label) => { assert(condition, label); count++; };
const slideSvg = async (bytes) => {
  const presentation = await core.parse(bytes, { lazy: false });
  const svg = core.renderSlideToSvg(presentation, presentation.slides[0], { textMode: 'svg' });
  presentation.dispose();
  return svg;
};

const scene = `<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d><a:sp3d extrusionH="${px(50)}"/>`;
const box = (effect = '') => slideXml(sp({
  x: 80, y: 90, w: 240, h: 150, name: 'box', prst: 'rect', fill: solid('4472C4'), effect,
}));
const plain = deck({ slides: [box()], width: 1280, height: 720, name: 'Plain' });
const spatial = deck({ slides: [box(scene)], width: 1280, height: 720, name: 'Spatial' });
const trap = deck({
  slides: [box(scene)],
  width: 1280,
  height: 720,
  name: 'Trap',
  extraTypes: '<Default Extension="png" ContentType="image/png"/><Default Extension="emf" ContentType="image/x-emf"/>',
  extraEntries: [
    ['ppt/media/huge.png', new Uint8Array(64 * 1024)],
    ['ppt/media/image1.emf', example()],
  ],
});

function corruptDeflate(zip, name) {
  const nameBytes = new TextEncoder().encode(name);
  for (let i = 0; i + 30 + nameBytes.length <= zip.length; i++) {
    if (zip[i] !== 0x50 || zip[i + 1] !== 0x4b || zip[i + 2] !== 0x03 || zip[i + 3] !== 0x04) continue;
    const nameLen = zip[i + 26] | (zip[i + 27] << 8);
    const extraLen = zip[i + 28] | (zip[i + 29] << 8);
    if (nameLen !== nameBytes.length) continue;
    if (!nameBytes.every((byte, index) => zip[i + 30 + index] === byte)) continue;
    const method = zip[i + 8] | (zip[i + 9] << 8);
    if (method !== 8) throw new Error(`${name} 必须是 deflate，才能用损坏流证明未解压`);
    const size = (zip[i + 18] | (zip[i + 19] << 8) | (zip[i + 20] << 16) | (zip[i + 21] << 24)) >>> 0;
    const start = i + 30 + nameLen + extraLen;
    if (size < 4) throw new Error(`${name} 压缩块太短`);
    zip[start] ^= 0xff;
    zip[start + 1] ^= 0xff;
    zip[start + 2] ^= 0xff;
    zip[start + 3] ^= 0xff;
    return zip;
  }
  throw new Error(`找不到 ${name}`);
}

const broken = corruptDeflate(trap, 'ppt/media/huge.png');
assert.throws(() => unzipSync(broken), '整包解压必须撞上损坏的照片');
count++;

core.setMetafileDecoder(() => 'SENTINEL');
core.setShape3DRenderer(() => 'SENTINEL');
await prepareAdvancedRendering(plain);
check((await slideSvg(emfFile)).includes('SENTINEL'), '普通稿不换图元 decoder');
check(!(await slideSvg(spatial)).includes('data-projection'), '普通稿不启用三维');

const raw = new Uint8Array(32);
raw.set([0xd0, 0xcf, 0x11, 0xe0]);
raw.set([0x45, 0x4d, 0x46, 0x2b, 1, 0x40], 8);
await prepareAdvancedRendering(raw);
const rawSvg = await slideSvg(emfFile);
check((rawSvg.includes('linearGradient') || decodeURIComponent(rawSvg).includes('linearGradient'))
  && !rawSvg.includes('SENTINEL'), '非 PK 仍按字节识别 EMF+');

let chartHits = 0;
core.setChartExParser(() => { chartHits += 1; return []; });
await prepareAdvancedRendering(broken);
check(chartHits === 0, '本入口不得调用 ChartEx parser');
const spatialSvg = await slideSvg(spatial);
check(spatialSvg.includes('data-projection') && !spatialSvg.includes('SENTINEL'), '损坏照片不能挡住三维首帧');
core.setChartExParser(null);

await prepareAdvancedRendering(new Uint8Array([0x50, 0x4b, 0, 0, 0]));
core.setMetafileDecoder(() => 'SENTINEL');
await prepareAdvancedRendering(new Uint8Array(32));
check((await slideSvg(emfFile)).includes('SENTINEL'), '没有标记的非 PK 不启用');
core.setMetafileDecoder(core.metafileToSvg);
core.setShape3DRenderer(undefined);

recordCount('advancedRendering', count);
console.log(`钩子准备扫描 ${count} 项通过${dist ? '（独立产物）' : ''}`);
