/**
 * 组合只映射子元素外框：描边、字号、效果保持物理尺寸（LibreOffice 实测与未成组对照形状一致）。
 * 固件见 tooling/make-group-scale-fixture.mjs；第 4、5 页右侧是同尺寸的未成组对照形状。
 */
const groupOf = (overrides) => ({
  kind: 'group', x: 0, y: 0, w: 100, h: 100, rot: 0, flipH: false, flipV: false,
  childX: 0, childY: 0, scaleX: 1, scaleY: 1, children: [], ...overrides,
});
const shapeOf = (overrides) => ({
  kind: 'shape', x: 0, y: 0, w: 10, h: 10, rot: 0, flipH: false, flipV: false,
  path: null, fill: null, stroke: null, text: null, ...overrides,
});

/** 页面中所有 scale()：除组合翻转的 ±1 外不允许出现，任何其他值都意味着子树仍被整体缩放。 */
function nonFlipScales(svg) {
  return [...svg.matchAll(/scale\(([^)]*)\)/g)].map((match) => match[1])
    .filter((value) => !value.trim().split(/\s+/).every((part) => Math.abs(Number(part)) === 1));
}

function maxStrokeWidth(svg) {
  return Math.max(0, ...[...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((match) => Number(match[1])));
}

export function runGroupTransformContract({ lib, parsed, check, eq, near }) {
  const presentation = parsed.get('sample-group-scale.pptx');
  if (!check('组合缩放固件已解析', !!presentation && presentation.slides.length === 6)) return;
  const [, normalizedText, normalizedStroke, scaled, nested, rotated] = presentation.slides;
  const render = (slide, textMode) => lib.renderSlideToSvg(presentation, slide, { textMode });

  for (const textMode of ['html', 'svg']) {
    const scales = presentation.slides.flatMap((slide) => nonFlipScales(render(slide, textMode)));
    eq(`[${textMode}] 组合固件不再对子树整体 scale()`, scales.length, 0);
  }

  // 归一化组合：WPS 的 chExt 只有约 1px，组缩放 600 倍。
  near('归一化子坐标产生 600 倍组变换', normalizedText.elements[0].scaleX, 600);
  const textHtml = render(normalizedText, 'html');
  check('归一化组合内 HTML 按最终宽度排版', textHtml.includes('width:600px;height:160px'), textHtml.slice(0, 500));
  check('归一化组合内 HTML 保持 24pt 字号', textHtml.includes('font-size:32px'), textHtml.slice(0, 500));
  check('归一化组合内原生文本保持 24pt 字号', render(normalizedText, 'svg').includes('font-size="32"'));
  for (const textMode of ['html', 'svg']) {
    const svg = render(normalizedStroke, textMode);
    eq(`[${textMode}] 归一化组合内 3px 描边不被组缩放放大`, maxStrokeWidth(svg), 3);
    check(`[${textMode}] 归一化组合内形状几何按 640×320 折算`, /L 640 /.test(svg) && /320/.test(svg), svg.slice(0, 600));
  }

  // 普通 1.5 倍组合：子元素渲染结果与右侧未成组对照形状只差位置与身份。
  const [group, reference] = scaled.elements;
  const placed = lib.placeGroupChild(group, group.children[0]);
  near('1.5 倍组合子元素外框宽度', placed.w, reference.w, 1e-6);
  near('1.5 倍组合子元素外框高度', placed.h, reference.h, 1e-6);
  near('1.5 倍组合子元素落在组合外框左上角（含 chOff）', group.x + placed.x, 80, 1e-6);
  eq('1.5 倍组合子元素几何与对照形状一致', placed.path, reference.path);
  eq('1.5 倍组合子元素描边保持 6px', placed.stroke.width, reference.stroke.width);
  for (const textMode of ['html', 'svg']) {
    const strip = (markup) => markup.replace(/ transform="[^"]*"/g, '').replace(/ data-el="[^"]*"/g, '');
    const inner = strip(lib.renderElementToSvg({ ...placed, x: 0, y: 0, id: 1, name: '' }, { textMode, idPrefix: 'g-' }).markup);
    const plain = strip(lib.renderElementToSvg({ ...reference, x: 0, y: 0, id: 1, name: '' }, { textMode, idPrefix: 'g-' }).markup);
    eq(`[${textMode}] 1.5 倍组合子元素渲染与未成组对照形状逐字节一致`, inner, plain);
  }

  // 嵌套组合：外层 2 倍、内层 0.5 倍，叶节点最终外框 480×200，与对照形状相同。
  const [outer, nestedReference] = nested.elements;
  const inner = lib.placeGroupChild(outer, outer.children[0]);
  const leaf = lib.placeGroupChild(inner, inner.children[0]);
  near('嵌套组合内层缩放逐层相乘', inner.scaleX, 1, 1e-9);
  near('嵌套叶节点外框宽度', leaf.w, nestedReference.w, 1e-6);
  near('嵌套叶节点外框高度', leaf.h, nestedReference.h, 1e-6);
  near('嵌套叶节点幻灯片 x', outer.x + inner.x + leaf.x, 120, 1e-6);
  near('嵌套叶节点幻灯片 y', outer.y + inner.y + leaf.y, 140, 1e-6);
  eq('嵌套叶节点描边保持 4px', maxStrokeWidth(render(nested, 'svg')), 4);

  // 非等比组合中的旋转子元素保持刚体：30° 不交换宽高，120° 交换（与 LibreOffice 一致）。
  const flipped = rotated.elements[0];
  const [, deg30, deg120] = flipped.children.map((child) => lib.placeGroupChild(flipped, child));
  check('30° 子元素按自身方向缩放（1.5×, 0.75×）', deg30.w === 300 && deg30.h === 60 && deg30.rot === 30,
    `${deg30.w}×${deg30.h}@${deg30.rot}`);
  check('120° 子元素宽高交换承接组缩放（0.75×, 1.5×）', deg120.w === 150 && deg120.h === 120 && deg120.rot === 120,
    `${deg120.w}×${deg120.h}@${deg120.rot}`);
  near('120° 子元素中心按组映射 x', deg120.x + deg120.w / 2, (220 + 100) * 1.5, 1e-6);
  near('120° 子元素中心按组映射 y', deg120.y + deg120.h / 2, (220 + 40) * 0.75, 1e-6);
  check('组合翻转与旋转仍是刚体变换', /rotate\(20 /.test(render(rotated, 'svg'))
    && render(rotated, 'svg').includes('scale(-1 1)'));

  // path data 按轴缩放覆盖相对命令、隐式重复与紧凑弧线标志。
  const scaledPath = (path, scaleX, scaleY) =>
    lib.placeGroupChild(groupOf({ scaleX, scaleY }), shapeOf({ path })).path;
  eq('相对命令、隐式 lineto 与紧凑弧线标志逐项缩放',
    scaledPath('m10 10 20 0 h5 v5 a5 5 0 01 10 0 c1 2 3 4 5 6 s1 1 2 2 q1 1 2 2 t3 3 z', 2, 3),
    'm 20 30 l 40 0 h 10 v 15 a 10 15 0 0 1 20 0 c 2 6 6 12 10 18 s 2 3 4 6 q 2 3 4 6 t 6 9 z');
  eq('等比缩放保留弧线倾角', scaledPath('M 0 0 A 10 5 45 0 1 10 10', 2, 2), 'M 0 0 A 20 10 45 0 1 20 20');
  const tilted = scaledPath('M 0 0 A 10 5 45 0 1 10 10', 2, 1).split(' ').map(Number);
  near('非等比缩放倾斜弧线时面积按 kx·ky 缩放', tilted[4] * tilted[5], 10 * 5 * 2, 0.2);
  check('非等比缩放倾斜弧线时倾角朝拉伸轴偏转', tilted[6] > 0 && tilted[6] < 45, String(tilted));
  eq('90° 倾斜弧线在非等比缩放下交换半轴', scaledPath('M 0 0 A 10 5 90 0 1 10 10', 2, 3), 'M 0 0 A 30 10 90 0 1 20 30');

  let invalid = '';
  try { scaledPath('M 0 0 L x 1', 2, 2); } catch (error) { invalid = error.message; }
  check('无效 path data 立即抛出并定位位置', invalid.includes('路径数据无效') && invalid.includes('位置'), invalid);
  const broken = lib.renderSlideToSvg(presentation, {
    ...scaled,
    elements: [groupOf({ scaleX: 2, scaleY: 2, children: [
      shapeOf({ id: 71, path: 'M 0 0 L x 1' }),
      shapeOf({ id: 72, path: 'M 0 0 L 10 10', stroke: { color: '#000', width: 2, dash: null } }),
    ] })],
  }, { textMode: 'svg' });
  check('组内单个子元素折算失败只占位自身，兄弟照常渲染',
    (broken.match(/data-render-error="1"/g) ?? []).length === 1 && broken.includes('L 20 20'), broken.slice(0, 800));
}
