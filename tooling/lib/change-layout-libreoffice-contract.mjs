import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync, zipSync } from 'fflate';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function pathBounds(pathTag) {
  const coordinates = pathTag.match(/\bd="([^"]+)"/)?.[1]
    ?.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (coordinates.length < 8 || coordinates.length % 2) throw new Error('SVG path 坐标无效');
  const xs = coordinates.filter((_, index) => index % 2 === 0);
  const ys = coordinates.filter((_, index) => index % 2 === 1);
  return {
    left: Math.min(...xs), right: Math.max(...xs),
    top: Math.min(...ys), bottom: Math.max(...ys),
  };
}

const geometryError = (actual, expected) => Math.max(...Object.keys(actual)
  .map((key) => Math.abs(actual[key] - expected[key])));

/** 隐藏页由 PDF 打开；可见 oracle 副本验证投影，重存包验证关系语义。 */
export function runChangeLayoutLibreOfficeContract({ savedPath, out, root, soffice, exportSvg }) {
  const parts = unzipSync(new Uint8Array(readFileSync(savedPath)));
  const decode = (part) => decoder.decode(parts[part]);
  const relationTag = decode('ppt/slides/_rels/slide7.xml.rels')
    .match(/<Relationship\b[^>]*>/g)?.find((tag) => /\bType="[^"]*\/slideLayout"/.test(tag));
  if (!relationTag?.includes('Target="../slideLayouts/slideLayout2.xml"')) {
    throw new Error('LibreOffice 换版式 oracle 的输入关系未指向目标版式');
  }

  // SVG 过滤不提供“导出隐藏页”；oracle 副本只改 show，不改投影和内容。
  const visibleParts = { ...parts };
  visibleParts['ppt/slides/slide7.xml'] = encoder.encode(
    decode('ppt/slides/slide7.xml').replace('<p:sld show="0"', '<p:sld show="1"'),
  );
  const visibleOracle = join(out, 'change-layout-visible-oracle.pptx');
  writeFileSync(visibleOracle, zipSync(visibleParts));
  const markup = exportSvg('换版式继承', visibleOracle);
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox || !['现有页面', '用于验证换版式保持直设位置与格式', '找不到目标占位符也不能丢', '保持原位']
    .every((text) => markup.includes(text))) {
    throw new Error('LibreOffice 换版式渲染缺少原页内容');
  }
  const viewW = Number(viewBox[1]);
  const viewH = Number(viewBox[2]);
  const expected = {
    left: 20 / 1280 * viewW, right: 200 / 1280 * viewW,
    top: 20 / 720 * viewH, bottom: 62 / 720 * viewH,
  };
  const paths = (markup.match(/<path\b[^>]*>/g) ?? []).flatMap((tag) => {
    try { return [{ bounds: pathBounds(tag) }]; } catch { return []; }
  });
  const targetMarker = paths.sort((left, right) =>
    geometryError(left.bounds, expected) - geometryError(right.bounds, expected))[0];
  const markerError = targetMarker ? geometryError(targetMarker.bounds, expected) : Infinity;
  const sourceBand = { left: 0, right: viewW, top: 0, bottom: 18 / 720 * viewH };
  const sourceBandError = Math.min(...paths.map(({ bounds }) => geometryError(bounds, sourceBand)));
  if (markerError > 3 || sourceBandError < 3) {
    throw new Error(`LibreOffice 未切到目标版式静态投影：marker=${markerError.toFixed(3)} source=${sourceBandError.toFixed(3)}`);
  }

  const resaveDir = join(out, 'change-layout-resave');
  mkdirSync(resaveDir, { recursive: true });
  const resavedPath = join(resaveDir, basename(savedPath));
  if (existsSync(resavedPath)) unlinkSync(resavedPath);
  const resaved = spawnSync(soffice, [
    '--headless', '--norestore', '--convert-to', 'pptx', '--outdir', resaveDir, savedPath,
  ], { cwd: root, encoding: 'utf8', timeout: 300_000 });
  if (resaved.error) throw resaved.error;
  if (resaved.status !== 0 || !existsSync(resavedPath)) {
    throw new Error(`LibreOffice 未能重存换版式产物：${resaved.stderr || resaved.stdout}`);
  }
  const resavedParts = unzipSync(new Uint8Array(readFileSync(resavedPath)));
  const resavedRels = decoder.decode(resavedParts['ppt/slides/_rels/slide1.xml.rels']);
  const resavedRelation = resavedRels.match(/<Relationship\b[^>]*>/g)
    ?.find((tag) => /\bType="[^"]*\/slideLayout"/.test(tag));
  const target = resavedRelation?.match(/\bTarget="([^"]+)"/)?.[1];
  const layoutPart = target ? posix.normalize(posix.join('ppt/slides', target)) : '';
  const layoutMarkup = layoutPart && resavedParts[layoutPart]
    ? decoder.decode(resavedParts[layoutPart]) : '';
  if (!target || !layoutMarkup.includes('重点内容')) {
    throw new Error(`LibreOffice 重存后 slideLayout 关系未保持目标版式：${target ?? '缺失'}`);
  }
  return `，换版式静态标记偏差 ${markerError.toFixed(3)} SVG unit/重存关系正确`;
}
