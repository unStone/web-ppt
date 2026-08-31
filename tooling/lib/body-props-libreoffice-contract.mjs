import { readFileSync } from 'node:fs';

/** LibreOffice 会按本机字体拆分 TextPosition，并重新求 spAutoFit；门禁只比较稳定语义。 */
export function runBodyPropsLibreOfficeContract({
  savedPath, sourcePath, exportSvg,
  expectedBounds, savedShapeGeometry, shapeByFillAndFrame,
  geometryError, followingText, textPositions,
}) {
  const markup = exportSvg('文字框属性', savedPath);
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) throw new Error('LibreOffice 文字框属性 SVG 缺少 viewBox');
  const viewW = Number(viewBox[1]);
  const viewH = Number(viewBox[2]);
  const frame = (bytes, name) => expectedBounds(
    savedShapeGeometry(bytes, name), viewW, viewH,
  );
  const savedBytes = new Uint8Array(readFileSync(savedPath));
  const sourceMarkup = exportSvg('文字框属性编辑前基线', sourcePath);
  const sourceViewBox = sourceMarkup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!sourceViewBox || Number(sourceViewBox[1]) !== viewW || Number(sourceViewBox[2]) !== viewH) {
    throw new Error('LibreOffice 文字框属性编辑前后 viewBox 不一致');
  }
  const sourceBytes = new Uint8Array(readFileSync(sourcePath));

  const columnsExpected = frame(savedBytes, '分栏与锚点');
  const columnsShape = shapeByFillAndFrame(markup, '254,243,199', columnsExpected);
  const columnsGeometryError = geometryError(columnsShape.bounds, columnsExpected);
  const positions = textPositions(followingText(markup, columnsShape.tag));
  const leftInsetExpected = columnsShape.bounds.left + 18 / 1280 * viewW;
  const columnStrideExpected = 296 / 1280 * viewW;
  const closestXError = (expected) => Math.min(
    ...positions.map((position) => Math.abs(position.x - expected)),
  );
  // 缺少中文字体时一行会被拆成多个 TextPosition；两列起点仍必须命中。
  const columnsError = Math.max(
    closestXError(leftInsetExpected),
    closestXError(leftInsetExpected + columnStrideExpected),
  );
  const maxY = Math.max(...positions.map((position) => position.y));
  if (columnsGeometryError > 3 || columnsError > 30
    || maxY < columnsShape.bounds.top + (columnsShape.bounds.bottom - columnsShape.bounds.top) * 0.65) {
    throw new Error(`LibreOffice 分栏/边距/底部锚点偏差 geometry=${columnsGeometryError.toFixed(3)} layout=${columnsError.toFixed(3)}`);
  }

  const directionExpected = frame(savedBytes, '文字方向-水平');
  const directionShape = shapeByFillAndFrame(markup, '245,243,255', directionExpected);
  const directionText = followingText(markup, directionShape.tag);
  const directionPositions = textPositions(directionText);
  const directionContent = directionText.replace(/<[^>]+>/g, '');
  // LibreOffice 24 会用 transform 近似不支持的 wordArtVert；精确方向由本引擎指纹与
  // PowerPoint 门禁负责，这里只证明外部消费端没有丢掉文字或 frame。
  if (geometryError(directionShape.bounds, directionExpected) > 3
    || directionPositions.length < 2 || !directionContent.includes('文字方向-水平')) {
    throw new Error('LibreOffice 未渲染 wordArtVert 目标文字');
  }

  const growExpected = frame(savedBytes, '自动适应-无');
  const growShape = shapeByFillAndFrame(markup, '236,253,245', growExpected);
  const growSourceShape = shapeByFillAndFrame(
    sourceMarkup, '236,253,245', frame(sourceBytes, '自动适应-无'),
  );
  const growStableEdgeError = Math.max(
    Math.abs(growShape.bounds.left - growSourceShape.bounds.left),
    Math.abs(growShape.bounds.right - growSourceShape.bounds.right),
    Math.abs(growShape.bounds.top - growSourceShape.bounds.top),
  );
  const growAmount = growShape.bounds.bottom - growSourceShape.bounds.bottom;
  const sourceGrowHeight = growSourceShape.bounds.bottom - growSourceShape.bounds.top;
  const noneExpected = frame(savedBytes, '自动适应-缩小');
  const noneShape = shapeByFillAndFrame(markup, '236,253,245', noneExpected);
  const noneMaxY = Math.max(...textPositions(followingText(markup, noneShape.tag))
    .map((position) => position.y));
  if (growStableEdgeError > 3 || growAmount <= sourceGrowHeight * 0.5
    || noneMaxY < noneShape.bounds.bottom + viewH * 0.05) {
    throw new Error(`LibreOffice autofit 模式证据无效：${JSON.stringify({
      growStableEdgeError, growAmount,
      noneOverflow: noneMaxY - noneShape.bounds.bottom,
    })}`);
  }
  const maxError = Math.max(columnsGeometryError, columnsError, growStableEdgeError);
  return `，bodyPr frame/分栏最大偏差 ${maxError.toFixed(3)} SVG unit`;
}
