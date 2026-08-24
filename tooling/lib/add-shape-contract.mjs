const presets = ['rect', 'ellipse', 'rightArrow', 'star5', 'flowChartProcess', 'straightConnector1'];

const textOf = (shape) => shape.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function rejected(fn) {
  try { fn(); return false; } catch { return true; }
}

/** 新增形状只从公开命令、有效投影、历史与结构化克隆取证。 */
export async function runAddShapeContract({ edit, core, load, check, eq }) {
  console.log('\n\x1b[36m▸ AddShape 模型、投影与历史\x1b[0m');
  const input = load('sample-editor-add-shape.pptx');
  if (!check('找到确定性新增形状固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'add-shape-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const siblingId = doc.slides[slideId].children[0];
  const sibling = doc.elements[siblingId];
  const beforeSlide = editor.toSlide(slideId);
  const result = editor.exec({
    type: 'AddShape', slideId, preset: 'roundRect',
    rect: { x: 123.25, y: 67.5, w: 211.75, h: 109.5 },
  });
  const id = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  const record = id && doc.elements[id];
  const shape = id && editor.effectiveElement(id);
  check('单条纯数据命令产生一个树 patch、选中新根并精确失效目标页',
    result.forward.length === 1 && result.inverse.length === 1
      && result.forward[0].op === 'insert' && result.forward[0].path.length === 2
      && result.dirtySlides.size === 1 && result.dirtySlides.has(slideId)
      && result.dirtyElements.has(id) && editor.history.undoCount === 1
      && editor.selection.kind === 'elements' && editor.selection.ids.join(',') === id);
  check('新增记录、有效投影和预设几何表达同一矩形',
    record?.parent === slideId && record.meta.created && !!record.meta.insertion
      && record.meta.origin?.part === doc.slides[slideId].origin.part
      && record.meta.geom?.preset === 'roundRect' && record.meta.editable === 'full'
      && shape?.kind === 'shape' && shape.x === 123.25 && shape.y === 67.5
      && shape.w === 211.75 && shape.h === 109.5 && shape.rot === 0
      && shape.path === core.resolveGeomPath({ preset: 'roundRect', adj: {} }, 211.75, 109.5).d
      && shape.fill?.type === 'solid' && shape.fill.color === 'rgb(217,79,112)'
      && shape.stroke !== null && shape.text === null);
  check('即时投影与保存宿主复用同一份默认样式和空文字来源',
    typeof doc.slides[slideId].defaultShape?.styleMarkup === 'string'
      && typeof doc.slides[slideId].defaultShape?.textBodyMarkup === 'string'
      && record.meta.insertion.markup.includes(doc.slides[slideId].defaultShape.styleMarkup)
      && record.meta.insertion.markup.includes(doc.slides[slideId].defaultShape.textBodyMarkup));
  check('只新增末尾兄弟并保留既有源记录与页面缓存边界',
    doc.slides[slideId].children.at(-1) === id && doc.elements[siblingId] === sibling
      && editor.toSlide(slideId) !== beforeSlide
      && editor.toSlide(slideId).elements.at(-1) === shape);

  editor.exec({
    type: 'EditText', id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '立即输入',
    }],
  });
  check('空形状复用既有文字命令立即进入可编辑状态',
    textOf(editor.effectiveElement(id)) === '立即输入');
  editor.undo();
  editor.undo();
  check('撤销新增会移除结构并恢复新增前选区', !doc.elements[id]
    && doc.slides[slideId].children.length === 1 && editor.selection.kind === 'none');
  editor.redo();
  check('重做新增恢复同一身份、几何与自动选区', doc.elements[id]?.meta.origin?.spid === record.meta.origin.spid
    && editor.effectiveElement(id).path === shape.path
    && editor.selection.kind === 'elements' && editor.selection.ids[0] === id);

  const created = [];
  editor.transaction((transaction) => {
    presets.forEach((preset, index) => transaction.exec({
      type: 'AddShape', slideId, preset,
      rect: { x: 30 + index * 70, y: 260, w: 60, h: 55 },
    }));
  }, '新增六类形状');
  for (const childId of doc.slides[slideId].children) {
    if (doc.elements[childId]?.meta.created) created.push(doc.elements[childId]);
  }
  const spids = created.map((candidate) => candidate.meta.origin?.spid);
  check('同事务连续新增六类形状得到唯一身份、spid、递增序与开放几何语义',
    created.length === 7 && new Set(created.map((candidate) => candidate.id)).size === created.length
      && spids.every(Number.isSafeInteger) && new Set(spids).size === created.length
      && created.every((candidate, index) => index === 0 || created[index - 1].z < candidate.z)
      && editor.effectiveElement(created.at(-1).id).openGeom === true);
  check('新增后 EditDoc 仍是纯数据', (() => {
    try { return structuredClone(doc).slides[slideId].children.length === doc.slides[slideId].children.length; }
    catch { return false; }
  })());

  const beforeFailure = {
    identity: JSON.stringify(doc.identity),
    children: [...doc.slides[slideId].children],
    selection: JSON.stringify(editor.selection),
  };
  check('拒绝未知预设、非法矩形、未知页面和命令额外字段',
    rejected(() => editor.exec({
      type: 'AddShape', slideId, preset: 'not-a-real-preset', rect: { x: 0, y: 0, w: 10, h: 10 },
    }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId, preset: 'rect', rect: { x: NaN, y: 0, w: 0, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId, preset: 'toString', rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId, preset: '__proto__', rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId, preset: 'rect', rect: { x: 225458, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId, preset: 'rect', rect: { x: -225458, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId, preset: 'rect', rect: { x: 0, y: 0, w: 225458, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId, preset: 'rect', rect: { x: 0, y: 0, w: 10, h: 0.00001 },
      }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId: 'missing-slide', preset: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddShape', slideId, preset: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 }, extra: true,
      })));
  check('批量后段失败会回滚新增结构、身份计数与选区', rejected(() => editor.exec(
    { type: 'AddShape', slideId, preset: 'rect', rect: { x: 5, y: 5, w: 20, h: 20 } },
    { type: 'SetXfrm', id: 'missing-element', x: 10 },
  ))
    && JSON.stringify(doc.identity) === beforeFailure.identity
    && doc.slides[slideId].children.join(',') === beforeFailure.children.join(',')
    && JSON.stringify(editor.selection) === beforeFailure.selection);

  editor.transaction((transaction) => {
    transaction.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 900, y: 500, w: 80, h: 60 },
    });
    transaction.select({ kind: 'none' });
  }, '新增但保持无选区');
  eq('显式事务选区优先于新增形状自动选中', editor.selection.kind, 'none');

  editor.exec({
    type: 'AddShape', slideId, preset: 'rect',
    rect: {
      x: -2147483648 / 9525, y: 2147483647 / 9525,
      w: 2147483647 / 9525, h: 1 / 9525,
    },
  });
  const boundaryId = editor.selection.ids[0];
  const boundaryMarkup = doc.elements[boundaryId].meta.insertion.markup;
  check('坐标边界按 PowerPoint 的 signed/positive EMU 域写入',
    boundaryMarkup.includes('<a:off x="-2147483648" y="2147483647"/>')
      && boundaryMarkup.includes('<a:ext cx="2147483647" cy="1"/>'));
  editor.undo();

  const remotePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const remoteDoc = edit.createDoc(remotePresentation, { idPrefix: 'add-shape-remote-' });
  const remoteEditor = new edit.Editor(remoteDoc);
  const remoteSlideId = remoteDoc.slideOrder[0];
  remoteEditor.exec({
    type: 'AddShape', slideId: remoteSlideId, preset: 'rect', rect: { x: 10, y: 10, w: 40, h: 30 },
  });
  const localId = remoteEditor.selection.ids[0];
  const local = remoteDoc.elements[localId];
  const remoteId = `${remoteDoc.identity.prefix}remote`;
  const remoteRecord = structuredClone(local);
  remoteRecord.id = remoteId;
  remoteRecord.z = edit.fractionalIndexBetween(local.z, null);
  remoteRecord.src.id = 500;
  remoteRecord.meta.origin.spid = 500;
  edit.applyPatches(remoteDoc, [{
    op: 'insert', path: ['elements', remoteId], origin: 'remote-client',
    value: { root: remoteId, parent: remoteSlideId, records: { [remoteId]: remoteRecord } },
  }]);
  remoteEditor.exec({
    type: 'AddShape', slideId: remoteSlideId, preset: 'ellipse', rect: { x: 60, y: 10, w: 40, h: 30 },
  });
  const afterRemote = remoteDoc.elements[remoteEditor.selection.ids[0]];
  check('远端结构 patch 的高位 spid 会推进本地 part 分配器', afterRemote.meta.origin.spid === 501);
  edit.disposeDoc(remoteDoc);

  const readonlyPresentation = await core.parse(input, { edit: true, lazy: false, assets: 'defer' });
  const readonlyDoc = edit.createDoc(readonlyPresentation, { idPrefix: 'add-shape-readonly-' });
  const readonlyEditor = new edit.Editor(readonlyDoc);
  check('缺少可写 OOXML 包时拒绝新增形状', rejected(() => readonlyEditor.exec({
    type: 'AddShape', slideId: readonlyDoc.slideOrder[0], preset: 'rect',
    rect: { x: 0, y: 0, w: 20, h: 20 },
  })));
  edit.disposeDoc(readonlyDoc);
  edit.disposeDoc(doc);
}
