/** 页面属性固件：继承/直接背景、隐藏页与未知扩展共同守住保留型写回。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, slideXml, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = (index, background = '', attrs = '') => slideXml(sp({
  x: 390, y: 250, w: 500, h: 180, name: `slide-properties-${index}`,
  fill: '<a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="85000"/></a:srgbClr></a:solidFill>',
  text: label(`页面属性 ${index}`, 3600, '172554'),
}), background, attrs);

const slides = [
  page(1),
  page(2, `<p:bg xmlns:fixture="urn:web-ppt:slide-properties" fixture:slot="solid"><p:bgPr fixture:keep="solid">
<a:solidFill><a:srgbClr val="0EA5E9"><a:alpha val="65000"/></a:srgbClr></a:solidFill>
<a:effectLst/><a:extLst><a:ext uri="{SLIDE-PROPERTIES-SOLID}"><fixture:keep value="solid-extension"/></a:ext></a:extLst>
</p:bgPr></p:bg>`),
  page(3, `<p:bg xmlns:fixture="urn:web-ppt:slide-properties" fixture:slot="gradient"><p:bgPr fixture:keep="gradient">
<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FDE68A"/></a:gs>
<a:gs pos="100000"><a:srgbClr val="F97316"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>
<a:effectLst/><a:extLst><a:ext uri="{SLIDE-PROPERTIES-GRADIENT}"><fixture:keep value="gradient-extension"/></a:ext></a:extLst>
</p:bgPr></p:bg>`, 'show="0"'),
  page(4, `<p:bg><p:bgPr><a:pattFill prst="diagCross"><a:fgClr><a:srgbClr val="14532D"/></a:fgClr>
<a:bgClr><a:srgbClr val="DCFCE7"/></a:bgClr></a:pattFill><a:effectLst/></p:bgPr></p:bg>`),
  page(5, '<p:bg><p:bgPr><a:noFill/><a:effectLst/></p:bgPr></p:bg>'),
  page(6, `<p:bg xmlns:fixture="urn:web-ppt:slide-properties" fixture:slot="theme-ref">
<p:bgRef idx="1"><a:schemeClr val="accent3"/></p:bgRef></p:bg>`, 'show="1"'),
];

const bytes = deck({ name: 'Editor Slide Properties', width: 1280, height: 720, slides });
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-slide-properties.pptx'), bytes);
console.log(`fixtures/sample-editor-slide-properties.pptx 已生成（${slides.length} 页，${(bytes.length / 1024).toFixed(1)} KB）`);
