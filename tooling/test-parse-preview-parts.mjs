import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { join, resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { installDomEnv } from './lib/dom-env.mjs';
import { recordCount } from './lib/measured.mjs';
import { deck, makePng, px, slideXml, sp, label } from './lib/ooxml.mjs';

installDomEnv();

const root = resolve('.');
const out = join(root, 'out/parse-preview-parts');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from '${root}/packages/core/src/index.ts';
export { isPreviewDeferredPart } from '${root}/packages/core/src/pptx/zip-preview.ts';`);
const bundled = await bundleBrowser({
  root,
  entry,
  output: join(out, 'contract.mjs'),
  aliases: [['@web-ppt/core', join(root, 'packages/core/src/index.ts')]],
});
const dist = process.argv.includes('--dist');
const core = dist ? await import('@web-ppt/core') : bundled.core;
const isPreviewDeferredPart = dist
  ? (name) => !name.endsWith('/') && (
    /\/(?:media|embeddings)\//i.test(name)
    || /^ppt\/slides\/(?:_rels\/)?slide[^/]+$/i.test(name)
    || /^ppt\/(?:notesSlides|comments|charts|diagrams)\//i.test(name)
    || /^ppt\/vbaProject/i.test(name)
  )
  : bundled.isPreviewDeferredPart;

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const png = (color) => makePng(8, 8, () => color);
const imageRel = (id, file) =>
  `<Relationship Id="${id}" Type="${REL}/image" Target="../media/${file}"/>`;
const pic = (name, rid) => `<p:pic>
<p:nvPicPr><p:cNvPr id="${name === 'first' ? 2 : 3}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(80)}" y="${px(80)}"/><a:ext cx="${px(160)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;

function photoDeck(unusedBytes, extraEntries = []) {
  return deck({
    slides: [
      slideXml(pic('first', 'rId2') + sp({
        x: 80, y: 220, w: 240, h: 40, name: 't1', text: label('首页'),
      })),
      slideXml(pic('second', 'rId2') + sp({
        x: 80, y: 220, w: 240, h: 40, name: 't2', text: label('后页'),
      })),
    ],
    width: 1280,
    height: 720,
    name: 'PreviewMedia',
    extraTypes: '<Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/octet-stream"/>',
    slideRelationships: [imageRel('rId2', 'image1.png'), imageRel('rId2', 'image2.png')],
    extraEntries: [
      ['ppt/media/image1.png', png([200, 40, 40])],
      ['ppt/media/image2.png', png([40, 80, 200])],
      ['ppt/media/unused.png', unusedBytes],
      ...extraEntries,
    ],
  });
}

function corruptEntry(zip, name) {
  const nameBytes = new TextEncoder().encode(name);
  const copy = new Uint8Array(zip);
  for (let i = 0; i + 30 + nameBytes.length <= copy.length; i++) {
    if (copy[i] !== 0x50 || copy[i + 1] !== 0x4b || copy[i + 2] !== 0x03 || copy[i + 3] !== 0x04) continue;
    const nameLen = copy[i + 26] | (copy[i + 27] << 8);
    const extraLen = copy[i + 28] | (copy[i + 29] << 8);
    if (nameLen !== nameBytes.length) continue;
    if (!nameBytes.every((byte, index) => copy[i + 30 + index] === byte)) continue;
    const size = (copy[i + 18] | (copy[i + 19] << 8) | (copy[i + 20] << 16) | (copy[i + 21] << 24)) >>> 0;
    const start = i + 30 + nameLen + extraLen;
    if (size < 4) throw new Error(`${name} 压缩块太短`);
    copy[start] ^= 0xff;
    copy[start + 1] ^= 0xff;
    copy[start + 2] ^= 0xff;
    copy[start + 3] ^= 0xff;
    return copy;
  }
  throw new Error(`找不到 ${name}`);
}

const firstImage = (presentation) => {
  const found = [];
  const walk = (elements) => {
    for (const element of elements) {
      if (element.kind === 'image') found.push(element);
      if (element.kind === 'group') walk(element.children);
    }
  };
  walk(presentation.slides[0].elements);
  return found[0];
};

let count = 0;
const check = (condition, label) => {
  assert(condition, label);
  count++;
};

check(isPreviewDeferredPart('ppt/media/image1.png'), '照片路径推迟');
check(isPreviewDeferredPart('ppt/media/media1.bin'), '视频 bin 推迟');
check(isPreviewDeferredPart('ppt/slides/slide2.xml'), '后页 XML 推迟');
check(isPreviewDeferredPart('ppt/slides/_rels/slide2.xml.rels'), '后页关系推迟');
check(isPreviewDeferredPart('ppt/embeddings/oleObject1.bin'), '嵌入物推迟');
check(isPreviewDeferredPart('ppt/notesSlides/notesSlide1.xml'), '备注推迟');
check(isPreviewDeferredPart('ppt/vbaProject.bin'), 'VBA 推迟');
check(!isPreviewDeferredPart('ppt/slides/'), '目录项不推迟');
check(!isPreviewDeferredPart('ppt/media/'), '媒体目录项不推迟');
check(!isPreviewDeferredPart('ppt/slideLayouts/slideLayout1.xml'), '版式不推迟');
check(!isPreviewDeferredPart('ppt/presentation.xml'), 'presentation 不推迟');
check(!isPreviewDeferredPart('ppt/commentAuthors.xml'), '批注作者不推迟');

const unused = new Uint8Array(64 * 1024).fill(7);
const intact = photoDeck(unused);
const brokenUnused = corruptEntry(intact, 'ppt/media/unused.png');
assert.throws(() => unzipSync(brokenUnused), '整包解压必须撞上损坏的未引用照片');
count++;

const preview = await core.parse(brokenUnused);
check(preview.slides.length === 2, '惰性页数仍完整');
const home = firstImage(preview);
check(!!home?.src, '当前页图片在第一次渲染前已建成地址');
check(core.slideText(preview.slides[0]).includes('首页'), '当前页文字仍在');
const later = preview.slides[1].elements.find((element) => element.kind === 'image');
check(!!later?.src, '后页第一次访问才解自己的图');
preview.dispose();

await assert.rejects(() => core.parse(brokenUnused, { keepPackage: true }), 'keepPackage 仍整包解压，损坏未引用照片要抛');
count++;

const kept = await core.parse(intact, { keepPackage: true, lazy: false });
check(!!kept.package?.parts['ppt/media/unused.png'], 'keepPackage 仍能读未引用媒体');
check(kept.package.parts['ppt/media/image1.png'].length > 0, 'keepPackage 当前页图仍在 parts');
kept.dispose();

const textOnly = deck({
  slides: [slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'only', text: label('只有字') }))],
  width: 1280,
  height: 720,
  name: 'Text',
  extraTypes: '<Default Extension="bin" ContentType="application/octet-stream"/>',
  extraEntries: [['ppt/media/media1.bin', unused]],
});
const brokenVideo = corruptEntry(textOnly, 'ppt/media/media1.bin');
assert.throws(() => unzipSync(brokenVideo), '整包解压必须撞上损坏的未引用视频');
count++;
const textPres = await core.parse(brokenVideo);
check(core.slideText(textPres.slides[0]).includes('只有字'), '未引用视频损坏不挡文本首页');
textPres.dispose();

const brokenCurrent = corruptEntry(intact, 'ppt/media/image1.png');
const failedPage = await core.parse(brokenCurrent);
check(
  failedPage.slides[0].elements.some((element) =>
    element.kind === 'unsupported' && String(element.label).includes('解析失败')),
  '当前页图损坏走页面失败卡片，不假装图在',
);
failedPage.dispose();

const oleBytes = new Uint8Array(48 * 1024).fill(9);
const longDeck = deck({
  slides: [
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'home', text: label('首页') })),
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'mid', text: label('中间页') })),
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'tail', text: label('后页') })),
  ],
  width: 1280,
  height: 720,
  name: 'LongText',
  extraTypes: '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>',
  extraEntries: [['ppt/embeddings/oleObject1.bin', oleBytes]],
});
const brokenLater = corruptEntry(longDeck, 'ppt/slides/slide3.xml');
assert.throws(() => unzipSync(brokenLater), '整包解压必须撞上损坏的后页 XML');
count++;
const laterPreview = await core.parse(brokenLater);
check(laterPreview.slides.length === 3, '只读页数不解后页');
check(core.slideText(laterPreview.slides[0]).includes('首页'), '损坏后页不挡文本首页');
check(
  laterPreview.slides[2].elements.some((element) =>
    element.kind === 'unsupported' && String(element.label).includes('解析失败')),
  '网格读到损坏后页时走失败卡片，不假装页在',
);
laterPreview.dispose();

const brokenOle = corruptEntry(longDeck, 'ppt/embeddings/oleObject1.bin');
assert.throws(() => unzipSync(brokenOle), '整包解压必须撞上损坏的未引用嵌入物');
count++;
const olePreview = await core.parse(brokenOle);
check(core.slideText(olePreview.slides[0]).includes('首页'), '未引用嵌入物损坏不挡文本首页');
check(core.slideText(olePreview.slides[1]).includes('中间页'), '访问后页仍只解那一页');
olePreview.dispose();

await assert.rejects(() => core.parse(brokenOle, { keepPackage: true }), 'keepPackage 仍整包解压，损坏未引用嵌入物要抛');
count++;

const keptOle = await core.parse(longDeck, { keepPackage: true, lazy: false });
check(!!keptOle.package?.parts['ppt/embeddings/oleObject1.bin'], 'keepPackage 仍能读未引用嵌入物');
check(keptOle.package.parts['ppt/slides/slide3.xml'].length > 0, 'keepPackage 后页 XML 仍在 parts');
keptOle.dispose();

recordCount('parsePreviewParts', count);
console.log(`预览解析跳过后页与未引用嵌入物 ${count} 项通过${dist ? '（独立产物）' : ''}`);
