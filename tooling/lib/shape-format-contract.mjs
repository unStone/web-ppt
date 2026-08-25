const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };
const DASH_PRESETS = [
  ['dash', [4, 3]], ['dashDot', [4, 3, 1, 3]], ['dot', [1, 3]], ['lgDash', [8, 3]],
  ['lgDashDot', [8, 3, 1, 3]], ['lgDashDotDot', [8, 3, 1, 3, 1, 3]],
  ['sysDash', [3, 3]], ['sysDashDot', [3, 3, 1, 3]],
  ['sysDashDotDot', [3, 3, 1, 3, 1, 3]], ['sysDot', [1, 1]],
];

/** SetFill 的公开模型 seam：有效值、直接覆盖、reset、历史与局部失效必须是同一语义。 */
export async function runShapeFormatContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 形状填充与描边直接格式\x1b[0m');
  const presentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'shape-format-' });
  const editor = new edit.Editor(doc);
  const shapeId = Object.values(doc.elements).find((record) =>
    record.src.kind === 'shape' && record.src.path && record.meta.editable === 'full')?.id;
  if (!check('找到可编辑形状格式目标', !!shapeId)) return;
  const sourceFill = structuredClone(edit.effectiveElement(doc, shapeId).fill);
  const before = edit.queryElementFill(doc, [shapeId]);
  const historyBefore = editor.history.undoCount;
  let lastChange;
  const unsubscribe = editor.subscribe((change) => { lastChange = change; });
  const changed = editor.exec({
    type: 'SetFill', id: shapeId, fill: { type: 'solid', color: '#33AA77' },
  });
  const direct = edit.queryElementFill(doc, [shapeId]);
  check('SetFill 只失效目标并向框架公开有效直接填充',
    changed.dirtyElements.has(shapeId) && lastChange?.renderElements.has(shapeId)
      && direct.mixed === false && direct.direct === true
      && direct.value?.type === 'solid' && direct.value.color === 'rgb(51,170,119)'
      && edit.effectiveElement(doc, shapeId).fill?.color === 'rgb(51,170,119)'
      && editor.history.undoCount === historyBefore + 1);

  editor.exec({ type: 'SetFill', id: shapeId, fill: null });
  const reset = edit.queryElementFill(doc, [shapeId]);
  check('fill:null 删除直接覆盖并恢复来源/主题有效值',
    !own(doc.elements[shapeId].ovr, 'fill') && reset.direct === false
      && JSON.stringify(reset.value) === JSON.stringify(sourceFill)
      && JSON.stringify(edit.effectiveElement(doc, shapeId).fill) === JSON.stringify(sourceFill));

  editor.exec({ type: 'SetFill', id: shapeId, fill: { type: 'none' } });
  const noFill = edit.queryElementFill(doc, [shapeId]);
  const explicitNoFill = own(doc.elements[shapeId].ovr, 'fill');
  const undo = editor.undo();
  check('显式无填充与恢复默认身份不同且可逆',
    noFill.value?.type === 'none' && noFill.direct === true
      && explicitNoFill
      && undo?.dirtyElements.has(shapeId)
      && !own(doc.elements[shapeId].ovr, 'fill'));
  check('未混合的初始查询不伪造直接格式',
    before.mixed === false && before.direct === false
      && JSON.stringify(before.value) === JSON.stringify(sourceFill));

  editor.exec({
    type: 'SetFill', id: shapeId,
    fill: {
      type: 'gradient', angle: 45.1234567, radial: false,
      stops: [
        { pos: 0, color: 'rgba(1,2,3,1)' },
        { pos: 0.1234567, color: 'rgba(4,5,6,0.123456)' },
        { pos: 1, color: '#070809' },
      ],
    },
  });
  const quantizedFill = edit.queryElementFill(doc, [shapeId]).value;
  check('填充在命令入口收敛到 core 与 OOXML 共同可往返的精度',
    quantizedFill?.type === 'gradient'
      && quantizedFill.angle === Math.round(45.1234567 * 60000) / 60000
      && quantizedFill.radial === undefined
      && quantizedFill.stops[0].color === 'rgb(1,2,3)'
      && quantizedFill.stops[1].pos === Math.round(0.1234567 * 100000) / 100000
      && quantizedFill.stops[1].color === 'rgba(4,5,6,0.123)');
  editor.exec({
    type: 'SetFill', id: shapeId,
    fill: {
      type: 'gradient', angle: 123.456, radial: true,
      stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#FFFFFF' }],
    },
  });
  const radialFill = edit.queryElementFill(doc, [shapeId]).value;
  check('径向渐变忽略的输入角度在入口规范为 core 重开值',
    radialFill?.type === 'gradient' && radialFill.radial === true && radialFill.angle === 0);

  const shapes = Object.values(doc.elements).filter((record) =>
    record.src.kind === 'shape' && record.src.path && record.meta.editable === 'full');
  const secondId = shapes.find((record) => record.id !== shapeId)?.id;
  if (check('找到第二个可编辑形状用于混合格式', !!secondId)) {
    const gradient = {
      type: 'gradient', angle: 135, radial: false,
      stops: [
        { pos: 0, color: 'rgba(16,32,48,0.4)' },
        { pos: 0.45, color: '#778899' },
        { pos: 1, color: 'rgb(240,241,242)' },
      ],
    };
    editor.exec({ type: 'SetFill', id: shapeId, fill: gradient });
    const gradientState = edit.queryElementFill(doc, [shapeId]);
    const mixed = edit.queryElementFill(doc, [shapeId, secondId]);
    editor.exec({
      type: 'SetFill', id: secondId,
      fill: { type: 'pattern', preset: 'diagCross', fg: '#112233', bg: 'rgba(250,240,230,0.5)' },
    });
    const patternState = edit.queryElementFill(doc, [secondId]);
    check('渐变/图案填充保持 stop、透明色并让多选查询报告 mixed',
      JSON.stringify(gradientState.value) === JSON.stringify({
        type: 'gradient', angle: 135,
        stops: [
          { pos: 0, color: 'rgba(16,32,48,0.4)' },
          { pos: 0.45, color: 'rgb(119,136,153)' },
          { pos: 1, color: 'rgb(240,241,242)' },
        ],
      })
        && mixed.mixed === true && mixed.direct === true
        && patternState.value?.type === 'pattern'
        && patternState.value.preset === 'diagCross');
  }

  const atomicBefore = {
    doc: JSON.stringify(doc), identity: JSON.stringify(doc.identity),
    history: editor.history.undoCount, selection: JSON.stringify(editor.selection),
  };
  check('非法 fill、错误目标、额外字段与非法批量在提交前原子拒绝',
    rejected(() => editor.exec({ type: 'SetFill', id: shapeId, fill: { type: 'solid', color: 'red' } }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId, fill: { type: 'solid', color: 'rgb(1.5,2,3)' },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId, fill: { type: 'solid', color: 'rgb(1,2,3,0.5)' },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId,
        fill: { type: 'gradient', angle: 0, stops: [{ pos: 0, color: '#000000' }] },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId,
        fill: { type: 'gradient', angle: Number.NaN, stops: [
          { pos: 0.7, color: '#000000' }, { pos: 0.2, color: '#FFFFFF' },
        ] },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId,
        fill: { type: 'gradient', angle: -1, stops: [
          { pos: 0, color: '#000000' }, { pos: 1, color: '#FFFFFF' },
        ] },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId,
        fill: { type: 'gradient', angle: 360, stops: [
          { pos: 0, color: '#000000' }, { pos: 1, color: '#FFFFFF' },
        ] },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId,
        fill: { type: 'gradient', angle: 0, stops: Array.from({ length: 11 }, (_, index) => ({
          pos: index / 10, color: '#000000',
        })) },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId,
        fill: { type: 'gradient', angle: 0, stops: [
          { pos: 0.123451, color: '#000000' }, { pos: 0.123454, color: '#FFFFFF' },
        ] },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId,
        fill: { type: 'pattern', preset: 'unknown', fg: '#000000', bg: '#FFFFFF' },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId,
        fill: { type: 'image', src: 'data:image/png;base64,AA==' },
      }))
      && rejected(() => editor.exec({
        type: 'SetFill', id: shapeId, fill: { type: 'none' }, extra: true,
      }))
      && rejected(() => editor.exec(
        { type: 'SetFill', id: shapeId, fill: { type: 'solid', color: '#010203' } },
        { type: 'SetFill', id: 'missing', fill: { type: 'none' } },
      ))
      && JSON.stringify(doc) === atomicBefore.doc
      && JSON.stringify(doc.identity) === atomicBefore.identity
      && editor.history.undoCount === atomicBefore.history
      && JSON.stringify(editor.selection) === atomicBefore.selection);

  const imageId = Object.values(doc.elements).find((record) =>
    record.src.kind === 'image' && record.meta.editable === 'full')?.id;
  const sourceStroke = structuredClone(edit.effectiveElement(doc, shapeId).stroke);
  const stroke = {
    color: 'rgba(12,34,56,0.65)', width: 2.5, dash: [10, 7.5],
    cap: 'round', join: 'bevel', compound: 'dbl',
    head: { type: 'triangle', w: 5, h: 3 },
    tail: { type: 'arrow', w: 2, h: 5 },
  };
  editor.exec({ type: 'SetStroke', id: shapeId, stroke });
  const strokeState = edit.queryElementStroke(doc, [shapeId]);
  const strokeWidth = Math.round(2.5 * 9525) / 9525;
  check('SetStroke 投影完整线型并公开直接格式状态',
    JSON.stringify(strokeState.value) === JSON.stringify({
      color: 'rgba(12,34,56,0.65)', width: strokeWidth,
      dash: [4 * strokeWidth, 3 * strokeWidth],
      cap: 'round', join: 'bevel',
      head: { type: 'triangle', w: 5, h: 3 },
      tail: { type: 'arrow', w: 2, h: 5 }, compound: 'dbl',
    })
      && strokeState.mixed === false && strokeState.direct === true
      && JSON.stringify(edit.effectiveElement(doc, shapeId).stroke) === JSON.stringify(strokeState.value));
  const rawWidth = 2.50001;
  editor.exec({
    type: 'SetStroke', id: shapeId,
    stroke: { color: 'rgba(1,2,3,1)', width: rawWidth, dash: [4 * rawWidth, 3 * rawWidth] },
  });
  const quantizedStroke = edit.queryElementStroke(doc, [shapeId]).value;
  const roundTripWidth = Math.round(rawWidth * 9525) / 9525;
  check('描边在命令入口量化宽度/虚线并显式冻结会继承的默认线型',
    quantizedStroke?.color === 'rgb(1,2,3)'
      && quantizedStroke.width === roundTripWidth
      && JSON.stringify(quantizedStroke.dash) === JSON.stringify([4 * roundTripWidth, 3 * roundTripWidth])
      && quantizedStroke.cap === 'butt' && quantizedStroke.join === 'miter'
      && quantizedStroke.compound === 'sng'
      && quantizedStroke.head?.type === 'none' && quantizedStroke.tail?.type === 'none');
  const dashCoverage = DASH_PRESETS.every(([, ratios]) => {
    const width = 2;
    editor.exec({
      type: 'SetStroke', id: shapeId,
      stroke: { color: '#010203', width, dash: ratios.map((ratio) => ratio * width) },
    });
    return JSON.stringify(edit.queryElementStroke(doc, [shapeId]).value?.dash)
      === JSON.stringify(ratios.map((ratio) => ratio * width));
  });
  check('十种 DrawingML 预设虚线都通过同一公开命令 seam', dashCoverage);
  const noneEnds = {
    color: '#0F172A', width: 1, dash: null,
    head: { type: 'none', w: 3, h: 3 }, tail: { type: 'none', w: 3, h: 3 },
  };
  editor.exec({ type: 'SetStroke', id: shapeId, stroke: noneEnds });
  check('DrawingML 显式 none 线端可通过公开 Stroke 类型往返',
    JSON.stringify(edit.queryElementStroke(doc, [shapeId]).value) === JSON.stringify({
      color: 'rgb(15,23,42)', width: 1, dash: null,
      cap: 'butt', join: 'miter',
      head: { type: 'none', w: 3, h: 3 }, tail: { type: 'none', w: 3, h: 3 },
      compound: 'sng',
    }));
  const noOpHistory = editor.history.undoCount;
  const noOp = editor.exec({
    type: 'SetStroke', id: shapeId,
    stroke: {
      color: 'rgb(15,23,42)', width: 1, dash: null,
      cap: 'butt', join: 'miter', compound: 'sng',
      head: { w: 3, h: 3, type: 'none' }, tail: { h: 3, type: 'none', w: 3 },
    },
  });
  check('相同端点语义不受调用方键顺序影响且保持严格 no-op',
    noOp.dirtyElements.size === 0 && editor.history.undoCount === noOpHistory);
  editor.exec({ type: 'SetStroke', id: shapeId, stroke: { type: 'none' } });
  const explicitNoStroke = edit.queryElementStroke(doc, [shapeId]);
  const ownsNoStroke = own(doc.elements[shapeId].ovr, 'stroke')
    && doc.elements[shapeId].ovr.stroke === null;
  editor.exec({ type: 'SetStroke', id: shapeId, stroke: null });
  const resetStroke = edit.queryElementStroke(doc, [shapeId]);
  check('显式无描边与 stroke:null 恢复默认保持不同身份',
    explicitNoStroke.value === null && explicitNoStroke.direct === true && ownsNoStroke
      && resetStroke.direct === false
      && JSON.stringify(resetStroke.value) === JSON.stringify(sourceStroke));
  if (check('找到可编辑图片边框目标', !!imageId)) {
    editor.exec({
      type: 'SetStroke', id: imageId,
      stroke: { color: '#8844CC', width: 1.5, dash: null, cap: 'square', join: 'round' },
    });
    const mixedStroke = edit.queryElementStroke(doc, [shapeId, imageId]);
    check('图片边框可编辑且跨 shape/image 查询报告 mixed',
      edit.effectiveElement(doc, imageId).stroke?.color === 'rgb(136,68,204)'
        && mixedStroke.mixed === true && mixedStroke.direct === true);
  }

  const strokeAtomicBefore = {
    doc: JSON.stringify(doc), history: editor.history.undoCount,
    selection: JSON.stringify(editor.selection),
  };
  check('非法 stroke、错误元素与非法批量原子拒绝',
    rejected(() => editor.exec({
      type: 'SetStroke', id: shapeId,
      stroke: { color: '#000000', width: -1, dash: null },
    }))
      && rejected(() => editor.exec({
        type: 'SetStroke', id: shapeId,
        stroke: { color: '#000000', width: 2112.0001, dash: null },
      }))
      && rejected(() => editor.exec({
        type: 'SetStroke', id: shapeId,
        stroke: { color: '#000000', width: 2, dash: [3, 7] },
      }))
      && rejected(() => editor.exec({
        type: 'SetStroke', id: shapeId,
        stroke: { color: '#000000', width: 1, dash: null, cap: 'invalid' },
      }))
      && rejected(() => editor.exec({
        type: 'SetStroke', id: shapeId,
        stroke: { color: '#000000', width: 1, dash: null, head: { type: 'triangle', w: 4, h: 3 } },
      }))
      && rejected(() => editor.exec({
        type: 'SetStroke', id: shapeId, stroke: { type: 'garbage', extra: true },
      }))
      && rejected(() => editor.exec({
        type: 'SetStroke', id: shapeId, stroke: { type: 'none', extra: true },
      }))
      && rejected(() => editor.exec(
        { type: 'SetStroke', id: shapeId, stroke: { type: 'none' } },
        { type: 'SetStroke', id: 'missing', stroke: null },
      ))
      && JSON.stringify(doc) === strokeAtomicBefore.doc
      && editor.history.undoCount === strokeAtomicBefore.history
      && JSON.stringify(editor.selection) === strokeAtomicBefore.selection);

  check('公开模型校验拒绝图片填充覆盖、null 填充与非法描边', (() => {
    const imageFill = structuredClone(doc);
    imageFill.elements[shapeId].ovr.fill = { type: 'image', src: 'blob:forged' };
    const nullFill = structuredClone(doc);
    nullFill.elements[shapeId].ovr.fill = null;
    const badStroke = structuredClone(doc);
    badStroke.elements[shapeId].ovr.stroke = { color: 'red', width: -3, dash: [] };
    return rejected(() => edit.validateEditDoc(imageFill))
      && rejected(() => edit.validateEditDoc(nullFill))
      && rejected(() => edit.validateEditDoc(badStroke));
  })());

  unsubscribe();
  edit.disposeDoc(doc);
}
