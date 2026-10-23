import { renderSlideToSvg } from '@web-ppt/core';
import type { Fill, Paragraph, SlideElement, Stroke, TextBody } from '@web-ppt/core';
import { color, contrast, over } from './color';
import { active, LayoutLintError, waitFor } from './types';
import type { ContrastContext, ContrastSamples } from './types';
import type { SvgContrastSamplerOptions } from './sampler';
import { blackenImages } from './sampler-images';

type Pixel = Uint8Array | Uint8ClampedArray;
type Sample = { paragraph: Paragraph; runIndex: number; owner: string; pair: { foreground: string; background: string } | null; ratio: number };
type Slot = ContrastSamples | (() => Promise<ContrastSamples>);
type Result = Map<string, Map<Paragraph, Map<number, Slot>>>;
const clear = 'rgba(0,0,0,0)';
const transparent = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=';
function dataUrl(bytes: Uint8Array, mime: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return `data:${mime};base64,${btoa(chunks.join(''))}`;
}

/** 每页只渲染完整图、无字底图和颜色标记图，避免图表密集页按 run 重复光栅化。 */
export function createSvgContrastSampler(options: SvgContrastSamplerOptions): (context: ContrastContext) => Promise<ContrastSamples> {
  const scale = options.scale ?? 3, maxPixels = options.maxPixels ?? 64 * 1024 * 1024;
  if (typeof options.rasterize !== 'function' || !Number.isFinite(scale) || scale < 1 || !Number.isSafeInteger(maxPixels) || maxPixels < 1) throw new LayoutLintError('invalid-options', 'SVG 采样必须提供 rasterize、正比例和正像素上限');
  const cache = new WeakMap<object, Promise<Result>>();
  const recent: object[] = [];
  const build = async (context: ContrastContext): Promise<Result> => {
    active(context.signal);
    const width = Math.ceil(context.canvas.width * scale), height = Math.ceil(context.canvas.height * scale);
    if (width * height > maxPixels) throw new LayoutLintError('resource-limit', 'SVG 采样超过 maxPixels', context.slideNumber, context.elementId);
    const owners = new Map(context.bindings.map(b => [b.element, b.elementId]));
    const samples = new Map<number, Sample>();
    const tags = new Map<string, Map<Paragraph, Map<number, number>>>();
    let serial = 0;
    const tag = (owner: string, p: Paragraph, index: number) => {
      let paras = tags.get(owner); if (!paras) tags.set(owner, paras = new Map());
      let runs = paras.get(p); if (!runs) paras.set(p, runs = new Map());
      let code = runs.get(index);
      if (code === undefined) {
        if (++serial >= 0xffffff) throw new LayoutLintError('resource-limit', '页面文本标记超过 24 位范围');
        code = (serial * 0x9e3779) & 0xffffff;
        runs.set(index, code); samples.set(code, { owner, paragraph: p, runIndex: index, pair: null, ratio: 22 });
      }
      return '#' + code.toString(16).padStart(6, '0');
    };
    const inline = (url: string) => {
      if (!url || url.startsWith('data:')) return url;
      const asset = context.resource(url);
      if (!asset) throw new LayoutLintError('image-resource-unavailable', 'SVG 采样缺少自包含资源', context.slideNumber, context.elementId);
      return dataUrl(asset.bytes, asset.mime);
    };
    const fill = (value: Fill | null | undefined): Fill | null => value?.type === 'image' ? { ...value, src: inline(value.src) } : value ?? null;
    const black = (value: string) => `rgba(0,0,0,${color(value)[3]})`;
    const maskFill = (value: Fill | null | undefined): Fill | null => {
      if (!value || value.type === 'none') return value ?? null;
      if (value.type === 'solid') return { ...value, color: black(value.color) };
      if (value.type === 'gradient') return { ...value, stops: value.stops.map(s => ({ ...s, color: black(s.color) })) };
      if (value.type === 'pattern') return { ...value, fg: black(value.fg), bg: black(value.bg) };
      return fill(value);
    };
    const maskStroke = (value: Stroke | null | undefined) => value ? { ...value, color: black(value.color) } : value;
    let solo: Sample | undefined;
    const body = (value: TextBody | null, mode: string, owner: string): TextBody | null => value && ({ ...value,
      paragraphs: value.paragraphs.map(p => ({ ...p,
        ...(mode !== 'full' ? { bulletColor: clear, bulletImage: p.bulletImage ? transparent : p.bulletImage } : {}),
        runs: p.runs.map((run, r) => {
          const base = { ...run, ...(options.fontFamily ? { fonts: [options.fontFamily] } : {}) };
          if (mode === 'full') return base;
          const invisible = color(run.color)[3] === 0 && !run.outline && !run.gradient && !run.gradientFill && !run.shadow && !run.shadowEffect;
          return { ...base, color: !invisible && mode === 'mask' ? tag(owner, p, r) : (mode === 'single' || mode === 'coverage') && owner === solo?.owner && p === solo.paragraph && r === solo.runIndex ? '#ffffff' : clear,
            gradient: null, gradientFill: null, outline: null, shadow: null, shadowEffect: null,
            ...(mode === 'mask' || mode === 'single' || mode === 'coverage' ? { highlight: null } : {}) };
        }),
      })),
    });
    const visit = (e: SlideElement, mode: string, inherited: string): SlideElement => {
      const owner = owners.get(e) ?? inherited;
      const masking = mode === 'mask' || mode === 'single' || mode === 'coverage';
      const base = { ...e, ...(masking ? { effects: undefined } : {}) };
      if (e.kind === 'shape') return { ...base, kind: 'shape', path: e.path, fill: mode === 'coverage' ? null : masking ? maskFill(e.fill) : fill(e.fill), stroke: mode === 'coverage' ? null : masking ? maskStroke(e.stroke) ?? null : e.stroke, text: body(e.text, mode, owner) };
      if (e.kind === 'group') return { ...e, effects: masking ? undefined : e.effects, children: e.children.map(c => visit(c, mode, owner)) };
      if (e.kind === 'image') return { ...e, effects: masking ? undefined : e.effects, src: mode === 'coverage' ? transparent : inline(e.src), filter: masking ? `${e.filter ?? ''} brightness(0)` : e.filter, media: undefined };
      if (e.kind === 'table') return { ...e, effects: masking ? undefined : e.effects, rows: e.rows.map(row => ({ ...row, cells: row.cells.map(c => ({ ...c, fill: mode === 'coverage' ? null : masking ? maskFill(c.fill) : fill(c.fill), borders: mode === 'coverage' ? {} : masking ? Object.fromEntries(Object.entries(c.borders ?? {}).map(([k,v]) => [k, maskStroke(v)])) : c.borders, text: body(c.text, mode, owner) })) })) };
      return masking ? { ...base, kind: 'shape', path: null, fill: null, stroke: null, text: null } : e;
    };
    const fonts = options.embeddedFonts?.map(f => ({ ...f, src: inline(f.src) }));
    const render = async (mode: string): Promise<Pixel> => {
      // 渲染器把未指定背景补成白色；标记图必须显式透明，才能区分遮挡与可见文字。
      const slide = { ...context.slide, background: mode === 'mask' || mode === 'single' || mode === 'coverage' ? { type: 'solid' as const, color: clear } : fill(context.slide.background), elements: context.slide.elements.map(e => visit(e, mode, '')) };
      let svg = renderSlideToSvg({ width: context.canvas.width, height: context.canvas.height, source: 'pptx', slides: [], embeddedFonts: fonts }, slide, { textMode: 'svg', idPrefix: 'lint-sample' });
      if (mode === 'mask' || mode === 'single') svg = blackenImages(svg);
      const pixels = await waitFor(options.rasterize(svg, width, height, context.signal), context.signal);
      if (pixels.length !== width * height * 4) throw new LayoutLintError('invalid-raster', 'rasterize 必须返回指定尺寸的 RGBA8', context.slideNumber, context.elementId);
      return pixels;
    };
    const full = await render('full'), background = await render('background'), mask = await render('mask'), matte = color(context.canvas.color);
    const rgb = (data: Pixel, i: number) => over([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, data[i + 3] / 255], matte);
    const css = (c: readonly number[]) => `rgb(${c[0] * 255},${c[1] * 255},${c[2] * 255})`;
    for (let i = 0; i < mask.length; i += 4) {
      if (mask[i + 3] !== 255) continue;
      const sample = samples.get((mask[i] << 16) | (mask[i + 1] << 8) | mask[i + 2]);
      if (!sample) continue;
      const fg = rgb(full, i), bg = rgb(background, i), ratio = contrast(fg, bg);
      if (ratio < sample.ratio) { sample.ratio = ratio; sample.pair = { foreground: css(fg), background: css(bg) }; }
    }
    active(context.signal);
    const result: Result = new Map();
    for (const sample of samples.values()) {
      let paras = result.get(sample.owner); if (!paras) result.set(sample.owner, paras = new Map());
      let runs = paras.get(sample.paragraph); if (!runs) paras.set(sample.paragraph, runs = new Map());
      runs.set(sample.runIndex, sample.pair ? [sample.pair] : async () => {
        solo = sample;
        const own = await render('single');
        solo = sample;
        const coverage = await render('coverage');
        let ink = false, best = 22, pair: { foreground: string; background: string } | null = null;
        for (let i = 0; i < own.length; i += 4) {
          ink ||= own[i] > 0 || own[i + 1] > 0 || own[i + 2] > 0;
          if (coverage[i + 3] !== 255 || own[i] === 0 && own[i + 1] === 0 && own[i + 2] === 0) continue;
          const fg = rgb(full, i), bg = rgb(background, i), value = contrast(fg, bg);
          if (value < best) { best = value; pair = { foreground: css(fg), background: css(bg) }; }
        }
        if (pair) return [pair];
        if (!ink) return { visible: false };
        throw new LayoutLintError('contrast-resolution-insufficient', '采样像素不足，请提高 scale', context.slideNumber, context.elementId);
      });
    }
    return result;
  };
  return async context => {
    active(context.signal);
    let ready = cache.get(context.slide);
    if (!ready) { ready = build(context); cache.set(context.slide, ready); recent.push(context.slide); if (recent.length > 2) cache.delete(recent.shift()!); }
    const result = await waitFor(ready, context.signal);
    const runs = result.get(context.elementId)?.get(context.paragraph), value = runs?.get(context.runIndex);
    if (value === undefined) throw new LayoutLintError('contrast-context-unavailable', '采样段落不属于调用时投影', context.slideNumber, context.elementId);
    if (typeof value !== 'function') return value;
    const sampled = await waitFor(value(), context.signal); runs!.set(context.runIndex, sampled); return sampled;
  };
}
