import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strToU8, strFromU8 } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const parts = unzipSync(readFileSync(new URL('../fixtures/sample-editor-comments.pptx', import.meta.url)));
const part = 'ppt/comments/comment1.xml';
parts[part] = strToU8(strFromU8(parts[part]).replace('</p:cmLst>', `<p:cm authorId="0" idx="4"><p:pos x="952500" y="952500"/><p:text>已有回复</p:text><p:extLst><p:ext uri="{C676402C-5697-4E1C-873F-D02D1690AC5C}"><p15:threadingInfo xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main"><p15:parentCm authorId="1" idx="1"/></p15:threadingInfo></p:ext></p:extLst></p:cm></p:cmLst>`));
writeFileSync(new URL('../fixtures/sample-comment-edit.pptx', import.meta.url), makeZip(Object.entries(parts)));
