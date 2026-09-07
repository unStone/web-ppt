import { isCompoundFile, readCompoundFile, patchCompoundFile } from '@web-ppt/edit-core/cfb';
import { unzipSync } from 'fflate';
import { patchOpcPackage, disposeOpcPackage } from '@web-ppt/edit-core/opc';
import { parseXmlTree, xmlElementChildren } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const attr = (node: XmlElement, key: string) => node.attributes.find((a) => a.localName === key)?.value;
export const children = (node: XmlElement | undefined, name: string) => node ? xmlElementChildren(node).filter((n) => n.localName === name) : [];
export const child = (node: XmlElement | undefined, name: string) => children(node, name)[0];
export const relPart = (part: string) => part.replace(/([^/]+)$/, '_rels/$1.rels');
export function resolvePart(base: string, target: string): string {
  if (/[:\\?#]/.test(target)) throw new Error('嵌入文档关系必须指向包内文件');
  const path = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') { if (!path.length) throw new Error('嵌入文档关系越界'); path.pop(); }
    else if (segment && segment !== '.') path.push(segment);
  }
  return path.join('/');
}
const zip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;
export interface EmbeddedPackage {
  parts: Record<string, Uint8Array>;
  main: string;
  kind: 'xlsx' | 'docx';
  wrap(parts: Record<string, Uint8Array | null>): Uint8Array;
}

/** Ole10Native 的标签、路径、尾部 Unicode 元数据原样保留，仅替换原生数据区。 */
function nativePayload(bytes: Uint8Array): { bytes: Uint8Array; wrap(bytes: Uint8Array): Uint8Array } | null {
  if (bytes.length < 6) return null;
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), total = d.getUint32(0, true);
  if (total + 4 > bytes.length) return null;
  let start = 4, sizeOffset: number | undefined;
  if (!zip(bytes.subarray(start))) {
    if (d.getUint16(4, true) !== 2) return null;
    start = 6;
    if (!zip(bytes.subarray(start))) {
      for (let i = 0; i < 2; i++) { let end = start; while (end < bytes.length && bytes[end]) end++; if (end - start > 4096 || end === bytes.length) return null; start = end + 1; }
      start += 4; if (start + 4 > bytes.length) return null;
      const commandLength = d.getUint32(start, true); if (commandLength > 4096) return null;
      start += 4 + commandLength; if (start + 4 > bytes.length) return null;
      sizeOffset = start; start += 4;
    }
  }
  const length = sizeOffset === undefined ? total + 4 - start : d.getUint32(sizeOffset, true);
  if (length < 0 || start + length > total + 4 || !zip(bytes.subarray(start))) return null;
  return { bytes: bytes.slice(start, start + length), wrap(payload) {
    const out = new Uint8Array(bytes.length - length + payload.length), v = new DataView(out.buffer);
    out.set(bytes.subarray(0, start)); out.set(payload, start); out.set(bytes.subarray(start + length), start + payload.length);
    v.setUint32(0, total - length + payload.length, true);
    if (sizeOffset !== undefined) v.setUint32(sizeOffset, payload.length, true);
    return out;
  } };
}

export function readEmbeddedPackage(source: Uint8Array): EmbeddedPackage | null {
  let bytes = source, wrap = (value: Uint8Array) => value;
  if (isCompoundFile(source)) {
    const file = readCompoundFile(source), candidates: Array<{ path: string; bytes: Uint8Array; wrap(bytes: Uint8Array): Uint8Array }> = [];
    for (const entry of file.entries) if (entry.type === 2 && entry.bytes && !entry.path.includes('/')) {
      if (entry.name.toLowerCase() === 'package' && zip(entry.bytes)) candidates.push({ path: entry.path, bytes: entry.bytes, wrap: (value) => value });
      if (entry.name.toLowerCase() === '\u0001ole10native') { const payload = nativePayload(entry.bytes); if (payload) candidates.push({ path: entry.path, ...payload }); }
    }
    if (candidates.length !== 1) return null;
    const payload = candidates[0]; bytes = payload.bytes; wrap = (value) => patchCompoundFile(source, { [payload.path]: payload.wrap(value) });
  }
  if (!zip(bytes)) return null;
  let size = 0, count = 0;
  if (bytes.length > 32 * 1024 * 1024) throw new Error('嵌入文档超限');
  const parts = unzipSync(bytes, { filter(file) {
    if ((size += file.originalSize) > 64 * 1024 * 1024 || ++count > 2048) throw new Error('嵌入文档解压超限'); return true;
  } });
  if (!parts['_rels/.rels']) return null;
  const links = children(parseXmlTree(parts['_rels/.rels']).root, 'Relationship').filter((n) => attr(n, 'Type') === `${R}/officeDocument` && attr(n, 'TargetMode') !== 'External');
  if (links.length !== 1) return null;
  const main = resolvePart('', attr(links[0], 'Target') ?? ''); if (!parts[main]) return null;
  const root = parseXmlTree(parts[main]).root;
  const kind = root.localName === 'workbook' ? 'xlsx' : root.localName === 'document' ? 'docx' : null;
  if (!kind) return null;
  return { parts, main, kind, wrap(changes) {
    const borrowed = { format: 'pptx' as const, parts, bytes, disposed: false }, result = patchOpcPackage(borrowed, changes);
    const saved = result.bytes.slice(); if (result.package !== borrowed) disposeOpcPackage(result.package);
    return wrap(saved);
  } };
}
