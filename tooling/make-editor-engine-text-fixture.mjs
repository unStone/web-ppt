/** 生成 engine 行盒编辑固件：跨行分段、硬换行、空段、RTL、竖排、分栏、公式与裸 autofit。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const COLUMN_TEXT = '第一列和第二列必须由同一份 engine 行盒决定。多栏文字在浏览器自动分栏时容易与原生 SVG 的断点不同，编辑面不能再次猜测。';

const wrapping = sp({
  x: 50, y: 45, w: 390, h: 270, name: 'Engine 跨行基准', fill: solid('F8FAFC'),
  bodyPr: '<a:bodyPr wrap="square" anchor="t"/>',
  text: `<a:p><a:pPr algn="l"/>
<a:r><a:rPr sz="2000"><a:latin typeface="Arial"/><a:ea typeface="Arial"/></a:rPr>
<a:t xml:space="preserve">中文，EnglishWords 日本語 mixed run wraps here </a:t></a:r>
<a:r><a:rPr sz="2000" b="1"><a:latin typeface="Arial"/><a:ea typeface="Arial"/></a:rPr>
<a:t>第二格式跨越视觉行</a:t></a:r>
<a:br><a:rPr sz="2000" u="sng"/></a:br>
<a:r><a:rPr sz="2000" i="1"><a:latin typeface="Arial"/><a:ea typeface="Arial"/></a:rPr>
<a:t>硬换行后😀</a:t></a:r><a:r><a:rPr sz="2000"/><a:t></a:t></a:r></a:p>
<a:p><a:pPr algn="ctr"/><a:endParaRPr sz="1800"/></a:p>
<a:p><a:pPr algn="r" rtl="1"/><a:r><a:rPr sz="1800"/><a:t>مرحبا RTL 右到左</a:t></a:r></a:p>
<a:p><a:pPr marL="228600" indent="-228600"><a:buChar char="•"/></a:pPr>
<a:r><a:rPr sz="1800"/><a:t>项目符号不是正文字符</a:t></a:r></a:p>`,
});

const vertical = sp({
  x: 480, y: 45, w: 190, h: 270, name: 'Engine 竖排基准', fill: solid('FFF7ED'),
  bodyPr: '<a:bodyPr vert="vert" wrap="square" anchor="ctr"/>',
  text: '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1900"/><a:t>竖排中文与ABC跨行编辑</a:t></a:r></a:p>',
});

const columns = sp({
  x: 710, y: 45, w: 510, h: 270, name: 'Engine 分栏基准', fill: solid('EFF6FF'),
  bodyPr: `<a:bodyPr wrap="square" anchor="t" numCol="2" spcCol="${px(18)}"/>`,
  text: `<a:p><a:pPr algn="just"/><a:r><a:rPr sz="1600"/>
<a:t>${COLUMN_TEXT.repeat(7)}</a:t>
</a:r></a:p>`,
});

const formula = sp({
  x: 50, y: 360, w: 520, h: 150, name: 'Engine 公式基准', fill: solid('F5F3FF'),
  bodyPr: '<a:bodyPr wrap="square" anchor="ctr"/>',
  text: `<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1900"/><a:t>公式前</a:t></a:r>
<m:oMath xmlns:m="${MATH_NS}"><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>
<a:r><a:rPr sz="1900"/><a:t>公式后</a:t></a:r></a:p>`,
});

const autofit = sp({
  x: 610, y: 360, w: 610, h: 150, name: 'Engine 裸自动缩放', fill: solid('ECFDF5'),
  bodyPr: '<a:bodyPr wrap="square" anchor="t"><a:normAutofit/></a:bodyPr>',
  text: `<a:p><a:r><a:rPr sz="2200"/><a:t>裸 normAutofit 没有 fontScale，engine 编辑面必须与原生 SVG 共用实时求出的有效比例，不能进入编辑后突然恢复标称字号。这里放入足够长的中文与 English words 触发缩小。</a:t></a:r></a:p>`,
});

const bytes = deck({
  name: 'Editor Engine Text', width: 1280, height: 720,
  slides: [slideXml(wrapping + vertical + columns + formula + autofit)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-engine-text.pptx'), bytes);
console.log(`fixtures/sample-editor-engine-text.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
