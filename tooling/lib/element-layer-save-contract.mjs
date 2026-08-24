/** 层级保存只经过公开命令、saveDetailed、重新解析与 OPC 字节观察。 */
import { equalBytes } from './bytes.mjs';

export async function runElementLayerSaveContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ SetZ 最小写回 OOXML\x1b[0m');
  const input = load('sample-editor-delete.pptx');
  if (!check('找到层级写回固件', !!input)) return;
  const pres = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(pres, { idPrefix: 'layer-save-' });
  const editor = new edit.Editor(doc);
  const byName = (name) => Object.values(doc.elements)
    .find((record) => record.src.name === name);
  const shape = byName('delete-shape');
  const childA = byName('delete-group-child-a');
  const childB = byName('delete-group-child-b');
  if (!check('顶层与组合内层级目标都有稳定 OOXML 锚点',
    !!shape?.meta.origin && !!childA?.meta.origin && !!childB?.meta.origin)) return;
  const part = shape.meta.origin.part;
  const sourcePart = doc.package.parts[part].slice();
  const sourceMedia = doc.package.parts['ppt/media/image1.png'].slice();

  editor.exec({ type: 'SetZ', id: shape.id, to: 'front' });
  editor.exec({ type: 'SetZ', id: childA.id, to: 'front' });
  const saved = await editor.saveDetailed();
  const xml = new TextDecoder().decode(saved.package.parts[part]);
  const reopened = await core.parse(saved.bytes, {
    edit: true, lazy: false, assets: 'defer',
  });
  const topNames = reopened.slides[0].elements.map((element) => element.name);
  const group = reopened.slides[0].elements.find((element) => element.name === 'delete-group');
  const childNames = group?.kind === 'group' ? group.children.map((element) => element.name) : [];
  check('保存只重排既有顶层与组内宿主并保留非图形节点、关系和媒体',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && topNames.at(-1) === 'delete-shape'
      && childNames.join(',') === 'delete-group-child-b,delete-group-child-a'
      && xml.includes('<p:nvGrpSpPr>') && xml.includes('<p:grpSpPr>')
      && xml.includes('name="delete-frame"') && xml.includes('r:embed="rId2"')
      && equalBytes(saved.package.parts['ppt/media/image1.png'], sourceMedia));

  editor.undo();
  editor.undo();
  const restored = await editor.saveDetailed();
  check('保存后撤销全部层级会从首次触碰基线逐字恢复来源 part',
    equalBytes(restored.package.parts[part], sourcePart) && !editor.isDirty());
  reopened.dispose?.();
  edit.disposeDoc(doc);

  const coverageInput = load('sample-editor-layer.pptx');
  const coveragePres = await core.parse(coverageInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const coverageDoc = edit.createDoc(coveragePres, { idPrefix: 'layer-save-coverage-' });
  const coverageEditor = new edit.Editor(coverageDoc);
  const link = Object.values(coverageDoc.elements)
    .find((record) => record.src.name === 'layer-link');
  const slidePart = link.meta.origin.part;
  const relPart = 'ppt/slides/_rels/slide1.xml.rels';
  const layoutPart = 'ppt/slideLayouts/slideLayout1.xml';
  const sourceSlide = coverageDoc.package.parts[slidePart].slice();
  const sourceRel = coverageDoc.package.parts[relPart].slice();
  const sourceLayout = coverageDoc.package.parts[layoutPart].slice();
  coverageEditor.exec({ type: 'SetZ', id: link.id, to: 'back' });
  const coverageSaved = await coverageEditor.saveDetailed();
  const coverageReopened = await core.parse(coverageSaved.bytes, {
    edit: true, lazy: false, assets: 'defer',
  });
  const writableNames = coverageReopened.slides[0].elements
    .filter((element) => element.name !== 'layer-inherited').map((element) => element.name);
  const reopenedLink = coverageReopened.slides[0].elements
    .find((element) => element.name === 'layer-link');
  check('超链接层级只重排 slide 宿主，关系与继承版式逐字直通',
    coverageSaved.mode === 'passthrough' && coverageSaved.rewrittenEntries === 1
      && writableNames[0] === 'layer-link'
      && reopenedLink?.link === 'https://example.com/layer'
      && equalBytes(coverageSaved.package.parts[relPart], sourceRel)
      && equalBytes(coverageSaved.package.parts[layoutPart], sourceLayout)
      && !equalBytes(coverageSaved.package.parts[slidePart], sourceSlide));
  coverageReopened.dispose?.();
  edit.disposeDoc(coverageDoc);
}
