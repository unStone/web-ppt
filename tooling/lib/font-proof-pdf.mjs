// 仅证明字体嵌入与映射可行；幻灯片 PDF 编码另有票据，不从这里扩展。
const encode = text => new TextEncoder().encode(text);
const hex = value => value.toString(16).padStart(4, '0');
const unicodeHex = text => Array.from({ length: text.length }, (_, i) => hex(text.charCodeAt(i))).join('');
const concat = chunks => {
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0; for (const c of chunks) { result.set(c, offset); offset += c.length; } return result;
};

export function fontProofPdf(rows, {actualText = true} = {}) {
  const objects = [null, null, null];
  const add = value => { objects.push(typeof value === 'string' ? encode(value) : value); return objects.length; };
  const stream = (bytes, extra = '') => add(concat([encode(`<< /Length ${bytes.length} ${extra} >>\nstream\n`), bytes, encode('\nendstream')]));
  const resources = [], commands = [];
  rows.forEach(({ glyphs, info, text, bytes }, row) => {
    if (!glyphs.length || !info.embedding.outlineAllowed) throw new Error('证明 PDF 不允许缺字或拒绝的字体');
    const name = `ProofFont${row}`, units = info.unitsPerEm, scale = 24 / units;
    const fontData = stream(bytes, `/Length1 ${bytes.length}`);
    const bbox = info.bbox.map(n => Math.round(n / units * 1000)).join(' ');
    const descriptor = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${bbox}] /ItalicAngle 0 /Ascent 1100 /Descent -300 /CapHeight 750 /StemV 80 /FontFile2 ${fontData} 0 R >>`);
    // CID 按使用位置分配，不能直接取 gid：ffi 与 ﬃ 可能整形成同一个字形。
    const map = new Uint8Array((glyphs.length + 1) * 2);
    const cmap = [], widths = [];
    glyphs.forEach((g, i) => {
      const cid = i + 1; map[cid * 2] = g.id >> 8; map[cid * 2 + 1] = g.id & 255;
      cmap.push(`<${hex(cid)}> <${unicodeHex(g.unicode)}>`);
      widths.push(`${cid} [${(g.xAdvance / units * 1000).toFixed(4)}]`);
    });
    const cidMap = stream(map);
    const toUnicode = stream(encode(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /${name}UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${cmap.length} beginbfchar\n${cmap.join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end`));
    const descendant = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${cidMap} 0 R /DW 1000 /W [${widths.join(' ')}] >>`);
    const type0 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
    resources.push(`/F${row} ${type0} 0 R`);
    for (let i = 0; i < glyphs.length;) {
      const start = glyphs[i].start, end = glyphs[i].end;
      if (actualText) commands.push(`/Span << /ActualText <FEFF${unicodeHex(text.slice(start, end))}> >> BDC`);
      while (i < glyphs.length && glyphs[i].start === start) {
        const g = glyphs[i];
        commands.push(`BT /F${row} 24 Tf 1 0 0 1 ${(40 + g.x * scale).toFixed(4)} ${(240 - row * 60 + g.y * scale).toFixed(4)} Tm <${hex(i + 1)}> Tj ET`);
        i++;
      }
      if (actualText) commands.push('EMC');
    }
  });
  const content = stream(encode(commands.join('\n')));
  objects[0] = encode('<< /Type /Catalog /Pages 2 0 R >>');
  objects[1] = encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects[2] = encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 300] /Resources << /Font << ${resources.join(' ')} >> >> /Contents ${content} 0 R >>`);
  const parts = [encode('%PDF-1.7\n')], offsets = [0];
  let size = parts[0].length;
  objects.forEach((object, i) => {
    offsets.push(size);
    const part = concat([encode(`${i + 1} 0 obj\n`), object, encode('\nendobj\n')]);
    parts.push(part); size += part.length;
  });
  parts.push(encode(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return concat(parts);
}
