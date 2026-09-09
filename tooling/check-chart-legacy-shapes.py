"""独立读取迁移矩阵的 ZIP/XML，比较原生缓存、工作簿及来源区域外的内容。"""
import hashlib
import io
import json
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

C = '{http://schemas.openxmlformats.org/drawingml/2006/chart}'
S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
R = '{http://schemas.openxmlformats.org/package/2006/relationships}'
O = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
IDENTITY = '{urn:web-ppt:chart-data-identities:v1}'


def package(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        result = {name: archive.read(name) for name in archive.namelist()}
    for name, value in result.items():
        if name.endswith(('.xml', '.rels')):
            ET.fromstring(value)
    return result


def relations(parts, source):
    path = posixpath.join(posixpath.dirname(source), '_rels', posixpath.basename(source) + '.rels')
    return {node.get('Id'): posixpath.normpath(posixpath.join(posixpath.dirname(source), node.get('Target')))
            for node in ET.fromstring(parts[path]) if node.get('TargetMode') != 'External'}


def chart_frames(parts, target):
    slides = relations(parts, 'ppt/presentation.xml')
    frames = 0
    for node in ET.fromstring(parts['ppt/presentation.xml']).iter(P + 'sldId'):
        slide = slides[node.get(O + 'id')]
        links = relations(parts, slide)
        frames += sum(links[chart.get(O + 'id')] == target for chart in ET.fromstring(parts[slide]).iter(C + 'chart'))
    return frames


def cache(block):
    return next((node for node in block.iter() if node.tag in [C + name for name in
                ['numCache', 'strCache', 'numLit', 'strLit', 'multiLvlStrCache']]), None)


def points(node, numeric=False):
    count = int(node.find(C + 'ptCount').get('val'))
    result = [None] * count
    for point in node.findall(C + 'pt'):
        index = int(point.get('idx'))
        assert 0 <= index < count
        value = point.findtext(C + 'v') or ''
        result[index] = float(value) if numeric else value
    return result


def series_content(chart, expected):
    series = [series for plot in chart.find('.//' + C + 'plotArea') for series in plot.findall(C + 'ser')]
    assert len(series) == len(expected['series'])
    for node, wanted in zip(series, expected['series']):
        name = node.find(C + 'tx')
        assert next(name.iter(C + 'v')).text == wanted['name']
        xy = wanted['plotKind'] in ['scatter', 'bubble']
        for field, key in ([('xVal', 'x'), ('yVal', 'value'), ('bubbleSize', 'size')]
                           if xy else [('val', 'value')]):
            block = node.find(C + field)
            if field == 'bubbleSize' and wanted['plotKind'] != 'bubble':
                assert block is None
                continue
            assert block is not None
            assert points(cache(block), True) == [point.get(key) for point in wanted['points']], (field, wanted['name'])
        if not xy:
            labels = cache(node.find(C + 'cat'))
            if labels.tag == C + 'multiLvlStrCache':
                count = int(labels.find(C + 'ptCount').get('val'))
                levels = []
                for level in reversed(labels.findall(C + 'lvl')):
                    slots = [None] * count
                    for point in level.findall(C + 'pt'):
                        slots[int(point.get('idx'))] = point.findtext(C + 'v') or ''
                    levels.append(slots)
                assert list(map(list, zip(*levels))) == [category['levels'] for category in expected['categories']]
            else:
                assert [value or '' for value in points(labels)] == [category['label'] for category in expected['categories']]


def cells(parts, sheet):
    strings = ET.fromstring(parts['xl/sharedStrings.xml']) if 'xl/sharedStrings.xml' in parts else []
    strings = [''.join(node.itertext()) for node in strings]
    values, nodes = {}, {}
    for cell in ET.fromstring(parts[sheet]).iter(S + 'c'):
        value = cell.findtext(S + 'v')
        if cell.get('t') == 's':
            value = strings[int(value)]
        elif cell.get('t') == 'inlineStr':
            value = ''.join(cell.find(S + 'is').itertext())
        elif value is not None:
            value = float(value)
        values[cell.get('r')] = value
        nodes[cell.get('r')] = ET.tostring(cell)
    return values, nodes


def formula_cells(formula):
    match = re.fullmatch(r"(.+)!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?", formula)
    assert match, formula
    sheet, c1, r1, c2, r2 = match.groups()
    def column(value):
        result = 0
        for letter in value:
            result = result * 26 + ord(letter) - 64
        return result
    def name(value):
        result = ''
        while value:
            value, digit = divmod(value - 1, 26)
            result = chr(65 + digit) + result
        return result
    return sheet.strip("'").replace("''", "'"), [[f'{name(col)}{row}'
        for col in range(column(c1), column(c2 or c1) + 1)] for row in range(int(r1), int(r2 or r1) + 1)]


def sheet_structure(data, writable, check_dimension=False):
    root = ET.fromstring(data)
    dimension = root.find(S + 'dimension')
    if dimension is not None:
        if check_dimension:
            addresses = [re.fullmatch(r'([A-Z]+)(\d+)', cell.get('r')).groups() for cell in root.iter(S + 'c')]
            columns = sorted({column for column, _ in addresses}, key=lambda value: (len(value), value))
            rows = [int(row) for _, row in addresses]
            first, last = (f'{columns[0]}{min(rows)}', f'{columns[-1]}{max(rows)}') if addresses else ('A1', 'A1')
            assert dimension.attrib == {'ref': first if first == last else f'{first}:{last}'}
        # 保存可补充或更新已用范围，但新的范围必须由实际单元格精确推导。
        root.remove(dimension)
    table = root.find(S + 'sheetData')
    for row in list(table):
        for cell in list(row):
            if cell.tag == S + 'c' and cell.get('r') in writable:
                row.remove(cell)
        # 图表扩缩允许生成或移除纯容器行；自定义行高、隐藏和其他元数据必须保留。
        if not len(row) and set(row.attrib) == {'r'}:
            table.remove(row)
    return ET.tostring(root)


def workbook_references(parts, original, target):
    chart = ET.fromstring(parts[target])
    external = chart.find(C + 'externalData')
    if external is None:
        return None, 0
    book = relations(parts, target)[external.get(O + 'id')]
    saved, before = package(parts[book]), package(original[book])
    links = relations(saved, 'xl/workbook.xml')
    sheets = {sheet.get('name'): links[sheet.get(O + 'id')] for sheet in
              ET.fromstring(saved['xl/workbook.xml']).find(S + 'sheets')}
    writable = {sheet: set() for sheet in sheets}
    for source in [ET.fromstring(original[target]), chart]:
        for formula in source.iter(C + 'f'):
            sheet, addresses = formula_cells(formula.text)
            writable[sheet].update(sum(addresses, []))
    references = 0
    for reference in chart.iter():
        if reference.tag not in [C + name for name in ['numRef', 'strRef', 'multiLvlStrRef']]:
            continue
        sheet, addresses = formula_cells(reference.findtext(C + 'f'))
        values, _ = cells(saved, sheets[sheet])
        cached = cache(reference)
        if reference.tag == C + 'multiLvlStrRef':
            levels = list(reversed(cached.findall(C + 'lvl')))
            horizontal = len(addresses) == len(levels) and len(addresses[0]) != len(levels)
            records = list(zip(*addresses)) if horizontal else addresses
            sparse = [{int(point.get('idx')): point.findtext(C + 'v') or '' for point in level} for level in levels]
            active = [None] * len(levels)
            for index, row in enumerate(records):
                for level, slots in enumerate(sparse):
                    if index in slots:
                        active[level:] = [slots[index]] + [None] * (len(levels) - level - 1)
                    elif level == len(levels) - 1:
                        active[level] = None
                assert active == [None if values.get(address) is None else str(values[address]).removesuffix('.0') for address in row]
        else:
            numeric = reference.tag == C + 'numRef'
            expected = [values.get(address) for address in sum(addresses, [])]
            actual = points(cached, numeric)
            if not numeric:
                expected = ['' if value is None else str(value).removesuffix('.0') for value in expected]
                actual = [value or '' for value in actual]
            if numeric and not actual:
                # 零点系列保留一个空白公式锚点供重建，不能据此虚构一个数据点。
                assert expected == [None], (reference.findtext(C + 'f'), expected)
            else:
                assert actual == expected, (reference.findtext(C + 'f'), actual, expected)
        references += 1
    for sheet, part in sheets.items():
        if not writable[sheet]:
            assert saved[part] == before[part], part
        else:
            assert sheet_structure(saved[part], writable[sheet], True) == sheet_structure(before[part], writable[sheet]), part
        old_values, old_nodes = cells(before, part)
        new_values, new_nodes = cells(saved, part)
        assert {key: value for key, value in old_values.items() if key not in writable[sheet]} == {
            key: value for key, value in new_values.items() if key not in writable[sheet]}, sheet
        assert {key: value for key, value in old_nodes.items() if key not in writable[sheet]} == {
            key: value for key, value in new_nodes.items() if key not in writable[sheet]}, sheet
    for part in before.keys() - set(sheets.values()) - {'xl/sharedStrings.xml'}:
        assert saved[part] == before[part], part
    return book, references


directory = Path(sys.argv[1] if len(sys.argv) > 1 else 'out/chart-shared/legacy-migration')
reports = []
manifests = sorted(directory.glob('shape-*.json'))
manifests = [path for path in manifests if re.fullmatch(r'shape-.+-(early|late)\.json', path.name)]
cases = json.loads(Path('tooling/chart-legacy-shape-cases.json').read_text())
assert {path.name for path in manifests} == {f'shape-{case["name"]}-{timing}.json'
    for case in cases for timing in ['early', 'late']}, '必须生成所声明形态与两种迁移时机的完整矩阵'
for manifest in manifests:
    config = json.loads(manifest.read_text())
    original = package(Path(f'fixtures/{config["fixture"]}.pptx').read_bytes())
    for name in config['files']:
        data = (directory / name).read_bytes()
        parts = package(data)
        assert chart_frames(parts, config['part']) == config['frames'] == 2
        chart = ET.fromstring(parts[config['part']])
        series_content(chart, config['expected'])
        identity = json.loads(chart.find('.//' + IDENTITY + 'ids').text)
        def normalized(value):
            return next((value[len(scope):] for scope in config['savedScopes'] if value.startswith(scope + ':')), value)
        assert [normalized(value) for value in identity['categories']] == [item['id'] for item in config['expected']['categories']]
        assert [normalized(item['id']) for item in identity['series']] == [item['id'] for item in config['expected']['series']]
        for item, wanted in zip(identity['series'], config['expected']['series']):
            expected_points = [point['id'] for point in wanted['points']] if wanted['plotKind'] in ['scatter', 'bubble'] else []
            assert [normalized(value) for value in item['points']] == expected_points
        book, references = workbook_references(parts, original, config['part'])
        for part in original:
            if (re.fullmatch(r'ppt/charts/chart\d+\.xml', part) and part != config['part']) or (part.endswith('.xlsx') and part != book):
                assert parts[part] == original[part], part
        reports.append({'file': name, 'sha256': hashlib.sha256(data).hexdigest(), 'frames': 2, 'references': references})
(directory / 'shape-native-proof.json').write_text(json.dumps(reports, indent=2) + '\n')
print(f'旧图表迁移：独立 ZIP/XML 验证 {len(reports)} 份产物，缓存、工作簿、身份与无关内容一致')
