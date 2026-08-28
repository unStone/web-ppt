function escaped(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function position(markup, text) {
  const match = markup.match(new RegExp(
    `<tspan class="TextPosition" x="([\\d.]+)" y="([\\d.]+)"><tspan[^>]*font-size="([\\d.]+)px"[^>]*>${escaped(text)}</tspan>`,
  ));
  if (!match) throw new Error(`LibreOffice SVG 缺少列表文字：${text}`);
  return { x: Number(match[1]), y: Number(match[2]), size: Number(match[3]) };
}

const spread = (values) => Math.max(...values) - Math.min(...values);

/** 以真实 Office 的相对坐标取证：改级段必须与同级行共用缩进、字号和续号。 */
export function runListLevelLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('列表级别文字几何');
  const bullets = ['1.', '2.', '3.', '4.'].map((text) => position(markup, text));
  const level0 = ['一级一', '一级二', '二级符号', '一级三']
    .map((text) => position(markup, text));
  const level2 = ['三级编号一', '三级编号二'].map((text) => position(markup, text));
  const yGaps = level0.slice(1).map((item, index) => item.y - level0[index].y);
  const level2Indent = level2[0].x - level0[0].x;
  const sizeRatio = level0[0].size / level2[0].size;
  if (spread(bullets.map((item) => item.x)) > 2
    || spread(bullets.map((item) => item.size)) > 2
    || spread(level0.map((item) => item.x)) > 2
    || spread(level0.map((item) => item.size)) > 2
    || spread(yGaps) > 2
    || level2Indent < 2200 || level2Indent > 2600
    || Math.abs(sizeRatio - 4 / 3) > 0.02) {
    throw new Error(`LibreOffice 列表级别文字几何无效：${JSON.stringify({
      bullets, level0, level2, yGaps, level2Indent, sizeRatio,
    })}`);
  }
  return `，列表同级 x/字号偏差 ≤2 SVG unit、三级缩进差 ${level2Indent.toFixed(0)} unit`;
}
