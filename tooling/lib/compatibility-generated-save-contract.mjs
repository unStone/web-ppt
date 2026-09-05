import { unzipSync } from 'fflate';
import { rewriteCompatibilityFixture } from './alternate-content-selection-contract.mjs';

export async function runCompatibilityGeneratedSaveContract({ core, edit, bytes, check, eq }) {
  const sourceParts = unzipSync(bytes);
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  const doc = edit.createDoc(presentation, { idPrefix: 'mc-generated-source-' });
  const editor = new edit.Editor(doc);
  try {
    const id = doc.slides[doc.slideOrder[0]].children[0];
    editor.exec({ type: 'SetXfrm', id, x: 90 });
    presentation.dispose?.();
    check('生成保存开始前原包已真正释放', presentation.package.disposed && Object.keys(presentation.package.parts).length === 0);
    const result = await editor.saveDetailed();
    const parts = unzipSync(result.bytes);
    const xml = new TextDecoder().decode(parts['ppt/slides/slide1.xml']);
    eq('缺原包生成保存保留完整兼容外壳', (xml.match(/<mc:AlternateContent/g) ?? []).length, 1);
    eq('生成保存同步移动全部兼容表示', (xml.match(/x="857250"/g) ?? []).length, 2);
    for (const part of ['ppt/charts/chartEx1.xml', 'ppt/charts/_rels/chartEx1.xml.rels',
      'ppt/embeddings/chart-data.xlsx', 'ppt/media/chart-preview.png']) {
      check(`生成保存原样保留 ${part}`, !!parts[part] && Buffer.from(parts[part]).equals(Buffer.from(sourceParts[part])));
    }
    const reopened = await core.parse(result.bytes, { lazy: false, edit: true });
    try {
      eq('生成包重开仍是兼容图片投影', reopened.slides[0].elements[0].kind, 'image');
      eq('生成包重开保持移动位置', reopened.slides[0].elements[0].x, 90);
      eq('生成包重开仍是框架权限', reopened.slides[0].elements[0].editInfo.editable, 'frame');
    } finally { reopened.dispose?.(); }
  } finally { editor.dispose(); }
}

export async function runCompatibilityGeneratedCopiesContract({ core, edit, bytes, check, eq }) {
  const variant = rewriteCompatibilityFixture(bytes, (xml) =>
    xml.replace('<p:cNvPr id="6" name="fallback-chart"/>', '<p:cNvPr id="9" name="fallback-chart"/>'));
  const presentation = await core.parse(variant, { lazy: true, edit: true, keepPackage: true });
  const doc = edit.createDoc(presentation, { idPrefix: 'mc-generated-copies-' });
  const editor = new edit.Editor(doc);
  const frames = [];
  const unsubscribe = editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
  try {
    const slide = doc.slideOrder[0], id = doc.slides[slide].children[0];
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [id]),
      at: { parentId: slide, x: 180, y: 80 } });
    editor.exec({ type: 'DuplicateSlide', id: slide });
    editor.undo();
    eq('释放原包前可撤销整页兼容副本', doc.slideOrder.length, 1);
    editor.redo();
    presentation.dispose();
    const saved = await editor.save();
    const reopened = await core.parse(saved, { lazy: false, edit: true });
    try {
      eq('延迟解析后生成保存保留整页副本', reopened.slides.length, 2);
      for (const [index, current] of reopened.slides.entries()) {
        eq(`生成页 ${index + 1} 保留原件与整壳副本`, current.elements.length, 2);
        eq(`生成页 ${index + 1} 保留粘贴落点`, current.elements[1].x, 180);
        check(`生成页 ${index + 1} 兼容对象身份不冲突`, new Set(current.elements.map((el) => el.id)).size === 2);
        check(`生成页 ${index + 1} 重开仍为框架对象`, current.elements.every((el) => el.editInfo.editable === 'frame'));
      }
    } finally { reopened.dispose(); }
    const repeated = await core.parse(await editor.save(), { lazy: false });
    try { eq('同一会话重复生成保存保留整页副本', repeated.slides.length, 2); }
    finally { repeated.dispose(); }
    for (const mode of ['recovery', 'external']) {
      const restoredPresentation = await core.parse(variant, { lazy: false, edit: true, keepPackage: true });
      const restoredDoc = edit.createDoc(restoredPresentation, { idPrefix: 'mc-generated-copies-' });
      const restored = new edit.Editor(restoredDoc, mode === 'recovery' ? { recoveryFrames: frames } : {});
      try {
        if (mode === 'external') for (const frame of frames) {
          if (frame.patches.length) restored.applyExternalPatches(frame.patches);
        }
        restoredPresentation.dispose();
        const reopened = await core.parse(await restored.save(), { lazy: false });
        try { eq(`${mode} 回放后生成保存保留复制结果`, reopened.slides.length, 2); }
        finally { reopened.dispose(); }
      } finally { restored.dispose(); }
    }
  } finally { unsubscribe(); editor.dispose(); }
}

export async function runCompatibilityGeneratedOpaqueContract({ core, edit, bytes, check, eq }) {
  const variant = rewriteCompatibilityFixture(bytes, (xml) => {
    const picture = xml.match(/<mc:Fallback>([\s\S]*?)<\/mc:Fallback>/)[1];
    const group = (id) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="opaque"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="2286000"/><a:chOff x="0" y="0"/><a:chExt cx="3810000" cy="2286000"/></a:xfrm></p:grpSpPr>${picture.replace('id="6"', `id="${id}"`)}</p:grpSp>`;
    return xml.replace('http://schemas.microsoft.com/office/drawing/2015/10/21/chartex',
      'http://schemas.microsoft.com/office/powerpoint/2010/main')
      .replace(/<mc:Choice[^>]*>[\s\S]*?<\/mc:Choice>/,
        `<mc:Choice Requires="modern"><mc:AlternateContent><mc:Choice Requires="modern">${group(7)}</mc:Choice><mc:Fallback>${group(8)}</mc:Fallback></mc:AlternateContent></mc:Choice>`)
      .replace(/<mc:Fallback><p:pic>[\s\S]*?<\/mc:Fallback>/, `<mc:Fallback>${group(9)}</mc:Fallback>`);
  });
  const presentation = await core.parse(variant, { lazy: true, edit: true, keepPackage: true });
  const doc = edit.createDoc(presentation, { idPrefix: 'mc-generated-opaque-' });
  const editor = new edit.Editor(doc);
  try {
    const slide = doc.slideOrder[0], id = doc.slides[slide].children[0];
    editor.exec({ type: 'SetXfrm', id, x: 91 });
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [id]),
      at: { parentId: slide, x: 200, y: 100 } });
    editor.exec({ type: 'AddShape', slideId: slide, preset: 'rect', rect: { x: 10, y: 10, w: 30, h: 30 } });
    presentation.dispose();
    const saved = await editor.save();
    const parts = unzipSync(saved);
    const xml = new TextDecoder().decode(parts['ppt/slides/slide1.xml']);
    eq('生成保存保留嵌套 MC 的全部外壳', (xml.match(/<mc:AlternateContent/g) ?? []).length, 4);
    eq('生成保存保留未建模表示中的图片孩子', (xml.match(/<p:pic>/g) ?? []).length, 6);
    const counts = new Map();
    for (const match of xml.matchAll(/<p:cNvPr id="(\d+)"/g)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    eq('仅两个逻辑组允许各三份表示复用 ID', [...counts.values()].filter((count) => count === 3).length, 2);
    check('未建模孩子与新增形状均获得独立 ID', [...counts.values()].every((count) => count === 1 || count === 3));
    const reopened = await core.parse(saved, { lazy: false, edit: true });
    try {
      eq('生成兼容组不重复插入模型中的只读孩子', reopened.slides[0].elements.length, 3);
      eq('嵌套兼容组重开保留位置', reopened.slides[0].elements[0].x, 91);
    } finally { reopened.dispose(); }
  } finally { editor.dispose(); }
}
