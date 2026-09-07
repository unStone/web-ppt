import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const parts = unzipSync(readFileSync(new URL('../fixtures/sample-smartart.pptx', import.meta.url)));
const decoder = new TextDecoder(), encoder = new TextEncoder();
const id = (value) => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`.toUpperCase();
};
for (const [part, bytes] of Object.entries(parts)) if (/ppt\/diagrams\/data\d+\.xml/.test(part)) {
  let xml = decoder.decode(bytes).replace(/(modelId|srcId|destId|parTransId|sibTransId|cxnId)="([^"]+)"/g,
    (_, attribute, value) => `${attribute}="${value === '0' ? '0' : id(value)}"`);
  xml = xml.replace('</dgm:dataModel>', '<dgm:extLst><dgm:ext uri="preserve-smartart"><keep xmlns="urn:test">未知数据扩展</keep></dgm:ext></dgm:extLst></dgm:dataModel>');
  parts[part] = encoder.encode(xml);
}
writeFileSync(new URL('../fixtures/sample-smartart-edit.pptx', import.meta.url), makeZip(Object.entries(parts)));
console.log('SmartArt 编辑固件：缓存、自排、原生 GUID 身份、树结构与未知数据扩展');
