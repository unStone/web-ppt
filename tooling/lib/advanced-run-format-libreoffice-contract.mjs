function followingText(markup, marker) {
  const at = markup.indexOf(marker);
  const previous = markup.lastIndexOf('<text ', at);
  const previousEnd = markup.lastIndexOf('</text>', at);
  const from = previous > previousEnd ? previous : markup.indexOf('<text ', at);
  const to = markup.indexOf('</text>', from);
  if (at < 0 || from < 0 || to < 0) throw new Error(`LibreOffice SVG 缺少高级文字目标：${marker}`);
  return markup.slice(from, to + 7);
}

/** 由独立排版器证明精确线型、双删除线、大小写与基线不是只写进 XML。 */
export function runAdvancedRunFormatLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('高级字符格式');
  const inherited = followingText(markup, 'fill="rgb(46,117,182)"');
  const direct = followingText(markup, 'fill="rgb(255,247,237)"');
  const date = markup.match(/<tspan class="PlaceholderText Date"[\s\S]*?<\/tspan>/)?.[0] ?? '';
  const inheritedLines = inherited.match(/<path fill="none" stroke="rgb\(46,117,182\)"/g)?.length ?? 0;
  const directLines = direct.match(/<path fill="none" stroke="rgb\(112,48,160\)"/g)?.length ?? 0;
  const sizes = [...direct.matchAll(/font-size="(\d+)px"/g)].map((match) => Number(match[1]));
  const evidence = {
    inheritedDashAndDoubleStrike: inheritedLines >= 3 && inherited.includes('stroke-dasharray='),
    directDotDashAndStrike: directLines >= 2 && direct.includes('stroke-dasharray='),
    smallCaps: new Set(sizes).size >= 2
      && direct.includes('>A</tspan>') && direct.includes('>DVANCED</tspan>'),
    baselineScale: Math.max(...sizes) > 0 && Math.max(...sizes) < 600,
    clearedField: date.includes('>2026/9/3</tspan>') && !date.includes('text-decoration='),
  };
  if (!Object.values(evidence).every(Boolean)) {
    throw new Error(`LibreOffice 高级文字证据无效：${JSON.stringify({
      ...evidence, inheritedLines, directLines, sizes,
    })}`);
  }
  return `，高级文字点划线/双删除线、small caps、baseline 与清除字段格式 oracle 一致`;
}
