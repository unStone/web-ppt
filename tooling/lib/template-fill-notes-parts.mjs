import { posix } from 'node:path';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync } from 'fflate';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';

function packageReader(parts) {
  const window = new JSDOM('').window;
  const parser = new window.DOMParser();
  return { window, read: part => parser.parseFromString(new TextDecoder().decode(parts[part]), 'application/xml') };
}

function relationships(xml) {
  return [...xml.getElementsByTagNameNS(REL, 'Relationship')];
}

export function inspectTemplateFillNotes(parts, assert) {
  const { window, read } = packageReader(parts);
  try {
    const presentation = read('ppt/presentation.xml');
    const documentRelationships = relationships(read('ppt/_rels/presentation.xml.rels'));
    const masters = documentRelationships.filter(relation => relation.getAttribute('Type') === `${OFFICE}/notesMaster`);
    assert.equal(masters.length, 1, '有备注时必须创建完整 notesMaster 关系');
    const masterPart = posix.normalize(posix.join('ppt', masters[0].getAttribute('Target')));
    assert(parts[masterPart], 'notesMaster 关系必须有实际目标');
    const masterIds = [...presentation.getElementsByTagNameNS(PRESENTATION, 'notesMasterId')];
    assert.equal(masterIds.length, 1, 'presentation 必须保留 notesMasterIdLst');
    assert.equal(masterIds[0].getAttributeNS(OFFICE, 'id'), masters[0].getAttribute('Id'));
    const types = [...read('[Content_Types].xml').getElementsByTagNameNS(TYPES, 'Override')];
    assert(types.some(type => type.getAttribute('PartName') === `/${masterPart}`
      && type.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml'),
    'notesMaster 必须注册正确内容类型');
    const notes = Object.keys(parts).filter(part => /^ppt\/notesSlides\/[^/]+\.xml$/.test(part));
    assert(notes.length > 0, '大纲备注必须物化为 notesSlide');
    for (const part of notes) {
      const relsPart = posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);
      assert(parts[relsPart], 'notesSlide 必须有关系部件');
      const linked = relationships(read(relsPart)).filter(relation => relation.getAttribute('Type') === `${OFFICE}/notesMaster`);
      assert.equal(linked.length, 1, '每份 notesSlide 必须关联 notesMaster');
      assert.equal(posix.normalize(posix.join(posix.dirname(part), linked[0].getAttribute('Target'))), masterPart);
      assert(types.some(type => type.getAttribute('PartName') === `/${part}`
        && type.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'));
    }
    return { masterPart, notes };
  } finally { window.close(); }
}

export function inspectTemplateFillWithoutNotes(parts, assert) {
  const { window, read } = packageReader(parts);
  try {
    assert.equal(read('ppt/presentation.xml').getElementsByTagNameNS(PRESENTATION, 'notesMasterIdLst').length, 0,
      '没有备注的输入和大纲不能新增 notesMasterIdLst');
    assert(!relationships(read('ppt/_rels/presentation.xml.rels')).some(relation => relation.getAttribute('Type') === `${OFFICE}/notesMaster`));
    assert(!Object.keys(parts).some(part => part.startsWith('ppt/notesMasters/')));
  } finally { window.close(); }
}

export async function runTemplateFillNotesReuse({ api, bytes, options, assert }) {
  const parts = unzipSync(bytes);
  const { masterPart } = inspectTemplateFillNotes(parts, assert);
  const { window, read } = packageReader(parts);
  try {
    const xml = read(masterPart);
    let extensions = xml.getElementsByTagNameNS(PRESENTATION, 'extLst')[0];
    if (!extensions) {
      extensions = xml.createElementNS(PRESENTATION, 'p:extLst');
      xml.documentElement.append(extensions);
    }
    const extension = xml.createElementNS(PRESENTATION, 'p:ext');
    extension.setAttribute('uri', 'urn:web-ppt:template-fill:notes-master-keep');
    const marker = xml.createElementNS('urn:web-ppt:template-fill:notes-master-keep', 'keep:marker');
    marker.setAttribute('value', 'original-notes-master');
    extension.append(marker); extensions.append(extension);
    parts[masterPart] = new TextEncoder().encode(new window.XMLSerializer().serializeToString(xml));
  } finally { window.close(); }
  const template = zipSync(parts, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
  const generated = await api.fill.fillTemplate(template, { version: 1, slides: [
    { type: 'title', title: 'Reused notes master', notes: 'New speaker notes' },
  ] }, options);
  const saved = unzipSync(generated.bytes);
  assert.deepEqual(saved[masterPart], parts[masterPart], '原已有 notesMaster 必须逐字节复用，不能被默认母版覆盖');
  assert.equal(inspectTemplateFillNotes(saved, assert).masterPart, masterPart);
}
