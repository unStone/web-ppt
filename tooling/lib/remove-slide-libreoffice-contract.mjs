import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

/** 由 LibreOffice roundtrip 独立证明删除后的页面顺序、渲染与 notes 归属。 */
export function runRemoveSlideLibreOfficeContract({
  savedPath, pages, out, root, soffice, exportSvg,
}) {
  const markup = exportSvg('删除页顺序与页码');
  const titleNumber = (value) => new RegExp(
    `可删除页面 </tspan><tspan[^>]*>${value}</tspan>`,
  ).test(markup);
  if ((markup.match(/可删除页面 <\/tspan>/g) ?? []).length !== 3
    || ![1, 3, 4].every(titleNumber) || titleNumber(2) || pages !== 3) {
    throw new Error('LibreOffice 删除页 SVG 仍含被删页面或丢失存活页');
  }

  const roundtripDir = join(out, 'remove-slide-roundtrip');
  mkdirSync(roundtripDir, { recursive: true });
  const roundtripPath = join(roundtripDir, 'remove-slide.pptx');
  if (existsSync(roundtripPath)) unlinkSync(roundtripPath);
  const roundtripped = spawnSync(soffice, [
    '--headless', '--norestore', '--convert-to', 'pptx', '--outdir', roundtripDir, savedPath,
  ], { cwd: root, encoding: 'utf8', timeout: 300_000 });
  if (roundtripped.error) throw roundtripped.error;
  if (roundtripped.status !== 0 || !existsSync(roundtripPath)) {
    throw new Error(`LibreOffice 未生成删除页 roundtrip：${roundtripped.stderr || roundtripped.stdout}`);
  }
  const parts = unzipSync(new Uint8Array(readFileSync(roundtripPath)));
  const decode = (part) => new TextDecoder().decode(parts[part]);
  const attr = (source, name) => source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
  const relationships = (part) => [...decode(part).matchAll(/<Relationship\b([^>]*)\/?\s*>/g)]
    .map((match) => ({
      id: attr(match[1], 'Id'), type: attr(match[1], 'Type'), target: attr(match[1], 'Target'),
    }));
  const resolveTarget = (fromPart, target) => {
    const normalized = [];
    for (const segment of [...fromPart.split('/').slice(0, -1), ...target.split('/')]) {
      if (!segment || segment === '.') continue;
      if (segment === '..') normalized.pop(); else normalized.push(segment);
    }
    return normalized.join('/');
  };
  const relationshipPart = (part) => {
    const at = part.lastIndexOf('/');
    return `${part.slice(0, at + 1)}_rels/${part.slice(at + 1)}.rels`;
  };
  const presentationRels = new Map(relationships('ppt/_rels/presentation.xml.rels')
    .map((rel) => [rel.id, rel]));
  const slideParts = [...decode('ppt/presentation.xml').matchAll(/<(?:\w+:)?sldId\b([^>]*)\/?\s*>/g)]
    .map((match) => presentationRels.get(attr(match[1], 'r:id')))
    .filter((rel) => rel?.type?.endsWith('/slide') && rel.target)
    .map((rel) => resolveTarget('ppt/presentation.xml', rel.target));
  const notes = slideParts.map((slidePart) => {
    const rel = relationships(relationshipPart(slidePart))
      .find((candidate) => candidate.type?.endsWith('/notesSlide') && candidate.target);
    if (!rel) return '';
    return [...decode(resolveTarget(slidePart, rel.target)).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => match[1]).join('').replace(/\s+/g, '');
  });
  const expectedNotes = ['页面1的独立备注', '页面3的独立备注', '页面4的独立备注'];
  if (slideParts.length !== 3
    || expectedNotes.some((text, index) => !notes[index]?.includes(text))
    || notes.some((text) => text.includes('页面2的独立备注'))) {
    throw new Error(`LibreOffice 删除页 notes 归属无效：${slideParts.join(' → ')}`);
  }
  return '，删除页 3 页顺序/渲染与 notes 归属 roundtrip 一致';
}
