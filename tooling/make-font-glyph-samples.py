"""字体验收样本：固定上游、固定字集、固定时间；不进入发布包。"""
import hashlib
import json
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont, TTCollection
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
upstream = root / 'out/font-glyphs/upstream'
dest = root / 'tooling/font-glyph-samples'
dest.mkdir(parents=True, exist_ok=True)
sources = json.loads((dest / 'sources.json').read_text())
for item in sources:
    assert hashlib.sha256((upstream / item['name']).read_bytes()).hexdigest() == item['sha256'], item['name']

latin_text = 'AV office ffi ﬁ ﬃ a\u0301 q\u0307 café ABC abc 0123456789'
chinese_text = '中文测试你好世界，。ABC abc 0123456789'

def rename(font, family):
    style = 'Bold' if font['OS/2'].usWeightClass == 700 else 'Regular'
    ps = family.replace(' ', '') + '-' + style
    # 修改过的 OFL 子集换名，避免保留字体名称的歧义。
    for record in font['name'].names:
        value = {1: family, 2: style, 3: ps, 4: family + ' ' + style, 6: ps, 16: family, 17: style}.get(record.nameID)
        if value is not None:
            record.string = value.encode(record.getEncoding())
    if 'CFF ' in font:
        font['CFF '].cff.fontNames = [ps]
        top = font['CFF '].cff.topDictIndex[0]
        top.FamilyName, top.FullName = family, family + ' ' + style
    font['head'].created = font['head'].modified = 2082844800

if '--full-chinese' in sys.argv:
    font = TTFont(upstream / 'chinese-variable.ttf', recalcTimestamp=False)
    font = instantiateVariableFont(font, {'wght': 400}, inplace=True)
    rename(font, 'WebPPT Glyph Full Chinese')
    target = root / 'out/font-glyphs/chinese-full.ttf'
    font.save(target)
    report = {'source': 'chinese-variable.ttf', 'weight': 400, 'subset': False,
              'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
              'glyphs': font['maxp'].numGlyphs, 'unitsPerEm': font['head'].unitsPerEm}
    (target.parent / 'chinese-full.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    sys.exit(0)

def sample(source, target, text, family, weight=None):
    font = TTFont(upstream / source, recalcTimestamp=False)
    if weight is not None:
        font = instantiateVariableFont(font, {'wght': weight}, inplace=True)
    options = subset.Options()
    options.recalc_timestamp = False
    options.layout_features = ['*']
    sub = subset.Subsetter(options=options)
    sub.populate(text=text)
    sub.subset(font)
    rename(font, family)
    font.save(dest / target)
    return font

regular = sample('latin.ttf', 'latin.ttf', latin_text, 'WebPPT Glyph Latin')
sample('latin-bold.ttf', 'latin-bold.ttf', latin_text, 'WebPPT Glyph Latin')
sample('chinese-variable.ttf', 'chinese.ttf', chinese_text, 'WebPPT Glyph Chinese', 400)
sample('chinese-variable.ttf', 'variable.ttf', chinese_text, 'WebPPT Glyph Variable')
sample('chinese-cff.otf', 'cff.otf', chinese_text, 'WebPPT Glyph CFF')
for flavor in ['woff', 'woff2']:
    font = TTFont(dest / 'latin.ttf', recalcTimestamp=False)
    font.flavor = flavor
    font.save(dest / ('latin.' + flavor))
collection = TTCollection()
collection.fonts = [TTFont(dest / 'latin.ttf', recalcTimestamp=False), TTFont(dest / 'latin-bold.ttf', recalcTimestamp=False)]
collection.save(dest / 'collection.ttc')
for name, flags in [('restricted', 2), ('preview', 4), ('editable', 8), ('no-subset', 0x100), ('bitmap', 0x200)]:
    font = TTFont(dest / 'latin.ttf', recalcTimestamp=False)
    font['OS/2'].fsType = flags
    font.save(dest / (name + '.ttf'))
for name in ['latin-OFL.txt', 'chinese-OFL.txt', 'cff-OFL.txt']:
    (dest / name).write_bytes((upstream / name).read_bytes())
manifest = [{ 'name': p.name, 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest() }
            for p in sorted(dest.iterdir()) if p.suffix in ['.ttf', '.otf', '.woff', '.woff2', '.ttc', '.txt']]
(dest / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
