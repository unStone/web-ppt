/** 高频对象/页面工具栏只依赖发布视图与 adapter，不接触内部 DOM 控制器。 */
export async function runCommonObjectSlideEditorContract({ lib, load, check }) {
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
