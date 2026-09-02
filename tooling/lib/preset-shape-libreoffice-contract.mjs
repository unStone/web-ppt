function pathByFill(markup, color) {
  return markup.match(new RegExp(`<path\\b[^>]*fill="rgb\\(${color}\\)"[^>]*>`, 'i'))?.[0] ?? '';
}

function rotatedPoint(frame, local) {
  const radians = frame.rot * Math.PI / 180;
  const center = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const point = { x: frame.x + local.x, y: frame.y + local.y };
  return {
    x: center.x + (point.x - center.x) * Math.cos(radians)
      - (point.y - center.y) * Math.sin(radians),
    y: center.y + (point.x - center.x) * Math.sin(radians)
      + (point.y - center.y) * Math.cos(radians),
  };
}

/** 直接从规范 adj 推导圆角端点；LibreOffice 可见路径必须落在同一点而不是旧 adj 或近似 custGeom。 */
export function runPresetShapeLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('预设形状调节值');
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const roundRect = pathByFill(markup, '46,117,182');
  const star = pathByFill(markup, '166,166,166');
  if (!viewBox || !roundRect || !star) {
    throw new Error('LibreOffice 预设形状 SVG 缺少 viewBox、圆角矩形或星形');
  }
  const move = roundRect.match(/\bd="M\s*(-?[\d.]+)[, ]+(-?[\d.]+)/);
  if (!move || (roundRect.match(/\bC\b/g)?.length ?? 0) !== 4) {
    throw new Error('LibreOffice 没有把 roundRect 渲染为四段圆角曲线');
  }
  const frame = { x: 70, y: 80, w: 260, h: 150, rot: 10 };
  const radius = Math.min(frame.w, frame.h) * 44_000 / 100_000;
  const expectedSlide = rotatedPoint(frame, { x: 0, y: radius });
  const expected = {
    x: expectedSlide.x / 1280 * Number(viewBox[1]),
    y: expectedSlide.y / 720 * Number(viewBox[2]),
  };
  const error = Math.hypot(Number(move[1]) - expected.x, Number(move[2]) - expected.y);
  const starData = star.match(/\bd="([^"]+)"/)?.[1] ?? '';
  const starPoints = (starData.match(/-?[\d.]+/g)?.length ?? 0) / 2;
  if (error > 2 || starPoints !== 11 || !/Z\s*$/.test(starData)) {
    throw new Error(`LibreOffice 预设几何 oracle 失败：roundRect=${error.toFixed(3)} star=${starPoints}`);
  }
  return `，roundRect adj=44000 端点偏差 ${error.toFixed(3)} SVG unit，star5 十顶点闭合路径通过`;
}
