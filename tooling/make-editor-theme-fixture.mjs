/** 主题编辑固件：多主题、主题引用、页面直设与未知主题属性共存。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { makeZip, px } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const files = unzipSync(new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-change-layout.pptx'))));
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>`;

const themeReference = `<p:sp><p:nvSpPr><p:cNvPr id="812" name="主题样式引用"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr>${xfrm(750, 590, 180, 54)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>主题引用</a:t></a:r></a:p></p:txBody></p:sp>`;
const direct = `<p:sp><p:nvSpPr><p:cNvPr id="813" name="页面直接格式"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr>${xfrm(520, 590, 180, 54)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="445566"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr><a:latin typeface="Direct Typeface"/></a:rPr><a:t>页面直设</a:t></a:r></a:p></p:txBody></p:sp>`;

replace('ppt/slides/slide7.xml', (xml) => xml
  .replace('<p:sld show="0"', '<p:sld')
  .replace('</p:spTree>', `${themeReference}${direct}</p:spTree>`));
replace('ppt/theme/theme1.xml', (xml) => xml.replace('<a:theme ', '<a:theme data-keep="theme-source" '));

const bytes = makeZip(Object.entries(files));
writeFileSync(join(root, 'fixtures/sample-editor-theme.pptx'), bytes);
console.log(`fixtures/sample-editor-theme.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
