import type { Presentation } from '@web-ppt/core';
import { presentationToImageZip } from '@web-ppt/core/image-zip';
import {
  listSections,
  openEditor,
  queryElementPresetGeometry,
  queryParaProps,
  queryRunProps,
  querySlideSize,
  queryTableGrid,
} from '@web-ppt/editor';
import { createBlankPptx } from '@web-ppt/edit-core/generate';

async function integrationJourney(): Promise<void> {
  const session = await openEditor(createBlankPptx(), { idPrefix: 'type-v06-' });
  const presentation: Presentation = session.toPresentation();
  const slideId = session.editor.doc.slideOrder[0];
  void querySlideSize(session.editor.doc);
  void listSections(session.editor.doc);
  void queryTableGrid;
  void queryElementPresetGeometry;
  void queryParaProps;
  void queryRunProps;
  await presentationToImageZip(presentation, { scale: 1 });
  void slideId;
  session.dispose();
}

void integrationJourney;
