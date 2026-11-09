// dist 同时存在 generate.js 与 generate/，声明文件里的 '../generate' 会被解析到无类型的 JS 产物
import type { CreateBlankPptxOptions } from '../generate/index';

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
