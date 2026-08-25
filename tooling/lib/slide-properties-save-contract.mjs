import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();

function applyScenario(editor, doc, scenario) {
  const [inherited, solid, hidden, pattern] = doc.slideOrder;
  editor.exec({ type: 'SetBackground', id: inherited, fill: scenario.backgrounds[0] });
  editor.exec({ type: 'SetBackground', id: solid, fill: scenario.backgrounds[1] });
  editor.exec(
    { type: 'SetBackground', id: hidden, fill: { type: 'none' } },
    { type: 'SetHidden', id: hidden, v: false },
  );
  editor.exec({ type: 'SetHidden', id: pattern, v: true });
  const duplicated = [...editor.exec({ type: 'DuplicateSlide', id: hidden }).createdSlides][0];
  const added = [...editor.exec({
    type: 'AddSlide', layoutId: doc.layoutOrder[0], at: { after: doc.slideOrder.at(-1) },
  }).createdSlides][0];
  editor.exec(
    { type: 'SetBackground', id: added, fill: scenario.backgrounds[2] },
    { type: 'SetHidden', id: added, v: true },
  );
  return { duplicated, added };
}

/** 页面属性从首次 XML 基线重建；复制/新增页面也必须物化同一有效状态。 */
export async function runSlidePropertiesSaveContract({
  edit, core, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 页面背景与隐藏状态保留型保存\x1b[0m');
  const input = load('sample-editor-slide-properties.pptx');

  const minimalPres = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const minimalDoc = edit.createDoc(minimalPres, { idPrefix: 'slide-properties-minimal-' });
  const minimalEditor = new edit.Editor(minimalDoc);
  const [first, , hidden, , , themeRef] = minimalDoc.slideOrder;
  minimalEditor.exec({ type: 'SetBackground', id: first, fill: { type: 'solid', color: '#334155' } });
  minimalEditor.exec({ type: 'SetHidden', id: hidden, v: false });
  minimalEditor.exec({
    type: 'SetBackground', id: themeRef,
    fill: structuredClone(minimalDoc.slides[themeRef].src.background),
  });
  minimalEditor.exec({ type: 'SetHidden', id: themeRef, v: false });
  const minimal = await minimalEditor.saveDetailed();
  const minimalDiff = diffPackageBytes(input, minimal.bytes);
  check('普通页面属性只修改目标 slide part',
    minimalDiff.added.length === 0 && minimalDiff.removed.length === 0
      && minimalDiff.changed.join(',')
        === 'ppt/slides/slide1.xml,ppt/slides/slide3.xml,ppt/slides/slide6.xml',
  `changed=${minimalDiff.changed}`);
  const materialized = decoder.decode(minimal.package.parts['ppt/slides/slide6.xml']);
  check('与来源同值的直接背景和可见值仍物化并替换来源 choice',
    materialized.includes('fixture:slot="theme-ref"')
      && materialized.includes('<a:solidFill><a:srgbClr val="70AD47"/></a:solidFill>')
      && !materialized.includes('<p:bgRef') && !/<p:sld[^>]*\bshow=/.test(materialized));
  minimalEditor.exec({ type: 'SetBackground', id: first, fill: null });
  minimalEditor.exec({ type: 'SetHidden', id: hidden, v: null });
  minimalEditor.exec({ type: 'SetBackground', id: themeRef, fill: null });
  minimalEditor.exec({ type: 'SetHidden', id: themeRef, v: null });
  const reset = await minimalEditor.saveDetailed();
  check('连续保存后恢复来源仍从首次基线重建原包', diffPackageBytes(input, reset.bytes).equal);
  edit.disposeDoc(minimalDoc);

  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'slide-properties-save-' });
  const editor = new edit.Editor(doc);
  const scenario = Object.freeze({
    type: 'slideProperties', file: 'sample-editor-slide-properties.pptx',
    backgrounds: [
      {
        type: 'gradient', angle: 135, stops: [
          { pos: 0, color: '#DBEAFE' }, { pos: 0.5, color: 'rgba(59,130,246,0.55)' },
          { pos: 1, color: '#1E3A8A' },
        ],
      },
      { type: 'pattern', preset: 'trellis', fg: '#052E16', bg: '#DCFCE7' },
      { type: 'solid', color: '#FDE68A' },
    ],
  });
  applyScenario(editor, doc, scenario);
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('slide-properties.pptx', saved.bytes);
  const slide1 = decoder.decode(saved.package.parts['ppt/slides/slide1.xml']);
  const slide2 = decoder.decode(saved.package.parts['ppt/slides/slide2.xml']);
  const slide3 = decoder.decode(saved.package.parts['ppt/slides/slide3.xml']);
  const slide4 = decoder.decode(saved.package.parts['ppt/slides/slide4.xml']);
  check('背景按 schema 写入并保留来源未知属性与扩展',
    slide1.indexOf('<p:bg>') < slide1.indexOf('<p:spTree>')
      && slide1.includes('<a:gradFill rotWithShape="1">')
      && slide1.includes('<a:alpha val="55000"/>')
      && slide2.includes('fixture:slot="solid"') && slide2.includes('fixture:keep="solid"')
      && slide2.includes('<fixture:keep value="solid-extension"/>')
      && slide2.includes('<a:pattFill prst="trellis">')
      && slide3.includes('fixture:slot="gradient"') && slide3.includes('fixture:keep="gradient"')
      && slide3.includes('<fixture:keep value="gradient-extension"/>')
      && slide3.includes('<a:noFill/>'));
  check('隐藏写回使用 show=0，显式可见移除来源属性',
    !/<p:sld[^>]*\bshow=/.test(slide3) && /<p:sld[^>]*\bshow="0"/.test(slide4));

  const reopened = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const expectedKinds = ['gradient', 'pattern', 'none', 'none', 'pattern', 'none', 'solid', 'solid'];
  check('保存重开后原页、复制页与新增页保持有效背景和隐藏状态',
    reopened.slides.length === 8
      && reopened.slides.every((slide, index) => slide.background?.type === expectedKinds[index])
      && JSON.stringify(reopened.slides.map((slide) => !!slide.hidden))
        === JSON.stringify([false, false, false, false, true, false, false, true])
      && reopened.slides[6].background?.type === 'solid'
      && reopened.slides[6].background.color === 'rgb(112,173,71)');
  const identity = await editor.saveDetailed();
  check('页面属性连续保存进入包 identity', identity.mode === 'identity' && identity.bytes === saved.bytes);

  let fingerprintsEqual = true;
  for (let resultSlideIndex = 0; resultSlideIndex < 8; resultSlideIndex++) {
    const proof = { ...scenario, resultSlideIndex };
    fingerprintsEqual = fingerprintsEqual
      && JSON.stringify(renderFingerprint(scenario.file, 'projected', proof))
        === JSON.stringify(renderFingerprint(artifact, 'saved', proof));
  }
  check('八页编辑投影与保存重开在两条文本渲染路径逐字节等价', fingerprintsEqual);
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
