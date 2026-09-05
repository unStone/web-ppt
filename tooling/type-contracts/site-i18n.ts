import { setText, t } from '../../packages/site/src/i18n/runtime';

declare const label: HTMLElement;
t('保存副本');
setText(label, '保存副本');
setText(label, '{name} · Web-PPT 编辑器', { name: '<中文文件>.pptx' });
// @ts-expect-error 参数名必须与源词条一致。
t('{name} · Web-PPT 编辑器', { file: 'draft.pptx' });
// @ts-expect-error 带参数的词条不能漏传。
t('{name} · Web-PPT 编辑器');
// @ts-expect-error 新文案必须先提供英文词条。
t('未登记的界面文案');
// @ts-expect-error 无参数词条不能接受任意业务数据。
setText(label, '保存副本', { name: 'draft.pptx' });
