import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();

/** 主题写回只从公开接口、包差异、重解析和独立进程双文本指纹取证。 */
export async function runThemeEditSaveContract({
  edit, core, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ Theme 最小写回与渲染等价\x1b[0m');
  const input = load('sample-editor-theme.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'theme-save-' });
  const editor = new edit.Editor(doc);
  const theme = edit.listThemes(doc).find((item) => item.name === 'Add Slide Theme');
  const other = edit.listThemes(doc).find((item) => item.name === 'Target Layout Theme');
  if (!check('找到主题保存目标与无关主题', !!theme && !!other)) return;
  const otherBytes = doc.package.parts[other.id].slice();
  editor.exec({
    type: 'SetTheme', id: theme.id,
    clrScheme: { accent1: '#112233' },
    fontScheme: { minor: { latin: 'Theme Edited Latin', scripts: { Jpan: 'Theme Japanese' } } },
  });
  const projected = editor.toSlide(doc.slideOrder[0]);
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('theme-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const xml = decoder.decode(saved.package.parts[theme.id]);
  check('保存只改目标主题 part 并保留未知来源词法',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === theme.id
      && xml.includes('data-keep="theme-source"')
      && xml.includes('val="112233"')
      && xml.includes('typeface="Theme Edited Latin"')
      && xml.includes('script="Jpan"') && xml.includes('typeface="Theme Japanese"')
      && Buffer.compare(Buffer.from(saved.package.parts[other.id]), Buffer.from(otherBytes)) === 0,
  `artifact=${artifact}`);
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopened, { idPrefix: 'theme-save-reopen-' });
  const reopenedTheme = edit.queryTheme(reopenedDoc, theme.id);
  check('主题保存重开保留颜色、字体与脚本映射',
    reopenedTheme.colors.accent1 === 'rgb(17,34,51)'
      && reopenedTheme.fonts.minor.latin === 'Theme Edited Latin'
      && reopenedTheme.fonts.minor.scripts.Jpan === 'Theme Japanese');
  const scenario = {
    type: 'theme', file: 'sample-editor-theme.pptx', slideIndex: 0,
    themeName: 'Add Slide Theme',
    clrScheme: { accent1: '#112233' },
    fontScheme: { minor: { latin: 'Theme Edited Latin', scripts: { Jpan: 'Theme Japanese' } } },
  };
  const before = renderFingerprint(scenario.file, 'projected', scenario);
  const after = renderFingerprint(artifact, 'saved', scenario);
  check('保存前后 HTML 与原生 SVG 在独立进程中投影指纹一致',
    before.html === after.html && before.svg === after.svg);
  const projectedNamed = Object.fromEntries(projected.elements
    .filter((element) => element.name).map((element) => [element.name, element]));
  const reopenedNamed = Object.fromEntries(reopened.slides[0].elements
    .filter((element) => element.name).map((element) => [element.name, element]));
  check('同进程即时投影与重开保留主题继承及页面直接格式',
    projectedNamed['普通业务形状']?.fill?.color === reopenedNamed['普通业务形状']?.fill?.color
      && projectedNamed['主题样式引用']?.fill?.color === reopenedNamed['主题样式引用']?.fill?.color
      && projectedNamed['页面直接格式']?.fill?.color === reopenedNamed['页面直接格式']?.fill?.color);
  edit.disposeDoc(reopenedDoc);
  const identity = await editor.saveDetailed();
  check('相同主题模型连续保存复用当前包 identity', identity.mode === 'identity' && identity.bytes === saved.bytes);
  editor.undo();
  const reset = await editor.saveDetailed();
  check('保存后撤销主题覆盖恢复完整原包', diffPackageBytes(input, reset.bytes).equal);
  edit.disposeDoc(doc);
}
