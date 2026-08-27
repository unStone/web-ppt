import { diffPackageBytes } from '../diff-package.mjs';
import { unzipSync, zipSync } from 'fflate';

const decoder = new TextDecoder();
const TYPES = [
  'none', 'fade', 'cut', 'push', 'pull', 'cover', 'wipe', 'split', 'zoom', 'dissolve',
  'checker', 'blinds', 'comb', 'wheel', 'circle', 'diamond', 'plus', 'wedge', 'newsflash',
  'randomBar', 'strips', 'vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'glitter',
  'warp', 'flythrough', 'flash', 'shred', 'reveal', 'wheelReverse', 'ferris', 'gallery',
  'conveyor', 'pan', 'doors', 'window', 'prism', 'morph',
];
const P14 = new Set(TYPES.slice(21, 40));
const DEFAULT_DIR = Object.freeze({
  push: 'l', pull: 'l', cover: 'l', wipe: 'l', split: 'horz-out', zoom: 'out',
  checker: 'horz', blinds: 'horz', comb: 'horz', randomBar: 'horz', strips: 'lu',
  vortex: 'l', switch: 'l', flip: 'l', ripple: 'center', glitter: 'l', warp: 'out',
  flythrough: 'in', shred: 'in', reveal: 'l', ferris: 'l', gallery: 'l',
  conveyor: 'l', pan: 'l', doors: 'horz', window: 'horz', prism: 'l',
});
const value = (type, index) => ({
  type,
  ...(type === 'none' ? {} : { durationMs: 900 + index * 13 }),
  ...(['push', 'pull', 'cover', 'wipe', 'glitter', 'reveal'].includes(type) ? { dir: 'l' } : {}),
  ...(type === 'split' ? { dir: 'horz-out' } : {}),
  ...(!['none', 'push', 'pull', 'cover', 'wipe', 'glitter', 'reveal', 'split'].includes(type)
    && DEFAULT_DIR[type] ? { dir: DEFAULT_DIR[type] } : {}),
  ...(type === 'morph' ? { morphBy: 'byChar' } : {}),
  ...(index === 2 ? { advanceAfterMs: 2800 } : {}),
});

/** 从首次基线重建标准、p14 与 morph，并用重解析验证公开 Schema。 */
export async function runTransitionSaveContract({ edit, core, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 页面切换保留型保存\x1b[0m');
  const input = load('sample-editor-transitions.pptx');
  const prefixedParts = unzipSync(input.slice());
  const prefixedPart = 'ppt/slides/slide1.xml';
  prefixedParts[prefixedPart] = new TextEncoder().encode(
    decoder.decode(prefixedParts[prefixedPart])
      .replace(
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
        'xmlns:q="http://schemas.openxmlformats.org/presentationml/2006/main"',
      )
      .replace(/(<\/?)(?:p):/g, '$1q:'),
  );
  const prefixedPresentation = await core.parse(zipSync(prefixedParts, { level: 0 }), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const prefixedDoc = edit.createDoc(prefixedPresentation, { idPrefix: 'transition-prefix-' });
  const prefixedEditor = new edit.Editor(prefixedDoc);
  prefixedEditor.exec({
    type: 'SetTransition', id: prefixedDoc.slideOrder[0],
    t: { type: 'fade', durationMs: 930 },
  });
  const prefixedSave = await prefixedEditor.saveDetailed();
  const prefixedXml = decoder.decode(prefixedSave.package.parts[prefixedPart]);
  const prefixedReopen = await core.parse(prefixedSave.bytes, { lazy: false, assets: 'defer' });
  check('保存按展开名沿用非标准 p 前缀且产物可重开',
    prefixedXml.includes('<q:sld') && prefixedXml.includes('<p:transition')
      && prefixedXml.includes('xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
      && prefixedXml.includes('<mc:AlternateContent')
      && prefixedReopen.slides[0].transition?.type === 'fade'
      && prefixedReopen.slides[0].transition?.durationMs === 930);
  edit.disposeDoc(prefixedDoc);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'transition-save-' });
  const editor = new edit.Editor(doc);
  for (let index = 0; index < doc.slideOrder.length; index++) {
    const type = TYPES[(index + 7) % TYPES.length];
    editor.exec({ type: 'SetTransition', id: doc.slideOrder[index], t: value(type, index) });
  }
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('slide-transitions.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('切换编辑只修改 41 个目标 slide part', diff.added.length === 0 && diff.removed.length === 0
    && diff.changed.length === 41 && diff.changed.every((part) => /^ppt\/slides\/slide\d+\.xml$/.test(part)),
  `changed=${diff.changed.length}`);

  let markupOk = true;
  for (let index = 0; index < doc.slideOrder.length; index++) {
    const type = TYPES[(index + 7) % TYPES.length];
    const xml = decoder.decode(saved.package.parts[`ppt/slides/slide${index + 1}.xml`]);
    const transitionAt = xml.search(/<p:transition\b|<mc:AlternateContent\b/);
    const colorMapAt = xml.indexOf('<p:clrMapOvr');
    const timingAt = xml.indexOf('<p:timing');
    if (type === 'none') markupOk &&= !/<(?:p|p14|p159):(fade|cut|push|pull|cover|wipe|split|zoom|dissolve|checker|blinds|comb|wheel|circle|diamond|plus|wedge|newsflash|randomBar|strips|vortex|switch|flip|ripple|honeycomb|glitter|warp|flythrough|flash|shred|reveal|wheelReverse|ferris|gallery|conveyor|pan|doors|window|prism|morph)\b/.test(xml);
    else if (P14.has(type)) markupOk &&= xml.includes('Requires="p14"')
      && xml.includes(`<p14:${type}`) && xml.includes('<mc:Fallback');
    else if (type === 'morph') markupOk &&= xml.includes('Requires="p159"')
      && xml.includes('<p159:morph option="byChar"/>') && xml.includes('<mc:Fallback');
    else markupOk &&= xml.includes('Requires="p14"') && xml.includes(`<p:${type}`)
      && xml.includes('<mc:Fallback');
    if (type !== 'none') markupOk &&= xml.includes(`p14:dur="${900 + index * 13}"`)
      && !xml.match(/<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/)?.[1].includes('p14:dur')
      && (colorMapAt < 0 || colorMapAt < transitionAt)
      && (timingAt < 0 || transitionAt < timingAt);
    if (index === 2) markupOk &&= xml.includes('advTm="2800"');
  }
  const preserved = decoder.decode(saved.package.parts['ppt/slides/slide2.xml']);
  check('标准、扩展、morph、精确时长和自动换片均按 schema 写回', markupOk);
  check('来源 timing、根未知属性和无关 AlternateContent 保持',
    preserved.includes('fixture:keep="root"') && preserved.includes('fixture:keep="timing"')
      && preserved.includes('<fixture:transition><fixture:cut/></fixture:transition>')
      && preserved.includes('{TRANSITION-KEEP}'));

  const reopened = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  check('保存重开后 41 页有效切换逐字段一致', reopened.slides.every((slide, index) => {
    const expected = value(TYPES[(index + 7) % TYPES.length], index);
    const actual = slide.transition ?? { type: 'none' };
    return actual.type === expected.type
      && (expected.type === 'none' || actual.durationMs === expected.durationMs)
      && actual.dir === expected.dir && actual.advanceAfterMs === expected.advanceAfterMs
      && actual.morphBy === expected.morphBy;
  }));
  const identity = await editor.saveDetailed();
  check('相同模型连续保存复用当前包 identity', identity.mode === 'identity' && identity.bytes === saved.bytes);

  for (const id of doc.slideOrder) editor.exec({ type: 'SetTransition', id, t: null });
  const reset = await editor.saveDetailed();
  check('连续保存后恢复来源仍从首次基线逐字节重建原包', diffPackageBytes(input, reset.bytes).equal);

  const preservePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const preserveDoc = edit.createDoc(preservePresentation, { idPrefix: 'transition-preserve-' });
  const preserveEditor = new edit.Editor(preserveDoc);
  const preserveFade = preserveDoc.slideOrder[1];
  const preserveTimed = preserveDoc.slideOrder[2];
  const preserveRandom = preserveDoc.slideOrder[9];
  const preserveVortex = preserveDoc.slideOrder[21];
  const preserveGlitter = preserveDoc.slideOrder[26];
  preserveEditor.exec({
    type: 'SetTransition', id: preserveFade, t: { type: 'fade', durationMs: 1250 },
  });
  preserveEditor.exec({
    type: 'SetTransition', id: preserveTimed, t: { type: 'none' },
  });
  preserveEditor.exec({
    type: 'SetTransition', id: preserveRandom, t: { type: 'dissolve', durationMs: 1260 },
  });
  preserveEditor.exec({
    type: 'SetTransition', id: preserveVortex,
    t: { type: 'vortex', dir: 'r', durationMs: 1265 },
  });
  preserveEditor.exec({
    type: 'SetTransition', id: preserveGlitter,
    t: { type: 'glitter', dir: 'r', durationMs: 1270 },
  });
  const preservedSave = await preserveEditor.saveDetailed();
  const preservedXml = decoder.decode(preservedSave.package.parts['ppt/slides/slide2.xml']);
  const timedXml = decoder.decode(preservedSave.package.parts['ppt/slides/slide3.xml']);
  const randomXml = decoder.decode(preservedSave.package.parts['ppt/slides/slide10.xml']);
  const mceXml = decoder.decode(preservedSave.package.parts['ppt/slides/slide22.xml']);
  const glitterXml = decoder.decode(preservedSave.package.parts['ppt/slides/slide27.xml']);
  check('未开放的点击策略、声音、扩展属性与同效果属性原样保留',
    preservedXml.includes('advClick="0"') && preservedXml.includes('fixture:transition="keep"')
      && preservedXml.includes('<p:fadeThroughBlack') && preservedXml.includes('fixture:effect="keep"')
      && preservedXml.includes('fixture:dur="4999"')
      && preservedXml.includes('<fixture:fade fixture:child="keep"/>')
      && preservedXml.includes('<p:sndAc><p:endSnd/></p:sndAc>'));
  check('关闭视觉效果仍保留不可点击页面的自动换片，模型与重开不反弹',
    edit.querySlideTransition(preserveDoc, [preserveTimed]).value?.advanceAfterMs === 2400
      && timedXml.includes('advClick="0"') && timedXml.includes('advTm="2400"')
      && !/<p:(?:cut|fade|push|pull|cover|wipe)\b/.test(timedXml));
  check('同义标准效果与扩展效果的未开放属性不会被规范化抹除',
    randomXml.includes('<p:random') && randomXml.includes('fixture:alias="keep"')
      && /<p14:glitter\b[^>]*\bpattern="hexagon"[^>]*\bdir="r"/.test(glitterXml));
  const firstChoiceAt = mceXml.indexOf('<mc:Choice');
  const futureChoiceAt = mceXml.indexOf('Requires="p200"');
  check('MCE 在原分支局部更新并让新分支优先于未来版本旧效果',
    firstChoiceAt >= 0 && futureChoiceAt > firstChoiceAt
      && /<p14:vortex\b[^>]*\bdir="r"/.test(mceXml)
      && mceXml.includes('fixture:carrier="keep"') && mceXml.includes('fixture:branch="keep"')
      && mceXml.includes('<fixture:keep xmlns:fixture="urn:web-ppt:transition-fixture" value="choice"/>'));
  edit.disposeDoc(preserveDoc);

  const payloadPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const payloadDoc = edit.createDoc(payloadPresentation, { idPrefix: 'transition-none-payload-' });
  const payloadEditor = new edit.Editor(payloadDoc);
  payloadEditor.exec({
    type: 'SetTransition', id: payloadDoc.slideOrder[21], t: { type: 'none' },
  });
  const payloadSave = await payloadEditor.saveDetailed();
  const payloadXml = decoder.decode(payloadSave.package.parts['ppt/slides/slide22.xml']);
  const payloadReopen = await core.parse(payloadSave.bytes, { lazy: false, assets: 'defer' });
  check('none 删除干净效果，但保留 MCE 载体、分支属性与相邻 ignorable 节点',
    payloadXml.includes('fixture:carrier="keep"') && payloadXml.includes('fixture:branch="keep"')
      && payloadXml.includes('<fixture:keep') && payloadReopen.slides[21].transition?.type === 'none');
  edit.disposeDoc(payloadDoc);

  const operationsPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const operationsDoc = edit.createDoc(operationsPresentation, { idPrefix: 'transition-pages-' });
  const operationsEditor = new edit.Editor(operationsDoc);
  const anchor = operationsDoc.slideOrder[1];
  const duplicate = operationsEditor.exec({ type: 'DuplicateSlide', id: anchor });
  const duplicateId = [...duplicate.createdSlides][0];
  const add = operationsEditor.exec({
    type: 'AddSlide', layoutId: operationsDoc.layoutOrder[0], at: { after: duplicateId },
  });
  const addedId = [...add.createdSlides][0];
  operationsEditor.exec({
    type: 'SetTransition', id: duplicateId,
    t: { type: 'ripple', dir: 'center', durationMs: 1050 },
  });
  operationsEditor.exec({
    type: 'SetTransition', id: addedId,
    t: { type: 'pull', dir: 'lu', durationMs: 1150 },
  });
  const operationsSave = await operationsEditor.saveDetailed();
  const operationsReopen = await core.parse(operationsSave.bytes, { lazy: false, assets: 'defer' });
  const duplicateIndex = operationsDoc.slideOrder.indexOf(duplicateId);
  const addedIndex = operationsDoc.slideOrder.indexOf(addedId);
  check('新增页与复制页的切换保存重开逐字段一致',
    operationsReopen.slides[duplicateIndex].transition?.type === 'ripple'
      && operationsReopen.slides[duplicateIndex].transition?.dir === 'center'
      && operationsReopen.slides[duplicateIndex].transition?.durationMs === 1050
      && operationsReopen.slides[addedIndex].transition?.type === 'pull'
      && operationsReopen.slides[addedIndex].transition?.dir === 'lu'
      && operationsReopen.slides[addedIndex].transition?.durationMs === 1150);
  edit.disposeDoc(operationsDoc);

  const layoutInput = load('sample-editor-change-layout.pptx');
  const defaultSpeedParts = unzipSync(layoutInput.slice());
  defaultSpeedParts['ppt/slides/slide7.xml'] = new TextEncoder().encode(
    decoder.decode(defaultSpeedParts['ppt/slides/slide7.xml']).replace(' spd="slow"', ''),
  );
  const defaultSpeedPresentation = await core.parse(zipSync(defaultSpeedParts, { level: 0 }), {
    lazy: false, assets: 'defer',
  });
  check('OOXML 来源省略 spd 时按标准 fast=500ms 解析',
    defaultSpeedPresentation.slides[0].transition?.durationMs === 500);
  const layoutPresentation = await core.parse(layoutInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const layoutDoc = edit.createDoc(layoutPresentation, { idPrefix: 'transition-layout-' });
  const layoutEditor = new edit.Editor(layoutDoc);
  const layoutSlide = layoutDoc.slideOrder[0];
  const targetLayout = layoutDoc.layoutOrder.find((id) => id !== layoutDoc.slides[layoutSlide].layoutId);
  layoutEditor.exec({ type: 'SetLayout', id: layoutSlide, layoutId: targetLayout });
  const layoutExpected = edit.querySlideTransition(layoutDoc, [layoutSlide]);
  const layoutSave = await layoutEditor.saveDetailed();
  const layoutReopen = await core.parse(layoutSave.bytes, { lazy: false, assets: 'defer' });
  check('换版式后的来源查询与保存重开切换一致',
    layoutExpected.value?.type === layoutExpected.source?.type
      && layoutExpected.value?.durationMs === layoutExpected.source?.durationMs
      && layoutExpected.value?.type === layoutEditor.toSlide(layoutSlide).transition?.type
      && layoutReopen.slides[0].transition?.type === layoutExpected.value?.type
      && layoutReopen.slides[0].transition?.durationMs === layoutExpected.value?.durationMs);
  check('页面直设切换换版式后仍优先于版式来源', layoutExpected.source?.type === 'fade');
  edit.disposeDoc(layoutDoc);

  const inheritedParts = unzipSync(layoutInput.slice());
  const inheritedPart = 'ppt/slides/slide7.xml';
  inheritedParts[inheritedPart] = new TextEncoder().encode(
    decoder.decode(inheritedParts[inheritedPart])
      .replace('<p:transition spd="slow"><p:fade/></p:transition>', ''),
  );
  const inheritedPresentation = await core.parse(zipSync(inheritedParts, { level: 0 }), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const inheritedDoc = edit.createDoc(inheritedPresentation, { idPrefix: 'transition-inherited-' });
  const inheritedEditor = new edit.Editor(inheritedDoc);
  const inheritedSlide = inheritedDoc.slideOrder[0];
  const inheritedTarget = inheritedDoc.layoutOrder.find((id) =>
    id !== inheritedDoc.slides[inheritedSlide].layoutId);
  inheritedEditor.exec({ type: 'SetLayout', id: inheritedSlide, layoutId: inheritedTarget });
  inheritedEditor.exec({ type: 'SetTransition', id: inheritedSlide, t: { type: 'none' } });
  const noneExpected = edit.querySlideTransition(inheritedDoc, [inheritedSlide]);
  const noneSave = await inheritedEditor.saveDetailed();
  saveArtifact('slide-transition-inherited-none.pptx', noneSave.bytes);
  const noneReopen = await core.parse(noneSave.bytes, { lazy: false, assets: 'defer' });
  const noneXml = decoder.decode(noneSave.package.parts[inheritedDoc.slides[inheritedSlide].origin.part]);
  check('继承版式切换的页面可显式关闭且保存重开不反弹',
    noneExpected.value?.type === 'none' && noneExpected.source?.type === 'push'
      && noneExpected.direct && inheritedEditor.toSlide(inheritedSlide).transition?.type === 'none'
      && /<p:transition\b[^>]*(?:\/>|><\/p:transition>)/.test(noneXml)
      && noneReopen.slides[0].transition?.type === 'none');
  edit.disposeDoc(inheritedDoc);
  check('保存产物可交给统一 Office 门禁', artifact.endsWith('slide-transitions.pptx'));
  edit.disposeDoc(doc);
}
