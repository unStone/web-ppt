const targetFill = (tag) => {
  const compact = tag.replace(/\s+/g, '').toLowerCase();
  return compact.includes('fill="rgb(217,234,247)"') || compact.includes('fill="#d9eaf7"');
};

function pathBounds(pathTag) {
  const coordinates = pathTag?.match(/\bd="([^"]+)"/)?.[1]
    ?.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (coordinates.length < 8 || coordinates.length % 2) {
    throw new Error('LibreOffice spAutoFit SVG path 坐标无效');
  }
  const xs = coordinates.filter((_, index) => index % 2 === 0);
  const ys = coordinates.filter((_, index) => index % 2 === 1);
  return {
    left: Math.min(...xs), right: Math.max(...xs),
    top: Math.min(...ys), bottom: Math.max(...ys),
  };
}

function readGeometry(markup, label) {
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const paths = markup.match(/<path\b[^>]*>/g)?.filter(targetFill) ?? [];
  if (!viewBox || paths.length !== 1) {
    throw new Error(`LibreOffice ${label} SVG 缺少唯一 spAutoFit 形状或 viewBox`);
  }
  return {
    viewBox: [Number(viewBox[1]), Number(viewBox[2])],
    bounds: pathBounds(paths[0]),
  };
}

/**
 * spAutoFit 的最终高度由消费端按本机字体重新求值，不能拿某一版 LibreOffice 的
 * 绝对坐标当规范。用同一消费端比较编辑前后，才能同时证明改高、旋转锚点和可打开性。
 */
export function runShapeAutofitLibreOfficeContract({ exportSvg, savedPath, sourcePath }) {
  const saved = readGeometry(exportSvg(' spAutoFit 编辑后几何', savedPath), '编辑后');
  const source = readGeometry(exportSvg(' spAutoFit 编辑前几何', sourcePath), '编辑前');
  if (saved.viewBox.join(',') !== source.viewBox.join(',')) {
    throw new Error(`LibreOffice spAutoFit 编辑前后 viewBox 不一致：${source.viewBox} → ${saved.viewBox}`);
  }

  // 固件旋转 90° 且使用顶部锚点：改高会只把左边界向左推，其余三边保持。
  const stableEdgeError = Math.max(
    Math.abs(saved.bounds.right - source.bounds.right),
    Math.abs(saved.bounds.top - source.bounds.top),
    Math.abs(saved.bounds.bottom - source.bounds.bottom),
  );
  const growth = source.bounds.left - saved.bounds.left;
  const sourceWidth = source.bounds.right - source.bounds.left;
  if (stableEdgeError > 3 || growth <= sourceWidth * 2) {
    throw new Error(`LibreOffice spAutoFit 相对几何无效：${JSON.stringify({
      source: source.bounds, saved: saved.bounds, stableEdgeError, growth,
    })}`);
  }
  return `，spAutoFit 旋转 frame 向左增长 ${growth.toFixed(3)} SVG unit，`
    + `固定边最大偏差 ${stableEdgeError.toFixed(3)}`;
}
