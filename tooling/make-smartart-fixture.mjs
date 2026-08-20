/**
 * 生成 fixtures/sample-smartart.pptx —— SmartArt 的两条路径都要有覆盖。
 *
 * 第 1 页：带缓存 drawing part（PowerPoint 存出来的样子）—— 走「直接读画好的图形」
 * 第 2-6 页：只有 data + layout，没有 drawing —— 走自研布局回退，每页一个布局族
 *
 * 此前 SmartArt 一个固件都没有，两条路径都从未被测过。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, makeZip, NS, nvGrp, px, slideXml, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;

const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const t = (s) => `<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1400"/><a:t>${s}</a:t></a:r></a:p></dgm:t>`;

/** 数据模型：doc 根 + 一棵点树。tree 为 [文本, 子节点[]] 的嵌套数组 */
function dataModel(tree) {
  const pts = [`<dgm:pt modelId="0" type="doc"><dgm:prSet/><dgm:spPr/></dgm:pt>`];
  const cxns = [];
  let seq = 0;
  const walk = (nodes, parentId) => {
    nodes.forEach(([text, kids = []], i) => {
      const id = `n${++seq}`;
      pts.push(`<dgm:pt modelId="${id}"><dgm:prSet/><dgm:spPr/>${t(text)}</dgm:pt>`);
      // parTrans / sibTrans 是真实文件里一定有的噪声点，解析必须把它们滤掉
      pts.push(`<dgm:pt modelId="${id}p" type="parTrans" cxnId="c${id}"><dgm:prSet/><dgm:spPr/></dgm:pt>`);
      pts.push(`<dgm:pt modelId="${id}s" type="sibTrans" cxnId="c${id}"><dgm:prSet/><dgm:spPr/></dgm:pt>`);
      cxns.push(`<dgm:cxn modelId="c${id}" srcId="${parentId}" destId="${id}" srcOrd="${i}" destOrd="0" parTransId="${id}p" sibTransId="${id}s"/>`);
      walk(kids, id);
    });
  };
  walk(tree, '0');
  // presOf 连接指向表现层，混进树里会让节点翻倍——必须被过滤
  cxns.push(`<dgm:cxn modelId="pres1" type="presOf" srcId="0" destId="n1" srcOrd="0" destOrd="0"/>`);
  return `${XML}<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${NS.a}">
<dgm:ptLst>${pts.join('')}</dgm:ptLst><dgm:cxnLst>${cxns.join('')}</dgm:cxnLst>
<dgm:bg/><dgm:whole/></dgm:dataModel>`;
}

function layoutDef(uniqueId, alg, linDir) {
  return `${XML}<dgm:layoutDef xmlns:dgm="${DGM}" xmlns:a="${NS.a}" uniqueId="${uniqueId}">
<dgm:title val=""/><dgm:desc val=""/>
<dgm:layoutNode name="root"><dgm:alg type="${alg}">${linDir ? `<dgm:param type="linDir" val="${linDir}"/>` : ''}</dgm:alg>
<dgm:shape xmlns:r="${NS.r}" type="none"/><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/>
</dgm:layoutNode></dgm:layoutDef>`;
}

const colorsXml = `${XML}<dgm:colorsDef xmlns:dgm="${DGM}" xmlns:a="${NS.a}" uniqueId="urn:test/colors">
<dgm:title val=""/><dgm:desc val=""/>
<dgm:styleLbl name="node0"><dgm:fillClrLst meth="repeat">
<a:schemeClr val="accent1"/><a:schemeClr val="accent2"/><a:schemeClr val="accent3"/>
<a:schemeClr val="accent4"/><a:schemeClr val="accent5"/><a:schemeClr val="accent6"/>
</dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:linClrLst>
<dgm:txLinClrLst/><dgm:txFillClrLst/><dgm:txEffectClrLst/><dgm:effectClrLst/>
</dgm:styleLbl></dgm:colorsDef>`;

const quickStyleXml = `${XML}<dgm:styleDef xmlns:dgm="${DGM}" xmlns:a="${NS.a}" uniqueId="urn:test/style">
<dgm:title val=""/><dgm:desc val=""/><dgm:scene3d><a:camera prst="orthographicFront"/>
<a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:styleLbl name="node0"><dgm:scene3d>
<a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d>
<dgm:sp3d/><dgm:txPr/><dgm:style/></dgm:styleLbl></dgm:styleDef>`;

/** 缓存 drawing part：PowerPoint 会把算好的形状写在这里 */
const drawingXml = `${XML}<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="${NS.a}">
<dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>
${['缓存A', '缓存B', '缓存C'].map((label, i) => `<dsp:sp><dsp:nvSpPr><dsp:cNvPr id="${i + 1}" name="cached${i}"/><dsp:cNvSpPr/></dsp:nvSpPr>
<dsp:spPr><a:xfrm><a:off x="${px(20 + i * 210)}" y="${px(40)}"/><a:ext cx="${px(190)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent${i + 1}"/></a:solidFill></dsp:spPr>
<dsp:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1400" b="1">
<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${label}</a:t></a:r></a:p></dsp:txBody></dsp:sp>`).join('')}
</dsp:spTree></dsp:drawing>`;

// ---------- 每页一种情形 ----------

const CASES = [
  {
    title: '缓存 drawing part（直接读画好的图形）',
    tree: [['数据A'], ['数据B'], ['数据C']],
    layout: layoutDef('urn:microsoft.com/office/officeart/2005/8/layout/process1', 'lin'),
    withDrawing: true,
  },
  {
    title: '无 drawing · 线性流程（lin）',
    tree: [['需求'], ['设计'], ['实现'], ['验收']],
    layout: layoutDef('urn:microsoft.com/office/officeart/2005/8/layout/process1', 'lin'),
  },
  {
    title: '无 drawing · 循环（cycle）',
    tree: [['计划'], ['执行'], ['检查'], ['改进']],
    layout: layoutDef('urn:microsoft.com/office/officeart/2005/8/layout/cycle2', 'cycle'),
  },
  {
    title: '无 drawing · 金字塔（pyra）',
    tree: [['战略'], ['战术'], ['执行']],
    layout: layoutDef('urn:microsoft.com/office/officeart/2005/8/layout/pyramid1', 'pyra'),
  },
  {
    title: '无 drawing · 组织结构（hierRoot）',
    tree: [['CEO', [['研发', [['前端'], ['后端']]], ['市场']]]],
    layout: layoutDef('urn:microsoft.com/office/officeart/2005/8/layout/orgChart1', 'hierRoot'),
  },
  {
    title: '无 drawing · 竖排列表（linDir=fromT）',
    tree: [['第一条'], ['第二条'], ['第三条']],
    layout: layoutDef('urn:microsoft.com/office/officeart/2005/8/layout/vList2', 'lin', 'fromT'),
  },
];

const slides = CASES.map((c, i) => slideXml(
  sp({ x: 40, y: 24, w: 900, h: 34, prst: 'rect', fill: '<a:noFill/>',
    text: `<a:p><a:r><a:rPr sz="1600" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>${c.title}</a:t></a:r></a:p>` }) +
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${500 + i}" name="SmartArt${i}"/>
<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(120)}" y="${px(100)}"/><a:ext cx="${px(1040)}" cy="${px(520)}"/></p:xfrm>
<a:graphic><a:graphicData uri="${DGM}">
<dgm:relIds xmlns:dgm="${DGM}" xmlns:r="${NS.r}" r:dm="rId2" r:lo="rId3" r:qs="rId4" r:cs="rId5"${c.withDrawing ? ' r:dgm="rId6"' : ''}/>
</a:graphicData></a:graphic></p:graphicFrame>`,
));

// deck() 只铺公共骨架，diagram 各 part 与每页的 rels 在这里补
const zip = deck({ name: 'SmartArt', width: W, height: H, slides });

// 重新组包：deck 已经产出完整 zip，这里需要额外 part，所以直接重建条目表
const { unzipSync } = await import('fflate');
const files = unzipSync(zip);
const entries = Object.entries(files).map(([k, v]) => [k, v]);

const dec = new TextDecoder();
CASES.forEach((c, i) => {
  const n = i + 1;
  entries.push([`ppt/diagrams/data${n}.xml`, dataModel(c.tree)]);
  entries.push([`ppt/diagrams/layout${n}.xml`, c.layout]);
  entries.push([`ppt/diagrams/quickStyle${n}.xml`, quickStyleXml]);
  entries.push([`ppt/diagrams/colors${n}.xml`, colorsXml]);
  if (c.withDrawing) entries.push([`ppt/diagrams/drawing${n}.xml`, drawingXml]);

  const rels = [
    `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    `<Relationship Id="rId2" Type="${REL}/diagramData" Target="../diagrams/data${n}.xml"/>`,
    `<Relationship Id="rId3" Type="${REL}/diagramLayout" Target="../diagrams/layout${n}.xml"/>`,
    `<Relationship Id="rId4" Type="${REL}/diagramQuickStyle" Target="../diagrams/quickStyle${n}.xml"/>`,
    `<Relationship Id="rId5" Type="${REL}/diagramColors" Target="../diagrams/colors${n}.xml"/>`,
  ];
  if (c.withDrawing) {
    rels.push(`<Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing${n}.xml"/>`);
  }
  const idx = entries.findIndex(([k]) => k === `ppt/slides/_rels/slide${n}.xml.rels`);
  entries[idx] = [`ppt/slides/_rels/slide${n}.xml.rels`,
    `${XML}<Relationships xmlns="${NS.rel}">${rels.join('')}</Relationships>`];
});

// Content_Types 补上 diagram 各 part
const ctIdx = entries.findIndex(([k]) => k === '[Content_Types].xml');
let ct = dec.decode(entries[ctIdx][1]);
const overrides = CASES.map((c, i) => {
  const n = i + 1;
  return `<Override PartName="/ppt/diagrams/data${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml"/>` +
    `<Override PartName="/ppt/diagrams/layout${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml"/>` +
    `<Override PartName="/ppt/diagrams/quickStyle${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml"/>` +
    `<Override PartName="/ppt/diagrams/colors${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml"/>` +
    (c.withDrawing ? `<Override PartName="/ppt/diagrams/drawing${n}.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/>` : '');
}).join('');
ct = ct.replace('</Types>', `${overrides}</Types>`);
entries[ctIdx] = ['[Content_Types].xml', ct];

const out = makeZip(entries);
writeFileSync(join(root, 'fixtures/sample-smartart.pptx'), out);
console.log(`fixtures/sample-smartart.pptx 已生成（${CASES.length} 页，${(out.length / 1024).toFixed(1)} KB）`);
