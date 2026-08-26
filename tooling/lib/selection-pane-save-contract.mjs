import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();

export async function runSelectionPaneSaveContract({ edit, core, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 选择窗格名称最小保存\x1b[0m');
  const input = load('sample-editor-layer.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'selection-pane-save-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements)
    .find((record) => record.src.name === 'layer-item-01');
  const part = target.meta.origin.part;
  editor.exec({ type: 'SetName', id: target.id, name: '对象 & <一>' });
  editor.exec({ type: 'SetLocked', id: target.id, locked: true });
  editor.exec({ type: 'SetElementHidden', id: target.id, hidden: true });
  const saved = await editor.saveDetailed();
  const diff = diffPackageBytes(input, saved.bytes);
  const xml = decoder.decode(saved.package.parts[part]);
  check('重命名只改目标 slide part，正确转义名称且不序列化会话状态',
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.join(',') === part
      && xml.includes(`id="${target.meta.origin.spid}" name="对象 &amp; &lt;一>"`)
      && !xml.includes('hiddenByUser') && !xml.includes('web-ppt-locked'));

  const reopenedPresentation = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopenedPresentation, { idPrefix: 'selection-pane-reopen-' });
  const reopened = Object.values(reopenedDoc.elements)
    .find((record) => record.meta.origin?.part === part
      && record.meta.origin.spid === target.meta.origin.spid);
  check('保存重开恢复名称而不携带会话锁定或隐藏',
    reopened?.src.name === '对象 & <一>' && !reopened.meta.locked && !reopened.meta.hiddenByUser);
  edit.disposeDoc(reopenedDoc);

  editor.exec({ type: 'SetLocked', id: target.id, locked: false });
  editor.exec({ type: 'SetName', id: target.id, name: null });
  const restored = await editor.saveDetailed();
  check('恢复来源名称从首次基线重建为原包字节，锁定/隐藏不影响保存 identity',
    diffPackageBytes(input, restored.bytes).equal && restored.mode === 'passthrough');
  const identity = await editor.saveDetailed();
  check('名称恢复后的连续保存复用同一包字节',
    identity.mode === 'identity' && identity.bytes === restored.bytes);
  edit.disposeDoc(doc);

  console.log('\n\x1b[36m▸ 选择窗格多宿主名称保存\x1b[0m');
  const hostInput = load('sample-editor-selection-pane.pptx');
  const hostPresentation = await core.parse(hostInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const hostDoc = edit.createDoc(hostPresentation, { idPrefix: 'selection-host-save-' });
  const hostEditor = new edit.Editor(hostDoc);
  const hostRecords = Object.values(hostDoc.elements);
  const group = hostRecords.find((record) => record.src.name === 'pane-outer-group');
  const frame = hostRecords.find((record) => record.src.name === 'pane-unknown-frame');
  hostEditor.exec({ type: 'SetName', id: group.id, name: '重命名组合' });
  hostEditor.exec({ type: 'SetName', id: frame.id, name: '重命名框架' });
  const added = hostEditor.exec({
    type: 'AddShape', slideId: hostDoc.slideOrder[0], preset: 'rect',
    rect: { x: 40, y: 520, w: 180, h: 60 },
  });
  const addedId = added.forward.find((patch) => patch.op === 'insert' && patch.path.length === 2)?.path[1];
  hostEditor.exec({ type: 'SetName', id: addedId, name: '新增后重命名' });
  const hostSaved = await hostEditor.saveDetailed();
  saveArtifact('selection-pane.pptx', hostSaved.bytes);
  const hostXml = decoder.decode(hostSaved.package.parts[group.meta.origin.part]);
  check('组合、未知框架和新增对象共用 cNvPr 名称写回且保留未知 XML',
    hostXml.includes('name="重命名组合"') && hostXml.includes('name="重命名框架"')
      && hostXml.includes('name="新增后重命名"')
      && hostXml.includes('uri="urn:web-ppt:selection-pane"') && hostXml.includes('keep="yes"'));
  const hostReopenedPresentation = await core.parse(hostSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const hostReopenedDoc = edit.createDoc(hostReopenedPresentation, { idPrefix: 'selection-host-reopen-' });
  const reopenedNames = Object.values(hostReopenedDoc.elements).map((record) => record.src.name);
  check('多宿主名称保存重开保持稳定名称',
    ['重命名组合', '重命名框架', '新增后重命名'].every((name) => reopenedNames.includes(name)));
  edit.disposeDoc(hostReopenedDoc);
  edit.disposeDoc(hostDoc);
}
