/** 删除写回只通过公开命令、saveDetailed、重新解析与 ZIP 字节观察验收。 */
import { equalBytes } from './bytes.mjs';
import { localRecords } from './zip-records.mjs';

function elementNames(elements) {
  return elements.flatMap((element) => [
    element.name,
    ...(element.kind === 'group' ? elementNames(element.children) : []),
  ]);
}

export async function runElementDeleteSaveContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ RemoveElement 最小写回 OOXML\x1b[0m');
  const input = load('sample-editor-delete.pptx');
  if (!check('找到确定性删除写回固件', !!input)) return;
  const pres = await core.parse(input, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(pres, { idPrefix: 'delete-save-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements).find((record) => record.src.name === 'delete-shape');
  if (!check('删除写回目标带稳定 slide part 与 spid', !!target?.meta.origin)) return;
  const part = target.meta.origin.part;
  const sourcePart = doc.package.parts[part];
  const mediaPart = doc.package.parts['ppt/media/image1.png'];
  editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
  editor.exec({ type: 'RemoveElement', id: target.id });
  const saved = await editor.saveDetailed();
  const xml = new TextDecoder().decode(saved.package.parts[part]);
  const reparsed = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const names = reparsed.slides[0].elements.map((element) => element.name);
  const beforeRecords = localRecords(input);
  const afterRecords = localRecords(saved.bytes);
  check('删除一个形状只重写目标页并保留共享图片关系与原始资源字节',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && !xml.includes('name="delete-shape"') && xml.includes('name="delete-picture"')
      && !names.includes('delete-shape') && names.includes('delete-peer')
      && equalBytes(saved.package.parts['ppt/media/image1.png'], mediaPart)
      && [...beforeRecords].every(([name, record]) => name === part
        || equalBytes(afterRecords.get(name), record)));

  editor.undo();
  const restored = await editor.saveDetailed();
  const restoredParse = await core.parse(restored.bytes, { edit: true, lazy: false, assets: 'defer' });
  check('保存后撤销删除会从首次触碰基线恢复原节点与投影',
    equalBytes(restored.package.parts[part], sourcePart)
      && restoredParse.slides[0].elements.some((element) => element.name === 'delete-shape')
      && !editor.isDirty());
  restoredParse.dispose?.();
  reparsed.dispose?.();
  edit.disposeDoc(doc);

  const hostPres = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const hostDoc = edit.createDoc(hostPres, { idPrefix: 'delete-hosts-' });
  const hostEditor = new edit.Editor(hostDoc);
  const hostNames = ['delete-group', 'delete-picture', 'delete-frame'];
  const hosts = hostNames.map((name) => Object.values(hostDoc.elements)
    .find((record) => record.src.name === name));
  if (!check('组合、图片与图框删除目标均有稳定溯源', hosts.every((record) => !!record?.meta.origin))) {
    edit.disposeDoc(hostDoc);
    return;
  }
  const hostPart = hosts[0].meta.origin.part;
  const relPart = 'ppt/slides/_rels/slide1.xml.rels';
  const beforeRel = hostDoc.package.parts[relPart];
  const beforeMedia = hostDoc.package.parts['ppt/media/image1.png'];
  hostEditor.transaction((transaction) => {
    for (const record of hosts) transaction.exec({ type: 'RemoveElement', id: record.id });
  }, '删除组合、图片与图框');
  const hostSaved = await hostEditor.saveDetailed();
  const hostXml = new TextDecoder().decode(hostSaved.package.parts[hostPart]);
  const hostReparsed = await core.parse(hostSaved.bytes, { lazy: false, assets: 'defer' });
  const remainingNames = elementNames(hostReparsed.slides[0].elements);
  check('组合递归子树、图片与不可编辑图框只移除宿主并保留关系和媒体字节',
    hostSaved.mode === 'passthrough' && hostSaved.rewrittenEntries === 1
      && [...hostNames, 'delete-group-child-a', 'delete-group-child-b']
        .every((name) => !hostXml.includes(`name="${name}"`) && !remainingNames.includes(name))
      && equalBytes(hostSaved.package.parts[relPart], beforeRel)
      && equalBytes(hostSaved.package.parts['ppt/media/image1.png'], beforeMedia));
  hostReparsed.dispose?.();
  edit.disposeDoc(hostDoc);

  const placeholderPres = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const placeholderDoc = edit.createDoc(placeholderPres, { idPrefix: 'delete-text-save-' });
  const placeholderEditor = new edit.Editor(placeholderDoc);
  const filled = Object.values(placeholderDoc.elements)
    .find((record) => record.src.name === 'delete-placeholder-filled');
  if (!check('占位符清空写回目标带文本与溯源', !!filled?.src.text && !!filled.meta.origin)) return;
  placeholderEditor.exec({ type: 'RemoveElement', id: filled.id });
  const cleared = await placeholderEditor.saveDetailed();
  const clearedXml = new TextDecoder().decode(cleared.package.parts[filled.meta.origin.part]);
  const clearedHost = clearedXml.match(
    /<p:sp>\s*<p:nvSpPr><p:cNvPr id="404" name="delete-placeholder-filled"\/>[\s\S]*?<\/p:sp>/,
  )?.[0] ?? '';
  const clearedParse = await core.parse(cleared.bytes, { edit: true, lazy: false, assets: 'defer' });
  const clearedPlaceholder = clearedParse.slides[0].elements
    .find((element) => element.name === 'delete-placeholder-filled');
  check('第一次删除只清空 txBody 段落并保留占位符宿主、bodyPr 与 lstStyle',
    cleared.mode === 'passthrough' && cleared.rewrittenEntries === 1
      && clearedHost.includes('<p:txBody><a:bodyPr/><a:lstStyle/>')
      && clearedHost.includes('<a:p><a:endParaRPr/></a:p>')
      && !clearedHost.includes('保留格式后清空')
      && !!clearedPlaceholder?.editInfo?.placeholder && clearedPlaceholder.text === null);
  placeholderEditor.exec({ type: 'RemoveElement', id: filled.id });
  const removedPlaceholder = await placeholderEditor.saveDetailed();
  const removedXml = new TextDecoder().decode(removedPlaceholder.package.parts[filled.meta.origin.part]);
  check('清空后再次删除才从 slide part 移除占位符宿主',
    !removedXml.includes('name="delete-placeholder-filled"') && !placeholderDoc.elements[filled.id]);
  clearedParse.dispose?.();
  edit.disposeDoc(placeholderDoc);
}
