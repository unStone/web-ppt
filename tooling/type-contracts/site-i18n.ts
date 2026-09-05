import { setText, t } from '../../packages/site/src/i18n/runtime';
import { message } from '../../packages/site/src/i18n/message';

declare const label: HTMLElement;
t('保存副本');
setText(label, '保存副本');
setText(label, '{name} · Web-PPT 编辑器', { name: '<中文文件>.pptx' });
message('正在准备{template}演示文稿…', { template: message('极光') });
message('记录于 {updated} 更新，共 {count} 步；最近操作：{label}。', { updated: new Date(), count: 1, label: 'AddShape' });
// @ts-expect-error 异步传递的消息也必须带齐参数。
message('正在打开 {name}');
// @ts-expect-error 参数名必须与源词条一致。
t('{name} · Web-PPT 编辑器', { file: 'draft.pptx' });
// @ts-expect-error 带参数的词条不能漏传。
t('{name} · Web-PPT 编辑器');
// @ts-expect-error 新文案必须先提供英文词条。
t('未登记的界面文案');
// @ts-expect-error 无参数词条不能接受任意业务数据。
setText(label, '保存副本', { name: 'draft.pptx' });
