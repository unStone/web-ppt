import { isDeepStrictEqual } from 'node:util';
import { unzipSync, FlateErrorCode } from 'fflate';
import { JSDOM } from 'jsdom';
import { hash } from './judge-preservation.mjs';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const dataErrors = new Set(['UnexpectedEOF', 'InvalidBlockType', 'InvalidLengthLiteral', 'InvalidDistance',
  'InvalidHeader', 'InvalidUTF8', 'ExtraFieldTooLong', 'InvalidDate', 'FilenameTooLong',
  'InvalidZipData', 'UnknownCompressionMethod'].map(key => FlateErrorCode[key]));
const colors = new Set(['srgbClr', 'scrgbClr', 'sysClr', 'schemeClr', 'hslClr', 'prstClr']);
const textProperties = new Set(['rPr', 'defRPr', 'endParaRPr']);
const effects = new Set(['blip', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst']);
const otherTextFills = new Set(['noFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);

function identity(node) {
  if (node.namespaceURI !== A || node.childElementCount) return false;
  if (['alpha', 'alphaMod'].includes(node.localName)) return node.getAttribute('val') === '100000';
  if (node.localName === 'alphaOff') return node.getAttribute('val') === '0';
  if (node.localName === 'alphaModFix') return !node.hasAttribute('amt') || node.getAttribute('amt') === '100000';
  if (node.localName === 'srcRect') return ['l', 't', 'r', 'b'].every(key =>
    !node.hasAttribute(key) || node.getAttribute(key) === '0');
  return false;
}

function attributes(node, allowedFrame) {
  return [...node.attributes].filter(attr => attr.namespaceURI !== XMLNS)
    .filter(attr => !(node.localName === 'cNvPr' && attr.localName === 'hidden'
      && ['0', 'false'].includes(attr.value)))
    .filter(attr => !(node.localName === 'sld' && attr.localName === 'show'
      && ['1', 'true'].includes(attr.value)))
    .map(attr => {
      const frame = node.namespaceURI === A && node.parentElement === allowedFrame
        && (node.localName === 'off' && ['x', 'y'].includes(attr.localName)
          || node.localName === 'ext' && ['cx', 'cy'].includes(attr.localName));
      return [`${attr.namespaceURI ?? ''}:${attr.localName}`, frame ? '<frame>' : attr.value];
    }).sort(([left], [right]) => left.localeCompare(right));
}

function canonical(node, allowedFrame) {
  if (identity(node)) return null;
  return { name: `${node.namespaceURI ?? ''}:${node.localName}`, attributes: attributes(node, allowedFrame),
    children: [...node.children].map(child => canonical(child, allowedFrame)).filter(Boolean) };
}

function insideText(node) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (parent.namespaceURI === P && parent.localName === 'txBody') return true;
  }
  return false;
}

function unsignedInteger(value) {
  return typeof value === 'string' && /^[0-9]+$/.test(value) && Number.isSafeInteger(Number(value));
}

function bodyProperties(node) {
  const children = [...node.children].filter(child => {
    if (child.namespaceURI !== A || child.childElementCount) return true;
    const attrs = [...child.attributes].filter(attribute => attribute.namespaceURI !== XMLNS);
    if (child.localName === 'noAutofit' && !attrs.length) return false;
    if (child.localName !== 'normAutofit') return true;
    const valid = attrs.every(attribute => attribute.namespaceURI === null && (
      attribute.localName === 'fontScale' && unsignedInteger(attribute.value)
        && Number(attribute.value) > 0 && Number(attribute.value) <= 100000
      || attribute.localName === 'lnSpcReduction' && attribute.value === '0'));
    return !valid;
  });
  return { attributes: attributes(node), children: children.map(child => canonical(child)).filter(Boolean) };
}

function snapshot(document) {
  const objects = [...document.getElementsByTagNameNS(P, 'cNvPr')].flatMap(properties => {
    const host = properties.parentElement?.parentElement;
    if (!host || host.localName === 'spTree') return [];
    const shapeProperties = [...host.children].find(node => node.namespaceURI === P
      && ['spPr', 'grpSpPr'].includes(node.localName));
    const frame = shapeProperties && [...shapeProperties.children]
      .find(node => node.namespaceURI === A && node.localName === 'xfrm');
    const opaqueNative = [...host.getElementsByTagNameNS(A, '*')].filter(node => {
      if (!insideText(node) || identity(node)) return false;
      return effects.has(node.localName) || colors.has(node.parentElement?.localName)
        || textProperties.has(node.parentElement?.localName) && otherTextFills.has(node.localName);
    }).map(node => canonical(node));
    return [{ id: properties.getAttribute('id'), name: properties.getAttribute('name'), kind: host.localName,
      frameAndStyle: [...host.children].filter(node => !(node.namespaceURI === P && node.localName === 'txBody'))
        .map(node => canonical(node, frame)).filter(Boolean), opaqueNative,
      textFrames: [...host.getElementsByTagNameNS(A, 'bodyPr')].map(bodyProperties) }];
  });
  const root = document.documentElement;
  const common = [...root.children].filter(node => !(node.namespaceURI === P && node.localName === 'cSld'));
  const content = [...root.getElementsByTagNameNS(P, 'cSld')][0];
  if (content) common.push(...[...content.children].filter(node => !(node.namespaceURI === P && node.localName === 'spTree')));
  const tree = [...root.getElementsByTagNameNS(P, 'spTree')][0];
  if (tree) common.push(...[...tree.children].filter(node => ['nvGrpSpPr', 'grpSpPr'].includes(node.localName)));
  return { attributes: attributes(root), contentAttributes: content ? attributes(content) : [],
    common: common.map(node => canonical(node)).filter(Boolean), objects };
}

function nativeVisibility(document, part, failures) {
  const root = document.documentElement;
  const show = root.getAttribute('show');
  if (show !== null && !['0', '1', 'true', 'false'].includes(show)) failures.push({
    reason: 'invalid-native-visibility', part, message: `原生页面可见属性 ${show} 不是合法布尔值` });
  if (['0', 'false'].includes(show)) failures.push({ reason: 'visibility-changed', part, message: '原生页面不得隐藏' });
  for (const properties of document.getElementsByTagNameNS(P, 'cNvPr')) {
    const hidden = properties.getAttribute('hidden');
    if (['1', 'true'].includes(hidden)) failures.push({ reason: 'visibility-changed', part,
      sourceId: properties.getAttribute('id'), message: '原生 OOXML 对象不得隐藏' });
    else if (hidden !== null && !['0', 'false'].includes(hidden)) failures.push({
      reason: 'invalid-native-visibility', part, message: `原生隐藏属性 ${hidden} 不是合法布尔值` });
  }
  for (const frame of document.getElementsByTagNameNS(A, 'xfrm')) for (const node of frame.children) {
    // spTree 的零尺寸根坐标框是合法来源；它由不可变原生公共属性整体保护。
    if (frame.parentElement?.parentElement?.localName === 'spTree') continue;
    if (node.namespaceURI !== A || !['off', 'ext'].includes(node.localName)) continue;
    const keys = node.localName === 'off' ? ['x', 'y'] : ['cx', 'cy'];
    for (const key of keys) {
      const value = node.getAttribute(key);
      const finiteInteger = typeof value === 'string' && /^[+-]?[0-9]+$/.test(value)
        && Number.isSafeInteger(Number(value));
      if (!finiteInteger || node.localName === 'ext' && Number(value) <= 0) failures.push({
        reason: 'invalid-native-geometry', part, message: `原生几何 ${key}=${value} 不是有效EMU坐标或正尺寸` });
    }
  }
}

function xmlDocument(bytes, part, failures) {
  try { return new JSDOM(bytes, { contentType: 'application/xml' }); }
  catch (error) {
    if (error.name !== 'SyntaxError') throw new Error('评测 XML 读取依赖发生意外错误', { cause: error });
    failures.push({ reason: 'output-parse-failed', part, message: `输出不是有效 XML：${error.message}` });
    return null;
  }
}

/** ZIP/XML 数据失败先独立识别；随后 SDK 异常不能被笼统归咎于模型。 */
export function inspectCandidatePackage(input, outputBytes, failures) {
  if (!(outputBytes instanceof Uint8Array) || !outputBytes.length) {
    failures.push({ reason: 'output-parse-failed', message: '候选输出必须是非空PPTX字节' });
    return;
  }
  let parts;
  try { parts = unzipSync(outputBytes); }
  catch (error) {
    if (!dataErrors.has(error.code)) throw new Error('评测 ZIP 读取依赖发生意外错误', { cause: error });
    failures.push({ reason: 'output-parse-failed', message: `候选不是有效PPTX ZIP：${error.message}` });
    return;
  }
  const original = input.package.parts;
  const partNames = Object.keys(original).sort();
  if (!isDeepStrictEqual(partNames, Object.keys(parts).sort())) failures.push({
    reason: 'package-content-changed', message: '保存包新增或删除了未授权的部件' });
  const editable = new Set(input.slideOrder.map(id => input.slides[id].origin?.part));
  for (const part of partNames) {
    if (!editable.has(part) && (!parts[part] || hash(original[part]) !== hash(parts[part]))) {
      failures.push({ reason: part.startsWith('ppt/media/') ? 'image-content-changed' : 'package-content-changed',
        part, message: `非页面部件 ${part} 不得改变` });
    }
  }
  if (failures.length) return;
  for (const [part, bytes] of Object.entries(parts)) {
    if (!part.endsWith('.xml') && !part.endsWith('.rels')) continue;
    const candidate = xmlDocument(bytes, part, failures);
    if (!candidate) continue;
    let baseline;
    try {
      if (!editable.has(part)) continue;
      nativeVisibility(candidate.window.document, part, failures);
      baseline = new JSDOM(original[part], { contentType: 'application/xml' });
      const before = snapshot(baseline.window.document), after = snapshot(candidate.window.document);
      const structure = value => value.objects.map(({ id, name, kind }) => ({ id, name, kind }));
      if (!isDeepStrictEqual(structure(before), structure(after))) failures.push({
        reason: 'element-structure-changed', part, message: '原生对象身份、数量、类型或次序改变' });
      if (!isDeepStrictEqual(before.attributes, after.attributes)
        || !isDeepStrictEqual(before.contentAttributes, after.contentAttributes)
        || !isDeepStrictEqual(before.common, after.common)) {
        failures.push({ reason: 'protected-native-format-changed', part, message: '原生页属性、动画或背景改变' });
      }
      const byId = new Map(after.objects.map(item => [item.id, item]));
      for (const item of before.objects) {
        const other = byId.get(item.id);
        if (!other) continue;
        if (!isDeepStrictEqual(item.frameAndStyle, other.frameAndStyle)
          || !isDeepStrictEqual(item.opaqueNative, other.opaqueNative)
          || !isDeepStrictEqual(item.textFrames, other.textFrames)) failures.push({
          reason: item.kind === 'pic' ? 'image-content-changed' : 'protected-native-format-changed',
          part, sourceId: item.id, message: '原生未授权效果、填充、关系或格式改变' });
      }
    } finally { candidate.window.close(); baseline?.window.close(); }
  }
}
