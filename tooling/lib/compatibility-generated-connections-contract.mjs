import { unzipSync } from 'fflate';
import { rewriteCompatibilityFixture } from './alternate-content-selection-contract.mjs';

export async function runCompatibilityGeneratedConnectionsContract({ core, edit, bytes, eq }) {
  const variant = rewriteCompatibilityFixture(bytes, (xml) => {
    const picture = xml.match(/<mc:Fallback>([\s\S]*?)<\/mc:Fallback>/)[1].replace('id="6"', 'id="7"');
    const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="opaque"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="2286000"/><a:chOff x="0" y="0"/><a:chExt cx="3810000" cy="2286000"/></a:xfrm></p:grpSpPr>${picture}
      <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="8" name="connector"/><p:cNvCxnSpPr><a:stCxn id="7" idx="0"/><a:endCxn id="7" idx="1"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:cxnSp></p:grpSp>`;
    return xml.replace('http://schemas.microsoft.com/office/drawing/2015/10/21/chartex',
      'http://schemas.microsoft.com/office/powerpoint/2010/main')
      .replace(/<mc:Choice[^>]*>[\s\S]*?<\/mc:Choice>/, `<mc:Choice Requires="modern">${group}</mc:Choice>`);
  });
  const presentation = await core.parse(variant, { lazy: false, edit: true, keepPackage: true });
  const editor = new edit.Editor(edit.createDoc(presentation));
  try {
    presentation.dispose();
    const xml = new TextDecoder().decode(unzipSync(await editor.save())['ppt/slides/slide1.xml']);
    const target = xml.match(/<p:cNvPr id="(\d+)" name="fallback-chart"/)[1];
    eq('兼容组内部连接起点随宿主 ID 同步重映射', xml.match(/<a:stCxn id="(\d+)"/)[1], target);
    eq('兼容组内部连接终点随宿主 ID 同步重映射', xml.match(/<a:endCxn id="(\d+)"/)[1], target);
  } finally { editor.dispose(); }
}

export async function runCompatibilityGeneratedParentContract({ core, edit, bytes, eq }) {
  const variant = rewriteCompatibilityFixture(bytes, (xml) => xml.replace(
    /<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/,
    (envelope) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="outer"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="3429000"/><a:chOff x="0" y="0"/><a:chExt cx="6096000" cy="3429000"/></a:xfrm></p:grpSpPr>${envelope}</p:grpSp>`));
  const presentation = await core.parse(variant, { lazy: false, edit: true, keepPackage: true });
  const editor = new edit.Editor(edit.createDoc(presentation));
  try {
    const slide = editor.doc.slideOrder[0];
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(editor.doc, [editor.doc.slides[slide].children[0]]),
      at: { parentId: slide, x: 180, y: 80 } });
    presentation.dispose();
    const reopened = await core.parse(await editor.save(), { lazy: false, edit: true });
    try {
      eq('复制普通父组后生成保存保留两个组', reopened.slides[0].elements.length, 2);
      eq('副本 MC 孩子从父级插入闭包重建', reopened.slides[0].elements[1].children[0].editInfo.editable, 'frame');
    } finally { reopened.dispose(); }
  } finally { editor.dispose(); }
}
