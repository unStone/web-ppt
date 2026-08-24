/** 生成富文本剪贴板固件：多 run、六类行内格式、段落间未知节点与硬换行。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const clipboardText = sp({
  x: 120, y: 110, w: 760, h: 260, prst: 'roundRect', fill: solid('F8FAFC'),
  name: '富文本剪贴板', bodyPr: '<a:bodyPr wrap="square" anchor="t"/>',
  text: `<a:p><a:pPr algn="ctr"/>
<a:r><a:rPr sz="2000"><a:solidFill><a:srgbClr val="DC2626"/></a:solidFill></a:rPr><a:t>同</a:t></a:r>
<!--rich-clipboard-gap: keep-->
<a:r><a:rPr sz="2000" b="1"><a:solidFill><a:srgbClr val="16A34A"/></a:solidFill><a:latin typeface="Courier New"/><a:ea typeface="Courier New"/><a:cs typeface="Courier New"/></a:rPr><a:t>同</a:t></a:r>
<a:r><a:rPr sz="2000" i="1" strike="sngStrike"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:rPr><a:t>同</a:t></a:r></a:p>`,
});

const hardBreak = sp({
  x: 120, y: 420, w: 760, h: 130, prst: 'rect', fill: solid('EFF6FF'),
  name: '带格式硬换行', bodyPr: '<a:bodyPr wrap="square" anchor="ctr"/>',
  text: `<a:p><a:r><a:rPr sz="1800"/><a:t>上</a:t></a:r>
<a:br><a:rPr sz="1800" u="sng"/></a:br>
<a:r><a:rPr sz="1800"/><a:t>下</a:t></a:r></a:p>`,
});

const bytes = deck({
  name: 'Editor Rich Clipboard', width: 1280, height: 720,
  slides: [slideXml(clipboardText + hardBreak)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-rich-clipboard.pptx'), bytes);
console.log(`fixtures/sample-editor-rich-clipboard.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
