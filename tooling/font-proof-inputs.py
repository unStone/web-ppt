"""字体证明的独立名义 cmap 输入；只用于开发验收，不随 SDK 发布。"""
import hashlib
import json
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
samples = root / 'tooling/font-glyph-samples'
out = root / 'out/font-glyphs'
out.mkdir(parents=True, exist_ok=True)
inputs = {}
for name in ['latin.ttf', 'chinese.ttf', 'no-subset.ttf']:
    data = (samples / name).read_bytes()
    font = TTFont(samples / name, recalcTimestamp=False)
    inputs[name] = {
        'sha256': hashlib.sha256(data).hexdigest(),
        'cmap': {str(code): font.getGlyphID(glyph) for code, glyph in font.getBestCmap().items()},
    }
(out / 'proof-inputs.json').write_text(json.dumps(inputs, sort_keys=True, indent=2) + '\n')
print('独立 cmap 输入：out/font-glyphs/proof-inputs.json')
