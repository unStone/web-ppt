/** 生成表格文字编辑固件：复杂单元格语义 + 20×10 输入性能表。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, nextShapeId, NS, px, slideXml, solid, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TABLE_STYLE_ID = '{A7D87910-7B6D-4B2F-9B21-54CB9C43E801}';
const APPEND_STYLE_ID = '{BFD9FC95-08A9-47D3-9785-8DB2E5A35D39}';

function cell({ attrs = '', bodyPr = '<a:bodyPr/>', text = '', tcPr = '<a:tcPr/>' } = {}) {
  return `<a:tc${attrs ? ` ${attrs}` : ''}><a:txBody>${bodyPr}<a:lstStyle/>`
    + `${text || '<a:p><a:endParaRPr sz="1600"/></a:p>'}</a:txBody>${tcPr}</a:tc>`;
}

function table({
  name, x, y, widths, heights, rows, rot = 0, flipH = false, flipV = false,
  styleId = TABLE_STYLE_ID, tableProps = 'firstRow="1" bandRow="1"', trailing = '',
}) {
  const width = widths.reduce((sum, value) => sum + value, 0);
  const height = heights.reduce((sum, value) => sum + value, 0);
  const xfrmAttrs = [rot ? ` rot="${rot}"` : '', flipH ? ' flipH="1"' : '', flipV ? ' flipV="1"' : ''].join('');
  return `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="${nextShapeId()}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm${xfrmAttrs}><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(width)}" cy="${px(height)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblPr ${tableProps}><a:tableStyleId>${styleId}</a:tableStyleId></a:tblPr><a:tblGrid>${widths.map((value) => `<a:gridCol w="${px(value)}"/>`).join('')}</a:tblGrid>
${rows.map((cells, r) => `<a:tr h="${px(heights[r])}">${cells.join('')}</a:tr>`).join('\n')}
${trailing}
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

const rich = `<a:p><a:pPr algn="l"/><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="DC2626"/></a:solidFill></a:rPr><a:t xml:space="preserve"> 前导 </a:t></a:r>
<!--table-rich-gap: keep--><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:rPr><a:t>中文</a:t></a:r></a:p>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1600" i="1"/><a:t>第二段</a:t></a:r></a:p>`;

const semantic = table({
  name: '表格文字综合', x: 80, y: 80, widths: [270, 270, 270, 270], heights: [170, 170, 170],
  rot: 120000, flipH: true, flipV: true,
  rows: [
    [
      cell({
        bodyPr: '<a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr>', text: rich,
        tcPr: `<a:tcPr marL="${px(18)}" marR="${px(8)}" marT="${px(10)}" marB="${px(6)}" anchor="ctr">${solid('FFF1F2')}</a:tcPr>`,
      }),
      cell({ text: '<a:p><a:pPr algn="ctr"/><a:endParaRPr sz="1900"/></a:p>', tcPr: `<a:tcPr anchor="ctr">${solid('F0FDF4')}</a:tcPr>` }),
      cell({ attrs: 'gridSpan="2"', text: '<a:p><a:r><a:rPr sz="1700"/><a:t>横向合并起始格</a:t></a:r></a:p>', tcPr: `<a:tcPr>${solid('EFF6FF')}</a:tcPr>` }),
      cell({ attrs: 'hMerge="1"', text: '<a:p><a:r><a:t>不可见占位</a:t></a:r></a:p>' }),
    ],
    [
      cell({ attrs: 'rowSpan="2"', text: '<a:p><a:r><a:rPr sz="1700"/><a:t>纵向合并起始格</a:t></a:r></a:p>', tcPr: `<a:tcPr anchor="b">${solid('FEF3C7')}</a:tcPr>` }),
      cell({ text: '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1700"/><a:t>竖排中文ABC</a:t></a:r></a:p>', tcPr: `<a:tcPr vert="vert" anchor="ctr">${solid('FAE8FF')}</a:tcPr>` }),
      cell({ text: '<a:p><a:pPr algn="r" rtl="1"/><a:r><a:rPr sz="1700"/><a:t>مرحبا RTL</a:t></a:r></a:p>', tcPr: `<a:tcPr anchor="ctr">${solid('ECFEFF')}</a:tcPr>` }),
      cell({
        bodyPr: '<a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr>',
        text: '<a:p><a:r><a:rPr sz="2200"/><a:t>裸 autofit 单元格需要实时计算比例，编辑面不能跳版。</a:t></a:r></a:p>',
        tcPr: `<a:tcPr vert="vert270" marL="${px(18)}" marR="${px(8)}" marT="${px(10)}" marB="${px(6)}">${solid('F5F3FF')}</a:tcPr>`,
      }),
    ],
    [
      cell({ attrs: 'vMerge="1"', text: '<a:p><a:r><a:t>不可见占位</a:t></a:r></a:p>' }),
      cell({ text: '<a:p><a:r><a:rPr sz="1600"/><a:t>末行一</a:t></a:r></a:p>' }),
      cell({ text: '<a:p><a:r><a:rPr sz="1600" u="sng"/><a:t>末行二</a:t></a:r></a:p>' }),
      cell({ text: '<a:p><a:r><a:rPr sz="1600"/><a:t>末格</a:t></a:r></a:p>' }),
    ],
  ],
});

const perfRows = Array.from({ length: 10 }, (_, r) => Array.from({ length: 20 }, (_, c) => cell({
  text: `<a:p><a:r><a:rPr sz="700"/><a:t>${r}:${c}</a:t></a:r></a:p>`,
  tcPr: `<a:tcPr marL="${px(2)}" marR="${px(2)}" marT="${px(1)}" marB="${px(1)}"/>`,
})));
const performance = table({
  name: '20x10 性能表', x: 40, y: 55,
  widths: Array(20).fill(60), heights: Array(10).fill(60), rows: perfRows,
});

const appendStyles = table({
  name: '追加行样式', x: 140, y: 90, widths: [220, 220, 220, 220], heights: [90, 90, 90],
  styleId: APPEND_STYLE_ID, tableProps: 'firstRow="1" lastRow="1" bandRow="1"',
  trailing: '<a:extLst><a:ext uri="{4485728A-C22C-4D8B-9C62-18D05E3A3D8C}"><a14:compatExt xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" spid="_x0000_s2048"/></a:ext></a:extLst>',
  rows: [
    [cell({ text: '<a:p><a:r><a:t>标题一</a:t></a:r></a:p>' }), cell({ text: '<a:p><a:r><a:t>标题二</a:t></a:r></a:p>' }), cell({ text: '<a:p><a:r><a:t>标题三</a:t></a:r></a:p>' }), cell({ text: '<a:p><a:r><a:t>标题四</a:t></a:r></a:p>' })],
    [cell({ text: '<a:p><a:r><a:t>条纹一</a:t></a:r></a:p>' }), cell({ text: '<a:p><a:r><a:t>条纹二</a:t></a:r></a:p>' }), cell({ text: '<a:p><a:r><a:t>条纹三</a:t></a:r></a:p>' }), cell({ text: '<a:p><a:r><a:t>条纹四</a:t></a:r></a:p>' })],
    [
      cell({ attrs: 'gridSpan="2"', text: '<a:p><a:r><a:rPr sz="2100"/><a:t>末行合并</a:t></a:r></a:p>' }),
      cell({ attrs: 'hMerge="1"', text: '<a:p><a:r><a:t>横向占位</a:t></a:r></a:p>' }),
      cell({ text: '<a:p><a:r><a:rPr sz="1900"/><a:t>末行三</a:t></a:r></a:p>' }),
      cell({ text: '<a:p a14:paraId="00112233" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a:r><a:rPr sz="1900"/><a:t>末格</a:t></a:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a14"><a:r><a:t>兼容旧字</a:t></a:r></mc:Choice><mc:Fallback><a:r><a:t>回退旧字</a:t></a:r></mc:Fallback></mc:AlternateContent></a:p>' }),
    ],
  ],
});

const appendBands = table({
  name: '仅行条纹', x: 140, y: 430, widths: [260, 260], heights: [70, 70],
  styleId: APPEND_STYLE_ID, tableProps: 'firstRow="1" bandRow="1"',
  rows: [
    [cell({ text: '<a:p><a:r><a:t>条纹标题一</a:t></a:r></a:p>' }), cell({ text: '<a:p><a:r><a:t>条纹标题二</a:t></a:r></a:p>' })],
    [cell({ text: '<a:p><a:r><a:t>条纹起点一</a:t></a:r></a:p>' }), cell({ text: '<a:p><a:r><a:t>条纹起点二</a:t></a:r></a:p>' })],
  ],
});

const tableStyles = `${XML}<a:tblStyleLst xmlns:a="${NS.a}" def="${TABLE_STYLE_ID}">
<a:tblStyle styleId="${TABLE_STYLE_ID}" styleName="Editor Table Text">
<a:firstRow><a:tcTxStyle b="on"/></a:firstRow>
</a:tblStyle>
<a:tblStyle styleId="${APPEND_STYLE_ID}" styleName="Append Row Contract">
<a:wholeTbl><a:tcStyle><a:fill>${solid('FFFFFF')}</a:fill></a:tcStyle></a:wholeTbl>
<a:firstRow><a:tcStyle><a:fill>${solid('DBEAFE')}</a:fill></a:tcStyle><a:tcTxStyle b="on"/></a:firstRow>
<a:band1H><a:tcStyle><a:fill>${solid('DCFCE7')}</a:fill></a:tcStyle></a:band1H>
<a:band2H><a:tcStyle><a:fill>${solid('FEF3C7')}</a:fill></a:tcStyle></a:band2H>
<a:lastRow><a:tcStyle><a:fill>${solid('FCE7F3')}</a:fill></a:tcStyle><a:tcTxStyle b="on"/></a:lastRow>
</a:tblStyle></a:tblStyleLst>`;

const bytes = deck({
  name: 'Editor Table Text', width: 1280, height: 720,
  slides: [slideXml(semantic), slideXml(performance), slideXml(appendStyles + appendBands)],
  presRels: '<Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>',
  extraTypes: '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>',
  extraEntries: [['ppt/tableStyles.xml', tableStyles]],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-table-text.pptx'), bytes);
console.log(`fixtures/sample-editor-table-text.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
