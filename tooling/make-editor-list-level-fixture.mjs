/** 生成列表层级固件：九级样式、自动编号续号、符号切换与段落直设共存。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const levelStyle = (level, margin, bullet, size, color) => `<a:lvl${level + 1}pPr marL="${px(margin)}" indent="${px(-18)}">
${bullet}<a:defRPr sz="${size}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr>
</a:lvl${level + 1}pPr>`;

const list = sp({
  x: 110, y: 70, w: 1060, h: 580, prst: 'roundRect', fill: solid('F8FAFC'), name: '多级列表',
  bodyPr: '<a:bodyPr wrap="square" anchor="t"><a:normAutofit fontScale="100000"/></a:bodyPr>',
  lstStyle: `<a:lstStyle>
${levelStyle(0, 48, '<a:buAutoNum type="arabicPeriod"/>', 2400, '1D4ED8')}
${levelStyle(1, 96, '<a:buChar char="◇"/>', 2000, 'B91C1C')}
${levelStyle(2, 144, '<a:buAutoNum type="alphaLcParenR"/>', 1800, '047857')}
${levelStyle(3, 192, '<a:buChar char="–"/>', 1700, '7C3AED')}
${levelStyle(4, 240, '<a:buChar char="•"/>', 1600, '0F766E')}
${levelStyle(5, 288, '<a:buChar char="○"/>', 1500, '9A3412')}
${levelStyle(6, 336, '<a:buChar char="▪"/>', 1400, '334155')}
${levelStyle(7, 384, '<a:buChar char="▫"/>', 1300, '475569')}
${levelStyle(8, 432, '<a:buChar char="■"/>', 1200, '111827')}
</a:lstStyle>`,
  text: `<a:p><a:pPr lvl="0" xmlns:x="urn:web-ppt:list"><!--level-sentinel--><x:keep value="yes"/></a:pPr><a:r><a:t>一级一</a:t></a:r></a:p>
<a:p><a:r><a:t>一级二</a:t></a:r></a:p>
<a:p><a:pPr lvl="1"/><a:r><a:t>二级符号</a:t></a:r></a:p>
<a:p><a:r><a:t>一级三</a:t></a:r></a:p>
<a:p><a:pPr lvl="2"/><a:r><a:t>三级编号一</a:t></a:r></a:p>
<a:p><a:pPr lvl="2"/><a:r><a:t>三级编号二</a:t></a:r></a:p>
<a:p><a:pPr lvl="8"/><a:r><a:t>九级边界</a:t></a:r></a:p>
<a:p><a:pPr lvl="0" marL="${px(220)}" indent="${px(-24)}"><a:buChar char="★"/><a:defRPr sz="2600"/></a:pPr><a:r><a:t>直设保持</a:t></a:r></a:p>`,
});

const bytes = deck({
  name: 'Editor List Level', width: 1280, height: 720,
  slides: [slideXml(list)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-list-level.pptx'), bytes);
console.log(`fixtures/sample-editor-list-level.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
