import { commentMessages } from './en-comments';
import { homeMessages } from './en-home';
import { editorMessages } from './en-editor';
import { sampleMessages } from './en-samples';
import { mediaMessages } from './en-media';
import { chartMessages } from './en-chart';
import { toolMessages } from './en-tools';
import { shapeMessages } from './en-shapes';
import { accessibilityMessages } from './en-accessibility';
import { appearanceMessages } from './en-appearance';

/** 合并和构建校验必须消费同一注册表，新增目录不能绕过参数与重复译文检查。 */
export const messageCatalogs = [homeMessages, editorMessages, sampleMessages, mediaMessages, chartMessages, toolMessages, shapeMessages, accessibilityMessages, appearanceMessages, commentMessages] as const;
type CatalogKeys<Catalog> = Catalog extends unknown ? keyof Catalog : never;
export type Message = CatalogKeys<typeof messageCatalogs[number]>;
export const messages = Object.assign({}, ...messageCatalogs) as Readonly<Record<Message, string>>;
