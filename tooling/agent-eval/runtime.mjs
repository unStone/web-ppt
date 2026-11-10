import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { LAYOUT_CHECKS, LayoutLintError } from '@web-ppt/edit-core/lint';
import { createTemplateFillMeasurement, verifyTemplateFillFonts } from '../lib/template-fill-measurement.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const family = 'WebPPT Template Fill Latin';
const maxPixels = 64 * 1024 * 1024;
let processRuntime;

function fail(reason, message) {
  const error = new Error(message);
  error.name = 'AgentEvaluationRuntimeError';
  error.reason = reason;
  throw error;
}

function active(signal) {
  if (signal?.aborted) fail('aborted', 'Agent 评测光栅化已取消');
}

function validSize(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > maxPixels) {
    fail('eval-raster-size-invalid', `Agent 评测像素尺寸 ${width}×${height} 无效，要求正安全整数且总像素不超过 ${maxPixels}`);
  }
}

/** HarfBuzz 公开对象由 GC 管理；私有 host 的进程结束是字体资源的最终作用域。 */
export function createRuntime() {
  if (processRuntime) return processRuntime;
  verifyTemplateFillFonts(root, assert);
  const source = JSON.parse(readFileSync(join(root, 'tooling/template-fill-fonts/manifest.json'), 'utf8'));
  const files = source.filter((item) => item.family === family);
  assert.equal(files.length, 2, '评测必须同时提供受控字体的正体和粗体文件');
  const fontFiles = files.map((item) => join(root, 'tooling/template-fill-fonts', item.name));
  const rawMeasure = createTemplateFillMeasurement(root);
  const measureText = (text, run, scale) => {
    if (typeof text !== 'string' || !run || typeof run !== 'object') {
      fail('eval-invalid-measurement', 'Agent 评测文字测量要求字符串与明确的文字样式');
    }
    if (
      !Array.isArray(run.fonts)
      || !run.fonts.length
      || run.fonts.some((name) => typeof name !== 'string' || !name.trim())
      || run.fonts[0].trim().toLowerCase() !== family.toLowerCase()
    ) {
      fail('eval-font-unavailable', `Agent 评测首选字体必须来自真实库存 ${family}，实际为 ${JSON.stringify(run.fonts)}`);
    }
    if (!Number.isFinite(run.size) || run.size <= 0) {
      fail('eval-invalid-measurement', `Agent 评测字号 ${run.size} 无效，要求正有限 px`);
    }
    if (!Number.isFinite(scale) || scale <= 0) {
      fail('eval-invalid-measurement', `Agent 评测测量比例 ${scale} 无效，要求正有限数值`);
    }
    if (run.spacing !== undefined && !Number.isFinite(run.spacing)) {
      fail('eval-invalid-measurement', `Agent 评测字间距 ${run.spacing} 必须有限`);
    }
    if (run.baseline !== undefined && !Number.isFinite(run.baseline)) {
      fail('eval-invalid-measurement', `Agent 评测上下标比例 ${run.baseline} 必须有限`);
    }
    const width = rawMeasure(text, run, scale);
    if (!Number.isFinite(width) || width < 0) {
      fail('eval-invalid-measurement', `Agent 评测真实测量宽度 ${width} 无效，要求非负有限 px`);
    }
    return width;
  };

  const render = (svg, width, height, signal) => {
    active(signal);
    validSize(width, height);
    if (typeof svg !== 'string' || !svg) fail('eval-invalid-svg', 'Agent 评测光栅化要求非空 SVG 字符串');
    const image = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: { fontFiles, loadSystemFonts: false, defaultFontFamily: family },
    }).render();
    if (image.width !== width || image.height !== height) {
      fail('eval-raster-size-mismatch', `Agent 评测光栅化实际尺寸 ${image.width}×${image.height}，预期 ${width}×${height}`);
    }
    active(signal);
    return image;
  };
  const rasterize = async (svg, size) => {
    if (!size || typeof size !== 'object') fail('eval-raster-size-invalid', 'Agent 评测缺少目标像素尺寸');
    return new Uint8Array(render(svg, size.width, size.height, size.signal).asPng());
  };
  // 当前公开 sampler 没有 measureText 注入；拒绝该路径，避免 Node 内部以估算分行。
  const resolveContrast = async (context) => {
    throw new LayoutLintError(
      'eval-contrast-background-unsupported',
      'Agent 评测仅支持可直接求值的实色背景；复杂背景需要具备真实测量注入的采样入口',
      context.slideNumber,
      context.elementId,
    );
  };
  processRuntime = Object.freeze({
    measureText,
    rasterize,
    lint: Object.freeze({
      checks: Object.freeze([...LAYOUT_CHECKS]),
      fonts: Object.freeze({ available: Object.freeze([family]), embedded: Object.freeze([]) }),
      resolveContrast,
    }),
    manifest: Object.freeze({
      version: 1,
      fontFamily: family,
      fontSelection: 'preferred-family-with-complete-glyph-coverage',
      contrast: 'solid-backgrounds-only',
      files: Object.freeze(source.map((item) => Object.freeze({ ...item }))),
    }),
  });
  return processRuntime;
}
