import { parseArgs } from 'node:util';
import { ALL_OFFICE_ARTIFACTS, EDIT_SAVE_OFFICE_ARTIFACTS } from './edit-save-office-artifacts.mjs';

export function selectEditOfficeArtifacts(args) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      'include-site': { type: 'boolean', default: false },
      'site-only': { type: 'boolean', default: false },
    },
  });
  if (values['include-site'] && values['site-only']) {
    throw new Error('--include-site 与 --site-only 不能同时使用');
  }
  const models = EDIT_SAVE_OFFICE_ARTIFACTS.map((artifact) => ({
    ...artifact,
    path: `out/edit-save/${artifact.file}`,
  }));
  if (values['include-site']) return ALL_OFFICE_ARTIFACTS;
  if (!values['site-only']) return models;

  // 官网产物从同一份总清单扣除模型产物，新增工件无需维护第二份路径和页数。
  const modelPaths = new Set(models.map((artifact) => artifact.path));
  return ALL_OFFICE_ARTIFACTS.filter((artifact) => !modelPaths.has(artifact.path));
}
