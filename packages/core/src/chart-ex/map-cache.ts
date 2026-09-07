import { Inflate } from 'fflate';
import { attr, parseXml } from '../xml';
import { child, children, CX, integer, number } from './data';
export type GeoPoint = [number, number];
export interface GeoRegion { id: string; name: string; rings: GeoPoint[][]; copyrights: string[] }
export interface GeoCache { regions: GeoRegion[]; names: Map<string, string> }
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export const geoName = (value: string) => value.normalize('NFKC').trim().toLowerCase();

/** Bing PCA 将经纬差值用 Cantor 配对后写成 5 bit 变长整数，和普通 polyline 编码不同。 */
export function decodeGeoRing(text: string): GeoPoint[] {
  const result: GeoPoint[] = []; let offset = 0, x = 0, y = 0;
  while (offset < text.length) {
    let value = 0, scale = 1;
    for (;;) {
      const digit = alphabet.indexOf(text[offset++] ?? '');
      if (digit < 0 || offset > text.length || scale > 2 ** 50) throw new Error('地图边界编码无效');
      value += (digit % 32) * scale;
      if (!Number.isSafeInteger(value)) throw new Error('地图边界整数超限');
      if (digit < 32) break; scale *= 32;
    }
    let diagonal = Math.floor((Math.sqrt(8 * value + 1) - 1) / 2);
    while (diagonal * (diagonal + 1) / 2 > value) diagonal--;
    while ((diagonal + 1) * (diagonal + 2) / 2 <= value) diagonal++;
    const ny = value - diagonal * (diagonal + 1) / 2, nx = diagonal - ny;
    x += nx % 2 ? -(nx + 1) / 2 : nx / 2; y += ny % 2 ? -(ny + 1) / 2 : ny / 2;
    if (Math.abs(x) > 18000000 || Math.abs(y) > 9000000 || result.length >= 200000) throw new Error('地图坐标超限');
    result.push([x / 100000, y / 100000]);
  }
  if (result.length < 3) throw new Error('地图多边形顶点不足'); return result;
}

function clearCache(cache: Element): Element[] {
  const clear = children(cache, 'clear');
  for (const binary of children(cache, 'binary')) {
    const value = (binary.textContent ?? '').replace(/\s/g, '');
    if (value.length > 16 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('地图缓存编码无效');
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)), chunks: Uint8Array[] = []; let size = 0;
    const inflate = new Inflate((chunk) => { if ((size += chunk.length) > 16 * 1024 * 1024) throw new Error('地图缓存解压超限'); chunks.push(chunk); });
    // Office 的缓存以 Z_SYNC_FLUSH 结束而没有 BFINAL；用流式解压，随后校验完整 XML。
    for (let i = 0; i < bytes.length; i += 2048) inflate.push(bytes.subarray(i, i + 2048), false);
    const decoded = new Uint8Array(size); let at = 0; for (const chunk of chunks) { decoded.set(chunk, at); at += chunk.length; }
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    if (!/<\/(?:[\w.-]+:)?clear>\s*$/.test(xml)) throw new Error('地图缓存被截断');
    const root = parseXml(xml); if (root.namespaceURI !== CX || root.localName !== 'clear') throw new Error('地图缓存根无效'); clear.push(root);
  }
  return clear;
}
export function readGeoCache(geography: Element): GeoCache {
  const cache = child(geography, 'geoCache'); if (!cache) throw new Error('地图缺少离线边界缓存');
  const regions: GeoRegion[] = [], names = new Map<string, string>(), coordinates = new Map<string, string>(); let points = 0;
  const nodes = clearCache(cache).flatMap((root) => [root, ...root.getElementsByTagName('*')]).filter((n) => n.namespaceURI === CX);
  for (const n of nodes) if (n.localName === 'geoData') {
    const id = attr(n, 'entityId'), name = attr(n, 'entityName'); if (!id || !name) throw new Error('地图区域身份缺失');
    const rings = children(child(n, 'geoPolygons'), 'geoPolygon').flatMap((polygon) => {
      const raw = (attr(polygon, 'pcaRings') ?? '').split(','); if (raw.shift() !== '1') throw new Error('地图边界版本不支持');
      const result = raw.filter(Boolean).map(decodeGeoRing), count = result.reduce((sum, ring) => sum + ring.length, 0);
      if (integer(attr(polygon, 'numPoints'), 200000) !== count || (points += count) > 300000) throw new Error('地图顶点数量无效');
      return result;
    });
    if (rings.length && !regions.some((r) => r.id === id)) regions.push({ id, name, rings, copyrights: children(child(n, 'copyrights'), 'copyright').map((c) => c.textContent ?? '') });
    names.set(geoName(name), id);
  }
  const coordinate = (n: Element) => `${number(attr(n, 'latitude')).toFixed(5)},${number(attr(n, 'longitude')).toFixed(5)}`;
  for (const n of nodes) if (n.localName === 'geoDataPointToEntityQueryResult') {
    const point = child(n, 'geoDataPointQuery'), entity = child(n, 'geoDataPointToEntityQuery');
    if (point && entity && attr(entity, 'entityId')) coordinates.set(coordinate(point), attr(entity, 'entityId')!);
  }
  for (const n of nodes) if (n.localName === 'geoLocationQueryResult') {
    const query = child(n, 'geoLocationQuery'); if (!query) continue;
    const locations = children(child(n, 'geoLocations'), 'geoLocation'); if (locations.length !== 1) continue;
    const location = locations[0], id = coordinates.get(coordinate(location)) ?? names.get(geoName(attr(location, 'entityName') ?? '')); if (!id) continue;
    for (const key of ['countryRegion', 'adminDistrict1', 'adminDistrict2', 'locality', 'postalCode', 'query']) {
      const value = attr(query, key); if (value) names.set(geoName(value), id);
    }
  }
  if (!regions.length) throw new Error('地图缓存没有可绘制边界'); return { regions, names };
}
