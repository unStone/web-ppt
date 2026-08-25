/** 表格插入固件：主题默认表样式、内容占位符、高位 spid 与未知尾节点共同守住原生 a:tbl 插入。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makeZip, px, slideXml, solid } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const STYLE_ID = '{5F9D1B80-6B13-4A7A-AFC1-ADD7AB1E0001}';
const BUILTIN_STYLE_ID = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';

function contentPlaceholder(id, name, x, y, w, h, text = '') {
  const paragraph = text
    ? `<a:p><a:r><a:rPr lang="zh-CN"/><a:t>${text}</a:t></a:r></a:p>`
    : '<a:p><a:endParaRPr lang="zh-CN"/></a:p>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph type="obj" idx="${id}"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>${paragraph}</p:txBody></p:sp>`;
}

const extension = `<p:extLst><p:ext uri="{ADD-TABLE-TAIL}">
<fixture:keep xmlns:fixture="urn:web-ppt:add-table" value="必须原位保留"/>
</p:ext></p:extLst>`;
const source = deck({
  name: 'Add Table Theme', width: 1280, height: 720,
  slides: [slideXml([
    contentPlaceholder(880, '空内容占位符', 90, 92, 720, 410),
    contentPlaceholder(881, '非空内容占位符', 870, 92, 310, 180, '不能被表格覆盖'),
    extension,
  ].join('\n'))],
  presRels: '<Relationship Id="rId90" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>',
  extraTypes: '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>',
  extraEntries: [['ppt/tableStyles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${STYLE_ID}">
<a:tblStyle styleId="${STYLE_ID}" styleName="Web PPT Theme Table">
<a:wholeTbl><a:tcStyle><a:tcBdr>
<a:left><a:ln w="12700">${solid('accent3')}</a:ln></a:left><a:right><a:ln w="12700">${solid('accent3')}</a:ln></a:right>
<a:top><a:ln w="12700">${solid('accent3')}</a:ln></a:top><a:bottom><a:ln w="12700">${solid('accent3')}</a:ln></a:bottom>
</a:tcBdr><a:fill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:fill></a:tcStyle><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle></a:wholeTbl>
<a:firstRow><a:tcStyle><a:fill>${solid('accent1')}</a:fill></a:tcStyle><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle></a:firstRow>
<a:band1H><a:tcStyle><a:fill><a:solidFill><a:schemeClr val="accent2"><a:tint val="85000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1H>
<a:band2H><a:tcStyle><a:fill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:fill></a:tcStyle></a:band2H>
</a:tblStyle></a:tblStyleLst>`]],
});

const files = unzipSync(source);
files['ppt/theme/theme1.xml'] = encoder.encode(
  decoder.decode(files['ppt/theme/theme1.xml'])
    .replace('<a:accent1><a:srgbClr val="2E75B6"/></a:accent1>',
      '<a:accent1><a:srgbClr val="D94F70"/></a:accent1>'),
);
const bytes = makeZip(Object.entries(files));
const builtinBytes = makeZip(Object.entries({
  ...files,
  'ppt/tableStyles.xml': encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${BUILTIN_STYLE_ID}"/>`),
}));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-add-table.pptx'), bytes);
writeFileSync(join(root, 'fixtures/sample-editor-add-table-builtin.pptx'), builtinBytes);
console.log(`fixtures/sample-editor-add-table*.pptx 已生成（${(bytes.length / 1024).toFixed(1)}/${(builtinBytes.length / 1024).toFixed(1)} KB）`);
