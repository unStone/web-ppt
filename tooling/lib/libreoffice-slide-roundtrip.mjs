import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { unzipSync } from 'fflate';

/** LibreOffice 重存后，按 presentation 关系顺序返回页面与可选 notes 归属。 */
export function roundtripSlideNotes({ savedPath, out, root, soffice, name }) {
  const roundtripDir = join(out, `${name}-roundtrip`);
  mkdirSync(roundtripDir, { recursive: true });
  const roundtripPath = join(roundtripDir, basename(savedPath));
  if (existsSync(roundtripPath)) unlinkSync(roundtripPath);
  const roundtripped = spawnSync(soffice, [
    '--headless', '--norestore', '--convert-to', 'pptx', '--outdir', roundtripDir, savedPath,
  ], { cwd: root, encoding: 'utf8', timeout: 300_000 });
  if (roundtripped.error) throw roundtripped.error;
  if (roundtripped.status !== 0 || !existsSync(roundtripPath)) {
    throw new Error(`LibreOffice 未生成 ${name} roundtrip：${roundtripped.stderr || roundtripped.stdout}`);
  }
  const parts = unzipSync(new Uint8Array(readFileSync(roundtripPath)));
  const decode = (part) => new TextDecoder().decode(parts[part]);
  const attr = (source, attribute) => source
    .match(new RegExp(`(?:^|\\s)${attribute}="([^"]*)"`))?.[1];
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
    .map((relation) => [relation.id, relation]));
  const slideParts = [...decode('ppt/presentation.xml')
    .matchAll(/<(?:\w+:)?sldId\b([^>]*)\/?\s*>/g)]
    .map((match) => presentationRels.get(attr(match[1], 'r:id')))
    .filter((relation) => relation?.type?.endsWith('/slide') && relation.target)
    .map((relation) => resolveTarget('ppt/presentation.xml', relation.target));
  const noteParts = [];
  const notes = slideParts.map((slidePart) => {
    const relation = relationships(relationshipPart(slidePart))
      .find((candidate) => candidate.type?.endsWith('/notesSlide') && candidate.target);
    if (!relation) {
      noteParts.push('');
      return '';
    }
    const notePart = resolveTarget(slidePart, relation.target);
    noteParts.push(notePart);
    return [...decode(notePart).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => match[1]).join('').replace(/\s+/g, '');
  });
  return { parts, slideParts, noteParts, notes };
}
