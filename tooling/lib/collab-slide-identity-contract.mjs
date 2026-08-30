import { unzipSync } from 'fflate';

const createdSlide = (result) => [...result.createdSlides][0];

function uniqueCnvPrIds(bytes) {
  const decoder = new TextDecoder();
  return Object.entries(unzipSync(bytes))
    .filter(([part]) => /^ppt\/slides\/slide\d+\.xml$/.test(part))
    .every(([, value]) => {
      const ids = [...decoder.decode(value).matchAll(
        /<(?:[A-Za-z_][\w.-]*:)?cNvPr\b[^>]*\bid\s*=\s*["'](\d+)["']/g,
      )].map((match) => match[1]);
      return new Set(ids).size === ids.length;
    });
}

function visibleElement(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(visibleElement);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'name', 'editInfo'].includes(key))
    .map(([key, child]) => [key, visibleElement(child)]));
}

const newSlideVisuals = (presentation, sourceCount) => presentation.slides.slice(sourceCount)
  .map((slide) => JSON.stringify(visibleElement(slide))).sort();

function uniqueSlideOpcIdentities(doc, ids) {
  const slides = ids.map((id) => doc.slides[id]);
  const unique = (values) => values.every(Boolean) && new Set(values).size === values.length;
  return unique(slides.map((slide) => slide.origin?.part))
    && unique(slides.map((slide) => slide.creation?.presentationSlideId))
    && unique(slides.map((slide) => slide.creation?.presentationRelationshipId));
}

export async function runCollabSlideIdentityContract({
  bindPair, canonical, check, core, createPair, edit, OfflineHub, semanticDoc, stringDiff,
}) {
  console.log('\n\x1b[36m▸ 并发新增/复制页的全套 OPC 身份\x1b[0m');
  const pair = await createPair('sample-editor-add-slide.pptx', 'collab-slide-');
  const hub = new OfflineHub();
  const errors = [];
  const bindings = bindPair(pair, hub, errors);
  const sourceCount = pair.left.slideOrder.length;
  const anchor = pair.left.slideOrder[0];
  const layoutId = pair.left.layoutOrder[0];
  const leftId = createdSlide(pair.leftEditor.exec({
    type: 'AddSlide', layoutId, at: { after: anchor },
  }));
  const rightId = createdSlide(pair.rightEditor.exec({
    type: 'AddSlide', layoutId, at: { after: anchor },
  }));
  hub.flush((items) => items.reverse());
  check('并发 AddSlide 保留两页且 part、sldId、rId 全部唯一', leftId !== rightId
    && pair.left.slides[leftId] && pair.left.slides[rightId]
    && uniqueSlideOpcIdentities(pair.left, [leftId, rightId]));
  check('并发 AddSlide 乱序投递后 EditDoc 收敛', semanticDoc(pair.left) === semanticDoc(pair.right),
    stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
  check('并发 AddSlide 没有适配错误', errors.length === 0, errors.map(String).join(' / '));

  const [leftBytes, rightBytes] = await Promise.all([pair.leftEditor.save(), pair.rightEditor.save()]);
  const [leftSaved, rightSaved] = await Promise.all([
    core.parse(leftBytes, { lazy: false }), core.parse(rightBytes, { lazy: false }),
  ]);
  check('并发 AddSlide 两份保存产物都保持每页 cNvPr 唯一', uniqueCnvPrIds(leftBytes)
    && uniqueCnvPrIds(rightBytes));
  check('并发 AddSlide 保存回读语义一致', JSON.stringify(canonical(leftSaved.slides))
    === JSON.stringify(canonical(rightSaved.slides)));

  const oraclePair = await createPair('sample-editor-add-slide.pptx', 'collab-slide-oracle-');
  const oracleAnchor = oraclePair.left.slideOrder[0];
  oraclePair.leftEditor.exec({
    type: 'AddSlide', layoutId: oraclePair.left.layoutOrder[0], at: { after: oracleAnchor },
  });
  oraclePair.leftEditor.exec({
    type: 'AddSlide', layoutId: oraclePair.left.layoutOrder[0], at: { after: oracleAnchor },
  });
  const oracleSaved = await core.parse(await oraclePair.leftEditor.save(), { lazy: false });
  check('并发新增页的可见语义与单机顺序执行 oracle 一致', JSON.stringify(
    newSlideVisuals(leftSaved, sourceCount),
  ) === JSON.stringify(newSlideVisuals(oracleSaved, sourceCount)));
  bindings.forEach((binding) => binding.dispose());

  const duplicate = await createPair('sample-editor-duplicate-slide.pptx', 'collab-duplicate-');
  const duplicateHub = new OfflineHub();
  const duplicateErrors = [];
  const duplicateBindings = bindPair(duplicate, duplicateHub, duplicateErrors);
  const source = duplicate.left.slideOrder[1];
  const duplicateLeft = createdSlide(duplicate.leftEditor.exec({ type: 'DuplicateSlide', id: source }));
  const duplicateRight = createdSlide(duplicate.rightEditor.exec({ type: 'DuplicateSlide', id: source }));
  duplicateHub.flush((items) => items.reverse());
  const copies = [duplicateLeft, duplicateRight];
  const notesParts = copies.map((id) => duplicate.left.slides[id].notes?.targetPart
    ?? duplicate.left.slides[id].creation?.duplicateNotesPart);
  check('并发 DuplicateSlide 的页与备注 OPC 身份全都唯一', uniqueSlideOpcIdentities(
    duplicate.left, copies,
  ) && notesParts.every(Boolean) && new Set(notesParts).size === notesParts.length);
  check('并发 DuplicateSlide 乱序投递后收敛且无适配错误', semanticDoc(duplicate.left)
    === semanticDoc(duplicate.right) && duplicateErrors.length === 0,
  stringDiff(semanticDoc(duplicate.left), semanticDoc(duplicate.right)));
  const duplicateBytes = await duplicate.leftEditor.save();
  check('并发 DuplicateSlide 保存后每页 cNvPr 仍唯一', uniqueCnvPrIds(duplicateBytes));
  duplicateBindings.forEach((binding) => binding.dispose());
}
