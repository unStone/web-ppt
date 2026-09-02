import { readFileSync } from 'node:fs';

/** LibreOffice 的 SVG path 是独立于浏览器模型的最终 Office 几何真值。 */
export function runCommonObjectSlideLibreOfficeContract({
  savedPath, exportSvg, expectedBounds, savedShapeGeometry, shapeByFillAndFrame, geometryError,
}) {
  if (!savedPath.endsWith('/common-object-slide.pptx')) return '';
  const markup = exportSvg('对象分布与页面尺寸');
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) throw new Error('LibreOffice 公共命令 SVG 缺少 viewBox');
  const viewW = Number(viewBox[1]);
  const viewH = Number(viewBox[2]);
  const targets = [
    ['common-left', '46,117,182'],
    ['common-middle-a', '166,166,166'],
    ['common-middle-b', '112,173,71'],
    ['common-right', '255,192,0'],
  ];
  const bytes = new Uint8Array(readFileSync(savedPath));
  const frames = targets.map(([name, rgb]) => {
    const expected = expectedBounds(savedShapeGeometry(bytes, name), viewW, viewH);
    const actual = shapeByFillAndFrame(markup, rgb, expected).bounds;
    return { actual, error: geometryError(actual, expected) };
  });
  const ordered = frames.map((frame) => frame.actual).sort((left, right) => left.left - right.left);
  const gaps = ordered.slice(1).map((frame, index) => frame.left - ordered[index].right);
  const frameError = Math.max(...frames.map((frame) => frame.error));
  const gapError = Math.max(...gaps) - Math.min(...gaps);
  const ratioError = Math.abs(viewW / viewH - 16 / 9);
  // LibreOffice 的 SVG viewBox 是 1/100 mm 整数，16:9 换算会有末位量化差。
  if (frameError > 3 || gapError > 3 || ratioError > 1e-3) {
    throw new Error(`LibreOffice 公共命令几何偏差 frame=${frameError.toFixed(3)} gap=${gapError.toFixed(3)} ratio=${ratioError}`);
  }
  return `，对象分布 frame/间隙最大偏差 ${frameError.toFixed(3)}/${gapError.toFixed(3)} SVG unit，16:9 画布`;
}
