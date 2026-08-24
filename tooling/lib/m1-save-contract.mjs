import { diffPackageBytes } from '../diff-package.mjs';
import { equalBytes } from './bytes.mjs';
import { localRecords } from './zip-records.mjs';
const emu = (value) => String(Math.round(value * 9525));

function replaceOnce(source, before, after) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`M1 固件中的预期片段不唯一：${before}`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

function findNamed(elements, name) {
  for (const element of elements) {
    if (element.name === name) return element;
    if (element.kind === 'group') {
      const nested = findNamed(element.children, name);
      if (nested) return nested;
    }
  }
  return null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** M1 的独立验收合约；预期值来自输入文件与方案，不读取保存器内部状态。 */
export async function runM1SaveContract({
  core, edit, fixtureNames, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ M1 最小写回与保存幂等\x1b[0m');

  const names = fixtureNames.filter((name) => name.endsWith('.pptx') && !name.includes('encrypted'));
  let identityFiles = 0;
  for (const name of names) {
    const input = load(name);
    const pres = await core.parse(input, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
    const doc = edit.createDoc(pres, { idPrefix: `m1-${identityFiles}-` });
    const editor = new edit.Editor(doc);
    const result = await editor.saveDetailed();
    if (result.mode === 'identity' && result.bytes === doc.package.bytes
      && equalBytes(result.bytes, input) && !editor.isDirty()) identityFiles++;
    edit.disposeDoc(doc);
  }
  check('全部可编辑 pptx 无编辑保存保持原文件逐字节身份', identityFiles === names.length,
    `${identityFiles}/${names.length}`);
  console.log(`  ${identityFiles}/${names.length} 份 pptx 无编辑保存逐字节相同`);

  const scenario = Object.freeze({
    file: 'sample-edit-xfrm.pptx', targetName: '异名前缀形状', x: 123.375,
  });
  const input = load(scenario.file);
  const pres = await core.parse(input, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(pres, { idPrefix: 'm1-move-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements).find((record) => record.src.name === scenario.targetName);
  if (!check('单形状移动固件暴露稳定编辑锚点', !!target?.meta.origin)) {
    edit.disposeDoc(doc);
    return;
  }

  const sourcePart = target.meta.origin.part;
  const sourceXml = new TextDecoder().decode(doc.package.parts[sourcePart]);
  const x = scenario.x;
  const beforeOff = `<d:off x="${emu(80)}" y="${emu(90)}"/>`;
  const afterOff = `<d:off x="${emu(x)}" y="${emu(90)}"/>`;
  const expectedXml = replaceOnce(sourceXml, beforeOff, afterOff);
  editor.exec({ type: 'SetXfrm', id: target.id, x });
  const saved = await editor.saveDetailed();
  const artifactPath = saveArtifact('single-move.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('移动一个形状使用直通保存且只重写一个 ZIP 条目',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1 && saved.preservedEntries > 0);
  eq('移动一个形状只改变目标 slide part',
    JSON.stringify({ added: diff.added, removed: diff.removed, changed: diff.changed }),
    JSON.stringify({ added: [], removed: [], changed: [sourcePart] }));
  eq('目标 XML 只把自己的 off@x 改成指定 EMU',
    new TextDecoder().decode(saved.package.parts[sourcePart]), expectedXml);
  const beforeRecords = localRecords(input);
  const afterRecords = localRecords(saved.bytes);
  check('目标外全部 ZIP 本地头、extra 与原始压缩流逐字节直通',
    [...beforeRecords].every(([name, record]) => name === sourcePart
      || equalBytes(afterRecords.get(name), record))
    && !equalBytes(afterRecords.get(sourcePart), beforeRecords.get(sourcePart)));

  const reparsed = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const projected = editor.toSlide(doc.slideOrder[0]);
  const comparable = structuredClone(reparsed.slides[0]);
  delete comparable.editInfo;
  const reparsedTarget = findNamed(comparable.elements, target.src.name);
  const projectedTarget = findNamed(projected.elements, target.src.name);
  check('重新解析的移动坐标与有效投影误差不超过一个 EMU',
    Math.abs(reparsedTarget.x - projectedTarget.x) <= 1 / 9525);
  reparsedTarget.x = projectedTarget.x;
  eq('保存产物重新解析后的统一投影逐字段等于 EditDoc 有效投影',
    stableJson(comparable), stableJson(projected));
  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifactPath, 'saved', scenario);
  for (const textMode of ['html', 'svg']) {
    eq(`保存产物 ${textMode} 渲染指纹等于独立进程中的有效投影`,
      savedFingerprint[textMode], projectedFingerprint[textMode]);
  }

  const repeated = await editor.saveDetailed();
  check('相同状态重复保存保持 ZIP 字节与包句柄身份', repeated.mode === 'identity'
    && repeated.bytes === saved.bytes && repeated.package === saved.package && !editor.isDirty());
  reparsed.dispose?.();
  edit.disposeDoc(doc);

  const deleteScenario = Object.freeze({
    type: 'remove', file: 'sample-editor-delete.pptx', targetName: 'delete-peer',
  });
  const deleteInput = load(deleteScenario.file);
  const deletePres = await core.parse(deleteInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const deleteDoc = edit.createDoc(deletePres, { idPrefix: 'm1-delete-' });
  const deleteEditor = new edit.Editor(deleteDoc);
  const deleteTarget = Object.values(deleteDoc.elements)
    .find((record) => record.src.name === deleteScenario.targetName);
  if (!check('元素删除指纹固件暴露稳定编辑锚点', !!deleteTarget?.meta.origin)) {
    edit.disposeDoc(deleteDoc);
    return;
  }
  deleteEditor.exec({ type: 'RemoveElement', id: deleteTarget.id });
  const deleteSaved = await deleteEditor.saveDetailed();
  const deleteArtifact = saveArtifact('element-delete.pptx', deleteSaved.bytes);
  const deleteReparsed = await core.parse(deleteSaved.bytes, { lazy: false, assets: 'defer' });
  check('元素删除保存后重新解析不再包含目标',
    !findNamed(deleteReparsed.slides[0].elements, deleteScenario.targetName));
  const deleteProjectedFingerprint = renderFingerprint(
    deleteScenario.file, 'projected', deleteScenario,
  );
  const deleteSavedFingerprint = renderFingerprint(deleteArtifact, 'saved', deleteScenario);
  for (const textMode of ['html', 'svg']) {
    eq(`元素删除保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      deleteSavedFingerprint[textMode], deleteProjectedFingerprint[textMode]);
  }
  deleteReparsed.dispose?.();
  edit.disposeDoc(deleteDoc);

  const layerScenario = Object.freeze({
    type: 'order', file: 'sample-editor-layer.pptx', targetName: 'layer-back', to: 'front',
  });
  const layerInput = load(layerScenario.file);
  const layerPres = await core.parse(layerInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const layerDoc = edit.createDoc(layerPres, { idPrefix: 'm1-layer-' });
  const layerEditor = new edit.Editor(layerDoc);
  const layerTarget = Object.values(layerDoc.elements)
    .find((record) => record.src.name === layerScenario.targetName);
  if (!check('元素层级指纹固件暴露稳定编辑锚点', !!layerTarget?.meta.origin)) {
    edit.disposeDoc(layerDoc);
    return;
  }
  layerEditor.exec({ type: 'SetZ', id: layerTarget.id, to: layerScenario.to });
  const layerSaved = await layerEditor.saveDetailed();
  const layerArtifact = saveArtifact('element-layer.pptx', layerSaved.bytes);
  const layerDiff = diffPackageBytes(layerInput, layerSaved.bytes);
  const layerReparsed = await core.parse(layerSaved.bytes, { lazy: false, assets: 'defer' });
  check('元素层级保存只改目标页且重新解析后目标位于可写顶层末端',
    layerSaved.mode === 'passthrough' && layerSaved.rewrittenEntries === 1
      && layerDiff.changed.join(',') === layerTarget.meta.origin.part
      && layerReparsed.slides[0].elements.at(-1)?.name === layerScenario.targetName);
  const layerProjectedFingerprint = renderFingerprint(
    layerScenario.file, 'projected', layerScenario,
  );
  const layerSavedFingerprint = renderFingerprint(layerArtifact, 'saved', layerScenario);
  for (const textMode of ['html', 'svg']) {
    eq(`元素层级保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      layerSavedFingerprint[textMode], layerProjectedFingerprint[textMode]);
  }
  layerReparsed.dispose?.();
  edit.disposeDoc(layerDoc);
}
