/** 真实 Chrome 从按需模板入口验证设计来源传播与普通页增量 DOM 是同一条产品链。 */
export async function runV07IntegrationBrowserContract({
  openEditor, createDesignEditor, templates,
}) {
  let checked = 0;
  for (const template of templates.listBuiltinTemplates()) {
    const designMount = document.createElement('div');
    const contentMount = document.createElement('div');
    const blankMount = document.createElement('div');
    for (const mount of [designMount, contentMount, blankMount]) {
      mount.className = 'contract-offscreen';
    }
    document.body.append(designMount, contentMount, blankMount);
    const session = await openEditor(templates.createPptxFromTemplate(template.id), {
      idPrefix: `browser-v07-${template.id}-`, historyLimit: 100,
    });
    let design = null;
    try {
      const doc = session.editor.doc;
      const contentLayout = doc.layoutOrder.find((id) => doc.layouts[id].name === '标题和内容');
      const blankLayout = doc.layoutOrder.find((id) => doc.layouts[id].name === '空白');
      const contentSlide = [...session.editor.exec({
        type: 'AddSlide', layoutId: contentLayout, at: { after: doc.slideOrder[0] },
      }).createdSlides][0];
      const blankSlide = [...session.editor.exec({
        type: 'AddSlide', layoutId: blankLayout, at: { after: contentSlide },
      }).createdSlides][0];
      session.mount(contentMount, {
        slideId: contentSlide, mode: 'edit', textMode: 'svg', snapping: false,
      });
      session.mount(blankMount, {
        slideId: blankSlide, mode: 'edit', textMode: 'svg', snapping: false,
      });
      design = createDesignEditor(designMount, session, {
        target: { kind: 'layout', id: contentLayout }, textMode: 'svg',
      });
      const contentStatic = contentMount.querySelector('[data-ppt-layer="static"]');
      const blankStatic = blankMount.querySelector('[data-ppt-layer="static"]');
      const contentBefore = contentStatic.querySelector('svg');
      const blankBefore = blankStatic.querySelector('svg');
      const designBefore = designMount.querySelector('svg');
      design.exec({
        type: 'AddShape', target: { kind: 'layout', id: contentLayout }, preset: 'roundRect',
        rect: { x: 940, y: 610, w: 220, h: 54 },
      });
      if (contentStatic.querySelector('svg') === contentBefore
        || blankStatic.querySelector('svg') !== blankBefore
        || designMount.querySelector('svg') === designBefore) {
        throw new Error(`${template.name}版式编辑没有只重绘依赖页`);
      }

      const title = doc.slides[contentSlide].children.map((id) => doc.elements[id])
        .find((record) => record.meta.ph?.type === 'title');
      const body = doc.slides[contentSlide].children.map((id) => doc.elements[id])
        .find((record) => record.meta.ph?.type === 'body');
      const contentAfterLayout = contentStatic.querySelector('svg');
      const titleBefore = contentStatic.querySelector(`[data-edit-id="${title.id}"]`);
      const bodyBefore = contentStatic.querySelector(`[data-edit-id="${body.id}"]`);
      session.editor.exec({
        type: 'SetFill', id: title.id, fill: { type: 'solid', color: '#F04A71' },
      });
      const titleAfter = contentStatic.querySelector(`[data-edit-id="${title.id}"]`);
      const directChecks = {
        slide: contentStatic.querySelector('svg') === contentAfterLayout,
        target: titleAfter !== titleBefore,
        sibling: contentStatic.querySelector(`[data-edit-id="${body.id}"]`) === bodyBefore,
        unrelated: blankStatic.querySelector('svg') === blankBefore,
        fill: session.editor.effectiveElement(title.id).fill?.color === 'rgb(240,74,113)',
      };
      if (Object.values(directChecks).some((value) => !value)) {
        throw new Error(`${template.name}普通页直接编辑没有保持兄弟与无关页 DOM 身份：`
          + JSON.stringify(directChecks));
      }

      const master = doc.masterOrder[0];
      design.setTarget({ kind: 'master', id: master });
      const contentBeforeMaster = contentStatic.querySelector('svg');
      const blankBeforeMaster = blankStatic.querySelector('svg');
      design.exec({
        type: 'SetBackground', target: { kind: 'master', id: master },
        fill: { type: 'solid', color: '#122033' },
      });
      if (contentStatic.querySelector('svg') === contentBeforeMaster
        || blankStatic.querySelector('svg') === blankBeforeMaster
        || session.editor.toSlide(contentSlide).background?.color !== 'rgb(18,32,51)'
        || session.editor.toSlide(blankSlide).background?.color !== 'rgb(18,32,51)') {
        throw new Error(`${template.name}母版编辑没有传播到直属版式页面`);
      }

      const contentBeforeTheme = contentStatic.querySelector('svg');
      const blankBeforeTheme = blankStatic.querySelector('svg');
      session.editor.exec({
        type: 'SetTheme', id: doc.themeOrder[0], clrScheme: { accent1: '#2468AC' },
      });
      if (contentStatic.querySelector('svg') === contentBeforeTheme
        || blankStatic.querySelector('svg') === blankBeforeTheme
        || session.editor.effectiveElement(title.id).fill?.color !== 'rgb(240,74,113)') {
        throw new Error(`${template.name}主题传播覆盖了页面直接格式`);
      }
      checked++;
    } finally {
      design?.destroy();
      session.dispose();
      designMount.remove();
      contentMount.remove();
      blankMount.remove();
    }
  }
  return { templates: checked };
}
