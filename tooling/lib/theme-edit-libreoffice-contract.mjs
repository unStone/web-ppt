/** 让独立办公软件证明主题颜色与字体已真正生效，而不只验证 OOXML 词法。 */
export function runThemeEditLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('主题颜色与字体');
  const editedColor = markup.match(/fill="rgb\(17,34,51\)"/g)?.length ?? 0;
  const directColor = markup.match(/fill="rgb\(68,85,102\)"/g)?.length ?? 0;
  const editedFont = markup.match(/font-family="Theme Edited Latin"/g)?.length ?? 0;
  if (editedColor < 1 || directColor < 1 || editedFont < 1) {
    throw new Error(`LibreOffice 主题证据无效：editedColor=${editedColor} directColor=${directColor} editedFont=${editedFont}`);
  }
  return `，主题继承色 ${editedColor} 处、页面直接色 ${directColor} 处、编辑字体 ${editedFont} 处`;
}
