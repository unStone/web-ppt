"""以 MuPDF 和 FontTools 独立核验正式 Provider 的浏览器产物。"""
import hashlib
import io
import json
from pathlib import Path
import fitz
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.svgLib.path import parse_path

class OutlinePen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.commands = []
        self.start = None
    def _moveTo(self, point):
        self.start = point
        self.commands.append(('M', point))
    def _lineTo(self, point):
        self.commands.append(('L', point))
    def _curveToOne(self, first, second, end):
        self.commands.append(('C', first, second, end))
    def _qCurveToOne(self, control, end):
        self.commands.append(('Q', control, end))
    def _closePath(self):
        if self.commands[-1] == ('L', self.start):
            self.commands.pop()
        self.commands.append(('Z',))

root = Path(__file__).resolve().parent.parent
out = root / 'out/font-glyphs'
browser = json.loads((out / 'proof-browser.json').read_text())
expected = '\n'.join(row['text'] for row in browser['rows']) + '\n'
results = []
outlines = 0
for row in browser['rows']:
    font = TTFont(root / 'tooling/font-glyph-samples' / row['sourceFile'], recalcTimestamp=False)
    glyph_set = font.getGlyphSet()
    for glyph in row['glyphs']:
        expected_pen, svg_pen = OutlinePen(glyph_set), OutlinePen(glyph_set)
        glyph_set[font.getGlyphName(glyph['id'])].draw(expected_pen)
        parse_path(glyph['path'], svg_pen)
        assert expected_pen.commands == svg_pen.commands, (row['text'], glyph['id'], '轮廓路径与独立 FontTools 不同')
        outlines += 1
for filename in ['font-proof.pdf', 'font-proof-tounicode.pdf']:
    document = fitz.open(out / filename)
    page = document[0]
    text = page.get_text()
    assert text == expected, (filename, repr(text), repr(expected))
    assert not page.get_images(), '字体证明页不应含栅格图片'
    fonts = []
    for entry, row in zip(page.get_fonts(full=True), browser['rows'], strict=True):
        _, ext, kind, data = document.extract_font(entry[0])
        source = (root / 'tooling/font-glyph-samples' / row['sourceFile']).read_bytes()
        assert data == source, 'PDF 嵌入字节与浏览器整形依据不同'
        assert hashlib.sha256(data).hexdigest() == row['sha256']
        font = TTFont(io.BytesIO(data), recalcTimestamp=False)
        assert font['OS/2'].fsType == row['info']['fsType']
        assert font['head'].unitsPerEm == row['info']['unitsPerEm']
        fonts.append({'kind': kind, 'format': ext, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                      'glyphs': font['maxp'].numGlyphs, 'unitsPerEm': font['head'].unitsPerEm,
                      'fsType': font['OS/2'].fsType})
    glyphs = [(index, row, glyph) for index, row in enumerate(browser['rows']) for glyph in row['glyphs']]
    trace = page.get_texttrace()
    assert len(trace) == len(glyphs)
    errors = []
    for span, (index, row, glyph) in zip(trace, glyphs, strict=True):
        painted = [char for char in span['chars'] if char[1] >= 0]
        assert len(painted) == 1 and painted[0][1] == glyph['id']
        assert all(char[0] != 65533 for char in span['chars']), '存在未映射字形'
        x, y = painted[0][2]
        errors.append(max(abs(x - (40 + glyph['x'] * 24 / row['info']['unitsPerEm'])),
                          abs(y - (60 + index * 60 - glyph['y'] * 24 / row['info']['unitsPerEm']))))
    assert max(errors) < 0.001, max(errors)
    page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(out / filename.replace('.pdf', '.png'))
    results.append({'file': filename, 'sha256': hashlib.sha256((out / filename).read_bytes()).hexdigest(),
                    'text': text, 'fonts': fonts, 'paintedGlyphs': len(glyphs), 'maxOriginErrorPt': max(errors), 'images': 0})
result = {'reader': 'MuPDF ' + fitz.VersionBind, 'fontToolsOutlines': outlines, 'results': results}
(out / 'independent.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
