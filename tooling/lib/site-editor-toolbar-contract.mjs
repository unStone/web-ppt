import { runSiteEditorShapeToolbarContract } from './site-editor-shape-toolbar-contract.mjs';
import { runSiteEditorTextToolbarContract } from './site-editor-text-toolbar-contract.mjs';
import { runSiteEditorImageToolbarContract } from './site-editor-image-toolbar-contract.mjs';
import { runSiteEditorProductToolbarContract } from './site-editor-product-toolbar-contract.mjs';
import { runSiteEditorSlideToolbarContract } from './site-editor-slide-toolbar-contract.mjs';

export async function runSiteEditorToolbarContract(context) {
  await runSiteEditorShapeToolbarContract(context);
  await runSiteEditorTextToolbarContract(context);
  await runSiteEditorImageToolbarContract(context);
  await runSiteEditorProductToolbarContract(context);
  await runSiteEditorSlideToolbarContract(context);
}
