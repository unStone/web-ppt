import { unzipSync } from 'fflate';
import { rewriteCompatibilityFixture } from './alternate-content-selection-contract.mjs';

export async function runCompatibilityStructureContract({ core, edit, bytes, check, eq }) {
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  const doc = edit.createDoc(presentation, { idPrefix: 'mc-structure-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const id = doc.slides[slideId].children[0];
  try {
    const payload = edit.copyElements(doc, [id]);
    editor.exec({ type: 'PasteElements', payload, at: { parentId: slideId, x: 180, y: 80 } });
    const copyId = editor.selection.ids[0];
    const saved = await editor.save();
    const reopened = await core.parse(saved, { lazy: false, edit: true, keepPackage: true });
    try {
      const elements = reopened.slides[0].elements;
      eq('复制兼容对象只新增一份投影', elements.length, 2);
      check('两份兼容对象重开后拥有独立身份', new Set(elements.map((element) => element.id)).size === 2);
      check('复制保留回退图片与落点', elements.every((element) => element.kind === 'image')
        && elements[1].x === 180 && elements[1].y === 80);
      const copyDoc = edit.createDoc(reopened, { idPrefix: 'mc-reopen-' });
      try {
        check('兼容副本重开仍是框架级对象', Object.values(copyDoc.elements).every((record) => record.meta.editable === 'frame'));
      } finally { edit.disposeDoc(copyDoc); }
    } finally { reopened.dispose?.(); }
    const xml = new TextDecoder().decode(unzipSync(saved)['ppt/slides/slide1.xml']);
    eq('复制保存保留两个完整兼容外壳', (xml.match(/<mc:AlternateContent/g) ?? []).length, 2);
    const newSpid = doc.elements[copyId].meta.origin.spid;
    eq('复制后两套分支共享新身份', (xml.match(new RegExp(`id="${newSpid}"`, 'g')) ?? []).length, 2);
    editor.exec({ type: 'SetZ', id, to: 'front' });
    const reordered = await core.parse(await editor.save(), { lazy: false });
    try {
      eq('层级调整搬动整个兼容对象', reordered.slides[0].elements.map((element) => element.x).join(','), '180,40');
    } finally { reordered.dispose?.(); }
    editor.exec({ type: 'RemoveElement', id });
    const deleted = await editor.save();
    eq('删除同时移除两套表示', (new TextDecoder().decode(unzipSync(deleted)['ppt/slides/slide1.xml'])
      .match(/<mc:AlternateContent/g) ?? []).length, 1);
    editor.undo();
    const restored = await editor.save();
    eq('撤销删除恢复完整兼容对象', (new TextDecoder().decode(unzipSync(restored)['ppt/slides/slide1.xml'])
      .match(/<mc:AlternateContent/g) ?? []).length, 2);
  } finally { editor.dispose(); }
}

export async function runCompatibilityRecoveryContract({ core, edit, bytes, eq }) {
  const open = async () => edit.createDoc(await core.parse(bytes,
    { lazy: false, edit: true, keepPackage: true }), { idPrefix: 'mc-recovery-' });
  const doc = await open();
  const editor = new edit.Editor(doc);
  const frames = [];
  const unsubscribe = editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
  const id = doc.slides[doc.slideOrder[0]].children[0];
  editor.exec({ type: 'SetXfrm', id, x: 88 });
  const recovered = new edit.Editor(await open(), { recoveryFrames: frames });
  try {
    eq('日志恢复保留回退框架权限', recovered.doc.elements[id].meta.editable, 'frame');
    const parts = unzipSync(await recovered.save());
    eq('日志恢复保存同步两套分支', (new TextDecoder().decode(parts['ppt/slides/slide1.xml'])
      .match(/x="838200"/g) ?? []).length, 2);
  } finally { unsubscribe(); recovered.dispose(); editor.dispose(); }
}

export async function runCompatibilityOpaqueIdentityContract({ core, edit, bytes, eq, check }) {
  const variant = rewriteCompatibilityFixture(bytes, (xml) => {
    const picture = xml.match(/<mc:Fallback>([\s\S]*?)<\/mc:Fallback>/)[1];
    const group = (childId) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="MC group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="2286000"/><a:chOff x="0" y="0"/><a:chExt cx="3810000" cy="2286000"/></a:xfrm></p:grpSpPr>${picture.replace('id="6"', `id="${childId}"`)}</p:grpSp>`;
    return xml.replace('http://schemas.microsoft.com/office/drawing/2015/10/21/chartex',
      'http://schemas.microsoft.com/office/powerpoint/2010/main')
      .replace(/<mc:Choice[^>]*>[\s\S]*?<\/mc:Choice>/, `<mc:Choice Requires="modern">${group(7)}</mc:Choice>`)
      .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/, `<mc:Fallback>${group(8)}</mc:Fallback>`);
  });
  const doc = edit.createDoc(await core.parse(variant,
    { lazy: false, edit: true, keepPackage: true }), { idPrefix: 'mc-hidden-' });
  const editor = new edit.Editor(doc);
  const frames = [];
  const unsubscribe = editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
  try {
    const slide = doc.slideOrder[0];
    const payload = edit.copyElements(doc, [doc.slides[slide].children[0]]);
    editor.exec({ type: 'PasteElements', payload, at: { parentId: slide, x: 100, y: 100 } });
    const saved = unzipSync(await editor.save());
    const xml = new TextDecoder().decode(saved['ppt/slides/slide1.xml']);
    eq('未选分支内部身份不能随复制泄漏到同页', (xml.match(/id="8"/g) ?? []).length, 1);
    eq('复制不得裁掉未建模分支的图片子对象', (xml.match(/<p:pic>/g) ?? []).length, 4);
    const copiedFrame = frames.find((frame) => frame.patches.some((patch) => patch.op === 'insert'));
    for (const warm of [false, true]) {
      const targetDoc = edit.createDoc(await core.parse(variant,
        { lazy: false, edit: true, keepPackage: true }), { idPrefix: 'mc-hidden-' });
      const target = new edit.Editor(targetDoc);
      try {
        const add = { type: 'AddShape', slideId: slide, preset: 'rect', rect: { x: 20, y: 20, w: 40, h: 40 } };
        if (warm) { target.exec(add); target.undo(); }
        target.applyExternalPatches(copiedFrame.patches);
        target.exec(add);
        const newId = target.doc.elements[target.selection.ids[0]].meta.origin.spid;
        check(`外部兼容对象回放后${warm ? '已有' : '首次'}分配避开全部备用身份`, newId > 11);
        const output = new TextDecoder().decode(unzipSync(await target.save())['ppt/slides/slide1.xml']);
        eq(`外部回放${warm ? '热' : '冷'}分配不产生重复形状 ID`, (output.match(new RegExp(`id="${newId}"`, 'g')) ?? []).length, 1);
      } finally { target.dispose(); }
    }
    const corrupt = structuredClone(copiedFrame);
    corrupt.identity.nextSpid['ppt/slides/slide1.xml'] = 11;
    const recoveryDoc = edit.createDoc(await core.parse(variant,
      { lazy: false, edit: true, keepPackage: true }), { idPrefix: 'mc-hidden-' });
    let rejected = false;
    try { edit.restoreRecoveryFrames(recoveryDoc, [corrupt]); } catch { rejected = true; }
    finally { edit.disposeDoc(recoveryDoc); }
    check('恢复日志不得回退到备用分支已占用的身份', rejected);
    const duplicated = editor.exec({ type: 'DuplicateSlide', id: slide });
    const duplicateId = [...duplicated.createdSlides][0];
    editor.exec({ type: 'AddShape', slideId: duplicateId, preset: 'rect', rect: { x: 30, y: 30, w: 50, h: 50 } });
    const added = doc.elements[editor.selection.ids[0]].meta.origin;
    check('整页复制的分配水位覆盖未建模备用身份', added.spid > 11);
    const duplicateXml = new TextDecoder().decode(unzipSync(await editor.save())[added.part]);
    eq('整页复制后新增形状不与备用分支撞 ID', (duplicateXml.match(new RegExp(`id="${added.spid}"`, 'g')) ?? []).length, 1);
    const chain = new edit.Editor(edit.createDoc(await core.parse(variant,
      { lazy: false, edit: true, keepPackage: true }), { idPrefix: 'mc-chain-' }));
    try {
      let current = chain.doc.slideOrder[0];
      for (let index = 0; index < 2; index++) current = [...chain.exec({ type: 'DuplicateSlide', id: current }).createdSlides][0];
      chain.exec({ type: 'AddShape', slideId: current, preset: 'rect', rect: { x: 20, y: 20, w: 40, h: 40 } });
      const anchor = chain.doc.elements[chain.selection.ids[0]].meta.origin;
      check('连续复制未保存页面仍跳过来源备用身份', anchor.spid > 8);
      const output = new TextDecoder().decode(unzipSync(await chain.save())[anchor.part]);
      eq('连续复制后新增对象身份在全部表示中唯一', (output.match(new RegExp(`id="${anchor.spid}"`, 'g')) ?? []).length, 1);
    } finally { chain.dispose(); }
  } finally { unsubscribe(); editor.dispose(); }
}

export async function runInsertionIdentityValidationContract({ core, edit, bytes, check }) {
  const open = async () => new edit.Editor(edit.createDoc(await core.parse(bytes,
    { lazy: false, edit: true, keepPackage: true }), { idPrefix: 'mc-validation-' }));
  const source = await open();
  try {
    const group = Object.values(source.doc.elements).find((record) => record.src.name === 'space-outer-group');
    const result = source.exec({ type: 'PasteElements', payload: edit.copyElements(source.doc, [group.id]),
      at: { parentId: source.doc.slideOrder[0], x: 100, y: 100 } });
    for (const mode of ['overlap', 'duplicate']) {
      const patches = structuredClone(result.forward);
      const root = patches[0].value.records[patches[0].value.root];
      const insertion = root.meta.insertion;
      if (mode === 'overlap') insertion.unmodeledSpids = [patches[0].value.records[root.children[0]].meta.origin.spid];
      else {
        const keys = Object.keys(insertion.spids);
        insertion.spids[keys[1]] = insertion.spids[keys[0]];
      }
      const target = await open();
      let rejected = false;
      try { target.applyExternalPatches(patches); } catch { rejected = true; }
      finally { target.dispose(); }
      check(`外部插入闭包拒绝${mode === 'overlap' ? '把可删除孩子伪装为未建模宿主' : '重复的目标身份'}`, rejected);
    }
  } finally { source.dispose(); }
}

export async function runNestedCompatibilityContract({ core, edit, bytes, eq }) {
  const variant = rewriteCompatibilityFixture(bytes, (xml) => {
    const envelope = xml.match(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/)[0];
    const fallback = xml.match(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/)[0];
    return xml.replace(envelope, `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:known="http://schemas.microsoft.com/office/powerpoint/2010/main"><mc:Choice Requires="known">${envelope}</mc:Choice>${fallback}</mc:AlternateContent>`);
  });
  const doc = edit.createDoc(await core.parse(variant,
    { lazy: false, edit: true, keepPackage: true }), { idPrefix: 'mc-nested-' });
  const editor = new edit.Editor(doc);
  try {
    editor.exec({ type: 'SetXfrm', id: doc.slides[doc.slideOrder[0]].children[0], x: 91 });
    const parts = unzipSync(await editor.save());
    eq('嵌套兼容外壳的全部表示同步移动', (new TextDecoder().decode(parts['ppt/slides/slide1.xml'])
      .match(/x="866775"/g) ?? []).length, 3);
    const id = doc.slides[doc.slideOrder[0]].children[0];
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [id]),
      at: { parentId: doc.slideOrder[0], x: 100, y: 100 } });
    const copied = unzipSync(await editor.save());
    eq('复制嵌套兼容对象保留两层外壳', (new TextDecoder().decode(copied['ppt/slides/slide1.xml'])
      .match(/<mc:AlternateContent/g) ?? []).length, 4);
  } finally { editor.dispose(); }
}

export async function runCompatibilityLockContract({ core, edit, bytes, check }) {
  const locked = rewriteCompatibilityFixture(bytes, (xml) => xml.replace('<p:cNvGraphicFramePr/>',
    '<p:cNvGraphicFramePr><a:graphicFrameLocks noMove="1"/></p:cNvGraphicFramePr>'));
  const doc = edit.createDoc(await core.parse(locked,
    { lazy: false, edit: true, keepPackage: true }), { idPrefix: 'mc-lock-' });
  const editor = new edit.Editor(doc);
  try {
    const id = doc.slides[doc.slideOrder[0]].children[0];
    let rejected = false;
    try { editor.exec({ type: 'SetXfrm', id, x: 90 }); } catch { rejected = true; }
    check('未选 Choice 的移动锁也保护同一源对象', rejected && editor.history.undoCount === 0);
  } finally { editor.dispose(); }
}

export async function runCompatibilityMissingSourceContract({ core, edit, bytes, check }) {
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  // 模拟旧解析器未提供兼容源资源的输入，仍必须拒绝把原始数据降级成 PNG。
  delete presentation.editInfo.assets;
  const doc = edit.createDoc(presentation, { idPrefix: 'mc-generated-' });
  const editor = new edit.Editor(doc);
  try {
    editor.exec({ type: 'SetXfrm', id: doc.slides[doc.slideOrder[0]].children[0], x: 90 });
    presentation.dispose?.();
    let reason = '';
    try { await editor.save(); } catch (error) { reason = String(error); }
    check('失去原包后不能把兼容图表静默生成为普通图片', /兼容对象.*原包/.test(reason)
      && editor.isDirty() && editor.history.undoCount === 1);
  } finally { editor.dispose(); }
}
