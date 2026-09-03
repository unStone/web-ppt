import { unzipSync, zipSync } from 'fflate';
import { deck, slideXml } from './ooxml.mjs';

/** 高频对象/页面工具栏只依赖发布视图与 adapter，不接触内部 DOM 控制器。 */
export async function runCommonObjectSlideEditorContract({ lib, imageZip, load, check }) {
  console.log('\n\x1b[36m▸ 高频对象与页面公开编辑接口\x1b[0m');
  const source = load('sample-editor-common-commands.pptx');
  const session = await lib.openEditor(source, { idPrefix: 'common-editor-' });
  const sourceSlides = [...session.editor.doc.slideOrder];
  const sourceProjectedSections = session.toPresentation().sections;
  const mount = document.createElement('div');
  const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
  const byName = (name) => Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === name);
  const ids = ['common-left', 'common-middle-a', 'common-middle-b', 'common-right']
    .map((name) => byName(name).id);
  session.editor.select({ kind: 'elements', ids, enteredGroup: null });
  const history = session.editor.history.undoCount;
  check('SlideEditor 从当前选区执行原子分布命令',
    view.distributeElements('horizontal')
      && session.editor.history.undoCount === history + 1);
  const alt = byName('common-alt');
  session.editor.select({ kind: 'elements', ids: [alt.id], enteredGroup: null });
  check('SlideEditor 公开替代文字查询与编辑且支持隐式单选目标',
    view.queryAltText()?.title === '来源标题'
      && view.setAltText({ title: '视图标题', descr: '视图描述' })
      && view.queryAltText()?.descr === '视图描述');
  const sections = view.listSections();
  check('SlideEditor 公开节目录与四类节动作',
    view.renameSection(sections[0].id, '视图节')
      && view.moveSection(sections[1].id, null)
      && view.removeSection(sections[0].id)
      && !!view.addSection({
        name: '视图新节', slideIds: session.editor.doc.slideOrder.slice(0, 2),
        at: { after: sections[1].id },
      })
      && view.listSections().map((section) => section.name).join(',') === '结尾,视图新节');
  check('SlideEditor 页面尺寸接口同步舞台与交互层边界且不缩放元素',
    view.setSlideSize({ w: 1600, h: 900 })
      && view.querySlideSize().w === 1600
      && mount.querySelector('[data-ppt-stage]').style.width === '1600px'
      && mount.querySelector('[data-ppt-layer="interaction"]').getAttribute('viewBox') === '0 0 1600 900'
      && mount.querySelector('[data-ppt-layer="static"] svg').getAttribute('viewBox') === '0 0 1600 900');
  view.setMode('view');
  check('查看模式保留查询并拒绝全部公共写动作',
    view.querySlideSize().h === 900
      && view.setSlideSize({ w: 1280, h: 720 }) === false
      && view.setAltText({ title: null, descr: null }, alt.id) === false
      && view.distributeElements('vertical', ids) === false
      && view.renameSection(sections[1].id, '不应写入') === false);
  const added = session.editor.exec({
    type: 'AddSlide', layoutId: session.editor.doc.layoutOrder[0],
    at: { after: sourceSlides[0] },
  });
  const addedSlide = [...added.createdSlides][0];
  session.editor.exec({ type: 'MoveSlide', id: addedSlide, at: { after: sourceSlides[2] } });
  session.editor.exec({ type: 'RemoveSlide', id: sourceSlides[1] });
  const projectedSections = session.toPresentation().sections;
  const createdPresentationId = session.editor.doc.slides[addedSlide].creation?.presentationSlideId;
  check('当前 Presentation 投影在新增、移动与删除页后保留节的数值身份和现行页序',
    JSON.stringify(sourceProjectedSections?.map((section) => section.slideIds))
      === JSON.stringify([[701, 702], [703]])
      && JSON.stringify(projectedSections?.map((section) => section.slideIds))
        === JSON.stringify([[703], [701, createdPresentationId]])
      && JSON.stringify(projectedSections?.map((section) => section.slideIndexes))
        === JSON.stringify([[1], [0, 2]]));
  session.dispose();

  const legacy = await lib.openEditor(load('sample.ppt'), { idPrefix: 'common-ppt-projection-' });
  const legacySlides = [...legacy.editor.doc.slideOrder];
  const recoveryFrames = [];
  const stopRecovery = legacy.editor.subscribeRecovery((frame) => {
    recoveryFrames.push(structuredClone(frame));
  });
  legacy.editor.exec({
    type: 'AddSection', name: '旧格式投影节', slideIds: legacySlides, at: { after: null },
  });
  const legacyProjection = legacy.toPresentation();
  const legacyAgain = legacy.toPresentation();
  const legacyIds = legacyProjection.sections?.[0]?.slideIds ?? [];
  const sectionIdentity = (target, projection) => {
    const section = target.editor.doc.sections.records[target.editor.doc.sections.order[0]];
    return new Map(section.slideIds.map((slideId, index) => [
      slideId, projection.sections?.[0]?.slideIds[index],
    ]));
  };
  const initialIdentity = sectionIdentity(legacy, legacyProjection);
  legacy.editor.exec({ type: 'MoveSlide', id: legacySlides[1], at: { after: null } });
  const movedProjection = legacy.toPresentation();
  const movedIdentity = sectionIdentity(legacy, movedProjection);
  const movedRecovered = await lib.openEditor(load('sample.ppt'), {
    idPrefix: 'common-ppt-projection-', recoveryFrames: structuredClone(recoveryFrames),
  });
  const movedRecoveredIdentity = sectionIdentity(movedRecovered, movedRecovered.toPresentation());
  legacy.editor.exec({ type: 'RemoveSlide', id: legacySlides[0] });
  const deletedIdentity = sectionIdentity(legacy, legacy.toPresentation());
  const deletedRecovered = await lib.openEditor(load('sample.ppt'), {
    idPrefix: 'common-ppt-projection-', recoveryFrames: structuredClone(recoveryFrames),
  });
  const deletedRecoveredIdentity = sectionIdentity(
    deletedRecovered, deletedRecovered.toPresentation(),
  );
  const emptyZip = await imageZip.presentationToImageZip({
    ...legacyProjection,
    slides: legacyProjection.slides.map((slide) => ({ ...slide, hidden: true })),
  }, { skipHidden: true });
  const emptyZipBytes = new Uint8Array(await emptyZip.arrayBuffer());
  check('.ppt 新增节可稳定投影唯一数值身份并继续进入图片 ZIP 边界',
    legacyIds.length === legacySlides.length && new Set(legacyIds).size === legacyIds.length
      && JSON.stringify(legacyAgain.sections?.[0]?.slideIds) === JSON.stringify(legacyIds)
      && JSON.stringify(legacyProjection.sections?.[0]?.slideIndexes) === JSON.stringify([0, 1])
      && legacySlides.every((id) => movedIdentity.get(id) === initialIdentity.get(id)
        && movedRecoveredIdentity.get(id) === initialIdentity.get(id))
      && deletedIdentity.get(legacySlides[1]) === initialIdentity.get(legacySlides[1])
      && deletedRecoveredIdentity.get(legacySlides[1]) === initialIdentity.get(legacySlides[1])
      && emptyZipBytes[0] === 0x50 && emptyZipBytes[1] === 0x4b);
  stopRecovery();
  movedRecovered.dispose();
  deletedRecovered.dispose();
  legacy.dispose();

  const sourceDeckParts = unzipSync(deck({
    name: '210 source slides', width: 1280, height: 720,
    slides: Array.from({ length: 210 }, () => slideXml('')),
  }));
  const presentationPart = 'ppt/presentation.xml';
  const sourceDeckXml = new TextDecoder().decode(sourceDeckParts[presentationPart]);
  if (!sourceDeckXml.includes('<p:sldId id="257"')
    || !sourceDeckXml.includes('<p:sldId id="465"')) {
    throw new Error('来源页身份碰撞测试缺少预期页身份');
  }
  const collisionDeckXml = sourceDeckXml
    .replace('<p:sldId id="257"', '<p:sldId id="256"')
    .replace('<p:sldId id="465"', '<p:sldId id="2147483647"');
  sourceDeckParts[presentationPart] = new TextEncoder().encode(collisionDeckXml);
  const large = await lib.openEditor(zipSync(sourceDeckParts, { level: 0 }), {
    idPrefix: 'common-large-section-',
  });
  large.editor.exec({
    type: 'AddSection', name: '210 页节', slideIds: [...large.editor.doc.slideOrder], at: { after: null },
  });
  large.toPresentation();
  const samples = Array.from({ length: 8 }, () => {
    const started = performance.now();
    const projection = large.toPresentation();
    return { elapsed: performance.now() - started, projection };
  });
  const p95 = [...samples].sort((left, right) => left.elapsed - right.elapsed)[6].elapsed;
  const largeSection = samples.at(-1).projection.sections?.[0];
  check('210 个来源 part 只解析一次，重复及高位身份碰撞仍投影为唯一身份',
    largeSection?.slideIds.length === 210 && new Set(largeSection.slideIds).size === 210
      && largeSection.slideIds[0] === 256
      && largeSection.slideIds[1] === 2147483646
      && largeSection.slideIds[209] === 2147483647
      && largeSection.slideIndexes?.length === 210
      && large.editor.doc.slideOrder.every((id) => large.editor.doc.slides[id].origin
        && !large.editor.doc.slides[id].creation)
      && p95 < 16,
    `p95=${p95.toFixed(3)}ms`);
  console.log(`  210 页 section 当前投影 p95 ${p95.toFixed(3)}ms`);
  large.dispose();

  const headless = await lib.openEditor(source, { idPrefix: 'common-adapter-' });
  const adapter = lib.createWebPptAdapter();
  await adapter.setDocument({ session: headless, ownership: 'external' });
  adapter.setView({ mode: 'edit' });
  const target = Object.values(headless.editor.doc.elements)
    .find((record) => record.src.name === 'common-alt');
  headless.editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
  const adapterSections = adapter.listSections();
  check('无 DOM adapter 同样公开替代文字、节与页面尺寸工具栏 seam',
    adapter.queryAltText()?.title === '来源标题'
      && adapter.setAltText({ title: '适配器标题', descr: '适配器描述' })
      && adapter.renameSection(adapterSections[0].id, '适配器节')
      && adapter.setSlideSize({ w: 1366, h: 768 })
      && adapter.querySlideSize().w === 1366
      && adapter.listSections()[0].name === '适配器节');
  adapter.setView({ mode: 'view' });
  check('adapter 查看模式权限边界与挂载视图一致',
    adapter.setAltText({ title: null, descr: null }, target.id) === false
      && adapter.removeSection(adapterSections[0].id) === false
      && adapter.setSlideSize({ w: null, h: null }) === false);
  adapter.dispose();
  headless.dispose();
}
