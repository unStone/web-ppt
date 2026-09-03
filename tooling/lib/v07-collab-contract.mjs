/** 三套模板都必须沿生产协同协议收敛设计来源、页面结构与直接覆盖。 */
export async function runV07CollabContract({
  templates, edit, createPairFromBytes, OfflineHub, bindPair, seededShuffle,
  semanticDoc, stringDiff, check,
}) {
  console.log('\n\x1b[36m▸ 内置模板复用统一协同模型\x1b[0m');
  for (const template of templates.listBuiltinTemplates()) {
    const pair = await createPairFromBytes(templates.createPptxFromTemplate(template.id),
      `collab-template-${template.id}-`);
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const themeId = pair.left.themeOrder[0];
    const layoutId = pair.left.layoutOrder[1];
    const masterId = pair.left.masterOrder[0];
    const layoutTarget = { kind: 'layout', id: layoutId };
    const masterTarget = { kind: 'master', id: masterId };
    pair.leftEditor.exec({
      type: 'SetTheme', id: themeId, clrScheme: { accent1: '#345678' },
    });
    pair.leftEditor.execDesign(masterTarget,
      {
        type: 'SetBackground', target: masterTarget,
        fill: { type: 'solid', color: '#16283A' },
      },
      {
        type: 'SetMasterTextStyle', target: masterTarget, category: 'body', level: 0,
        run: { font: `Collab ${template.id}` },
      });
    pair.rightEditor.execDesign(layoutTarget, {
      type: 'SetBackground', target: layoutTarget, fill: { type: 'solid', color: '#F0E5D8' },
    });
    const added = pair.rightEditor.exec({
      type: 'AddSlide', layoutId, at: { after: pair.right.slideOrder[0] },
    });
    const addedSlide = [...added.createdSlides][0];
    const title = pair.right.slides[addedSlide].children.map((id) => pair.right.elements[id])
      .find((record) => record.meta.ph?.type === 'title');
    pair.rightEditor.exec({
      type: 'SetFill', id: title.id, fill: { type: 'solid', color: '#F04A71' },
    });
    hub.flush((items) => seededShuffle(items, 0x0707004));
    const leftTitle = pair.left.slides[addedSlide].children.map((id) => pair.left.elements[id])
      .find((record) => record.meta.ph?.type === 'title');
    check(`${template.name}模板协同收敛主题、母版、版式与页面直设`,
      edit.queryTheme(pair.left, themeId).colors.accent1 === 'rgb(52,86,120)'
        && edit.queryMaster(pair.left, masterTarget).background.value.color === 'rgb(22,40,58)'
        && edit.queryMaster(pair.left, masterTarget).textStyles.body[0].value.run.font
          === `Collab ${template.id}`
        && edit.queryLayout(pair.left, layoutTarget).background.value.color === 'rgb(240,229,216)'
        && pair.leftEditor.effectiveElement(leftTitle.id).fill.color === 'rgb(240,74,113)'
        && pair.leftEditor.toSlide(addedSlide).background.color === 'rgb(240,229,216)'
        && semanticDoc(pair.left) === semanticDoc(pair.right),
      stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
    check(`${template.name}模板协同没有适配错误`, errors.length === 0,
      errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
    edit.disposeDoc(pair.left);
    edit.disposeDoc(pair.right);
  }
}
