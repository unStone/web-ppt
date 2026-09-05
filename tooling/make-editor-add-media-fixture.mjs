/** 音频插入从无媒体页面开始，避免原包资源偶然遮住新资源闭包缺陷。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, slideXml, solid, sp } from './lib/ooxml.mjs';
import { makeMp4 } from './lib/media-mp4-fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = deck({
  name: 'Add Media', width: 960, height: 540,
  slides: [slideXml(sp({ x: 40, y: 40, w: 240, h: 40, fill: solid('accent1'), name: '音频插入锚点' }))],
  presRels: '<Relationship Id="rId79" Type="urn:web-ppt:add-media:unknown" Target="../customXml/add-media.xml"/>',
  extraTypes: '<Override PartName="/customXml/add-media.xml" ContentType="application/x-web-ppt-add-media+xml"/>',
  extraEntries: [['customXml/add-media.xml', '<keep xmlns="urn:web-ppt:add-media">媒体插入不改写旁路内容</keep>']],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-add-media.pptx'), bytes);
writeFileSync(join(root, 'fixtures/sample-editor-media.mp4'), makeMp4());
writeFileSync(join(root, 'fixtures/sample-editor-media-fragmented.mp4'), makeMp4(true));
console.log(`媒体插入固件已生成（${bytes.length} 字节）`);
