/** 项目符号编辑固件：继承、直设互斥、两种字号与图片关系都来自真实 OOXML。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, makePng, slideXml, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const bulletPng = makePng(12, 12, (x, y) => x === y || x + y === 11
  ? [220, 38, 38] : [255, 255, 255]);

const list = sp({
  x: 100, y: 60, w: 1080, h: 600, name: '项目符号编辑',
  lstStyle: `<a:lstStyle><a:lvl1pPr marL="457200" indent="-171450">
<a:buAutoNum type="arabicPeriod"/><a:defRPr sz="2200"/>
</a:lvl1pPr></a:lstStyle>`,
  text: `<a:p><a:r><a:t>继承自动编号</a:t></a:r></a:p>
<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>显式无项目符号</a:t></a:r></a:p>
<a:p><a:pPr><a:buClr><a:srgbClr val="C00000"/></a:buClr><a:buSzPct val="125000"/><a:buFont typeface="Wingdings"/><a:buChar char=""/></a:pPr><a:r><a:t>字符项目符号</a:t></a:r></a:p>
<a:p><a:pPr><a:buAutoNum type="romanLcPeriod" startAt="4"/></a:pPr><a:r><a:t>自动编号起点</a:t></a:r></a:p>
<a:p><a:pPr><a:buBlip><a:blip r:embed="rIdBullet"/></a:buBlip></a:pPr><a:r><a:t>图片项目符号</a:t></a:r></a:p>
<a:p><a:pPr><a:buSzPts val="2400"/><a:buChar char="◆"/></a:pPr><a:r><a:t>绝对字号项目符号</a:t></a:r></a:p>`,
});

const bytes = deck({
  name: 'Editor Bullet', width: 1280, height: 720,
  slides: [slideXml(list)],
  slideRelationships: [`<Relationship Id="rIdBullet" Type="${IMAGE_REL}" Target="../media/bullet.png"/>`],
  extraTypes: '<Override PartName="/ppt/media/bullet.png" ContentType="image/png"/>',
  extraEntries: [['ppt/media/bullet.png', bulletPng]],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-bullets.pptx'), bytes);
console.log(`fixtures/sample-editor-bullets.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
