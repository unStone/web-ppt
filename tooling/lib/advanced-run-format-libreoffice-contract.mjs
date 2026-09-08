function followingText(markup, marker) {
  const at = markup.indexOf(marker);
  const previous = markup.lastIndexOf('<text ', at);
  const previousEnd = markup.lastIndexOf('</text>', at);
  const from = previous > previousEnd ? previous : markup.indexOf('<text ', at);
  const to = markup.indexOf('</text>', from);
  if (at < 0 || from < 0 || to < 0) throw new Error(`LibreOffice SVG 缺少高级文字目标：${marker}`);
  return markup.slice(from, to + 7);
}

/** 由独立排版器证明装饰线、大小写与基线不是只写进 XML。 */
export function runAdvancedRunFormatLibreOfficeContract({ exportSvg }) {
  const markup = exportSvg('高级字符格式');
  const inherited = followingText(markup, 'fill="rgb(46,117,182)"');
  const direct = followingText(markup, 'fill="rgb(255,247,237)"');
  const identity = followingText(markup, 'fill="rgb(239,246,255)"');
  // Linux LibreOffice 会丢掉 PlaceholderText Date class，只能按字段所在形状取第一个叶子 run。
  const dateField = identity.match(/<tspan\b[^>]*style="white-space: pre">[^<]*<\/tspan>/)?.[0] ?? '';
  const inheritedLines = inherited.match(/<path fill="none" stroke="rgb\(46,117,182\)"/g)?.length ?? 0;
  const directLines = direct.match(/<path fill="none" stroke="rgb\(112,48,160\)"/g)?.length ?? 0;
  const sizes = [...direct.matchAll(/font-size="(\d+)px"/g)].map((match) => Number(match[1]));
  const dateText = dateField.match(/>([^<]+)<\/tspan>/)?.[1] ?? '';
  const evidence = {
    inheritedUnderlineAndDoubleStrike: inheritedLines >= 3,
    directUnderlineAndStrike: directLines >= 2,
    smallCaps: new Set(sizes).size >= 2
      && direct.includes('>A</tspan>') && direct.includes('>DVANCED</tspan>'),
    baselineScale: Math.max(...sizes) > 0 && Math.max(...sizes) < 600,
    // 变量日期由 LibreOffice 按执行当天与 locale 输出，不能把生成测试那天写死。
    clearedField: (dateText.match(/\d+/g)?.length ?? 0) >= 2
      && !dateField.includes('text-decoration='),
  };
  if (!Object.values(evidence).every(Boolean)) {
    throw new Error(`LibreOffice 高级文字证据无效：${JSON.stringify({
      ...evidence, inheritedLines, directLines, sizes,
    })}`);
  }
  return `，高级文字装饰线、small caps、baseline 与清除字段格式 oracle 一致`;
}
