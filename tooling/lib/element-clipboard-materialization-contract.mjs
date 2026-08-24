/** 原始组合也必须按当前 EditDoc 状态复制，不能把未保存修改遗漏在源 OOXML 里。 */
export async function runClipboardMaterializationContract({ edit, core, load, check }) {
  const presentation = await core.parse(load('sample-editor-layer.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'clipboard-materialize-' });
  const editor = new edit.Editor(doc);
  const byName = (name) => Object.values(doc.elements).find((record) => record.src.name === name);
  const group = byName('layer-group');
  const kept = byName('layer-child-a');
  const removed = byName('layer-child-b');
  const nestedSource = byName('layer-link');
  if (!check('物化固件含可修改、删除及嵌入的组合素材',
    !!group && !!kept && !!removed && !!nestedSource)) return;

  const expectedX = edit.effectiveElement(doc, kept.id).x + 33;
  editor.exec({ type: 'SetXfrm', id: kept.id, x: expectedX });
  editor.exec({ type: 'RemoveElement', id: removed.id });
  editor.exec({
    type: 'PasteElements', payload: edit.copyElements(doc, [nestedSource.id]),
    at: { parentId: group.id, x: 200, y: 240 },
  });
  const payload = edit.copyElements(doc, [group.id]);
  const payloadRoot = payload.records[payload.roots[0]];
  editor.exec({
    type: 'PasteElements', payload,
    at: { parentId: doc.slideOrder[0], x: 520, y: 300 },
  });
  const pastedId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  const pasted = pastedId && doc.elements[pastedId];
  const pastedChild = pasted?.children?.[0] && doc.elements[pasted.children[0]];
  check('复制原始组合物化修改和嵌入后代并排除已删除宿主',
    payloadRoot.children.length === 2 && pasted?.children?.length === 2
      && Math.abs(edit.effectiveElement(doc, pastedChild.id).x - expectedX) < 1e-6);

  const saved = await editor.save();
  const reopened = await core.parse(saved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopened, { idPrefix: 'clipboard-materialize-reopen-' });
  const groups = Object.values(reopenedDoc.elements).filter((record) => record.src.name === 'layer-group');
  check('原始组合复制保存重开不回退后代修改或复活删除宿主',
    groups.length === 2 && groups.every((record) => record.children?.length === 2
      && record.children.some((id) => reopenedDoc.elements[id].src.name === 'layer-link')
      && record.children.some((id) => reopenedDoc.elements[id].src.name === 'layer-child-a'
        && Math.abs(edit.effectiveElement(reopenedDoc, id).x - expectedX) < 1e-6))
      && !Object.values(reopenedDoc.elements).some((record) => record.src.name === 'layer-child-b'));
  edit.disposeDoc(reopenedDoc);
  edit.disposeDoc(doc);
}
