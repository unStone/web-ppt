/** 真实 Chrome 验证母版设计画布、直属多版式传播与无关页面 DOM 身份。 */
export async function runEditorMasterBrowserContract({ openEditor, createDesignEditor, load }) {
  const designMount = document.createElement('div');
  const firstMount = document.createElement('div');
  const secondMount = document.createElement('div');
  const otherMount = document.createElement('div');
  for (const node of [designMount, firstMount, secondMount, otherMount]) {
    node.className = 'contract-offscreen';
  }
  document.body.append(designMount, firstMount, secondMount, otherMount);
  const session = await openEditor(await load('sample-editor-master-editing.pptx'), {
    idPrefix: 'browser-master-', historyLimit: 100,
  });
  let design = null;
  try {
    const masterId = session.editor.doc.masterOrder[1];
    const master = session.editor.doc.masters[masterId];
    const first = session.editor.doc.slideOrder.find((id) =>
      session.editor.doc.slides[id].layoutId === master.layoutIds[1]);
    const second = [...session.editor.exec({
      type: 'AddSlide', layoutId: master.layoutIds[0],
      at: { after: session.editor.doc.slideOrder.at(-1) },
    }).createdSlides][0];
    const other = session.editor.doc.slideOrder.find((id) =>
      !master.layoutIds.includes(session.editor.doc.slides[id].layoutId));
    const target = { kind: 'master', id: masterId };
    design = createDesignEditor(designMount, session, { target, textMode: 'svg' });
    session.mount(firstMount, { slideId: first, mode: 'edit', textMode: 'svg', snapping: false });
    session.mount(secondMount, { slideId: second, mode: 'edit', textMode: 'svg', snapping: false });
    session.mount(otherMount, { slideId: other, mode: 'edit', textMode: 'svg', snapping: false });
    const marker = master.children.map((id) => session.editor.doc.elements[id])
      .find((record) => record.src.name === '目标母版标记');
    const designSvg = designMount.querySelector('svg');
    const firstSvg = firstMount.querySelector('[data-ppt-layer="static"] svg');
    const secondSvg = secondMount.querySelector('[data-ppt-layer="static"] svg');
    const otherSvg = otherMount.querySelector('[data-ppt-layer="static"] svg');
    design.exec({ type: 'SetXfrm', id: marker.id, x: marker.src.x + 29 });
    if (!designMount.querySelector('[data-ppt-design-editor="master"]')
      || !designMount.querySelector(`[data-edit-id="${marker.id}"]`)
      || designMount.querySelector('svg') === designSvg
      || firstMount.querySelector('[data-ppt-layer="static"] svg') === firstSvg
      || secondMount.querySelector('[data-ppt-layer="static"] svg') === secondSvg
      || otherMount.querySelector('[data-ppt-layer="static"] svg') !== otherSvg
      || session.editor.toSlide(first).elements
        .find((element) => element.name === marker.src.name)?.x !== marker.src.x + 29) {
      throw new Error('母版设计画布身份或多版式传播边界失败');
    }
    design.exec({
      type: 'SetMasterTextStyle', target, category: 'body', level: 1,
      paragraph: { align: 'right' }, run: { size: 30, font: 'Master Browser Latin' },
    });
    const body = session.editor.doc.slides[first].children
      .map((id) => session.editor.doc.elements[id])
      .find((record) => record.meta.ph?.type === 'body');
    const paragraph = session.editor.effectiveElement(body.id).text?.paragraphs[1];
    if (paragraph?.align !== 'right' || paragraph.runs[0]?.size !== 30
      || paragraph.runs[0]?.fonts[0] !== 'Master Browser Latin') {
      throw new Error('母版文字默认值没有在真实浏览器重算直属页面');
    }
    return { pageCount: 2 };
  } finally {
    design?.destroy();
    session.dispose();
    designMount.remove();
    firstMount.remove();
    secondMount.remove();
    otherMount.remove();
  }
}
