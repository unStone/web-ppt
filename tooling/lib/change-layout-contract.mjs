const textOf = (shape) => shape.text?.paragraphs
  .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('') ?? '';

const rejected = (fn) => {
  try { fn(); return false; } catch { return true; }
};

/** 换版式只通过公开命令、查询、有效投影和历史 seam 取证。 */
export async function runChangeLayoutContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ SetLayout 继承切换、身份与历史\x1b[0m');
  const input = load('sample-editor-change-layout.pptx');
  if (!check('找到确定性换版式基础固件', !!input)) return;

  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'change-layout-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const sourceLayout = doc.layoutOrder.find((id) => doc.layouts[id].name === '标题和正文');
  const targetLayout = doc.layoutOrder.find((id) => doc.layouts[id].name === '重点内容');
  const writableIds = doc.slides[slideId].children.filter((id) =>
    doc.elements[id].meta.origin?.part === doc.slides[slideId].origin?.part);
  const sourceChildren = doc.slides[slideId].children.join(',');
  const sourceTexts = writableIds.map((id) => textOf(editor.effectiveElement(id))).join('|');
  const byName = (name) => writableIds.map((id) => doc.elements[id]).find((record) =>
    record.src.name === name);
  const title = byName('现有标题');
  const body = byName('现有正文');
  const picture = byName('现有图片占位符');
  const sourceOnly = byName('来源独有内容');
  const ordinary = byName('普通业务形状');
  const slideNumber = byName('动态页码');
  check('固件覆盖继承、直设、图片、缺失目标、普通元素与动态字段',
    !!title && !!body && !!picture && !!sourceOnly && !!ordinary && !!slideNumber
      && editor.toSlide(slideId).hidden === true
      && editor.toSlide(slideId).notes === '换版式必须保留备注');
  check('目标版式属于不同母版，覆盖跨主题关系切换',
    doc.layouts[sourceLayout].origin.masterPart !== doc.layouts[targetLayout].origin.masterPart);

  const initial = edit.querySlideLayout(doc, [slideId]);
  check('查询公开当前与来源版式身份', initial.value === sourceLayout
    && initial.source === sourceLayout && !initial.mixed && !initial.direct);

  editor.select({ kind: 'elements', ids: [title.id], enteredGroup: null });
  const beforeIdentity = JSON.stringify(doc.identity);
  const result = editor.exec({ type: 'SetLayout', id: slideId, layoutId: targetLayout });
  const projected = editor.toSlide(slideId);
  check('换版式只产生页面级稀疏 patch 并要求目标视图整页重建',
    result.forward.length === 1 && result.inverse.length === 1
      && result.forward[0].path.join('/') === `slides/${slideId}/layoutId`
      && result.dirtySlides.has(slideId) && result.renderSlides.has(slideId)
      && editor.selection.kind === 'elements' && editor.selection.ids[0] === title.id);
  check('稳定页、元素和 OPC 身份不变且没有改写真实页面树',
    JSON.stringify(doc.identity) === beforeIdentity
      && doc.slides[slideId].children.join(',') === sourceChildren
      && writableIds.every((id) => doc.elements[id]?.meta.origin?.part === doc.slides[slideId].origin?.part)
      && writableIds.map((id) => textOf(editor.effectiveElement(id))).join('|') === sourceTexts);
  check('目标版式静态投影立即生效，旧版式继承图形退出但页面内容保留',
    projected.layoutName === '重点内容'
      && projected.elements.some((element) => element.name === '目标版式角标')
      && !projected.elements.some((element) => element.name === '版式色带')
      && !projected.elements.some((element) => element.name === '母版标记')
      && doc.slides[slideId].sourceHideMasterShapes === true
      && writableIds.every((id) => projected.elements.some((element) => element.id === doc.elements[id].src.id)));
  check('同 idx 占位符采用目标几何，图片同样重绑且目标新增占位符不伪造内容',
    editor.effectiveElement(title.id).x === 260
      && editor.effectiveElement(title.id).w === 820
      && editor.effectiveElement(title.id).text.paragraphs[0].runs[0].size === 48
      && editor.effectiveElement(picture.id).x === 70
      && editor.effectiveElement(picture.id).w === 320
      && !projected.elements.some((element) => element.editInfo?.placeholder?.idx === '5'),
  JSON.stringify({
    title: editor.effectiveElement(title.id), picture: editor.effectiveElement(picture.id),
  }));
  check('页面直设、缺失目标占位符、普通业务元素、隐藏/备注和主题背景保持正确',
    editor.effectiveElement(body.id).x === 160
      && editor.effectiveElement(body.id).w === 900
      && editor.effectiveElement(body.id).fill?.type === 'solid'
      && editor.effectiveElement(body.id).fill?.color === 'rgb(51,102,204)'
      && editor.effectiveElement(body.id).text.paragraphs[0].bullet === '◆'
      && editor.effectiveElement(sourceOnly.id).x === 60
      && editor.effectiveElement(ordinary.id).x === 980
      && editor.effectiveElement(ordinary.id).fill?.color === 'rgb(0,153,204)'
      && editor.effectiveElement(ordinary.id).text.paragraphs[0].runs[0].color === 'rgb(0,153,204)'
      && editor.effectiveElement(ordinary.id).text.paragraphs[0].runs[0].fonts[0] === 'Target Theme Latin'
      && editor.effectiveElement(slideNumber.id).x === 1120
      && projected.hidden === true && projected.notes === '换版式必须保留备注'
      && projected.background?.type === 'solid'
      && projected.transition?.type === 'fade' && projected.transition.durationMs === 1000
      && doc.slides[slideId].sourceDirectTransition === true, JSON.stringify({
    body: editor.effectiveElement(body.id), sourceOnly: editor.effectiveElement(sourceOnly.id),
    ordinary: editor.effectiveElement(ordinary.id), slideNumber: editor.effectiveElement(slideNumber.id),
    hidden: projected.hidden, notes: projected.notes, background: projected.background,
  }));
  const bodyParagraphs = editor.effectiveElement(body.id).text.paragraphs;
  const effectiveBody = editor.effectiveElement(body.id);
  check('正文按类型回退到不同 idx 的目标占位符，且多级文字采用对应级别默认样式',
    body.meta.ph?.type === 'body' && body.meta.ph?.idx === '2'
      && bodyParagraphs[0].bullet === '◆'
      && bodyParagraphs[1].lvl === 1
      && bodyParagraphs[1].bullet === '◇'
      && bodyParagraphs[1].marL === 72
      && bodyParagraphs[1].indent === -18
      && bodyParagraphs[1].runs[0].size === 24,
  JSON.stringify(bodyParagraphs));
  check('页面显式零值与 noFill 描边仍是直设，不被目标非零默认值覆盖',
    bodyParagraphs[0].runs[0].baseline === undefined
      && bodyParagraphs[0].runs[0].spacing === undefined
      && bodyParagraphs[0].runs[0].outline === null
      && bodyParagraphs[0].runs[0].gradient === null
      && bodyParagraphs[0].runs[0].underlineColor === null
      && bodyParagraphs[0].runs[0].color === 'rgb(255,245,230)',
  JSON.stringify(bodyParagraphs[0].runs[0]));
  check('字符字体按脚本槽独立重基，Latin 直设不阻断东亚与复杂文字继承',
    bodyParagraphs[0].runs[0].fonts.join('|') === 'Source Latin|Target EA|Target CS');
  check('项目符号颜色、字体与绝对字号 choice 都保留页面直设语义',
    bodyParagraphs[1].bulletColor === null
      && bodyParagraphs[1].bulletFont === null
      && Math.abs(bodyParagraphs[1].bulletSize - 10 / 9) < 1e-9,
  JSON.stringify(bodyParagraphs[1]));
  check('p:style 的主题效果属于页面直设，换版式不被目标 effectLst 覆盖',
    effectiveBody.effects?.shadow?.color === 'rgb(51,102,204)'
      && effectiveBody.effects?.glow === undefined,
  JSON.stringify(effectiveBody.effects));
  const changed = edit.querySlideLayout(doc, [slideId]);
  check('查询把换版式表达为相对来源的直接选择', changed.value === targetLayout
    && changed.source === sourceLayout && changed.direct && !changed.mixed);

  editor.exec({ type: 'SetXfrm', id: title.id, x: 333 });
  check('换版式后的用户直接覆盖优先于目标版式且撤销恢复目标继承值',
    editor.effectiveElement(title.id).x === 333);
  editor.undo();
  check('撤销用户覆盖不撤销版式选择', editor.effectiveElement(title.id).x === 260
    && doc.slides[slideId].layoutId === targetLayout);
  const titleLength = textOf(editor.effectiveElement(title.id)).length;
  editor.exec({
    type: 'EditText', id: title.id,
    ops: [{
      type: 'replace',
      from: { p: 0, r: 0, off: titleLength },
      to: { p: 0, r: 0, off: titleLength },
      text: '！',
    }],
  });
  check('换版式后首次编辑文字沿用目标继承格式而不跳回旧版式',
    textOf(editor.effectiveElement(title.id)) === '现有页面！'
      && editor.effectiveElement(title.id).text.paragraphs[0].runs[0].size === 48);
  editor.undo();

  editor.undo();
  check('撤销恢复来源版式、同一身份和旧投影', doc.slides[slideId].layoutId === sourceLayout
    && doc.slides[slideId].children.join(',') === sourceChildren
    && editor.toSlide(slideId).elements.some((element) => element.name === '版式色带'));
  editor.redo();
  check('重做恢复目标版式与同一页面身份', doc.slides[slideId].layoutId === targetLayout
    && doc.slideOrder[0] === slideId
    && editor.toSlide(slideId).elements.some((element) => element.name === '目标版式角标'));

  const duplicated = editor.exec({ type: 'DuplicateSlide', id: slideId });
  const duplicateId = [...duplicated.createdSlides][0];
  const duplicateTitle = Object.values(doc.elements).find((record) =>
    record.parent === duplicateId && record.src.name === '现有标题');
  const duplicateBody = Object.values(doc.elements).find((record) =>
    record.parent === duplicateId && record.src.name === '现有正文');
  const duplicateOrdinary = Object.values(doc.elements).find((record) =>
    record.parent === duplicateId && record.src.name === '普通业务形状');
  check('换版式后复制仍保留稀疏继承、内容和目标几何',
    doc.slides[duplicateId].layoutId === targetLayout
      && doc.slides[duplicateId].sourceLayoutId === sourceLayout
      && editor.toSlide(duplicateId).elements.some((element) => element.name === '目标版式角标')
      && duplicateTitle && editor.effectiveElement(duplicateTitle.id).x === 260
      && textOf(editor.effectiveElement(duplicateTitle.id)) === '现有页面'
      && duplicateBody && editor.effectiveElement(duplicateBody.id).fill?.color === 'rgb(51,102,204)'
      && duplicateOrdinary
      && editor.effectiveElement(duplicateOrdinary.id).fill?.color === 'rgb(0,153,204)');
  editor.undo();
  check('撤销复制不影响原页版式和身份', !doc.slides[duplicateId]
    && doc.slides[slideId].layoutId === targetLayout);

  const stable = {
    layout: doc.slides[slideId].layoutId,
    children: doc.slides[slideId].children.join(','),
    identity: JSON.stringify(doc.identity),
    history: editor.history.undoCount,
  };
  check('未知版式、未知页、同页删除冲突与批量后段失败全部原子拒绝',
    rejected(() => editor.exec({ type: 'SetLayout', id: slideId, layoutId: 'missing' }))
      && rejected(() => editor.exec({ type: 'SetLayout', id: slideId, layoutId: 'toString' }))
      && rejected(() => editor.exec({ type: 'SetLayout', id: 'missing', layoutId: targetLayout }))
      && rejected(() => editor.exec({ type: 'SetLayout', id: 'toString', layoutId: targetLayout }))
      && rejected(() => editor.exec(
        { type: 'SetLayout', id: slideId, layoutId: sourceLayout },
        { type: 'RemoveSlide', id: slideId },
      ))
      && rejected(() => editor.exec(
        { type: 'SetLayout', id: slideId, layoutId: sourceLayout },
        { type: 'SetXfrm', id: 'missing-element', x: 1 },
      ))
      && doc.slides[slideId].layoutId === stable.layout
      && doc.slides[slideId].children.join(',') === stable.children
      && JSON.stringify(doc.identity) === stable.identity
      && editor.history.undoCount === stable.history);

  const directFiles = unzipSync(input.slice());
  directFiles['ppt/slides/slide7.xml'] = encoder.encode(
    decoder.decode(directFiles['ppt/slides/slide7.xml']).replace(
      '<p:cSld><p:spTree>',
      '<p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>',
    ).replace(
      '<a:p><a:r><a:rPr sz="2400" baseline="0" spc="0">',
      '<a:p><a:pPr><a:buChar char="●"/></a:pPr><a:r><a:rPr sz="2400" baseline="0" spc="0">',
    ),
  );
  const directPresentation = await core.parse(zipSync(directFiles, { level: 0 }), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const directDoc = edit.createDoc(directPresentation, { idPrefix: 'change-layout-direct-' });
  const directEditor = new edit.Editor(directDoc);
  const directSlideId = directDoc.slideOrder[0];
  const directBody = Object.values(directDoc.elements).find((record) =>
    record.parent === directSlideId && record.src.name === '现有正文');
  const directTarget = directDoc.layoutOrder.find((id) => directDoc.layouts[id].name === '重点内容');
  directEditor.exec({ type: 'SetLayout', id: directSlideId, layoutId: directTarget });
  check('slide XML 直设背景和转场不被新版式的继承值覆盖',
    directDoc.slides[directSlideId].sourceDirectBackground === true
      && directDoc.slides[directSlideId].sourceDirectTransition === true
      && directEditor.toSlide(directSlideId).background?.type === 'solid'
      && directEditor.toSlide(directSlideId).background.color === 'rgb(0,153,204)'
      && directEditor.toSlide(directSlideId).transition?.durationMs === 1000
      && directBody && directEditor.effectiveElement(directBody.id).text.paragraphs[0].bullet === '●');
  edit.disposeDoc(directDoc);

  const alternateFiles = unzipSync(input.slice());
  alternateFiles['ppt/slides/slide7.xml'] = encoder.encode(
    decoder.decode(alternateFiles['ppt/slides/slide7.xml']).replace(
      '<p:transition spd="slow"><p:fade/></p:transition>',
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="slow"><p:fade/></p:transition></mc:Choice></mc:AlternateContent>',
    ),
  );
  const alternatePresentation = await core.parse(zipSync(alternateFiles, { level: 0 }), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const alternateDoc = edit.createDoc(alternatePresentation, { idPrefix: 'change-layout-alternate-' });
  const alternateEditor = new edit.Editor(alternateDoc);
  const alternateSlideId = alternateDoc.slideOrder[0];
  const alternateTarget = alternateDoc.layoutOrder.find((id) =>
    alternateDoc.layouts[id].name === '重点内容');
  alternateEditor.exec({ type: 'SetLayout', id: alternateSlideId, layoutId: alternateTarget });
  check('AlternateContent 内的 slide 直设转场换版式后仍保持',
    alternateDoc.slides[alternateSlideId].sourceDirectTransition === true
      && alternateEditor.toSlide(alternateSlideId).transition?.type === 'fade'
      && alternateEditor.toSlide(alternateSlideId).transition?.durationMs === 1000);
  edit.disposeDoc(alternateDoc);

  const fallbackPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const fallbackDoc = edit.createDoc(fallbackPresentation, { idPrefix: 'change-layout-assets-' });
  const fallbackPackage = fallbackDoc.package;
  fallbackDoc.package = {
    format: 'pptx', bytes: fallbackPackage.bytes, parts: fallbackPackage.parts,
    assets: Object.freeze({}), disposed: false,
  };
  const fallbackEditor = new edit.Editor(fallbackDoc);
  const fallbackSlideId = fallbackDoc.slideOrder[0];
  const fallbackTarget = fallbackDoc.layoutOrder.find((id) =>
    fallbackDoc.layouts[id].name === '重点内容');
  const fallbackPicture = Object.values(fallbackDoc.elements).find((record) =>
    record.parent === fallbackSlideId && record.src.name === '现有图片占位符');
  fallbackEditor.exec({ type: 'SetLayout', id: fallbackSlideId, layoutId: fallbackTarget });
  check('旧保存包缺少 sourcePart 资源索引时仍兑现重解析 sidecar，不泄漏内部 asset 令牌',
    fallbackPicture
      && fallbackEditor.effectiveElement(fallbackPicture.id).src.startsWith('data:image/png;base64,'));
  edit.disposeDoc(fallbackDoc);

  const literalFiles = unzipSync(input.slice());
  literalFiles['ppt/slides/slide7.xml'] = encoder.encode(
    decoder.decode(literalFiles['ppt/slides/slide7.xml'])
      .replace('<a:t>保持原位</a:t>', '<a:t>layout-asset:0</a:t>'),
  );
  const literalPresentation = await core.parse(zipSync(literalFiles, { level: 0 }), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const literalDoc = edit.createDoc(literalPresentation, { idPrefix: 'change-layout-literal-' });
  const literalEditor = new edit.Editor(literalDoc);
  const literalSlideId = literalDoc.slideOrder[0];
  const literalTarget = literalDoc.layoutOrder.find((id) =>
    literalDoc.layouts[id].name === '重点内容');
  const literalOrdinary = Object.values(literalDoc.elements).find((record) =>
    record.parent === literalSlideId && record.src.name === '普通业务形状');
  literalEditor.exec({ type: 'SetLayout', id: literalSlideId, layoutId: literalTarget });
  check('形似内部资源令牌的合法正文逐字保留，不参与 sidecar 兑现',
    literalOrdinary && textOf(literalEditor.effectiveElement(literalOrdinary.id)) === 'layout-asset:0');
  edit.disposeDoc(literalDoc);

  const readonlyPresentation = await core.parse(input, { edit: true, lazy: false, assets: 'defer' });
  const readonlyDoc = edit.createDoc(readonlyPresentation, { idPrefix: 'change-layout-readonly-' });
  const readonlyEditor = new edit.Editor(readonlyDoc);
  check('只读文档拒绝换版式且模型不变', readonlyDoc.meta.readonly
    && rejected(() => readonlyEditor.exec({
      type: 'SetLayout', id: readonlyDoc.slideOrder[0], layoutId: readonlyDoc.layoutOrder[1],
    }))
    && readonlyDoc.slides[readonlyDoc.slideOrder[0]].layoutId === readonlyDoc.layoutOrder[0]);

  edit.disposeDoc(readonlyDoc);
  edit.disposeDoc(doc);
}
import { unzipSync, zipSync } from 'fflate';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
