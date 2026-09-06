import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
export async function nativeContextContract({ core, edit, parser, bytes, check }) {
  for (const native of [true, false]) {
    core.setChartExParser(native ? parser : null);
    const pres = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
    const doc = edit.createDoc(pres), editor = new edit.Editor(doc);
    const slide = doc.slideOrder[0];
    const checkKind = (name) => check(`${native ? '原生' : '回退'}文稿/${name}`, () => {
      assert.equal(editor.toSlide(slide).elements.find((el) => el.id === 6)?.kind, native ? 'group' : 'image');
    });
    core.setChartExParser(native ? null : parser);
    try {
      editor.exec({ type: 'SetTheme', id: doc.themeOrder[0], clrScheme: { accent1: '#123456' } });
      checkKind('主题重解析沿用打开时配置');
      await editor.save();
      editor.exec({ type: 'SetTheme', id: doc.themeOrder[0], clrScheme: { accent1: '#456789' } });
      checkKind('补丁保存后的新包沿用原配置');
      const master = edit.listMasters(doc)[0];
      editor.execDesign(master.target, { type: 'SetBackground', target: master.target, fill: { type: 'solid', color: '#F0F0F0' } });
      checkKind('母版属性投影沿用原配置');
      editor.execDesign(master.target, { type: 'AddShape', target: master.target, preset: 'rect', rect: { x: 1, y: 1, w: 10, h: 10 } });
      checkKind('母版元素投影沿用原配置');
    } finally {
      editor.dispose();
      pres.dispose();
    }
  }
  core.setChartExParser(parser);
}
export async function nativeSaveContract({ core, edit, bytes, out, check }) {
  const original = unzipSync(bytes);
  for (const generated of [false, true]) {
    const pres = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
    const doc = edit.createDoc(pres, { idPrefix: 'cx-native-' }), editor = new edit.Editor(doc);
    const frames = [];
    const unsubscribe = editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
    const mode = generated ? 'generated' : 'patch';
    try {
      const slide = doc.slideOrder[0], id = doc.slides[slide].children[0];
      check(`${mode} 原生孩子没有独立编辑权限`, () => {
        const childId = doc.elements[id].children[0];
        assert.throws(() => editor.exec({ type: 'SetXfrm', id: childId, x: 1 }));
      });
      editor.exec({ type: 'SetXfrm', id, x: 70 });
      editor.undo();
      editor.redo();
      editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [id]), at: { parentId: slide, x: 160, y: 100 } });
      if (generated)
        pres.dispose();
      const saved = await editor.save();
      writeFileSync(resolve(out, `native-${mode}.pptx`), saved);
      const parts = unzipSync(saved);
      for (const [name, source] of Object.entries(original).filter(([name]) => name.startsWith('ppt/charts/') || name.startsWith('ppt/media/'))) {
        check(`${mode} 原始图表/预览字节保持 ${name}`, () => assert.deepEqual(parts[name], source));
      }
      const reopened = await core.parse(saved, { lazy: false, edit: true });
      try {
        check(`${mode} 原生图表保存重开`, () => assert.deepEqual(reopened.slides.map((s) => s.elements[0].kind), ['group', 'group', 'group', 'group', 'group', 'group', 'group', 'image']));
        check(`${mode} 整壳复制移动仍有效`, () => { assert.equal(reopened.slides[0].elements.length, 2); assert.equal(reopened.slides[0].elements[0].x, 70); assert.equal(reopened.slides[0].elements[1].x, 160); });
      }
      finally {
        reopened.dispose();
      }
      for (const replay of ['recovery', 'external']) {
        const p = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
        const d = edit.createDoc(p, { idPrefix: 'cx-native-' }), e = new edit.Editor(d, replay === 'recovery' ? { recoveryFrames: frames } : {});
        try {
          if (replay === 'external')
            for (const frame of frames)
              if (frame.patches.length)
                e.applyExternalPatches(frame.patches);
          p.dispose();
          const r = await core.parse(await e.save(), { lazy: false, edit: true });
          try {
            check(`${mode}/${replay} 原包释放后保持整壳`, () => { assert.equal(r.slides[0].elements.length, 2); assert.equal(r.slides[0].elements[0].kind, 'group'); assert.equal(r.slides[0].elements[0].x, 70); });
          }
          finally {
            r.dispose();
          }
        }
        finally {
          e.dispose();
        }
      }
    }
    finally {
      unsubscribe();
      editor.dispose();
      pres.dispose();
    }
  }
}
