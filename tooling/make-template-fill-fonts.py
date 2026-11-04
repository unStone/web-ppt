import hashlib
import json
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
upstream = root / 'out/font-glyphs/upstream'
dest = root / 'tooling/template-fill-fonts'
dest.mkdir(parents=True, exist_ok=True)
sources = {item['name']: item for item in json.loads((root / 'tooling/font-glyph-samples/sources.json').read_text())}
characters = list(range(0x20, 0x7F)) + [0xA0, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2023, 0x25E6]
manifest = []

for source_name, name in [('latin.ttf', 'regular.ttf'), ('latin-bold.ttf', 'bold.ttf')]:
    source = sources[source_name]
    data = (upstream / source_name).read_bytes()
    if hashlib.sha256(data).hexdigest() != source['sha256']:
        raise ValueError(f'{source_name} 字体源哈希与固定来源不一致')
    font = TTFont(upstream / source_name, recalcTimestamp=False)
    options = subset.Options()
    options.recalc_timestamp = False
    options.layout_features = ['*']
    selection = subset.Subsetter(options=options)
    selection.populate(unicodes=characters)
    selection.subset(font)
    family = 'WebPPT Template Fill Latin'
    style = 'Bold' if font['OS/2'].usWeightClass == 700 else 'Regular'
    postscript = family.replace(' ', '') + '-' + style
    # 修改后的 OFL 字体使用独立名称，不能冒充原字体或现有字形专项的小字集。
    for record in font['name'].names:
        value = {1: family, 2: style, 3: postscript, 4: family + ' ' + style, 6: postscript,
                 16: family, 17: style}.get(record.nameID)
        if value is not None:
            record.string = value.encode(record.getEncoding())
    font['head'].created = font['head'].modified = 2082844800
    target = dest / name
    font.save(target)
    result = target.read_bytes()
    manifest.append({'name': name, 'source': source['url'], 'sourceSha256': source['sha256'],
                     'family': family, 'weight': font['OS/2'].usWeightClass,
                     'bytes': len(result), 'sha256': hashlib.sha256(result).hexdigest()})

license_data = (root / 'tooling/font-glyph-samples/latin-OFL.txt').read_bytes()
(dest / 'OFL.txt').write_bytes(license_data)
manifest.append({'name': 'OFL.txt', 'source': sources['latin-OFL.txt']['url'],
                 'bytes': len(license_data), 'sha256': hashlib.sha256(license_data).hexdigest()})
(dest / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(manifest, ensure_ascii=False, indent=2))
