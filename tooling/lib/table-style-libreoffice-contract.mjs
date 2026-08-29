/** LibreOffice 是独立样式求值 oracle：验证四类行色、直接格式与表头文字优先级。 */
export function runTableStyleLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('表样式切换与直接格式');
  const table = markup.match(/<g class="com\.sun\.star\.drawing\.TableShape">\s*<g>([\s\S]*?)<\/g>\s*<\/g>/)?.[1];
  if (!table) throw new Error('LibreOffice 表样式 SVG 缺少 TableShape');
  const filled = table.match(/<path\b[^>]*\bfill="rgb\([^)]*\)"[^>]*>/g) ?? [];
  const count = (color) => filled.filter((tag) => tag.includes(`fill="rgb(${color})"`)).length;
  const directText = table.match(/<tspan[^>]*fill="rgb\(16,185,129\)"[^>]*>0:1<\/tspan>/);
  const boldHeader = table.match(/<tspan[^>]*font-weight="700"[^>]*fill="rgb\(255,255,255\)"[^>]*>0:0<\/tspan>/);
  const directBorder = table.match(/stroke="rgb\(220,38,38\)"/g)?.length ?? 0;
  if (filled.length !== 16 || count('239,68,68') !== 4 || count('59,130,246') !== 3
    || count('17,24,39') !== 1 || count('250,204,21') !== 4 || count('34,197,94') !== 4
    || !directText || !boldHeader || directBorder < 1) {
    throw new Error(`LibreOffice 表样式证据无效：cells=${filled.length} fills=${count('239,68,68')}/${count('59,130,246')}/${count('17,24,39')}/${count('250,204,21')}/${count('34,197,94')} border=${directBorder}`);
  }
  return '，表样式 4/3/1/4/4 单元格行色、表头文字与直接格式 oracle 一致';
}
