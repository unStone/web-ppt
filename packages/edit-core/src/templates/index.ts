import { createOpcPackage, disposeOpcPackage } from '../opc/patch';
import { assertSlideSize } from '../slide-size';
import { generatedDesignedTemplateParts } from '../generate/template';
import { BUILTIN_TEMPLATE_RECIPES } from './recipes';
import type {
  BuiltinTemplateCatalogItem, BuiltinTemplateId, CreatePptxFromTemplateOptions,
} from './types';

export type {
  BuiltinTemplateCatalogItem, BuiltinTemplateId, BuiltinTemplatePreviewToken,
  CreatePptxFromTemplateOptions,
} from './types';

const CATALOG: readonly BuiltinTemplateCatalogItem[] = Object.freeze(
  Object.values(BUILTIN_TEMPLATE_RECIPES).map(({ id, name, description, preview }) => Object.freeze({
    id, name, description, preview: Object.freeze({ ...preview }),
  })),
);

export function listBuiltinTemplates(): readonly BuiltinTemplateCatalogItem[] {
  return CATALOG;
}

export function createPptxFromTemplate(
  id: BuiltinTemplateId,
  options: CreatePptxFromTemplateOptions = {},
): Uint8Array {
  const recipe = Object.prototype.hasOwnProperty.call(BUILTIN_TEMPLATE_RECIPES, id)
    ? BUILTIN_TEMPLATE_RECIPES[id]
    : undefined;
  if (!recipe) throw new Error(`未知内置模板：${id}`);
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  assertSlideSize(width, '页面宽度');
  assertSlideSize(height, '页面高度');
  const result = createOpcPackage(generatedDesignedTemplateParts(width, height, recipe));
  disposeOpcPackage(result.package);
  return result.bytes;
}
