import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const named = (records, name) => Object.values(records)
  .find((record) => record.src.name === name);
const rangeOf = (edit, text) => ({
  from: { p: 0, r: 0, off: 0 },
  to: edit.textPositionAtIndex(text, edit.textBodyEditText(text).length),
});
const shapeFragment = (xml, name) => {
  const at = xml.indexOf(`name="${name}"`);
  const from = xml.lastIndexOf('<p:sp>', at);
  const to = xml.indexOf('</p:sp>', at);
  return from >= 0 && to >= 0 ? xml.slice(from, to + 7) : '';
};

/** 补丁与生成保存共用同一精确字符属性，第三方不应看到布尔降级值。 */
export async function runAdvancedRunFormatSaveContract({
  core, edit, generate, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 高级字符格式保留型与生成式保存\x1b[0m');
  const input = load('sample-editor-advanced-run-format.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'advanced-run-save-' });
  const editor = new edit.Editor(doc);
  const target = named(doc.elements, '高级字符格式直接值');
  const identity = named(doc.elements, '字段链接公式格式身份');
  const noHighlightSource = named(doc.elements, '全部下划线类型');
  const inheritedHighlightTarget = named(doc.elements, '高级格式版式继承');
  const targetRange = rangeOf(edit, target.src.text);
  const fieldRange = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 2 },
  };
  const props = {
    underline: 'dotDotDashHeavy', strikeType: 'sngStrike', highlight: '#F472B6',
    spacing: 4, caps: 'small', baseline: -22,
  };
  editor.exec({ type: 'SetRunProps', id: target.id, range: targetRange, props });
  editor.exec({ type: 'ClearFormat', id: identity.id, range: fieldRange });
  const noHighlightRange = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 },
  };
  editor.exec({
    type: 'ApplyFormat', from: noHighlightSource.id, to: inheritedHighlightTarget.id,
    mask: ['run'], fromRange: noHighlightRange, toRange: noHighlightRange,
  });
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('advanced-run-format-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const xml = decoder.decode(saved.package.parts['ppt/slides/slide1.xml']);
  const targetXml = shapeFragment(xml, target.src.name);
  const identityXml = shapeFragment(xml, identity.src.name);
  const noHighlightXml = shapeFragment(xml, inheritedHighlightTarget.src.name);
  check('补丁保存只改目标页并写出精确 DrawingML 字符属性',
    saved.rewrittenEntries === 1 && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml'
      && targetXml.includes('u="dotDotDashHeavy"')
      && targetXml.includes('strike="sngStrike"') && targetXml.includes('spc="300"')
      && targetXml.includes('cap="small"') && targetXml.includes('baseline="-22000"')
      && /<a:srgbClr\b[^>]*\bval="F472B6"\/>/.test(targetXml)
      && noHighlightXml.includes('<a:alpha val="0"/>'),
    targetXml.slice(targetXml.indexOf('<a:rPr'), targetXml.indexOf('</a:rPr>') + 8));
  check('清除字段格式删除视觉直设但保留字段与超链接关系',
    identityXml.includes('<a:fld ') && identityXml.includes('<a:hlinkClick r:id="rId2"/>')
      && !identityXml.slice(identityXml.indexOf('<a:fld '), identityXml.indexOf('</a:fld>'))
        .includes('u="dotDashHeavy"'));
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedTarget = reopened.slides[0].elements
    .find((element) => element.name === target.src.name).text.paragraphs[0].runs[0];
  const reopenedIdentity = reopened.slides[0].elements
    .find((element) => element.name === identity.src.name).text.paragraphs[0].runs;
  const reopenedNoHighlight = reopened.slides[0].elements
    .find((element) => element.name === inheritedHighlightTarget.src.name).text.paragraphs[0].runs[0];
  check('补丁保存重开保留高级有效值以及字段、链接和公式身份',
    reopenedTarget.underline === props.underline && reopenedTarget.strikeType === props.strikeType
      && reopenedTarget.highlight === 'rgb(244,114,182)' && reopenedTarget.spacing === 4
      && reopenedTarget.caps === 'small' && reopenedTarget.baseline === -22
      && reopenedIdentity.some((run) => run.field === 'datetime1'
        && run.link === 'https://example.com/advanced-format' && !run.u)
      && reopenedIdentity.some((run) => run.math?.length)
      && reopenedNoHighlight.highlight === 'rgba(0,0,0,0)');
  const scenario = {
    type: 'text', targetName: target.src.name, edits: [],
    formats: [{ targetName: target.src.name, range: targetRange, props }],
    formatPainters: [{
      fromName: noHighlightSource.src.name, toName: inheritedHighlightTarget.src.name,
      mask: ['run'], fromRange: noHighlightRange, toRange: noHighlightRange,
    }],
    clears: [{ targetName: identity.src.name, range: fieldRange }],
  };
  const projectedFingerprint = renderFingerprint(
    'sample-editor-advanced-run-format.pptx', 'projected', scenario,
  );
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const textMode of ['html', 'svg']) check(
    `高级字符格式 ${textMode} 独立进程投影与保存指纹一致`,
    projectedFingerprint[textMode] === savedFingerprint[textMode],
    JSON.stringify({ projected: projectedFingerprint[textMode], saved: savedFingerprint[textMode] }),
  );
  reopened.dispose?.();
  edit.disposeDoc(doc);

  const blank = await core.parse(generate.createBlankPptx(), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const generatedDoc = edit.createDoc(blank, { idPrefix: 'advanced-run-generated-' });
  const generatedEditor = new edit.Editor(generatedDoc);
  generatedEditor.exec({
    type: 'AddShape', slideId: generatedDoc.slideOrder[0], preset: 'rect',
    rect: { x: 90, y: 90, w: 700, h: 160 },
  });
  const generatedId = generatedEditor.selection.ids[0];
  generatedEditor.exec({
    type: 'EditText', id: generatedId,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: 'Generated Advanced',
    }],
  });
  const generatedRange = rangeOf(edit, generatedEditor.effectiveElement(generatedId).text);
  generatedEditor.exec({
    type: 'SetRunProps', id: generatedId, range: generatedRange,
    props: {
      underline: 'wavyDbl', strikeType: 'dblStrike', highlight: '#A7F3D0',
      spacing: 2, caps: 'all', baseline: 24,
    },
  });
  blank.dispose?.();
  const generated = generate.generateEditDoc(generatedDoc);
  saveArtifact('generated-advanced-run-format.pptx', generated.bytes);
  const generatedXml = decoder.decode(generated.package.parts['ppt/slides/slide1.xml']);
  const generatedReopened = await core.parse(generated.bytes, { lazy: false, assets: 'defer' });
  const generatedRun = generatedReopened.slides[0].elements
    .find((element) => element.name === generatedDoc.elements[generatedId].src.name)
    .text.paragraphs[0].runs[0];
  check('生成保存写出并重开全部高级字符属性',
    generatedXml.includes('u="wavyDbl"') && generatedXml.includes('strike="dblStrike"')
      && generatedXml.includes('spc="150"') && generatedXml.includes('cap="all"')
      && generatedXml.includes('baseline="24000"')
      && generatedRun.underline === 'wavyDbl' && generatedRun.strikeType === 'dblStrike'
      && generatedRun.highlight === 'rgb(167,243,208)' && generatedRun.spacing === 2
      && generatedRun.caps === 'all' && generatedRun.baseline === 24);
  generatedReopened.dispose?.();
  edit.disposeDoc(generatedDoc);
}
