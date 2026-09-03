import type { CreateBlankPptxOptions } from '../generate';

export type BuiltinTemplateId = 'aurora' | 'editorial' | 'midnight';

export interface BuiltinTemplatePreviewToken {
  readonly surface: string;
  readonly foreground: string;
  readonly accent: string;
  readonly secondary: string;
  readonly motif: 'orb' | 'rule' | 'beam';
}

export interface BuiltinTemplateCatalogItem {
  readonly id: BuiltinTemplateId;
  readonly name: string;
  readonly description: string;
  readonly preview: BuiltinTemplatePreviewToken;
}

export interface CreatePptxFromTemplateOptions extends CreateBlankPptxOptions {}
