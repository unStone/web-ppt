/** `layoutText` 的公共坐标契约；由 test-core 传入已解析固件，避免重复解析。 */
export function runTextLayoutContract({ lib, parsed, allElements, check, eq, near }) {
  if (!check('公开 layoutText', typeof lib.layoutText === 'function')) return;

  let bodies = 0;
  let validBodies = 0;
  let validSegments = 0;
  let segments = 0;
  const audit = (text, w, h, options = {}) => {
    bodies++;
    const layout = lib.layoutText(text, w, h, options);
    let valid = Number.isFinite(layout.scale) && layout.scale > 0
      && Array.isArray(layout.transform) && layout.transform.length === 6
      && layout.transform.every(Number.isFinite);
    for (const line of layout.lines) {
      valid &&= Number.isInteger(line.paragraphIndex) && line.paragraphIndex >= 0
        && line.paragraphIndex < text.paragraphs.length
        && Number.isInteger(line.lineIndex) && line.lineIndex >= 0
        && Number.isInteger(line.columnIndex) && line.columnIndex >= 0
        && [line.x, line.y, line.width, line.height, line.baseline, line.anchorX]
          .every(Number.isFinite)
        && line.width >= 0 && line.height >= 0;
      for (const segment of line.segments) {
        segments++;
        const para = text.paragraphs[line.paragraphIndex];
        const run = segment.runIndex >= 0 ? para.runs[segment.runIndex] : null;
        let segmentValid = segment.bullet
          ? segment.runIndex === -1 && segment.carets.length === 0
          : !!run && segment.from >= 0 && segment.to >= segment.from
            && segment.to <= run.text.length && segment.carets.length >= 1
            && segment.carets[0].offset === segment.from
            && segment.carets.at(-1).offset === segment.to;
        if (!segment.bullet) {
          for (let i = 1; i < segment.carets.length; i++) {
            const a = segment.carets[i - 1];
            const b = segment.carets[i];
            segmentValid &&= a.offset < b.offset && Number.isFinite(a.x) && Number.isFinite(b.x)
              && (line.rtl ? a.x >= b.x : a.x <= b.x);
          }
          if (segment.atomic) segmentValid &&= segment.carets.length === 2;
        }
        segmentValid &&= Number.isFinite(segment.x) && Number.isFinite(segment.width)
          && Number.isFinite(segment.naturalWidth) && segment.width >= 0 && segment.naturalWidth >= 0;
        if (segmentValid) validSegments++;
      }
    }
    if (valid) validBodies++;
    return layout;
  };

  for (const pres of parsed.values()) {
    for (const element of allElements(pres)) {
      if (element.kind === 'shape' && element.text) {
        audit(element.text, element.w, element.h);
      } else if (element.kind === 'table') {
        for (let ri = 0; ri < element.rows.length; ri++) {
          const row = element.rows[ri];
          for (let ci = 0; ci < row.cells.length; ci++) {
            const cell = row.cells[ci];
            if (cell.merged || !cell.text) continue;
            const w = element.colWidths.slice(ci, ci + cell.colSpan).reduce((sum, value) => sum + value, 0)
              || element.colWidths[ci] || 0;
            const h = element.rows.slice(ri, ri + cell.rowSpan).reduce((sum, value) => sum + value.height, 0)
              || row.height;
            audit(cell.text, w, h, { insets: cell.margins, anchor: cell.vAlign, vert: cell.vert });
          }
        }
      }
    }
  }
  check('行盒覆盖大量真实文本体', bodies > 1000, `实际 ${bodies}`);
  eq('全部真实文本体的行盒数值有效', validBodies, bodies);
  check('字符映射覆盖大量真实分段', segments > 1000, `实际 ${segments}`);
  eq('全部真实分段的 UTF-16 映射有效', validSegments, segments);
  console.log(`  ${bodies} 个文本体 · ${segments} 个带字符映射的分段`);

  let source = null;
  for (const pres of parsed.values()) {
    source = allElements(pres).find((element) => element.kind === 'shape' && element.text)?.text ?? null;
    if (source) break;
  }
  if (!check('找到行盒合成基准文本', !!source)) return;

  const run = { ...source.paragraphs[0].runs[0], text: 'A😀ß', caps: 'all', math: undefined,
    spacing: undefined, baseline: undefined };
  const synthetic = {
    ...source,
    anchor: 'top',
    insets: [0, 0, 0, 0],
    wrap: true,
    fontScale: 1,
    autoFitCompute: false,
    autoFitShape: false,
    columns: undefined,
    columnGap: undefined,
    vert: undefined,
    warp: undefined,
    paragraphs: [{ ...source.paragraphs[0], marL: 0, indent: 0, bullet: null, bulletImage: null,
      spaceBefore: 0, spaceAfter: 0, lineHeight: 1, runs: [run] }],
  };
  let measureCalls = 0;
  const monospace = (value) => {
    measureCalls++;
    return [...value].length * 10;
  };
  const exact = lib.layoutText(synthetic, 200, 100, { measureText: monospace });
  const exactSegment = exact.lines[0]?.segments[0];
  eq('注入测量器决定行宽', exact.lines[0]?.width, 40);
  eq('UTF-16 偏移跳过代理项内部', exactSegment?.carets.map((caret) => caret.offset).join(','), '0,1,3,4');
  eq('全大写展开仍映射回单个源字符', exactSegment?.carets.map((caret) => caret.x).join(','), '0,10,20,40');
  check('行盒实际调用注入测量器', measureCalls > 0, `实际 ${measureCalls}`);
  const hit = exactSegment.carets.reduce((best, caret) =>
    Math.abs(caret.x - 19) < Math.abs(best.x - 19) ? caret : best);
  eq('字符 x 偏移可做最近光标命中', hit.offset, 3);
  const light = lib.layoutText(synthetic, 200, 100, { measureText: monospace, includeCarets: false });
  check('轻量行盒可跳过逐字停靠点', light.lines.every((line) =>
    line.segments.every((segment) => segment.carets.length === 0)));

  const rtl = structuredClone(synthetic);
  rtl.paragraphs[0].rtl = true;
  rtl.paragraphs[0].runs[0].text = 'AB';
  rtl.paragraphs[0].runs[0].caps = 'none';
  const rtlCarets = lib.layoutText(rtl, 200, 100, { measureText: monospace })
    .lines[0].segments[0].carets;
  eq('RTL 光标按阅读方向递减', rtlCarets.map((caret) => caret.x).join(','), '20,10,0');

  const broken = structuredClone(synthetic);
  broken.paragraphs[0].runs[0].text = 'A\nB';
  const brokenLayout = lib.layoutText(broken, 200, 100, { measureText: monospace });
  eq('硬换行生成两条行盒', brokenLayout.lines.length, 2);
  eq('硬换行前分段保留源偏移', brokenLayout.lines[0].segments[0].to, 1);
  eq('硬换行后分段跳过换行符', brokenLayout.lines[1].segments[0].from, 2);

  const cjk = structuredClone(synthetic);
  cjk.paragraphs[0].runs[0].text = '「中，文。」';
  cjk.paragraphs[0].runs[0].size = 20;
  const squeezed = lib.layoutText(cjk, 40, 100, { measureText: monospace });
  check('行盒复用 CJK 标点挤压', squeezed.lines.length === 1 && squeezed.lines[0].squeezed);
  check('挤压后的逻辑宽度小于自然宽度', squeezed.lines[0].width < squeezed.lines[0].naturalWidth,
    `${squeezed.lines[0].width}/${squeezed.lines[0].naturalWidth}`);
  near('挤压行最后光标落在有效行宽',
    squeezed.lines[0].segments.at(-1).carets.at(-1).x - squeezed.lines[0].x,
    squeezed.lines[0].width, 0.01);

  const columns = structuredClone(synthetic);
  columns.columns = 2;
  columns.columnGap = 10;
  columns.paragraphs[0].runs[0].text = 'A A A A A A A A A A A A A A';
  const columnLayout = lib.layoutText(columns, 100, 24, { measureText: monospace });
  const columnIds = new Set(columnLayout.lines.map((line) => line.columnIndex));
  check('分栏行盒进入多个物理列', columnIds.has(0) && columnIds.has(1), [...columnIds].join(','));
  check('第二列 x 坐标位于第一列右侧',
    Math.min(...columnLayout.lines.filter((line) => line.columnIndex === 1).map((line) => line.x))
      > Math.min(...columnLayout.lines.filter((line) => line.columnIndex === 0).map((line) => line.x)));

  const vertical = structuredClone(synthetic);
  vertical.vert = 'vert';
  const verticalLayout = lib.layoutText(vertical, 120, 80, { measureText: monospace });
  eq('竖排公开与 SVG 相同的局部仿射变换', verticalLayout.transform.join(','), '0,1,-1,0,120,0');
  eq('竖排交换逻辑排版宽度', verticalLayout.layoutWidth, 80);
  eq('竖排交换逻辑排版高度', verticalLayout.layoutHeight, 120);

  let fitted = null;
  const autoPres = parsed.get('sample-autofit.pptx');
  for (const element of autoPres ? allElements(autoPres) : []) {
    if (element.kind !== 'shape' || !element.text?.autoFitCompute) continue;
    const candidate = lib.layoutText(element.text, element.w, element.h);
    if (candidate.scale < element.text.fontScale) {
      fitted = { element, layout: candidate };
      break;
    }
  }
  if (check('找到实际触发的 normAutofit 行盒', !!fitted)) {
    const html = lib.renderTextBodyToHtml(fitted.element.text, fitted.element.w, fitted.element.h);
    const scale = Number(html.match(/data-font-scale="([^"]+)"/)?.[1]);
    near('HTML 与 engine 行盒共用有效 autofit 比例', fitted.layout.scale, scale, 0.005);
  }

  const mathPres = parsed.get('sample-math.pptx');
  let atomic = null;
  for (const element of mathPres ? allElements(mathPres) : []) {
    if (element.kind !== 'shape' || !element.text) continue;
    const layout = lib.layoutText(element.text, element.w, element.h);
    atomic = layout.lines.flatMap((line) => line.segments).find((segment) => segment.atomic) ?? null;
    if (atomic) break;
  }
  if (check('找到公式原子行盒', !!atomic)) {
    eq('公式只允许光标停在两侧', atomic.carets.length, 2);
    check('公式原子覆盖整个源 run', atomic.from === 0 && atomic.to > atomic.from);
  }

  const before = JSON.stringify(synthetic);
  const stableA = lib.layoutText(synthetic, 200, 100, { measureText: monospace });
  const stableB = lib.layoutText(synthetic, 200, 100, { measureText: monospace });
  eq('相同测量输入产生确定行盒', JSON.stringify(stableB), JSON.stringify(stableA));
  eq('行盒不修改 TextBody', JSON.stringify(synthetic), before);

  const oldDocument = globalThis.document;
  globalThis.document = undefined;
  try {
    const workerLayout = lib.layoutText(synthetic, 200, 100);
    check('行盒 API 可在 Worker 中运行', workerLayout.lines.length > 0);
  } finally {
    globalThis.document = oldDocument;
  }
}
