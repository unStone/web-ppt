import { packageTargetParts, resolveRelationshipTarget } from './clipboard-source';
import { retainPackageSource } from './session-assets';
import type { EditDoc, ElementRecord, SlideRecord } from './types';

export function insertionPackageTargets(record: ElementRecord | null): string[] {
  const insertion = record?.meta.insertion;
  const origin = record?.meta.origin;
  if (!insertion || !origin) return [];
  return (insertion.relationships ?? []).flatMap((relation) => {
    if (relation.targetMode) return [];
    const target = resolveRelationshipTarget(origin.part, relation.target);
    return insertion.resources?.some((resource) => resource.targetPart === target) ? [] : [target];
  });
}

/** 命令、协同和恢复都在结构补丁落模前保留依赖，不能依赖本地命令的准备过程。 */
export function retainInsertionSources(doc: EditDoc, tree: { records: Readonly<Record<string, ElementRecord | null>>; slide?: SlideRecord }): void {
  const pkg = doc.package;
  if (!pkg || pkg.disposed) return;
  const creation = tree.slide?.creation;
  if (creation) retainPackageSource(doc, [creation.duplicateSourcePart ?? '', creation.duplicateNotesSourcePart ?? '']);
  for (const target of new Set(Object.values(tree.records).flatMap(insertionPackageTargets))) {
    if (pkg.parts[target]) retainPackageSource(doc, packageTargetParts(pkg, target));
  }
}
