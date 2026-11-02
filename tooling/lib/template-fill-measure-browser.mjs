import { fillTemplate } from '@web-ppt/edit-core/fill';
import { createSvgContrastSampler } from '@web-ppt/edit-core/lint/sampler';
import { createTemplateFillOutline } from './template-fill-cases.mjs';
import { families, installFonts, measurement, rasterize } from './template-fill-browser.mjs';

export async function measureTemplateFill() {
  const fonts = await installFonts((condition, message) => { if (!condition) throw new Error(message); });
  try {
    const image = new Uint8Array(await (await fetch('/fixtures/agent-mcp-replacement.png')).arrayBuffer());
    let binary = '';
    for (const byte of image) binary += String.fromCharCode(byte);
    const outline = createTemplateFillOutline(btoa(binary));
    const metrics = measurement();
    const lint = { measureText: metrics.measureText, fonts: { available: families, embedded: [] },
      resolveContrast: createSvgContrastSampler({ rasterize, embeddedFonts: fonts.embeddedFonts }) };
    const beforeHeap = performance.memory?.usedJSHeapSize ?? null;
    const start = performance.now();
    const result = await fillTemplate('aurora', outline, { idPrefix: 'measured-', lint });
    const elapsedMs = performance.now() - start;
    if (result.lint.issues.length || result.lint.checks.length !== 7) throw new Error('性能样本必须全部七项检查零问题');
    return { elapsedMs, pages: result.description.totalSlides, outputBytes: result.bytes.length,
      repairs: result.repairs.length, checks: result.lint.checks, issues: result.lint.issues.length,
      measureCalls: metrics.calls, heapDeltaBytes: beforeHeap === null ? null : performance.memory.usedJSHeapSize - beforeHeap };
  } finally { fonts.release(); }
}
