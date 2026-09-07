import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { makeZip } from './ooxml.mjs';
import { JSDOM } from 'jsdom';

// 复制/生成会重分配作者索引；比较父批注的位置，不能把格式身份当成正文语义。
const semantic = (slide) => (slide.comments ?? []).map(({ idx, id, parentId, ...comment }) => ({
  ...comment, ...(parentId ? { parent: slide.comments.findIndex((c) => c.id === parentId) } : {}),
}));
export async function runCommentsSaveContract({ core, edit, load, out, check }) {
  for (const generated of [false, true]) {
    const p = await core.parse(load('sample-editor-comments.pptx'), { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(p, { idPrefix: 'comments-' }), editor = new edit.Editor(doc);
    const frames = [];
    editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
    const first = doc.slideOrder[0], last = doc.slideOrder[2];
    const duplicate = [...editor.exec({ type: 'DuplicateSlide', id: first }).createdSlides][0];
    editor.exec({ type: 'MoveSlide', id: duplicate, at: { after: last } });
    editor.undo(); editor.redo();
    const expected = doc.slideOrder.map((id) => semantic(editor.toSlide(id)));
    if (generated) {
      for (const mode of ['external', 'recovery']) {
        const original = await core.parse(load('sample-editor-comments.pptx'), { edit: true, keepPackage: true, lazy: false });
        const copy = new edit.Editor(edit.createDoc(original, { idPrefix: 'comments-' }), mode === 'recovery' ? { recoveryFrames: frames } : {});
        if (mode === 'external') for (const frame of frames) copy.applyExternalPatches(frame.patches);
        original.dispose();
        const restored = await core.parse(await copy.save(), { lazy: false });
        check(`批注副本 ${mode} 回放后释放来源仍可生成保存`, JSON.stringify(restored.slides.map(semantic)) === JSON.stringify(expected));
        restored.dispose(); copy.dispose();
      }
      p.dispose();
    }
    const bytes = await editor.save();
    writeFileSync(join(out, `comments-${generated ? 'generated' : 'patched'}.pptx`), bytes);
    const q = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
    check('批注复制、重排与历史之后两条保存保留完整语义', JSON.stringify(q.slides.map(semantic)) === JSON.stringify(expected));
    const parts = unzipSync(bytes);
    if (!generated) check('补丁保存保留未编辑批注未知扩展', strFromU8(parts['ppt/comments/comment1.xml']).includes('keep:data'));
    {
      const pairs = [];
      for (const [name, value] of Object.entries(parts)) if (/^ppt\/comments\/[^/]+\.xml$/.test(name)) {
        const dom = new JSDOM(strFromU8(value), { contentType: 'application/xml' });
        for (const cm of dom.window.document.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'cm')) {
          pairs.push(`${cm.getAttribute('authorId')}/${cm.getAttribute('idx')}`);
        }
        dom.window.close();
      }
      check('两条保存为复制页分配全文档唯一的作者批注索引', pairs.length === 5 && new Set(pairs).size === pairs.length);
      if (!generated) {
        const repeatedBytes = await editor.save();
        check('连续补丁保存不累积批注或索引', Buffer.from(repeatedBytes).equals(Buffer.from(bytes)));
        editor.undo(); editor.undo();
        const undoneBytes = await editor.save(), undone = await core.parse(undoneBytes, { lazy: false });
        check('保存后撤销复制清理副本批注部件', undone.slides.length === 3
          && !Object.keys(unzipSync(undoneBytes)).some((part) => /comments\/web-ppt-/.test(part)));
        undone.dispose(); editor.redo(); editor.redo();
        const redone = await core.parse(await editor.save(), { lazy: false });
        check('保存后重做复制重建独立批注', JSON.stringify(redone.slides.map(semantic)) === JSON.stringify(expected));
        redone.dispose();
      }
      const repeated = new edit.Editor(edit.createDoc(q));
      q.dispose();
      const again = await core.parse(await repeated.save(), { lazy: false });
      check('批注重复生成保存不丢失或重复', JSON.stringify(again.slides.map(semantic)) === JSON.stringify(expected));
      again.dispose(); repeated.dispose();
    }
    q.dispose(); p.dispose(); editor.dispose();
  }
  const extreme = unzipSync(load('sample-editor-comments.pptx'));
  extreme['ppt/comments/comment1.xml'] = strToU8(strFromU8(extreme['ppt/comments/comment1.xml']).replace('idx="1"', 'idx="4294967295"'));
  const input = makeZip(Object.entries(extreme));
  for (const generated of [false, true]) {
    const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(p), editor = new edit.Editor(doc);
    editor.exec({ type: 'DuplicateSlide', id: doc.slideOrder[0] });
    const expected = doc.slideOrder.map((id) => semantic(editor.toSlide(id)));
    if (generated) p.dispose();
    const reopened = await core.parse(await editor.save(), { lazy: false });
    check('最大合法索引和跨作者逆序仍保留批注阅读顺序', JSON.stringify(reopened.slides.map(semantic)) === JSON.stringify(expected));
    reopened.dispose(); p.dispose(); editor.dispose();
  }

  const relocated = unzipSync(load('sample-editor-comments.pptx'));
  const oldPart = 'ppt/comments/comment1.xml', newPart = 'ppt/review/nested/comment1.xml';
  relocated[newPart] = strToU8(strFromU8(relocated[oldPart]).replace('</p:cmLst>', '<keep:cm xmlns:keep="urn:comments-test">must retain</keep:cm></p:cmLst>')); delete relocated[oldPart];
  relocated['ppt/slides/_rels/slide1.xml.rels'] = strToU8(strFromU8(relocated['ppt/slides/_rels/slide1.xml.rels'])
    .replace('Target="../comments/comment1.xml"', 'Target="../review/nested/comment1.xml" TargetMode="Internal"'));
  relocated['[Content_Types].xml'] = strToU8(strFromU8(relocated['[Content_Types].xml']).replace(oldPart, newPart)
    .replace('</Types>', '<Override PartName="/customXml/comment-metadata.xml" ContentType="application/xml"/></Types>'));
  relocated['ppt/review/nested/_rels/comment1.xml.rels'] = strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdData" Type="urn:comment-test" Target="../../../customXml/comment-metadata.xml" TargetMode="Internal"/></Relationships>');
  relocated['customXml/comment-metadata.xml'] = strToU8('<data/>');
  const p = await core.parse(makeZip(Object.entries(relocated)), { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(p), editor = new edit.Editor(doc);
  editor.exec({ type: 'DuplicateSlide', id: doc.slideOrder[0] });
  const saved = unzipSync(await editor.save());
  const copied = Object.keys(saved).find((part) => /^ppt\/comments\/web-ppt-.*\.xml$/.test(part));
  check('显式 Internal 和非默认目录批注仍独立复制并重定位子关系', !!copied
    && strFromU8(saved[copied]).includes('>must retain</keep:cm>')
    && strFromU8(saved[copied.replace('/comments/', '/comments/_rels/') + '.rels']).includes('Target="../../customXml/comment-metadata.xml"'));
  editor.dispose(); p.dispose();

}
