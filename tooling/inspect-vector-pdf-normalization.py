import json
import sys
from pathlib import Path
import pymupdf as fitz

out = Path(sys.argv[1])
reference = json.loads((out / 'normalization-reference.json').read_text())
by_name = {image['name']: image for image in reference['images']}
original = by_name['exif-1']['rgba']
for orientation in range(1, 9):
    image = by_name[f'exif-{orientation}']
    assert (image['width'], image['height']) == ((16, 8) if orientation <= 4 else (8, 16))
    for y in range(image['height']):
        for x in range(image['width']):
            sx, sy = [(x, y), (15 - x, y), (15 - x, 7 - y), (x, 7 - y),
                      (y, x), (y, 7 - x), (15 - y, 7 - x), (15 - y, x)][orientation - 1]
            at, source = (y * image['width'] + x) * 4, (sy * 16 + sx) * 4
            assert image['rgba'][at:at + 4] == original[source:source + 4], (orientation, x, y)
before = '--before' in sys.argv
doc = fitz.open(out / ('normalization-before.pdf' if before else 'normalization.pdf'))
assert len(doc) == (1 if before else len(reference['images']))
results = []
for index, page in enumerate(doc):
    expected = reference['images'][index]
    images = page.get_images(full=True)
    assert len(images) == 1, (index, images)
    xref, mask, width, height = images[0][:4]
    assert (width, height) == (expected['width'], expected['height'])
    rgb = doc.xref_stream(xref)
    alpha = doc.xref_stream(mask) if mask else bytes([255]) * (width * height)
    assert len(rgb) == width * height * 3
    rgba = [v for i in range(width * height) for v in (*rgb[i * 3:i * 3 + 3], alpha[i])]
    difference = [abs(a - b) for a, b in zip(rgba, expected['rgba'])]
    item = {'name': expected['name'], 'width': width, 'height': height, 'max_pixel_difference': max(difference),
            'first_pixel_pdf': rgba[:4], 'first_pixel_browser': expected['rgba'][:4]}
    results.append(item)
    assert 'ABC' in page.get_text(), (index, '普通文字仍可提取')
    if not before:
        assert max(difference) == 0, item
        # 独立阅读器须实际合成到原始图片位置，不能只证明内嵌字节正确。
        pix = page.get_pixmap(matrix=fitz.Matrix(4 / 3, 4 / 3), alpha=False)
        for x, y in [(width // 4, height // 4), (width * 3 // 4, height // 4),
                     (width // 4, height * 3 // 4), (width * 3 // 4, height * 3 // 4)]:
            px, py = int(40 + (x + .5) * 160 / width), int(40 + (y + .5) * 100 / height)
            source = expected['rgba'][(y * width + x) * 4:(y * width + x + 1) * 4]
            target = [round(source[c] * source[3] / 255 + [255, 213, 79][c] * (1 - source[3] / 255)) for c in range(3)]
            actual = pix.pixel(px, py)
            assert max(abs(a - b) for a, b in zip(actual, target)) <= 5, (expected['name'], x, y, actual, target)
(out / ('normalization-before.json' if before else 'normalization.json')).write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, ensure_ascii=False))
