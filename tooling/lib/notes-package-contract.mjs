import { posix } from 'node:path';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync } from 'fflate';

const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const resolveTarget = (host, target) => posix.normalize(posix.join(posix.dirname(host), target));
const relsPart = part => posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);
const elements = (xml, namespace, local) => [...xml.getElementsByTagNameNS(namespace, local)];

/** 同时检查两个关系方向与目录，单有 notesMaster part 仍会让原生阅读器挂起。 */
export function hasNotesMasterClosure(parts) {
  const window = new JSDOM('').window;
  const parser = new window.DOMParser();
  const read = part => parser.parseFromString(new TextDecoder().decode(parts[part]), 'application/xml');
  const links = host => parts[relsPart(host)] ? elements(read(relsPart(host)), REL, 'Relationship') : [];
  const internal = (host, type) => links(host).filter(link => link.getAttribute('Type') === `${OFFICE}/${type}`
    && link.getAttribute('TargetMode') !== 'External');
  try {
    const presentation = 'ppt/presentation.xml';
    const masterLinks = internal(presentation, 'notesMaster');
    if (masterLinks.length !== 1) return false;
    const masterPart = resolveTarget(presentation, masterLinks[0].getAttribute('Target'));
    if (!parts[masterPart] || read(masterPart).documentElement.localName !== 'notesMaster') return false;
    const ids = elements(read(presentation), PRESENTATION, 'notesMasterId');
    if (ids.length !== 1 || ids[0].getAttributeNS(OFFICE, 'id') !== masterLinks[0].getAttribute('Id')) return false;
    const types = elements(read('[Content_Types].xml'), TYPES, 'Override');
    const hasType = (part, type) => types.some(entry => entry.getAttribute('PartName') === `/${part}`
      && entry.getAttribute('ContentType') === `application/vnd.openxmlformats-officedocument.presentationml.${type}+xml`);
    if (!hasType(masterPart, 'notesMaster')) return false;
    const themes = internal(masterPart, 'theme');
    if (themes.length !== 1 || !parts[resolveTarget(masterPart, themes[0].getAttribute('Target'))]) return false;
    const notes = Object.keys(parts).filter(part => /^ppt\/notesSlides\/[^/]+\.xml$/.test(part));
    return notes.length > 0 && notes.every(part => {
      const masters = internal(part, 'notesMaster'), slides = internal(part, 'slide');
      return hasType(part, 'notesSlide') && masters.length === 1 && slides.length === 1
        && resolveTarget(part, masters[0].getAttribute('Target')) === masterPart
        && !!parts[resolveTarget(part, slides[0].getAttribute('Target'))];
    });
  } finally { window.close(); }
}

/** 独立制造历史缺闭包输入，保证默认保存不会顺带修理调用者未编辑的源文稿。 */
export function withoutNotesMasterClosure(bytes) {
  const parts = unzipSync(bytes);
  const window = new JSDOM('').window;
  const parser = new window.DOMParser(), serializer = new window.XMLSerializer();
  try {
    for (const part of Object.keys(parts)) {
      if (part.startsWith('ppt/notesMasters/')) { delete parts[part]; continue; }
      if (part !== 'ppt/presentation.xml' && part !== '[Content_Types].xml' && !part.endsWith('.rels')) continue;
      const xml = parser.parseFromString(new TextDecoder().decode(parts[part]), 'application/xml');
      const removed = [
        ...elements(xml, PRESENTATION, 'notesMasterIdLst'),
        ...elements(xml, REL, 'Relationship').filter(link => link.getAttribute('Type') === `${OFFICE}/notesMaster`
          || part.startsWith('ppt/notesSlides/_rels/') && link.getAttribute('Type') === `${OFFICE}/slide`),
        ...elements(xml, TYPES, 'Override').filter(entry => entry.getAttribute('PartName').startsWith('/ppt/notesMasters/')),
      ];
      if (!removed.length) continue;
      for (const node of removed) node.remove();
      parts[part] = new TextEncoder().encode(serializer.serializeToString(xml));
    }
    return zipSync(parts, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
  } finally { window.close(); }
}
