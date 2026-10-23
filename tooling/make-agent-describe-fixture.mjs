import { writeFileSync } from 'node:fs';
import { deck, label, nextShapeId, NS, px, slideXml, sp } from './lib/ooxml.mjs';

const placeholder = (name, type, idx, text) => sp({
  name, x: 40, y: 30, w: 300, h: 60, text: label(text),
}).replace('<p:nvPr/>', `<p:nvPr><p:ph type="${type}" idx="${idx}"/></p:nvPr>`);
const child = sp({ name: '组内中文', x: 20, y: 10, w: 80, h: 30, text:
  '<a:p><a:pPr lvl="2"><a:buChar char="•"/></a:pPr><a:r><a:t>中文 &amp; "quotes" 😀</a:t></a:r></a:p>' });
const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextShapeId()}" name="缩放组合"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(100)}" y="${px(100)}"/><a:ext cx="${px(400)}" cy="${px(100)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(200)}" cy="${px(100)}"/></a:xfrm></p:grpSpPr>${child}</p:grpSp>`;

writeFileSync(new URL('../fixtures/sample-agent-describe.pptx', import.meta.url), deck({
  name: 'Agent describe', width: 640, height: 360,
  masterShapes: placeholder('母版标题', 'title', '7', '母版提示'),
  layoutShapes: placeholder('版式标题', 'ctrTitle', '7', '版式提示'),
  slides: [
    slideXml(placeholder('页面标题', 'title', '7', '可编辑标题') + group),
    slideXml(sp({ name: '隐藏页文字', x: 10, y: 20, w: 300, h: 40, text: label('第二页') }), '', 'show="0"'),
  ],
  presExtra: `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="第一节" id="{11111111-2222-3333-4444-555555555555}"><p14:sldIdLst><p14:sldId id="256"/><p14:sldId id="257"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst>`,
  slideRelationships: [`<Relationship Id="rIdNotes" Type="${NS.r}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>`],
  extraTypes: '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>',
  extraEntries: [['ppt/notesSlides/notesSlide1.xml', `<p:notes xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="备注"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${label('备注 &amp; Notes')}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`]],
}));
