import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

/**
 * 对照 svg-dialect.json 与 VectorCoverage 允许项：每种方言节点/属性/CSS
 * 要么在允许表内（可原生写出），要么登记为稳定回退原因。遗漏即失败。
 */
export const DIALECT_FALLBACKS = {
  nodes: {
    filter: 'svg-filter',
    feDropShadow: 'svg-filter',
    feComposite: 'svg-filter',
    feGaussianBlur: 'svg-filter',
    feComponentTransfer: 'svg-filter',
    feFuncA: 'svg-filter',
    feOffset: 'svg-filter',
    feFlood: 'svg-filter',
    feColorMatrix: 'svg-filter',
    textPath: 'svg-node-textPath',
    mask: 'svg-mask',
    use: 'svg-node-use',
  },
  attributes: {
    'g@filter': 'svg-filter',
    'g@mask': 'svg-mask',
    'tspan@font-variant': 'svg-attribute-font-variant',
    'tspan@paint-order': 'svg-attribute-paint-order',
    'tspan@stroke': 'svg-text-stroke',
    'tspan@stroke-width': 'svg-text-stroke',
  },
  css: {
    'tspan@text-decoration-thickness': 'svg-css-text-decoration-thickness',
    'tspan@text-decoration-skip-spaces': 'svg-css-text-decoration-skip-spaces',
    // 非 solid 的装饰样式由覆盖检查返回 svg-css-text-decoration-style
    'tspan@text-decoration-style:dashed': 'svg-css-text-decoration-style',
    'tspan@text-decoration-style:double': 'svg-css-text-decoration-style',
    'tspan@text-decoration-style:wavy': 'svg-css-text-decoration-style',
    'tspan@text-decoration-style:dotted': 'svg-css-text-decoration-style',
  },
};

const common = new Set('id style fill stroke stroke-width font-family font-size font-weight font-style letter-spacing'.split(' '));
const metadata = new Set('role tabindex target rel pointer-events'.split(' '));
const nodes = {
  svg: 'xmlns xmlns:xlink viewBox x y width height overflow',
  g: 'transform clip-path',
  a: 'href transform clip-path',
  path: 'd transform clip-path fill-rule stroke-dasharray stroke-linecap stroke-linejoin marker-start marker-end opacity',
  rect: 'x y width height transform clip-path fill-rule stroke-dasharray stroke-linecap stroke-linejoin opacity',
  line: 'x1 y1 x2 y2 transform clip-path stroke-dasharray stroke-linecap stroke-linejoin marker-start marker-end opacity',
  circle: 'cx cy r transform clip-path fill-rule stroke-dasharray stroke-linecap stroke-linejoin opacity',
  ellipse: 'cx cy rx ry transform clip-path fill-rule stroke-dasharray stroke-linecap stroke-linejoin opacity',
  image: 'href xlink:href x y width height opacity preserveAspectRatio transform clip-path',
  text: 'x y text-anchor xml:space transform direction unicode-bidi dominant-baseline',
  tspan: 'dx dy xml:space',
  title: '',
  desc: '',
};
const definitions = {
  linearGradient: 'id x1 y1 x2 y2 gradientUnits',
  radialGradient: 'id cx cy r fx fy gradientUnits',
  stop: 'offset stop-color stop-opacity',
  clipPath: 'id clip-rule clipPathUnits',
  marker: 'id viewBox refX refY markerWidth markerHeight markerUnits orient',
  pattern: 'id x y width height patternUnits',
};
const css = new Set('fill stroke stroke-width font-family font-size font-weight font-style letter-spacing text-decoration text-decoration-line text-decoration-color text-decoration-style'.split(' '));
const ignoredCss = new Set(['cursor', 'transform-box', 'transform-origin', 'filter']);

function allowedAttrs(tag) {
  const extra = nodes[tag] ?? definitions[tag];
  if (extra === undefined) return null;
  return new Set([...extra.split(' ').filter(Boolean), ...common]);
}

export function auditSvgDialect(dialect) {
  const gaps = [];
  for (const [tag, info] of Object.entries(dialect.tags)) {
    if (tag === 'defs' || tag === 'style') continue;
    const allowed = allowedAttrs(tag);
    if (!allowed) {
      if (!DIALECT_FALLBACKS.nodes[tag]) gaps.push({kind: 'node', tag, count: info.count});
      continue;
    }
    for (const attr of Object.keys(info.attributes ?? {})) {
      if (attr.startsWith('data-') || attr.startsWith('aria-') || metadata.has(attr)) continue;
      if (allowed.has(attr)) continue;
      const key = `${tag}@${attr}`;
      if (!DIALECT_FALLBACKS.attributes[key]) gaps.push({kind: 'attribute', tag, attr, count: Object.values(info.attributes[attr]).reduce((a, b) => a + b, 0)});
    }
    for (const [prop, values] of Object.entries(info.styles ?? {})) {
      if (ignoredCss.has(prop)) continue;
      if (css.has(prop)) {
        if (prop === 'text-decoration-style') {
          for (const value of Object.keys(values)) {
            if (value === 'solid') continue;
            const key = `${tag}@${prop}:${value}`;
            if (!DIALECT_FALLBACKS.css[key]) gaps.push({kind: 'css-value', tag, prop, value, count: values[value]});
          }
        }
        continue;
      }
      const key = `${tag}@${prop}`;
      if (!DIALECT_FALLBACKS.css[key]) gaps.push({kind: 'css', tag, prop, count: Object.values(values).reduce((a, b) => a + b, 0)});
    }
  }
  return gaps;
}

export async function vectorPdfDialectAuditContract(api, fonts, root, out) {
  execFileSync(process.execPath, ['tooling/inventory-svg-dialect.mjs'], {cwd: root, stdio: 'inherit'});
  const dialect = JSON.parse(readFileSync(resolve(out, 'svg-dialect.json'), 'utf8'));
  assert.ok(dialect.files >= 150, dialect.files);
  assert.ok(dialect.pages >= 500, dialect.pages);
  const gaps = auditSvgDialect(dialect);
  writeFileSync(resolve(out, 'dialect-audit.json'), JSON.stringify({gaps, fallbacks: DIALECT_FALLBACKS}, null, 2) + '\n');
  assert.deepEqual(gaps, [], gaps);

  // 斜角路径带 opacity：默认立体近似写出原生 ExtGState，不再因属性缺口整对象回退。
  const bevel = await api.parse(new Uint8Array(readFileSync('fixtures/sample-three-d.pptx')));
  try {
    for (const el of bevel.slides[0].elements) if (el.kind === 'shape') el.text = null;
    const svg = api.renderSlideToSvg(bevel, bevel.slides[0], {textMode: 'svg'});
    assert.match(svg, /<path[^>]* opacity="/);
    const result = await api.presentationToVectorPdf(bevel, {fonts});
    assert.equal(result.issues.filter(i => i.reason === 'svg-attribute-opacity').length, 0);
    writeFileSync(resolve(out, 'dialect-opacity.pdf'), new Uint8Array(await result.blob.arrayBuffer()));
  } finally { bevel.dispose(); }

  console.log(`方言审计通过：${dialect.files} 文件 / ${dialect.pages} 页，允许项与回退表覆盖全部实发方言`);
}
