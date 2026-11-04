import type { TextMeasure } from '@web-ppt/core';
import {
  fillTemplate, TemplateFillError,
  type TemplateFillOptions, type TemplateFillOutline, type TemplateFillResult,
} from '@web-ppt/edit-core/fill';

const outline: TemplateFillOutline = {
  version: 1,
  slides: [
    { type: 'title', title: '季度回顾', subtitle: '业务进展' },
    { type: 'section', title: '第一部分', body: [{ text: '产品', level: 0, bullet: true }] },
    { type: 'content', title: '结论', body: [{ text: '收入增长' }] },
    { type: 'two-column', title: '对照', columns: [[{ text: '本期' }], [{ text: '上期' }]] },
    { type: 'image', title: '产品', image: { bytes: 'AA==', mime: 'image/png', fit: 'contain', altText: '产品照片' } },
    { type: 'chart', title: '收入', chart: { type: 'bar', categories: ['一月', '二月'], series: [{ name: '收入', values: [1, null] }] } },
  ],
};

export async function templateFillContract(bytes: Uint8Array, measureText: TextMeasure): Promise<TemplateFillResult> {
  const options: TemplateFillOptions = { lint: { measureText }, requireClean: true, repair: true };
  const builtin: TemplateFillResult = await fillTemplate('aurora', outline, options);
  const external = await fillTemplate(bytes, outline, options);
  const saved: Uint8Array = external.bytes;
  const version: 1 = external.description.version;
  const objectId: string | null = external.bindings[0].objectId;
  void [builtin, saved, version, objectId];
  return external;
}

export function templateFillFailures(measureText: TextMeasure): void {
  // @ts-expect-error 生成必须具备真实测字端口，不能依赖估算。
  void fillTemplate('aurora', outline, { lint: {} });
  // @ts-expect-error 当前大纲只支持协议版本 1。
  const version: TemplateFillOutline = { version: 2, slides: [] };
  // @ts-expect-error JSON 大纲中的图片字节必须使用 Base64。
  const image: TemplateFillOutline = { version: 1, slides: [{ type: 'image', title: '图片', image: { bytes: new Uint8Array(), mime: 'image/png' } }] };
  // @ts-expect-error 填充入口只开放已具备原生生成能力的八类图表。
  const chart: TemplateFillOutline = { version: 1, slides: [{ type: 'chart', title: '图表', chart: { type: 'stock', categories: [], series: [] } }] };
  // @ts-expect-error 双栏页必须提供两栏，不能暗自补造另一栏内容。
  const columns: TemplateFillOutline = { version: 1, slides: [{ type: 'two-column', title: '双栏', columns: [[{ text: '只有一栏' }]] }] };
  // @ts-expect-error 模板名称只接受内置目录中的稳定 ID。
  void fillTemplate('unknown-template', outline, { lint: { measureText } });
  void [version, image, chart, columns];
}

export function templateFillErrorContract(error: TemplateFillError): readonly [string, number | null, string | null] {
  return [error.reason, error.slideNumber, error.elementId];
}
