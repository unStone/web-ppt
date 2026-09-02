import { diffPackageBytes } from '../diff-package.mjs';

const decode = (parts, part) => new TextDecoder().decode(parts[part]);

export async function runCommonObjectSlideSaveContract({
  edit, core, generate, load, check, saveArtifact,
}) {
  console.log('\n\x1b[36m▸ 高频对象与页面命令保存\x1b[0m');
  const input = load('sample-editor-common-commands.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'common-save-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements).find((record) => record.src.name === 'common-alt');
  const distributed = ['common-left', 'common-middle-a', 'common-middle-b', 'common-right']
    .map((name) => Object.values(doc.elements).find((record) => record.src.name === name).id);
  const originalName = target.src.name;
  editor.exec({ type: 'DistributeElements', ids: distributed, axis: 'horizontal' });
  editor.exec({ type: 'SetAltText', id: target.id, title: '图表 & 趋势', descr: '季度 <增长>' });
  const sections = edit.listSections(doc);
  editor.exec({ type: 'RenameSection', id: sections[0].id, name: '主体 & 说明' });
  editor.exec({ type: 'MoveSection', id: sections[1].id, at: { after: null } });
  editor.exec({ type: 'RemoveSection', id: sections[1].id });
  editor.exec({
    type: 'AddSection', name: '重建结尾', slideIds: [doc.slideOrder[2]], at: { after: null },
  });
  const rebuiltSection = edit.listSections(doc)[0];
  editor.exec({ type: 'SetSlideSize', w: 1600, h: 900 });
  const saved = await editor.saveDetailed();
  saveArtifact('common-object-slide.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const slideXml = decode(saved.package.parts, target.meta.origin.part);
  const presentationXml = decode(saved.package.parts, 'ppt/presentation.xml');
  check('替代文字最小写回目标 slide part 并保留名称与未知属性',
    diff.changed.includes(target.meta.origin.part)
      && slideXml.includes(`name="${originalName}" title="图表 &amp; 趋势" descr="季度 &lt;增长>"`)
      && slideXml.includes('fixture:keep="ALT"'));
  check('页面尺寸写回 p:sldSz 且不触碰 notesSz',
    presentationXml.includes('<p:sldSz cx="15240000" cy="8572500"/>')
      && presentationXml.includes('<p:notesSz cx="6858000" cy="9144000"/>'));
  check('节增删改名与移动复用存活来源节点、分配新 GUID 并保留未知扩展',
    presentationXml.indexOf('name="重建结尾"') < presentationXml.indexOf('name="主体 &amp; 说明"')
      && presentationXml.includes(`name="重建结尾" id="${rebuiltSection.presentationId}"`)
      && !presentationXml.includes('{22222222-2222-2222-2222-222222222222}')
      && presentationXml.includes('fixture:keep="SECTION"')
      && presentationXml.includes('<fixture:tail xmlns:fixture="urn:web-ppt:common" keep="yes"/>'));

  const reopenedPresentation = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopenedPresentation, { idPrefix: 'common-reopen-' });
  const reopenedTarget = Object.values(reopenedDoc.elements)
    .find((record) => record.meta.origin?.part === target.meta.origin.part
      && record.meta.origin.spid === target.meta.origin.spid);
  const reopenedAlt = edit.queryElementAltText(reopenedDoc, reopenedTarget.id);
  check('保存重开恢复替代文字、节顺序和页面尺寸',
    reopenedAlt.title === '图表 & 趋势' && reopenedAlt.descr === '季度 <增长>'
      && reopenedTarget.src.name === originalName
      && edit.listSections(reopenedDoc).map((section) => section.name).join(',') === '重建结尾,主体 & 说明'
      && edit.querySlideSize(reopenedDoc).w === 1600 && edit.querySlideSize(reopenedDoc).h === 900);
  edit.disposeDoc(reopenedDoc);

  const generated = await generate.generateEditDoc({ ...doc, package: null });
  const generatedPresentation = await core.parse(generated.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const generatedDoc = edit.createDoc(generatedPresentation, { idPrefix: 'common-generated-' });
  check('生成保存物化同一节成员与页面尺寸',
    edit.querySlideSize(generatedDoc).w === 1600 && edit.querySlideSize(generatedDoc).h === 900
      && edit.listSections(generatedDoc).map((section) => section.name).join(',') === '重建结尾,主体 & 说明'
      && edit.listSections(generatedDoc).flatMap((section) => section.slideIds).length === 3);
  edit.disposeDoc(generatedDoc);

  const savedAgain = await editor.saveDetailed();
  check('连续保存进入 identity', savedAgain.mode === 'identity' && savedAgain.bytes === saved.bytes);
  for (let index = 0; index < 7; index++) editor.undo();
  const restored = await editor.saveDetailed();
  check('四组覆盖全部撤销后逐字恢复原包', diffPackageBytes(input, restored.bytes).equal);
  edit.disposeDoc(doc);
}
