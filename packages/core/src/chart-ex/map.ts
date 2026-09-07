import type { ChartEnv } from '../chart/hook';
import type { Fill, SlideElement } from '../types';
import { accentColor, mix, nf, rectEl, shapeEl, solid, textEl } from '../chart/util';
import { attr } from '../xml';
import { child, children } from './data';
import type { ChartExModel } from './model';
import { readGeoCache, geoName } from './map-cache';
import type { GeoPoint } from './map-cache';
const radians = Math.PI / 180;
const robX = [1,.9986,.9954,.99,.9822,.973,.96,.9427,.9216,.8962,.8679,.835,.7986,.7597,.7186,.6732,.6213,.5722,.5322];
const robY = [0,.062,.124,.186,.248,.31,.372,.434,.4958,.5571,.6176,.6769,.7346,.7903,.8435,.8936,.9394,.9761,1];

function projection(kind: string, center: number, latitude: number): (p: GeoPoint) => GeoPoint {
  if (!['mercator', 'miller', 'robinson', 'albers'].includes(kind)) throw new Error('地图投影不支持');
  const phi1 = Math.max(-70, Math.min(70, latitude - 15)) * radians, phi2 = Math.max(-75, Math.min(75, latitude + 15)) * radians;
  const n = (Math.sin(phi1) + Math.sin(phi2)) / 2, c = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  return ([lon, lat]) => {
    const x = (lon - center) * radians, phi = Math.max(-89.999, Math.min(89.999, lat)) * radians;
    if (kind === 'mercator') return [x, -Math.log(Math.tan(Math.PI / 4 + Math.max(-85.05113, Math.min(85.05113, lat)) * radians / 2))];
    if (kind === 'miller') return [x, -1.25 * Math.log(Math.tan(Math.PI / 4 + .4 * phi))];
    if (kind === 'albers' && Math.abs(n) > 1e-5) {
      const rho = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(phi))) / n;
      return [rho * Math.sin(n * x), rho * Math.cos(n * x)];
    }
    if (kind === 'albers') return [x, -Math.sin(phi)];
    const at = Math.min(17, Math.floor(Math.abs(lat) / 5)), t = Math.min(1, Math.abs(lat) / 5 - at);
    return [.8487 * x * (robX[at] * (1 - t) + robX[at + 1] * t), -Math.sign(lat) * 1.3523 * (robY[at] * (1 - t) + robY[at + 1] * t)];
  };
}
function unwrap(ring: GeoPoint[], center: number): GeoPoint[] {
  let previous = center;
  return ring.map(([x, y]) => { while (x - previous > 180) x -= 360; while (x - previous < -180) x += 360; previous = x; return [x, y]; });
}
function clipLongitude(ring: GeoPoint[], bound: number, right: boolean): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], inside = (p: GeoPoint) => right ? p[0] <= bound : p[0] >= bound;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) { const t = (bound - a[0]) / (b[0] - a[0]); out.push([bound, a[1] + t * (b[1] - a[1])]); }
  }
  return out;
}

export function drawRegionMap(root: Element, model: ChartExModel, width: number, height: number, env: ChartEnv): SlideElement[] {
  if (!(width >= 40 && height >= 40) || !Number.isFinite(width + height)) throw new Error('地图画布无效');
  const series = model.series[0], native = children(child(child(child(root, 'chart'), 'plotArea'), 'plotAreaRegion'), 'series')[series.index];
  const geography = child(child(native ?? null, 'layoutPr'), 'geography'); if (!geography) throw new Error('地图地理属性缺失');
  const cache = readGeoCache(geography), values = new Map<string, { value: number; index: number }>();
  series.values.forEach((value, index) => {
    if (value === null) return;
    const id = series.entities?.[index] ?? cache.names.get(geoName(series.categories[0]?.[index] ?? ''));
    if (!id || !cache.regions.some((r) => r.id === id)) throw new Error('地图数据缺少离线边界');
    if (values.has(id)) throw new Error('地图数据区域重复'); values.set(id, { value, index });
  });
  if (!values.size) throw new Error('地图缺少有效数据');
  const selected = cache.regions.filter((r) => values.has(r.id)), sample = selected.flatMap((r) => r.rings.flatMap((p) => p));
  const center = Math.atan2(sample.reduce((s, p) => s + Math.sin(p[0] * radians), 0), sample.reduce((s, p) => s + Math.cos(p[0] * radians), 0)) / radians;
  const latitude = sample.reduce((s, p) => s + p[1], 0) / sample.length;
  const project = projection(attr(geography, 'projectionType') ?? 'mercator', center, latitude);
  const maps = cache.regions.map((region) => ({ ...region, paths: region.rings.flatMap((r) => {
    const points = unwrap(r, center);
    return [-360, 0, 360].map((offset) => clipLongitude(clipLongitude(points.map(([x, y]) => [x + offset, y]), center - 180, false), center + 180, true)).filter((p) => p.length > 2).map((r) => r.map(project));
  }) }));
  const shown = attr(geography, 'viewedRegionType') === 'world' ? maps : maps.filter((r) => values.has(r.id));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const region of shown) for (const ring of region.paths) for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const size = Math.max(8, Math.min(model.size, width / 20, height / 18)), pad = Math.min(width, height) * .04;
  const top = pad + (model.title ? size * 2 : 0), bottom = size * (model.legend ? 4 : 2);
  const scale = Math.min((width - 2 * pad) / Math.max(maxX - minX, 1e-8), (height - top - bottom) / Math.max(maxY - minY, 1e-8));
  const x0 = (width - (maxX - minX) * scale) / 2, y0 = top + (height - top - bottom - (maxY - minY) * scale) / 2;
  const out: SlideElement[] = [rectEl({ x: 0, y: 0, w: width, h: height }, model.background, null)];
  const text = (x: number, y: number, w: number, h: number, value: string, fontSize = size) => out.push(textEl(x, y, w, h, value, { size: fontSize, color: model.textColor, fonts: model.fonts, align: 'center', anchor: 'middle' }));
  if (model.title) text(pad, pad, width - pad * 2, size * 2, model.title);
  const nums = [...values.values()].map((v) => v.value), low = Math.min(...nums), high = Math.max(...nums);
  const fill = (index: number, value: number): Fill => series.points.get(index) ?? (series.colorCategories ? solid(accentColor(env.ctx, value))
    : solid(mix(series.fill.type === 'solid' ? series.fill.color : accentColor(env.ctx, 0), '#ffffff', high === low ? .25 : .85 - .8 * (value - low) / (high - low))));
  // 内外环共用一个路径并保留原始方向，nonzero 填充才能保留湖泊等孔洞。
  for (const region of shown) {
    const item = values.get(region.id); let path = '', x = 0, y = 0, points = 0;
    for (const ring of region.paths) {
      path += ring.map(([px, py], i) => { const sx = x0 + (px - minX) * scale, sy = y0 + (py - minY) * scale; x += sx; y += sy; points++; return `${i ? 'L' : 'M'}${nf(sx)} ${nf(sy)}`; }).join(' ') + 'Z';
    }
    const shape = shapeEl(0, 0, width, height, path, item ? fill(item.index, item.value) : solid('#e2e8f0'), { color: '#ffffff', width: .6, dash: null });
    shape.name = region.name; out.push(shape);
    if (item && series.labels && points) text(x / points - size * 4, y / points - size, size * 8, size * 2, series.categories[0]?.[item.index] ?? region.name, size * .8);
  }
  if (model.legend) {
    const categories = series.colorCategories ? [...new Set(series.colorCategories.filter((v) => v !== null))] : null;
    const count = categories ? Math.min(categories.length, 8) : 8, band = (width - pad * 2) / count;
    for (let i = 0; i < count; i++) out.push(rectEl({ x: pad + i * band, y: height - size * 3.8, w: band, h: size * .7 }, fill(-1, categories ? i : low + (high - low) * i / 7), null));
    if (categories) categories.slice(0, 8).forEach((value, i) => text(pad + i * band, height - size * 3, band, size * 1.5, value, size * .75));
    else { text(pad, height - size * 3, size * 6, size * 1.5, String(low)); text(width - pad - size * 6, height - size * 3, size * 6, size * 1.5, String(high)); }
  }
  const attribution = [...new Set([attr(geography, 'attribution') ?? '', ...shown.flatMap((r) => r.copyrights)].filter(Boolean))].join(' · ');
  if (attribution) text(pad, height - size * 1.4, width - 2 * pad, size * 1.2, attribution, size * .65);
  return out;
}
