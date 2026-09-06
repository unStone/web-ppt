import { writeFileSync } from 'node:fs';
import { unzipSync, strToU8, strFromU8 } from 'fflate';
import { deck, makeZip, NS, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const parts = unzipSync(deck({ name: 'Read-only comments', width: 640, height: 360,
  slides: [0, 1, 2].map((i) => slideXml(sp({ name: `comment-shape-${i}`, x: 80, y: 80, w: 300, h: 150, fill: solid('4285F4') }))) }));
const add = (part, end, content) => { parts[part] = strToU8(strFromU8(parts[part]).replace(end, content + end)); };
parts['ppt/commentAuthors.xml'] = strToU8(`${XML}<p:cmAuthorLst xmlns:p="${NS.p}">
<p:cmAuthor id="0" name="审阅 &amp; Review" initials="SR" lastIdx="3" clrIdx="0"/>
<p:cmAuthor id="1" name="Reviewer" initials="" lastIdx="1" clrIdx="1"/></p:cmAuthorLst>`);
add('ppt/_rels/presentation.xml.rels', '</Relationships>', `<Relationship Id="rIdComments" Type="${NS.r}/commentAuthors" Target="commentAuthors.xml"/>`);
add('[Content_Types].xml', '</Types>', '<Override PartName="/ppt/commentAuthors.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"/>');
const content = [
  '<p:cm authorId="0" dt="2026-01-02T03:04:05Z" idx="1"><p:pos x="952500" y="952500"/><p:text>第一条 &lt;script&gt; &amp; English</p:text><p:extLst><p:ext uri="comments-fixture"><keep:data xmlns:keep="urn:comments-test"/></p:ext></p:extLst></p:cm>'
    + '<p:cm authorId="1" idx="1"><p:pos x="-95250" y="4762500"/><p:text>第二条\n保留换行</p:text></p:cm>',
  '<p:cm authorId="0" idx="3"><p:pos x="1905000" y="1905000"/><p:text>跨页批注</p:text></p:cm>',
];
for (const [i, body] of content.entries()) {
  parts[`ppt/comments/comment${i + 1}.xml`] = strToU8(`${XML}<p:cmLst xmlns:p="${NS.p}">${body}</p:cmLst>`);
  add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, '</Relationships>', `<Relationship Id="rIdComments" Type="${NS.r}/comments" Target="../comments/comment${i + 1}.xml"/>`);
  add('[Content_Types].xml', '</Types>', `<Override PartName="/ppt/comments/comment${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.comments+xml"/>`);
}
writeFileSync(new URL('../fixtures/sample-editor-comments.pptx', import.meta.url), makeZip(Object.entries(parts)));
