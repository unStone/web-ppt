/** 超链接固件：共享关系、元素/图片/run、内部跳转、相对动作与只读危险来源同页覆盖。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  deck, label, makePng, makeZip, NS, px, slideXml, solid, sp, XML,
} from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const linkedShape = (name, x, relationship, extra = '') => sp({
  x, y: 60, w: 210, h: 70, name, fill: solid('accent1'), text: label(name, 1400),
}).replace(
  new RegExp(`<p:cNvPr id="(\\d+)" name="${name}"/>`),
  `<p:cNvPr id="$1" name="${name}"><a:hlinkClick r:id="${relationship}"${extra}/></p:cNvPr>`,
);

const hoverShape = sp({
  x: 40, y: 170, w: 240, h: 70, name: 'link-hover-preserve',
  fill: solid('accent2'), text: label('click + hover', 1400),
}).replace(
  /<p:cNvPr id="(\d+)" name="link-hover-preserve"\/>/,
  `<p:cNvPr id="$1" name="link-hover-preserve">
<a:hlinkClick r:id="rId2" tooltip="KEEP-CLICK" fixture:keep="click"><a:extLst><a:ext uri="{KEEP-CLICK}"><fixture:keep value="click"/></a:ext></a:extLst></a:hlinkClick>
<a:hlinkMouseOver r:id="rId3" tooltip="KEEP-HOVER" fixture:keep="hover"/>
</p:cNvPr>`,
);

const relativeShape = sp({
  x: 320, y: 170, w: 210, h: 70, name: 'link-relative-next',
  fill: solid('accent3'), text: label('next', 1400),
}).replace(
  /<p:cNvPr id="(\d+)" name="link-relative-next"\/>/,
  '<p:cNvPr id="$1" name="link-relative-next"><a:hlinkClick action="ppaction://hlinkshowjump?jump=nextslide"/></p:cNvPr>',
);

const richText = sp({
  x: 40, y: 285, w: 680, h: 170, name: 'link-text-runs', fill: solid('F8FAFC'),
  text: `<a:p><a:pPr><a:buNone/></a:pPr>
<a:r><a:rPr sz="1800"><a:hlinkClick r:id="rId2"/></a:rPr><a:t>共享外链</a:t></a:r>
<a:r><a:rPr sz="1800"><a:hlinkClick r:id="rId5" action="ppaction://hlinksldjump"/></a:rPr><a:t>内部第三页</a:t></a:r>
<a:r><a:rPr sz="1800"><a:hlinkClick r:id="rId4" fixture:keep="unsafe"/></a:rPr><a:t>危险来源</a:t></a:r>
<a:r><a:rPr sz="1800"/><a:t>普通文字</a:t></a:r></a:p>`,
});

const picture = `<p:pic>
<p:nvPicPr><p:cNvPr id="900" name="link-picture"><a:hlinkClick r:id="rId5" action="ppaction://hlinksldjump"/></p:cNvPr><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId6"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(760)}" y="${px(280)}"/><a:ext cx="${px(180)}" cy="${px(135)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;

const first = slideXml([
  linkedShape('link-shared-a', 40, 'rId2'),
  linkedShape('link-shared-b', 290, 'rId2'),
  linkedShape('link-unsafe-source', 540, 'rId4', ' fixture:keep="unsafe"'),
  hoverShape, relativeShape, richText, picture,
].join('')).replace(
  '<p:sld ', `<p:sld xmlns:fixture="urn:web-ppt:hyperlink" `,
);
const target = (name, color) => slideXml(sp({
  x: 120, y: 100, w: 700, h: 360, name, fill: solid(color), text: label(name, 3200),
}));

const files = unzipSync(deck({
  name: 'Editor Hyperlinks', width: 1000, height: 560,
  slides: [first, target('link-target-two', 'accent4'), target('link-target-three', 'accent5')],
}));
files['ppt/media/image1.png'] = makePng(24, 18, (x, y) =>
  (x + y) % 2 ? [14, 165, 233] : [99, 102, 241]);
files['ppt/slides/_rels/slide1.xml.rels'] = encoder.encode(`${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${REL}/hyperlink" Target="https://example.com/shared" TargetMode="External"/>
<Relationship Id="rId3" Type="${REL}/hyperlink" Target="https://example.com/hover" TargetMode="External"/>
<Relationship Id="rId4" Type="${REL}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
<Relationship Id="rId5" Type="${REL}/slide" Target="slide3.xml"/>
<Relationship Id="rId6" Type="${REL}/image" Target="../media/image1.png"/>
<Relationship Id="rId7" Type="${REL}/hyperlink" Target="https://example.com/untouched-orphan" TargetMode="External"/>
<Relationship Id="rId8" Type="${REL}/slide" Target="slide3.xml"/>
</Relationships>`);
files['[Content_Types].xml'] = encoder.encode(decoder.decode(files['[Content_Types].xml'])
  .replace('<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'));

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-hyperlinks.pptx'), bytes);
console.log(`fixtures/sample-editor-hyperlinks.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
