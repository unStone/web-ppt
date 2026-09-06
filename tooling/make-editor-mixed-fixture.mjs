import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { makeZip, NS, px } from './lib/ooxml.mjs';
import { kinds } from './lib/chartex-native-fixture.mjs';

const read = (name) => unzipSync(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const parts = read('sample-chart-data.pptx'), modern = read('sample-chartex-native.pptx');
const comments = read('sample-editor-comments.pptx'), appearance = read('sample-editor-appearance.pptx');
const add = (part, end, content) => { parts[part] = strToU8(strFromU8(parts[part]).replace(end, content + end)); };
const type = (part, contentType) => add('[Content_Types].xml', '</Types>', `<Override PartName="/${part}" ContentType="${contentType}"/>`);
const rel = (page, id, kind, target) => add(`ppt/slides/_rels/slide${page}.xml.rels`, '</Relationships>',
  `<Relationship Id="${id}" Type="${kind}" Target="${target}"/>`);
for (const [i] of kinds.entries()) {
  const page = i + 1;
  const shell = strFromU8(modern[`ppt/slides/slide${page}.xml`]).match(/<mc:AlternateContent[\s\S]*<\/mc:AlternateContent>/)[0]
    .replaceAll('id="6"', 'id="906"').replaceAll('rId2', 'rIdModern').replaceAll('rId3', 'rIdModernPreview');
  add(`ppt/slides/slide${page}.xml`, '</p:spTree>', shell);
  rel(page, 'rIdModern', 'http://schemas.microsoft.com/office/2014/relationships/chartEx', `../charts/chartEx${page}.xml`);
  rel(page, 'rIdModernPreview', `${NS.r}/image`, '../media/chartex.png');
  const part = `ppt/charts/chartEx${page}.xml`;
  parts[part] = modern[part]; type(part, 'application/vnd.ms-office.chartex+xml');
}
parts['ppt/media/chartex.png'] = modern['ppt/media/chartex.png'];
for (const [part, bytes] of Object.entries(comments)) if (/^ppt\/(comments\/|commentAuthors.xml)/.test(part)) {
  parts[part] = bytes;
  type(part, `application/vnd.openxmlformats-officedocument.presentationml.${part.includes('/comments/') ? 'comments' : 'commentAuthors'}+xml`);
}
for (const page of [1, 2]) rel(page, 'rIdComments', `${NS.r}/comments`, `../comments/comment${page}.xml`);
add('ppt/_rels/presentation.xml.rels', '</Relationships>', `<Relationship Id="rIdComments" Type="${NS.r}/commentAuthors" Target="commentAuthors.xml"/>`);
// 独立页带来源图片效果和真实可播放字节，使源固件本身就覆盖完整混合内容。
const source = strFromU8(appearance['ppt/slides/slide1.xml']);
add('ppt/slides/slide9.xml', '</p:spTree>', [...source.matchAll(/<p:(pic|sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)].map((match) => match[0]).join('')
  .replaceAll('rId10', 'rIdMixedImage'));
const imageRels = strFromU8(appearance['ppt/slides/_rels/slide1.xml.rels']).match(/<Relationship\b[^>]*Type="[^"]*\/image"[^>]*\/>/g) ?? [];
add('ppt/slides/_rels/slide9.xml.rels', '</Relationships>', imageRels.join('').replaceAll('rId10', 'rIdMixedImage'));
for (const [part, bytes] of Object.entries(appearance)) if (part.startsWith('ppt/media/')) parts[part] = bytes;
for (const [i, [kind, ext, mime]] of [['audio', 'wav', 'audio/wav'], ['video', 'mp4', 'video/mp4']].entries()) {
  const id = `rIdMixed${kind}`;
  add('ppt/slides/slide9.xml', '</p:spTree>', `<p:pic><p:nvPicPr><p:cNvPr id="${970 + i}" name="mixed-${kind}"/><p:cNvPicPr/><p:nvPr><a:${kind}File r:link="${id}"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rIdMixedPoster"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${px(720 + i * 160)}" y="${px(520)}"/><a:ext cx="${px(120)}" cy="${px(80)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
  rel(9, id, `${NS.r}/${kind}`, `../media/mixed.${ext}`);
  const part = `ppt/media/mixed.${ext}`;
  parts[part] = readFileSync(new URL(`../fixtures/sample-editor-media.${ext}`, import.meta.url)); type(part, mime);
}
rel(9, 'rIdMixedPoster', `${NS.r}/image`, '../media/chartex.png');
if (!strFromU8(parts['[Content_Types].xml']).includes('Extension="png"')) add('[Content_Types].xml', '</Types>', '<Default Extension="png" ContentType="image/png"/>');
writeFileSync(new URL('../fixtures/sample-editor-mixed.pptx', import.meta.url), makeZip(Object.entries(parts)));
