/** 高频对象与页面命令固件：分布、替代文字、节和页面尺寸共用同一份真实 OOXML。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makeZip, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';

const first = [
  sp({ x: 80, y: 80, w: 120, h: 90, name: 'common-left', fill: solid('accent1') }),
  sp({ x: 270, y: 230, w: 150, h: 80, name: 'common-middle-a', fill: solid('accent2'), rot: 900000 }),
  sp({ x: 515, y: 410, w: 90, h: 130, name: 'common-middle-b', fill: solid('accent3') }),
  sp({ x: 820, y: 570, w: 180, h: 100, name: 'common-right', fill: solid('accent4'), rot: -600000 }),
  sp({ x: 80, y: 330, w: 320, h: 120, name: 'common-alt', fill: solid('accent5') })
    .replace('name="common-alt"', 'name="common-alt" title="来源标题" descr="来源描述" xmlns:fixture="urn:web-ppt:common" fixture:keep="ALT"'),
].join('');

const page = (index) => slideXml(sp({
  x: 120, y: 160, w: 1040, h: 260, name: `common-page-${index}`,
  fill: solid(`accent${index + 1}`),
}));

const sections = `<p:extLst><p:ext uri="{WEB-PPT-COMMON-COMMANDS}">
<p14:sectionLst xmlns:p14="${P14}">
<p14:section name="开场" id="{11111111-1111-1111-1111-111111111111}" xmlns:fixture="urn:web-ppt:common" fixture:keep="SECTION"><p14:sldIdLst><p14:sldId id="701"/><p14:sldId id="702"/></p14:sldIdLst></p14:section>
<p14:section name="结尾" id="{22222222-2222-2222-2222-222222222222}"><p14:sldIdLst><p14:sldId id="703"/></p14:sldIdLst></p14:section>
</p14:sectionLst><fixture:tail xmlns:fixture="urn:web-ppt:common" keep="yes"/>
</p:ext></p:extLst>`;

const bytes = deck({
  name: 'Common Commands', width: 1280, height: 720,
  slides: [slideXml(first), page(2), page(3)], presExtra: sections,
});
const files = unzipSync(bytes);
files['ppt/presentation.xml'] = encoder.encode(
  [701, 702, 703].reduce((xml, id, index) =>
    xml.replace(`id="${256 + index}" r:id="rId${index + 2}"`, `id="${id}" r:id="rId${index + 2}"`),
  decoder.decode(files['ppt/presentation.xml'])),
);
const output = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-common-commands.pptx'), output);
console.log(`fixtures/sample-editor-common-commands.pptx 已生成（${(output.length / 1024).toFixed(1)} KB）`);
