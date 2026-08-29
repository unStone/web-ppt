const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);

export async function runVertexGeometryContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 自定义几何顶点模型\x1b[0m');
  const presentation = await core.parse(load('showcase.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'vertex-model-' });
  const record = byName(doc, 'CustGeomFormula');
  const geometry = record?.meta.customGeometry;
  check('custGeom 解析为稳定路径点并保留 avLst/gdLst 公式',
    geometry?.paths[0]?.commands[0]?.points[0]?.id === 'p0-c0-a'
      && geometry.adjustments[0]?.formula === 'val 30000'
      && geometry.guides[0]?.formula === '*/ w 1 2');
  const commandSeam = typeof edit.queryElementCustomGeometry === 'function'
    && typeof edit.moveCustomGeometryPoint === 'function';
  check('发布入口提供自定义几何查询与稳定点移动 seam', commandSeam);
  const arcRecord = byName(doc, 'CustArc');
  const arcEditable = arcRecord && edit.queryElementCustomGeometry(doc, arcRecord.id);
  const arcLine = arcEditable?.paths[0].commands.at(-1);
  const arcCubicLine = arcEditable && arcLine && edit.setCustomGeometrySegmentType(
    arcEditable, arcEditable.paths[0].id, arcLine.id, 'cubic',
  ).paths[0].commands.at(-1);
  check('来源 arcTo 保真驻留，进入顶点编辑时才物化可寻址贝塞尔',
    arcRecord?.meta.customGeometry?.paths[0].commands.some((command) => command.type === 'arc')
      && arcEditable?.paths[0].commands.every((command) => command.type !== 'arc')
      && arcEditable.paths[0].commands.filter((command) => command.type === 'cubic').length === 3
      && Math.abs(arcCubicLine?.points[0].x.value - 100 / 3) < 0.000001
      && Math.abs(arcCubicLine?.points[0].y.value - 100) < 0.000001);
  if (!commandSeam || !record || !geometry) {
    edit.disposeDoc(doc);
    return;
  }
  const editor = new edit.Editor(doc);
  const sourcePath = editor.effectiveElement(record.id).path;
  const sourceFrame = [record.z, record.src.x, record.src.y, record.src.w, record.src.h];
  const target = geometry.paths[0].commands[1].points.at(-1);
  const inconsistent = structuredClone(geometry);
  inconsistent.paths[0].commands[1].points.at(-1).x.value += 123_456;
  let inconsistentCommandRejected = false;
  let inconsistentPatchRejected = false;
  let guidePatchRejected = false;
  let emptyExpressionRejected = false;
  try { editor.exec({ type: 'SetGeometry', id: record.id, geometry: inconsistent }); }
  catch { inconsistentCommandRejected = true; }
  try {
    edit.applyPatches(doc, [{
      op: 'set', path: ['elements', record.id, 'ovr', 'geometry'],
      value: inconsistent, origin: 'vertex-remote',
    }]);
  } catch { inconsistentPatchRejected = true; }
  const changedGuides = structuredClone(geometry);
  changedGuides.guides[0].formula = 'val 1';
  try {
    edit.applyPatches(doc, [{
      op: 'set', path: ['elements', record.id, 'ovr', 'geometry'],
      value: changedGuides, origin: 'vertex-guides-remote',
    }]);
  } catch { guidePatchRejected = true; }
  const emptyExpression = structuredClone(geometry);
  emptyExpression.paths[0].commands[1].points.at(-1).x = { expression: '', value: 0 };
  try { editor.exec({ type: 'SetGeometry', id: record.id, geometry: emptyExpression }); }
  catch { emptyExpressionRejected = true; }
  check('命令与外部 Patch 都拒绝 expression/value 双真相或改写公式列表',
    inconsistentCommandRejected && inconsistentPatchRejected && guidePatchRejected && emptyExpressionRejected
      && editor.history.undoCount === 0
      && record.ovr.geometry === undefined);
  const moved = edit.moveCustomGeometryPoint(geometry, target.id, {
    x: target.x.value + 37, y: target.y.value + 23,
  });
  editor.exec({ type: 'SetGeometry', id: record.id, geometry: moved });
  check('SetGeometry 只改路径并形成可撤销的稀疏覆盖',
    editor.effectiveElement(record.id).path !== sourcePath
      && JSON.stringify(sourceFrame)
        === JSON.stringify([record.z, record.src.x, record.src.y, record.src.w, record.src.h])
      && record.ovr.geometry?.paths[0].commands[1].points.at(-1).x.value
        === target.x.value + 37
      && editor.history.undoCount === 1);
  editor.undo();
  check('SetGeometry 撤销恢复来源几何且不残留覆盖',
    record.ovr.geometry === undefined && editor.effectiveElement(record.id).path === sourcePath);
  const decoder = new TextDecoder();
  const sourceXml = decoder.decode(doc.package.parts[record.meta.origin.part]);
  const preservedLists = (xml) => ['avLst', 'gdLst', 'ahLst', 'cxnLst'].map((name) =>
    xml.match(new RegExp(`<a:${name}(?:\\s[^>]*)?>[\\s\\S]*?</a:${name}>|<a:${name}(?:\\s[^>]*)?/>`))?.[0] ?? '');
  editor.exec({ type: 'SetGeometry', id: record.id, geometry: moved });
  const saved = await editor.save();
  const reparsed = await core.parse(saved, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const reparsedShape = reparsed.slides.flatMap((slide) => slide.elements)
    .find((element) => element.name === 'CustGeomFormula');
  const reparsedGeometry = reparsedShape?.editInfo?.customGeometry;
  const savedXml = decoder.decode(doc.package.parts[record.meta.origin.part]);
  check('顶点编辑保存后重解析路径逐点相等',
    JSON.stringify(reparsedGeometry?.paths) === JSON.stringify(moved.paths));
  check('custGeom 写回逐字保留 avLst/gdLst 与未建模列表',
    JSON.stringify(preservedLists(savedXml)) === JSON.stringify(preservedLists(sourceXml)));
  reparsed.dispose?.();

  const path = geometry.paths[0];
  const segment = path.commands.find((command) => command.type === 'line' || command.type === 'cubic');
  const segmentSeam = typeof edit.setCustomGeometrySegmentType === 'function'
    && typeof edit.setCustomGeometryClosed === 'function';
  check('发布入口提供线段类型与闭合切换 seam', segmentSeam);
  if (segmentSeam && segment) {
    const changedType = segment.type === 'line' ? 'cubic' : 'line';
    const changed = edit.setCustomGeometrySegmentType(geometry, path.id, segment.id, changedType);
    const restored = edit.setCustomGeometrySegmentType(changed, path.id, segment.id, segment.type);
    const toggled = edit.setCustomGeometryClosed(geometry, path.id, !path.closed);
    check('直线与贝塞尔切换保持命令和锚点稳定身份',
      changed.paths[0].commands.find((command) => command.id === segment.id)?.type === changedType
        && restored.paths[0].commands.find((command) => command.id === segment.id)
          ?.points.at(-1)?.id === segment.points.at(-1)?.id);
    check('闭合切换只改变目标路径的闭合语义',
      toggled.paths[0].closed === !path.closed
        && toggled.paths[0].commands.length === path.commands.length);
    const quadraticGeometry = structuredClone(geometry);
    const quadraticPath = quadraticGeometry.paths.find((candidate) => candidate.id === path.id);
    const quadraticAt = quadraticPath.commands.findIndex((command) => command.id === segment.id);
    const quadraticAnchor = quadraticPath.commands[quadraticAt].points.at(-1);
    const quadraticControl = segment.type === 'cubic' ? segment.points[0] : {
      ...quadraticAnchor, id: `${segment.id}-c0`, role: 'control',
    };
    quadraticPath.commands[quadraticAt] = {
      id: segment.id, type: 'quadratic', points: [
        { ...quadraticControl, id: `${segment.id}-c0`, role: 'control' },
        { ...quadraticAnchor, id: `${segment.id}-a`, role: 'anchor' },
      ],
    };
    const line = edit.setCustomGeometrySegmentType(quadraticGeometry, path.id, segment.id, 'line');
    const cubic = edit.setCustomGeometrySegmentType(quadraticGeometry, path.id, segment.id, 'cubic');
    check('二次贝塞尔可切直线或等价三次贝塞尔且锚点身份稳定',
      line.paths[0].commands.find((command) => command.id === segment.id)?.type === 'line'
        && cubic.paths[0].commands.find((command) => command.id === segment.id)?.type === 'cubic'
        && cubic.paths[0].commands.find((command) => command.id === segment.id)
          ?.points.at(-1)?.id === `${segment.id}-a`);
  }

  const preset = Object.values(doc.elements).find((candidate) =>
    candidate.src.kind === 'shape' && candidate.meta.geom && !candidate.meta.customGeometry
      && candidate.meta.editable === 'full');
  const convertSeam = typeof edit.customGeometryFromSvgPath === 'function';
  check('发布入口提供预设路径物化 seam', convertSeam);
  if (convertSeam && preset) {
    const compound = edit.customGeometryFromSvgPath(
      'M 0 0 L 10 0 L 10 10 Z M 2 2 L 2 8 L 8 8 Z', 10, 10,
    );
    const ellipse = edit.customGeometryFromSvgPath(
      'M 20 10 A 10 10 0 1 1 0 10 A 10 10 0 1 1 20 10 Z', 20, 20,
    );
    const closeLine = edit.customGeometryFromSvgPath('M 0 0 L 10 0 Z L 20 10', 20, 10);
    const closeLinePath = closeLine.paths[0];
    const closeLineSegment = closeLinePath.commands.at(-1);
    const closeCubic = edit.setCustomGeometrySegmentType(
      closeLine, closeLinePath.id, closeLineSegment.id, 'cubic',
    ).paths[0].commands.at(-1);
    check('复合预设物化保持同一填充路径内的中间 close',
      compound.paths.length === 1
        && compound.paths[0].commands.some((command) => command.type === 'close')
        && compound.paths[0].closed === true);
    check('含圆弧预设物化为具备锚点与控制柄的贝塞尔段',
      ellipse.paths[0].commands.filter((command) => command.type === 'cubic').length === 4
        && ellipse.paths[0].commands.every((command) => command.type !== 'cubic'
          || command.points.length === 3));
    check('close 后线段转贝塞尔从子路径起点生成控制柄',
      Math.abs(closeCubic.points[0].x.value / 9525 - 20 / 3) < 0.000001
        && Math.abs(closeCubic.points[0].y.value / 9525 - 10 / 3) < 0.000001);
    const presetEditor = new edit.Editor(doc);
    const before = presetEditor.effectiveElement(preset.id).path;
    presetEditor.exec({ type: 'ConvertToCustomGeometry', id: preset.id });
    check('预设形状只能通过显式命令转为可撤销自由形状',
      preset.ovr.geometry?.paths.length > 0
        && presetEditor.effectiveElement(preset.id).path === before
        && presetEditor.history.undoCount === 1);
    presetEditor.undo();
    check('预设转换撤销后恢复预设几何且不残留覆盖',
      preset.ovr.geometry === undefined && presetEditor.effectiveElement(preset.id).path === before);
  }
  if (arcRecord && arcEditable) {
    const arcTarget = arcEditable.paths[0].commands.find((command) => command.type === 'cubic').points[2];
    const arcMoved = edit.moveCustomGeometryPoint(arcEditable, arcTarget.id, {
      x: arcTarget.x.value + 1.23456789, y: arcTarget.y.value + 2.34567891,
    });
    editor.exec({ type: 'SetGeometry', id: arcRecord.id, geometry: arcMoved });
    const arcSaved = await editor.save();
    const arcReparsed = await core.parse(arcSaved, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const arcReparsedShape = arcReparsed.slides.flatMap((slide) => slide.elements)
      .find((element) => element.name === 'CustArc');
    check('arc 物化编辑保存重开后命令与点地址逐点稳定',
      JSON.stringify(arcReparsedShape?.editInfo?.customGeometry?.paths) === JSON.stringify(arcMoved.paths));
    arcReparsed.dispose?.();
  }
  edit.disposeDoc(doc);
}
