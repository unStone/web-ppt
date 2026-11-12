import { diffPackageBytes } from '../diff-package.mjs';
import { makeTtf } from './font.mjs';

const decoder = new TextDecoder();

/** 嵌入字体写入保存：登记 → 保存 → 重开读回字节一致；许可拒绝与幂等另验。 */
export async function runFontEmbeddingSaveContract({ edit, core, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 嵌入字体写入保存与读回一致\x1b[0m');
  const font = makeTtf({ family: 'WebPPT Embedded Write', style: 'Bold', bold: true, italic: false });
  const rights = core.sfntEmbeddingRights(font);
  if (!check('固件字体允许写入', rights.ok && rights.rights.usage === 'installable', JSON.stringify(rights))) return;
  const base64 = Buffer.from(font).toString('base64');
  const input = load('sample-editor-text.pptx');
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(presentation, { idPrefix: 'font-embed-' });
  doc.fontResources = {
    w1: { family: 'WebPPT Embedded Write', hash: 'w1', mime: 'font/ttf', styles: [{ bold: true, italic: false }], bytes: base64, fsType: 0 },
  };
  const editor = new edit.Editor(doc);
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('font-embedding.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const fontPart = 'ppt/fonts/w1.fntdata';
  check(
    '保存只新增字体部件并改 presentation 三处闭包',
    diff.added.join(',') === fontPart
      && diff.changed.sort().join(',') === '[Content_Types].xml,ppt/_rels/presentation.xml.rels,ppt/presentation.xml',
    `artifact=${artifact} added=${diff.added} changed=${diff.changed}`,
  );
  const rels = decoder.decode(saved.package.parts['ppt/_rels/presentation.xml.rels']);
  const presXml = decoder.decode(saved.package.parts['ppt/presentation.xml']);
  const contentTypes = decoder.decode(saved.package.parts['[Content_Types].xml']);
  const container = saved.package.parts[fontPart];
  check('关系指向字体部件', rels.includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"') && rels.includes('Target="fonts/w1.fntdata"'), rels.slice(-300));
  check('embeddedFontLst 引用同一关系', presXml.includes('<p:embeddedFontLst>') && presXml.includes('typeface="WebPPT Embedded Write"') && /<p:bold r:id="rId\d+"/.test(presXml), presXml.slice(presXml.indexOf('embeddedFontLst'), presXml.indexOf('embeddedFontLst') + 300));
  check('Content-Type 登记 fntdata', contentTypes.includes('Extension="fntdata"'), contentTypes.slice(0, 400));
  check('容器头是 EOT 魔数且 Flags 无子集位', container[34] === 0x4c && container[35] === 0x50 && !(container[12] & 1));
  check('容器 fsType 回写真实许可值', container[32] === 0 && container[33] === 0, `${container[32]},${container[33]}`);

  // 读侧（浏览器）fetch blob 拿到的就是 fontUrl 经 embeddedFontToSfnt 还原的 sfnt；
  // node 里 blob 协议不可 fetch，直接对保存产物剥头断言同一语义
  const reopened = await core.parse(saved.bytes, { lazy: false, assets: 'defer' });
  const fonts = reopened.embeddedFonts ?? [];
  check('重开读回嵌入字体', fonts.length === 1 && fonts[0].family === 'WebPPT Embedded Write' && fonts[0].bold === true, JSON.stringify(fonts.map((f) => f.family)));
  const decoded = core.embeddedFontToSfnt(container);
  check('读侧还原 sfnt 逐字节等于登记原字体', !!decoded && decoded.mime === 'font/ttf'
    && decoded.data.length === font.length && decoded.data.every((b, i) => b === font[i]),
    decoded ? `${decoded.data.length}B vs ${font.length}B` : 'null');

  // 幂等：不动资源再次保存，部件字节与关系身份保持稳定
  const again = await editor.saveDetailed();
  const container2 = again.package.parts[fontPart];
  check(
    '重复保存部件名与字节不变',
    !!container2 && container2.length === container.length && container2.every((b, i) => b === container[i]),
    artifact,
  );

  // 许可拒绝：restricted 字体在登记边界拒绝
  const restricted = font.slice();
  const view = new DataView(restricted.buffer);
  let os2 = -1;
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(restricted[record], restricted[record + 1], restricted[record + 2], restricted[record + 3]) === 'OS/2') {
      os2 = view.getUint32(record + 8);
    }
  }
  view.setUint16(os2 + 8, 0x0002);
  const denied = core.sfntEmbeddingRights(restricted);
  check('restricted 字体写入边界拒绝', !denied.ok && denied.reason === 'embedding-restricted', JSON.stringify(denied));
}
