/** 新增形状固件：自定义主题、既有兄弟与 spTree 尾部扩展共同守住插入序位。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makeZip, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extension = `<p:extLst><p:ext uri="{D5B74B20-3A34-4CB1-9B12-ADD-SHAPE}">
<fixture:keep xmlns:fixture="urn:web-ppt:add-shape" value="必须保留"/>
</p:ext></p:extLst>`;
const source = deck({
  name: 'Add Shape Theme', width: 1280, height: 720,
  slides: [slideXml(sp({
    x: 80, y: 90, w: 220, h: 120, prst: 'ellipse', fill: solid('accent2'), name: '新增形状锚点',
  }) + extension)],
});
const files = unzipSync(source);
const decoder = new TextDecoder();
const encoder = new TextEncoder();
files['ppt/theme/theme1.xml'] = encoder.encode(
  decoder.decode(files['ppt/theme/theme1.xml'])
    .replace('<a:accent1><a:srgbClr val="2E75B6"/></a:accent1>',
      '<a:accent1><a:srgbClr val="D94F70"/></a:accent1>'),
);

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-add-shape.pptx'), bytes);
console.log(`fixtures/sample-editor-add-shape.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
