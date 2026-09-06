import { runSiteEditContextBrowserContract } from './site-edit-context-browser-contract.mjs';
import { runSiteAppearanceBrowserContract } from './site-appearance-browser-contract.mjs';
import { runSiteEditorShapeToolbarContract } from './site-editor-shape-toolbar-contract.mjs';
import { runSiteEditorTextToolbarContract } from './site-editor-text-toolbar-contract.mjs';
import { runSiteEditorImageToolbarContract } from './site-editor-image-toolbar-contract.mjs';
import { runSiteEditorProductToolbarContract } from './site-editor-product-toolbar-contract.mjs';
import { runSiteEditorSlideToolbarContract } from './site-editor-slide-toolbar-contract.mjs';
import { runSiteEditorMediaToolbarContract } from './site-editor-media-toolbar-contract.mjs';
import { runSiteEditorLanguageContract } from './site-editor-language-contract.mjs';

export async function runSiteEditorToolbarContract(context) {
  await runSiteEditorShapeToolbarContract(context);
  await runSiteEditorTextToolbarContract(context);
  await runSiteEditorImageToolbarContract(context);
  await runSiteEditorProductToolbarContract(context);
  await runSiteEditorSlideToolbarContract(context);
  await runSiteEditorMediaToolbarContract(context);
  await runSiteAppearanceBrowserContract(context);
  await runSiteEditContextBrowserContract(context);
  await runSiteEditorLanguageContract(context);
}
