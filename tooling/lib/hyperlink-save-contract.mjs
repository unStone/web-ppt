import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const count = (value, pattern) => [...value.matchAll(pattern)].length;
const byName = (doc, name) => Object.values(doc.elements).find((record) => record.src.name === name);

/** 关系图是链接保存的真相：XML 与 .rels 必须原子更新，且共享目标只保留一条关系。 */
export async function runHyperlinkSaveContract({ edit, core, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 元素与文字超链接保留型保存\x1b[0m');
  const input = load('sample-editor-hyperlinks.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'hyperlink-save-' });
  const editor = new edit.Editor(doc);
  const linked = byName(doc, 'link-shared-a');
  const second = byName(doc, 'link-shared-b');
  if (!check('找到两个元素链接保存目标', !!linked?.meta.origin && !!second?.meta.origin)) return;
  const target = { kind: 'external', href: 'https://example.com/shared?from=web-ppt' };
  editor.exec(
    { type: 'SetLink', id: linked.id, target },
    { type: 'SetLink', id: second.id, target },
  );
  const externalSaved = await editor.saveDetailed();
  const part = linked.meta.origin.part;
  const relsPart = 'ppt/slides/_rels/slide1.xml.rels';
  const slideXml = decoder.decode(externalSaved.package.parts[part]);
  const relsXml = decoder.decode(externalSaved.package.parts[relsPart]);
  const sharedId = relsXml.match(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="https:\/\/example\.com\/shared\?from=web-ppt"/)?.[1];
  check('同页相同外链复用关系、使用 External 且只改 slide 与关系 part',
    !!sharedId
      && count(relsXml, /Target="https:\/\/example\.com\/shared\?from=web-ppt"/g) === 1
      && relsXml.includes(`Id="${sharedId}"`)
      && relsXml.includes('TargetMode="External"')
      && count(slideXml, new RegExp(`<a:hlinkClick[^>]*r:id="${sharedId}"`, 'g')) === 2
      && diffPackageBytes(input, externalSaved.bytes).changed.sort().join(',')
        === [part, relsPart].sort().join(','));
  check('修改其它链接不会清理未触碰的无引用关系',
    relsXml.includes('Target="https://example.com/untouched-orphan"'));

  const targetSlideId = doc.slideOrder[1];
  editor.exec({ type: 'SetLink', id: linked.id, target: { kind: 'slide', slideId: targetSlideId } });
  const internalSaved = await editor.saveDetailed();
  const internalSlide = decoder.decode(internalSaved.package.parts[part]);
  const internalRels = decoder.decode(internalSaved.package.parts[relsPart]);
  const internalId = internalRels.match(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="slide2\.xml"/)?.[1];
  check('内部链接写 slide 关系与 hlinksldjump，且不携带 External',
    !!internalId
      && internalSlide.includes(`r:id="${internalId}" action="ppaction://hlinksldjump"`)
      && internalRels.match(new RegExp(`Id="${internalId}"[^>]*Type="[^"]*/slide"`))
      && !internalRels.match(new RegExp(`Id="${internalId}"[^>]*TargetMode="External"`)));

  editor.exec({ type: 'SetLink', id: linked.id, target: { kind: 'none' } });
  const removedSaved = await editor.saveDetailed();
  const removedSlide = decoder.decode(removedSaved.package.parts[part]);
  const removedRels = decoder.decode(removedSaved.package.parts[relsPart]);
  const removedProperties = removedSlide.match(new RegExp(
    `<p:cNvPr[^>]*id="${linked.meta.origin.spid}"[\\s\\S]*?</p:cNvPr>`,
  ))?.[0] ?? '';
  check('最后引用移除时才清理旧 hyperlink 关系',
    !!removedProperties && !removedProperties.includes('<a:hlinkClick')
      && !removedRels.includes('Target="slide2.xml"')
      && removedRels.includes('Target="https://example.com/shared?from=web-ppt"'));

  const hover = byName(doc, 'link-hover-preserve');
  editor.exec({
    type: 'SetLink', id: hover.id,
    target: { kind: 'external', href: 'https://example.com/click-replaced' },
  });
  const hoverSaved = await editor.saveDetailed();
  const hoverXml = decoder.decode(hoverSaved.package.parts[part]);
  const hoverRels = decoder.decode(hoverSaved.package.parts[relsPart]);
  check('替换 click 链接保留 hlinkMouseOver、未知属性/扩展及其关系',
    hoverXml.includes('tooltip="KEEP-HOVER" fixture:keep="hover"')
      && hoverXml.includes('fixture:keep="click"')
      && hoverXml.includes('uri="{KEEP-CLICK}"')
      && hoverRels.includes('Target="https://example.com/hover"'));

  const reopened = await core.parse(internalSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopened, { idPrefix: 'hyperlink-reopen-' });
  const reopenedLink = Object.values(reopenedDoc.elements).find((record) =>
    record.meta.origin?.spid === linked.meta.origin.spid && record.meta.origin.part === part);
  check('元素内部链接保存重开恢复为目标页稳定身份',
    edit.queryElementLink(reopenedDoc, [reopenedLink.id]).value?.slideId === reopenedDoc.slideOrder[1]);
  edit.disposeDoc(reopenedDoc);
  edit.disposeDoc(doc);

  const textInput = load('sample-editor-hyperlinks.pptx');
  const textPresentation = await core.parse(textInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const textDoc = edit.createDoc(textPresentation, { idPrefix: 'hyperlink-text-save-' });
  const textEditor = new edit.Editor(textDoc);
  const textRecord = byName(textDoc, 'link-text-runs');
  if (!check('找到文字链接保存目标', !!textRecord?.meta.origin)) return;
  const p = textRecord.src.text.paragraphs.findIndex((paragraph) =>
    paragraph.runs.some((run) => run.link?.startsWith('http')));
  const r = textRecord.src.text.paragraphs[p].runs.findIndex((run) => run.link?.startsWith('http'));
  const run = textRecord.src.text.paragraphs[p].runs[r];
  const range = { from: { p, r, off: 0 }, to: { p, r, off: run.text.length } };
  textEditor.exec({
    type: 'SetRunProps', id: textRecord.id, range,
    props: { link: { kind: 'slide', slideId: textDoc.slideOrder.at(-1) } },
  });
  const textSaved = await textEditor.saveDetailed();
  saveArtifact('hyperlinks.pptx', textSaved.bytes);
  const textPart = textRecord.meta.origin.part;
  const textRelsPart = `ppt/slides/_rels/${textPart.slice(textPart.lastIndexOf('/') + 1)}.rels`;
  const textXml = decoder.decode(textSaved.package.parts[textPart]);
  const textRels = decoder.decode(textSaved.package.parts[textRelsPart]);
  check('文字链接写入目标 a:rPr 并保存为内部 slide 关系',
    /<a:rPr[^>]*>[\s\S]*?<a:hlinkClick\b[^>]*action="ppaction:\/\/hlinksldjump"/.test(textXml)
      && /Type="[^"]*\/slide"[^>]*Target="slide3\.xml"/.test(textRels));
  const textReopened = await core.parse(textSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const textReopenedDoc = edit.createDoc(textReopened, { idPrefix: 'hyperlink-text-reopen-' });
  const reopenedTextRecord = Object.values(textReopenedDoc.elements).find((record) =>
    record.meta.origin?.spid === textRecord.meta.origin.spid
      && record.meta.origin.part === textRecord.meta.origin.part);
  check('文字内部链接保存重开仍指向稳定目标页',
    edit.queryRunLink(textReopenedDoc, reopenedTextRecord.id, range).value?.slideId
      === textReopenedDoc.slideOrder.at(-1));
  edit.disposeDoc(textReopenedDoc);
  edit.disposeDoc(textDoc);

  const removedTargetPresentation = await core.parse(load('sample-editor-hyperlinks.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const removedTargetDoc = edit.createDoc(removedTargetPresentation, {
    idPrefix: 'hyperlink-removed-target-save-',
  });
  const removedTargetEditor = new edit.Editor(removedTargetDoc);
  removedTargetEditor.exec({ type: 'RemoveSlide', id: removedTargetDoc.slideOrder[2] });
  const removedTargetSaved = await removedTargetEditor.saveDetailed();
  const removedTargetSlide = decoder.decode(removedTargetSaved.package.parts['ppt/slides/slide1.xml']);
  const removedTargetRels = decoder.decode(
    removedTargetSaved.package.parts['ppt/slides/_rels/slide1.xml.rels'],
  );
  check('删除链接目标页会同时清理来源节点与关系，不留下悬空 OPC 引用',
    !removedTargetSlide.includes('r:id="rId5"')
      && !removedTargetRels.includes('Id="rId5"')
      && !removedTargetRels.includes('Id="rId8"')
      && !removedTargetRels.includes('Target="slide3.xml"'));
  edit.disposeDoc(removedTargetDoc);
}
