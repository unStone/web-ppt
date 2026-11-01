import { Resvg } from '@resvg/resvg-js';

export function measureText(text, run, scale) {
  const size = run.size * scale * (run.baseline ? 0.65 : 1);
  let width = 0;
  for (const char of text) width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? size : size * 0.55;
  return width + (run.spacing ?? 0) * text.length;
}

export function rasterize(svg) {
  return new Resvg(svg, { background: 'white' }).render().asPng();
}
