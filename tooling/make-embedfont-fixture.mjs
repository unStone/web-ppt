/**
 * 生成 fixtures/sample-embedfont.pptx —— 嵌入字体的四种容器形态。
 *
 * 为什么需要这个固件：PowerPoint 的 `ppt/fonts/*.fntdata` 不是裸 TTF，
 * 是 EOT 容器，而且现实里基本都开着 MTX 压缩。在此之前解析器把这段字节
 * 原样当 `font/ttf` 塞进 `@font-face`，浏览器一个都不认（控制台里就是
 * `invalid sfntVersion`），而 158 个快照没有一个覆盖到嵌入字体，
 * 于是这条路径「从来没通过」这件事一直没人发现。
 *
 * 四种形态一次覆盖 `embeddedFontToSfnt` 的全部分支：
 *
 * | 字重/斜体   | 容器          | 期望 |
 * |------------|---------------|------|
 * | regular    | 未压缩 EOT     | 剥掉头即可用 |
 * | bold       | 未压缩 + 异或   | 剥头 + 逐字节 XOR 0x50 |
 * | italic     | 标记 MTX 压缩   | 没注入解码器就整条丢掉，注入了才交给它 |
 * | boldItalic | 裸 TTF（无容器）| 原样放行 |
 *
 * italic 那份的载荷并不是真的 MTX 数据——没有开源压缩器，而解析器在这条
 * 分支上唯一该做的事就是「把整份容器交给注入的解码器」，载荷是什么它不看。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTtf, wrapEot, TTEMBED_SUBSET, TTEMBED_TTCOMPRESSED, TTEMBED_XORENCRYPTDATA } from './lib/font.mjs';
import { deck, label, NS, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;
const FAMILY = 'WebPPT Embedded';

/** 四个字体部件：[标签, 样式名, 粗, 斜, 容器构造] */
const FONTS = [
  ['regular', 'Regular', false, false, (ttf, o) => wrapEot(ttf, { ...o, flags: TTEMBED_SUBSET })],
  ['bold', 'Bold', true, false, (ttf, o) => wrapEot(ttf, { ...o, flags: TTEMBED_SUBSET | TTEMBED_XORENCRYPTDATA })],
  ['italic', 'Italic', false, true, (ttf, o) => wrapEot(ttf, { ...o, flags: TTEMBED_SUBSET | TTEMBED_TTCOMPRESSED })],
  ['boldItalic', 'Bold Italic', true, true, (ttf) => ttf],
];

const parts = FONTS.map(([tag, styleName, bold, italic, wrap], i) => {
  const ttf = makeTtf({ family: FAMILY, style: styleName, bold, italic });
  return {
    tag,
    path: `ppt/fonts/font${i + 1}.fntdata`,
    rid: `rId${100 + i}`,
    data: wrap(ttf, { familyName: FAMILY, styleName, bold, italic }),
  };
});

const row = (text, y, rPr) => sp({
  x: 60, y, w: W - 120, h: 90, prst: 'rect', fill: '<a:noFill/>',
  text: `<a:p><a:r><a:rPr sz="3200" ${rPr}><a:latin typeface="${FAMILY}"/></a:rPr><a:t>${text}</a:t></a:r></a:p>`,
});

const slide = slideXml(
  sp({ x: 60, y: 40, w: W - 120, h: 44, prst: 'rect', fill: '<a:noFill/>',
    text: `<a:p><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>嵌入字体 · 四种容器形态</a:t></a:r></a:p>` }) +
  row('AAAA 未压缩 EOT', 110, '') +
  row('AAAA 未压缩 EOT + 异或', 210, 'b="1"') +
  row('AAAA 标记为 MTX 压缩', 310, 'i="1"') +
  row('AAAA 裸 TTF 无容器', 410, 'b="1" i="1"') +
  sp({ x: 60, y: 540, w: W - 120, h: 120, prst: 'roundRect', fill: solid('lt2'),
    text: label(`四段文字都指定 ${FAMILY}；能不能真按它渲染，取决于容器有没有被还原成 sfnt`, 1100) }),
);

/** presentation.xml 里的嵌入字体清单：一个 typeface 挂四个字重/斜体变体 */
const embeddedFontLst =
  `<p:embeddedFontLst><p:embeddedFont><p:font typeface="${FAMILY}" pitchFamily="34" charset="0"/>` +
  parts.map((p) => `<p:${p.tag} r:id="${p.rid}"/>`).join('') +
  '</p:embeddedFont></p:embeddedFontLst>';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const zip = deck({
  name: 'EmbedFont',
  width: W,
  height: H,
  slides: [slide],
  presExtra: embeddedFontLst,
  presRels: parts.map((p) => `<Relationship Id="${p.rid}" Type="${REL}/font" Target="fonts/${p.path.split('/').pop()}"/>`).join(''),
  extraTypes: '\n<Default Extension="fntdata" ContentType="application/x-fontdata"/>',
  extraEntries: parts.map((p) => [p.path, p.data]),
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-embedfont.pptx'), zip);
console.log(`fixtures/sample-embedfont.pptx 已生成（${parts.length} 个字体部件：` +
  parts.map((p) => `${p.tag} ${p.data.length}B`).join('、') + `，${(zip.length / 1024).toFixed(1)} KB）`);
