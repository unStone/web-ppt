import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { unzipSync, unzlibSync } from 'fflate';

const decoder = new TextDecoder();

function balancedGroup(markup, start) {
  const tags = /<\/?g\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return markup.slice(start, tags.lastIndex);
  }
  return '';
}

function customShapeFragments(markup) {
  const marker = '<g class="com.sun.star.drawing.CustomShape">';
  const out = [];
  for (let at = markup.indexOf(marker); at >= 0; at = markup.indexOf(marker, at + marker.length)) {
    const fragment = balancedGroup(markup, at);
    if (fragment) out.push(fragment);
  }
  return out;
}

function box(fragment, className = 'BoundingBox') {
  const match = fragment.match(new RegExp(
    `<rect class="${className}"[^>]* x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`,
  ));
  if (!match) return null;
  return {
    x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]),
  };
}

function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function nearestShape(fragments, expected) {
  return fragments.map((fragment) => ({ fragment, bounds: box(fragment) }))
    .filter((candidate) => candidate.bounds)
    .sort((left, right) => {
      const l = center(left.bounds); const r = center(right.bounds);
      return Math.hypot(l.x - expected.x, l.y - expected.y)
        - Math.hypot(r.x - expected.x, r.y - expected.y);
    })[0]?.fragment ?? '';
}

function pathBounds(fragment) {
  const data = fragment.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1];
  const values = data?.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (values.length < 8 || values.length % 2) throw new Error('LibreOffice 效果形状路径无效');
  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
  };
}

function imageRecords(fragment) {
  return [...fragment.matchAll(
    /<image\b[^>]* x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*xlink:href="data:image\/png;base64,([^"]+)"/g,
  )].map((match) => ({
    x: Number(match[1]), y: Number(match[2]),
    width: Number(match[3]), height: Number(match[4]), data: match[5],
  }));
}

function decodeRgbaPng(base64) {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) {
    throw new Error(`LibreOffice 效果 PNG 格式无效：depth=${bytes[24]} type=${bytes[25]} interlace=${bytes[28]}`);
  }
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const compressed = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let compressedAt = 0;
  for (const chunk of chunks) { compressed.set(chunk, compressedAt); compressedAt += chunk.length; }
  const raw = unzlibSync(compressed);
  const channels = 4; const stride = width * channels;
  const pixels = new Uint8Array(width * height * channels);
  const paeth = (left, up, upperLeft) => {
    const estimate = left + up - upperLeft;
    const dl = Math.abs(estimate - left); const du = Math.abs(estimate - up);
    return dl <= du && dl <= Math.abs(estimate - upperLeft) ? left
      : du <= Math.abs(estimate - upperLeft) ? up : upperLeft;
  };
  let sourceAt = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[sourceAt++];
    if (filter > 4) throw new Error(`LibreOffice 效果 PNG filter 无效：${filter}`);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = raw[sourceAt++];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upperLeft);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  const colors = new Map();
  let alphaMin = 255; let alphaMax = 0; let transparent = 0;
  for (let index = 0; index < pixels.length; index += channels) {
    const alpha = pixels[index + 3];
    if (!alpha) { transparent++; continue; }
    alphaMin = Math.min(alphaMin, alpha); alphaMax = Math.max(alphaMax, alpha);
    const color = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
    colors.set(color, (colors.get(color) ?? 0) + 1);
  }
  const dominant = [...colors].sort((left, right) => right[1] - left[1])[0]?.[0] ?? '';
  return { dominant, alphaMin, alphaMax, transparent };
}

function shapeXml(slideXml, name) {
  const named = slideXml.indexOf(`name="${name}"`);
  const from = slideXml.lastIndexOf('<p:sp>', named);
  const to = slideXml.indexOf('</p:sp>', named);
  if (named < 0 || from < 0 || to < 0) throw new Error(`LibreOffice 重存产物缺少 ${name}`);
  return slideXml.slice(from, to + 7);
}

function attrs(fragment, effectName) {
  const source = fragment.match(new RegExp(`<a:${effectName}\\b([^>]*)>`))?.[1];
  if (source === undefined) return null;
  return Object.fromEntries([...source.matchAll(/([\w:]+)="([^"]*)"/g)]
    .map((match) => [match[1], match[2]]));
}

function close(actual, expected, tolerance) {
  return Math.abs(Number(actual) - expected) <= tolerance;
}

function roundTripWithLibreOffice(savedPath, out, soffice) {
  const output = join(out, basename(savedPath));
  if (existsSync(output)) unlinkSync(output);
  const converted = spawnSync(soffice, [
    '--headless', '--norestore', '--convert-to', 'pptx', '--outdir', out, savedPath,
  ], { encoding: 'utf8', timeout: 300_000 });
  if (converted.error) throw converted.error;
  if (converted.status !== 0 || !existsSync(output)) {
    throw new Error(`LibreOffice 未重存二维效果 PPTX：${converted.stderr || converted.stdout}`);
  }
  return new Uint8Array(readFileSync(output));
}

/** 用 LibreOffice 的可见 SVG 与同格式重存同时验证效果值，避免只让自家解析器读自家输出。 */
export function runShapeEffectsLibreOfficeContract({ savedPath, out, soffice, exportSvg }) {
  const markup = exportSvg('二维效果');
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) throw new Error('LibreOffice 二维效果 SVG 缺少 viewBox');
  const viewW = Number(viewBox[1]); const viewH = Number(viewBox[2]);
  const packageParts = unzipSync(new Uint8Array(readFileSync(savedPath)));
  const presentationXml = decoder.decode(packageParts['ppt/presentation.xml']);
  const size = presentationXml.match(/<p:sldSz cx="(\d+)" cy="(\d+)"\/>/);
  if (!size) throw new Error('二维效果保存产物缺少画布尺寸');
  const slideW = Number(size[1]) / 9525; const slideH = Number(size[2]) / 9525;
  const fragments = customShapeFragments(markup);
  const locate = (x, y, width, height) => nearestShape(fragments, {
    x: (x + width / 2) / slideW * viewW, y: (y + height / 2) / slideH * viewH,
  });

  const shadow = locate(55, 450, 160, 80);
  const shadowPath = pathBounds(shadow); const shadowImage = imageRecords(shadow)[0];
  const shadowPixel = shadowImage && decodeRgbaPng(shadowImage.data);
  const shadowOpacity = Number(shadow.match(/style="opacity: ([\d.]+)"/)?.[1]);
  const shadowShift = shadowImage && {
    x: center(shadowImage).x - center(shadowPath).x,
    y: center(shadowImage).y - center(shadowPath).y,
  };
  const shadowVisual = shadowPixel?.dominant === '15,23,42'
    && Math.abs(shadowOpacity - 0.55) < 0.005
    && Math.abs(shadowShift.x - 8 / slideW * viewW) < 3
    && Math.abs(shadowShift.y - 5 / slideH * viewH) < 3
    && Math.abs(shadowImage.width - shadowPath.width - 10 / slideW * viewW) < 3
    && Math.abs(shadowImage.height - shadowPath.height - 10 / slideH * viewH) < 3;

  const glow = locate(270, 450, 160, 80);
  const glowPath = pathBounds(glow); const glowImages = imageRecords(glow);
  const glowPixels = glowImages.map((image) => decodeRgbaPng(image.data));
  const glowExtents = glowImages.map((image) => (image.width - glowPath.width) / 2)
    .sort((left, right) => left - right);
  const glowVisual = glowPixels.length === 2
    && glowPixels.every((pixel) => pixel.dominant === '124,58,237'
      && Math.abs(pixel.alphaMax - 0.65 * 255) <= 1)
    && Math.abs(glowExtents[0] - 7 / slideW * viewW) < 3
    && Math.abs(glowExtents[1] - 14 / slideW * viewW) < 3;

  const soft = locate(485, 450, 160, 80); const softImage = imageRecords(soft)[0];
  const softPixel = softImage && decodeRgbaPng(softImage.data);
  const softVisual = softPixel?.dominant === '167,243,208'
    && softPixel.alphaMin < 10 && softPixel.alphaMax === 255 && softPixel.transparent > 0
    && Math.abs(softImage.width - 160 / slideW * viewW) < 3
    && Math.abs(softImage.height - 80 / slideH * viewH) < 3;

  const reflection = locate(700, 450, 160, 80);
  const reflectionBaseVisible = reflection.includes('fill="rgb(254,202,202)"');

  const roundTripped = unzipSync(roundTripWithLibreOffice(savedPath, out, soffice));
  const roundTripSlide = decoder.decode(roundTripped['ppt/slides/slide1.xml']);
  const shadowAttrs = attrs(shapeXml(roundTripSlide, 'effects-lo-shadow'), 'outerShdw');
  const glowAttrs = attrs(shapeXml(roundTripSlide, 'effects-lo-glow'), 'glow');
  const softAttrs = attrs(shapeXml(roundTripSlide, 'effects-lo-soft-edge'), 'softEdge');
  const reflectionAttrs = attrs(shapeXml(roundTripSlide, 'effects-lo-reflection'), 'reflection');
  const richXml = shapeXml(roundTripSlide, 'effects-rich');
  const semanticEvidence = shadowAttrs && glowAttrs && softAttrs && reflectionAttrs
    && close(shadowAttrs.blurRad, 47625, 200) && close(shadowAttrs.dist, 89859, 400)
    && close(shadowAttrs.dir, 1920323, 3000)
    && richXml.includes('<a:innerShdw')
    && close(glowAttrs.rad, 66675, 200)
    && close(softAttrs.rad, 28575, 200)
    && reflectionAttrs.stA === '60000' && reflectionAttrs.endPos === '50000'
    && reflectionAttrs.dist === '38100' && reflectionAttrs.dir === '5400000'
    && reflectionAttrs.fadeDir === '5400000' && reflectionAttrs.sy === '-100000';
  const colorEvidence = shapeXml(roundTripSlide, 'effects-lo-shadow')
    .includes('<a:srgbClr val="0F172A"><a:alpha val="55000"')
    && shapeXml(roundTripSlide, 'effects-lo-glow')
      .includes('<a:srgbClr val="7C3AED"><a:alpha val="65000"');

  const evidence = {
    shadowVisual, glowVisual, softVisual, reflectionBaseVisible, semanticEvidence, colorEvidence,
  };
  if (!Object.values(evidence).every(Boolean)) {
    throw new Error(`LibreOffice 二维效果证据无效：${JSON.stringify(evidence)}`);
  }
  return `，二维效果阴影颜色/偏移/模糊、发光颜色/半径、柔边 alpha 均由 SVG 像素验证，倒影等四类效果由 LibreOffice 重存语义验证`;
}
