import packageAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync } from 'fflate';

const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MAIN = '/ppt/presentation.xml';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const POTX = 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml';
const MACRO = 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function contentTypes(parts, visit) {
  const window = new JSDOM('').window;
  try {
    const xml = new window.DOMParser().parseFromString(new TextDecoder().decode(parts['[Content_Types].xml']), 'application/xml');
    packageAssert.equal(xml.getElementsByTagName('parsererror').length, 0, '测试输入必须有合法 Content Types XML');
    const mains = [...xml.getElementsByTagNameNS(TYPES, 'Override')].filter(node => node.getAttribute('PartName') === MAIN);
    packageAssert.equal(mains.length, 1, '测试输入必须有唯一 presentation 主部件');
    return visit(mains[0], xml, window);
  } finally { window.close(); }
}

function withMainType(bytes, type) {
  const parts = unzipSync(bytes);
  contentTypes(parts, (main, xml, window) => {
    main.setAttribute('ContentType', type);
    parts['[Content_Types].xml'] = new TextEncoder().encode(new window.XMLSerializer().serializeToString(xml));
  });
  return zipSync(parts, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
}

/** 使用独立 DOM 读取主类型，防止生成器与测试共用类型转换错误。 */
export async function runTemplateFillPackageContract({ api, template, outline, baseline, options, assert }) {
  const original = template.slice();
  const potx = withMainType(template, POTX), originalPotx = potx.slice();
  const generated = await api.fill.fillTemplate(potx, outline, options);
  assert.deepEqual(potx, originalPotx, 'POTX 填充不能修改调用方模板字节');
  assert.deepEqual(template, original, '构造 POTX 变体不能修改原 PPTX 字节');
  const mainType = contentTypes(unzipSync(generated.bytes), main => main.getAttribute('ContentType'));
  assert.equal(mainType, PPTX, 'POTX 模板填充返回的 PPTX 必须使用 presentation.main+xml');
  assert.deepEqual(generated.description, baseline.description, '仅主类型不同的 POTX 与 PPTX 必须生成相同文稿语义');
  assert.deepEqual(generated.bindings, baseline.bindings, 'POTX 的最终绑定必须与普通 PPTX 来源一致');
  assert.deepEqual(generated.lint, baseline.lint, '主类型转换不能改变实际布局检查结果');
  const presentation = await api.core.parse(generated.bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = api.edit.createDoc(presentation, { idPrefix: options.idPrefix });
  try {
    assert.deepEqual(api.describe.describePresentation(doc), generated.description,
      'POTX 来源返回的 describe 必须与最终 PPTX 字节重开逐字段一致');
  } finally { api.edit.disposeDoc(doc); }
  const normal = await api.fill.fillTemplate(template, outline, options);
  const normalHash = sha256(normal.bytes), baselineHash = sha256(baseline.bytes);
  assert.equal(normalHash, baselineHash, '处理 POTX 后普通 PPTX 的生成字节散列必须保持不变');
  assert.deepEqual(template, original, '普通 PPTX 再次填充仍不得改变调用方模板');

  const unsupported = withMainType(template, MACRO), originalUnsupported = unsupported.slice();
  await assert.rejects(() => api.fill.fillTemplate(unsupported, outline, options),
    error => error instanceof api.fill.TemplateFillError && error.reason === 'unsupported-template',
    '宏主类型不能被当作普通 PPTX/POTX 模板处理');
  assert.deepEqual(unsupported, originalUnsupported, '拒绝非普通模板时调用方输入字节必须保持不变');
  return { bytes: generated.bytes, report: { inputMainType: POTX, outputMainType: mainType,
    normalSha256: normalHash, baselineSha256: baselineHash, sourcePreserved: true, macroMainRejected: true } };
}
