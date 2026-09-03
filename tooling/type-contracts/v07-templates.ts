import {
  createPptxFromTemplate, listBuiltinTemplates,
  type BuiltinTemplateId, type BuiltinTemplatePreviewToken,
} from '@web-ppt/edit-core/templates';
import * as editorTemplates from '@web-ppt/editor/templates';
import * as reactTemplates from '@web-ppt/react/templates';
import * as vueTemplates from '@web-ppt/vue/templates';

const id: BuiltinTemplateId = listBuiltinTemplates()[0].id;
const preview: BuiltinTemplatePreviewToken = listBuiltinTemplates()[0].preview;
const bytes: Uint8Array = createPptxFromTemplate(id, { width: 1280, height: 720 });
const editorBytes: Uint8Array = editorTemplates.createPptxFromTemplate(id);
const reactBytes: Uint8Array = reactTemplates.createPptxFromTemplate(id);
const vueBytes: Uint8Array = vueTemplates.createPptxFromTemplate(id);

void [preview, bytes, editorBytes, reactBytes, vueBytes];
