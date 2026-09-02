/** 触屏命中依赖真实 SVG 几何；细描边与邻近对象使用固定坐标保证可重复。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hairline = '<a:ln w="9525"><a:solidFill><a:srgbClr val="7C3AED"/></a:solidFill></a:ln>';
const thinOutline = sp({
  x: 240, y: 150, w: 320, h: 180, fill: '<a:noFill/>', ln: hairline, name: 'touch-thin-outline',
});
const neighbour = sp({
  x: 590, y: 150, w: 220, h: 180, fill: solid('accent2'), name: 'touch-neighbour',
});
const bytes = deck({
  name: 'Editor Touch', width: 1280, height: 720,
  slides: [slideXml(thinOutline + neighbour)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-touch.pptx'), bytes);
console.log(`fixtures/sample-editor-touch.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
