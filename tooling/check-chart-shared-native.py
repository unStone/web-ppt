"""使用 Python ZIP/XML 读取器验证原生共享引用与两份数据，不经过编辑器解析器。"""
import io
import json
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

C = '{http://schemas.openxmlformats.org/drawingml/2006/chart}'
S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/package/2006/relationships}'


def package(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    for name, value in parts.items():
        if name.endswith(('.xml', '.rels')):
            ET.fromstring(value)
    return parts


def cell_values(parts, sheet='xl/worksheets/sheet1.xml'):
    strings = [''.join(node.itertext()) for node in ET.fromstring(parts['xl/sharedStrings.xml'])]
    result = {}
    for cell in ET.fromstring(parts[sheet]).iter(S + 'c'):
        raw = cell.findtext(S + 'v')
        if cell.get('t') == 's':
            value = strings[int(raw)]
        elif cell.get('t') == 'inlineStr':
            value = ''.join(cell.find(S + 'is').itertext())
        elif raw is None:
            value = None
        else:
            value = float(raw)
        result[cell.get('r')] = value
    return result


def range_cells(formula):
    match = re.fullmatch(r'.+!\$?([A-Z])\$?(\d+)(?::\$?([A-Z])\$?(\d+))?', formula)
    assert match, formula
    c1, r1, c2, r2 = match.groups()
    return [[f'{chr(column)}{row}' for column in range(ord(c1), ord(c2 or c1) + 1)]
            for row in range(int(r1), int(r2 or r1) + 1)]


def cache_points(cache):
    return {int(point.get('idx')): point.findtext(C + 'v') or '' for point in cache.findall(C + 'pt')}


def validate_references(chart, read_cells):
    references = 0
    for reference in chart.iter():
        if reference.tag not in [C + 'numRef', C + 'strRef', C + 'multiLvlStrRef']:
            continue
        formula = reference.findtext(C + 'f')
        cells = read_cells(formula.split('!')[0].strip("'").replace("''", "'"))
        addresses = range_cells(formula)
        cache = next(child for child in reference if child.tag.endswith('Cache'))
        if reference.tag == C + 'multiLvlStrRef':
            levels = list(reversed(cache.findall(C + 'lvl')))
            horizontal = len(addresses) == len(levels) and len(addresses[0]) != len(levels)
            records = list(map(list, zip(*addresses))) if horizontal else addresses
            points, active = [cache_points(level) for level in levels], [None] * len(levels)
            for row, address in enumerate(records):
                for level, entries in enumerate(points):
                    value = entries.get(row)
                    if value is not None:
                        active[level:] = [value] + [None] * (len(levels) - level - 1)
                    elif level == len(levels) - 1:
                        active[level] = None
                for level, current in enumerate(active):
                    expected = cells.get(address[level])
                    assert current == (None if expected is None else str(expected).removesuffix('.0')), (formula, address, current, expected)
        else:
            points = cache_points(cache)
            for row, address in enumerate(sum(addresses, [])):
                expected, value = cells.get(address), points.get(row)
                if reference.tag == C + 'numRef':
                    value = None if value is None else float(value)
                else:
                    # 平面字符串缓存用空串表示空白单元格；多级空槽在上面的路径单独保留。
                    expected = '' if expected is None else str(expected).removesuffix('.0')
                    value = '' if value is None else value
                assert value == expected, (formula, address, value, expected)
        references += 1
    return references


def validate_cache_case(case, parts):
    source = package(Path(f'fixtures/{case["fixture"]}').read_bytes())
    assert not any(part.endswith('.xlsx') for part in parts)
    assert parts['ppt/charts/chart2.xml'] == source['ppt/charts/chart2.xml']
    chart = ET.fromstring(parts['ppt/charts/chart1.xml'])
    assert chart.find(C + 'externalData') is None
    identity = json.loads(chart.find('.//{urn:web-ppt:chart-data-identities:v1}ids').text)
    assert identity['categoryOrientation'] == case['orientation']
    series = chart.findall('.//' + C + 'ser')
    assert len(series) == 1
    values = series[0].find(C + 'val/' + C + 'numLit')
    assert int(values.find(C + 'ptCount').get('val')) == case['depth']
    assert cache_points(values) == {0: '431', 1: '0'}
    cache = series[0].find(C + 'cat/' + C + 'multiLvlStrRef/' + C + 'multiLvlStrCache')
    original = ET.fromstring(source['ppt/charts/chart1.xml']).find('.//' + C + 'multiLvlStrCache')
    assert int(cache.find(C + 'ptCount').get('val')) == case['depth']
    assert [cache_points(level) for level in cache.findall(C + 'lvl')] == [
        {index: value for index, value in cache_points(level).items() if index < case['depth']}
        for level in original.findall(C + 'lvl')]
    for index in [1, 2, 3]:
        relationships = ET.fromstring(parts[f'ppt/slides/_rels/slide{index}.xml.rels'])
        assert [node.get('Target') for node in relationships if node.get('Type').endswith('/chart')] == [
            f'../charts/chart{2 if index == 2 else 1}.xml']


def validate_transition(case, parts):
    binding = case['transition']
    original = package(Path(f'fixtures/{case["fixture"]}').read_bytes())
    part, workbook = binding['part'], binding['workbook']
    chart = ET.fromstring(parts[part])
    series = chart.findall('.//' + C + 'ser')
    source_series = ET.fromstring(original[part]).findall('.//' + C + 'ser')
    assert len(series) == len(source_series) + 1
    assert series[0].find('.//' + C + 'tx//' + C + 'v').text == 'Before copy'
    assert series[-1].find('.//' + C + 'tx//' + C + 'v').text == 'Before copy series'
    numeric = series[0].find(C + 'yVal') if 'xy' in case['stem'] else series[0].find(C + 'val')
    cache = next(child for child in numeric.iter() if child.tag in [C + 'numCache', C + 'numLit'])
    points = cache_points(cache)
    assert points[max(points)] == '79'
    references = 0
    if workbook:
        book = package(parts[workbook])
        targets = {node.get('Id'): node.get('Target') for node in ET.fromstring(book['xl/_rels/workbook.xml.rels'])}
        sheets = {sheet.get('name'): cell_values(book, 'xl/' + targets[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')])
                  for sheet in ET.fromstring(book['xl/workbook.xml']).find(S + 'sheets')}
        references = validate_references(chart, sheets.__getitem__)
        source = package(original[workbook])
        for entry in source.keys() - {'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml'}:
            assert book[entry] == source[entry], entry
    else:
        assert chart.find(C + 'externalData') is None
    # 复制页可以在生成模式重编号，引用的部件身份不能改变。
    target = part.replace('ppt/', '../', 1)
    frames = sum(node.get('Target') == target
                 for entry in parts if entry.startswith('ppt/slides/_rels/')
                 for node in ET.fromstring(parts[entry]) if node.get('Type').endswith('/chart'))
    assert frames == 2
    for entry in original:
        if entry.startswith(('ppt/charts/', 'ppt/embeddings/')) and entry not in [part, workbook]:
            assert parts[entry] == original[entry], entry
    return {'frames': frames, 'chartParts': 1, 'workbooks': int(bool(workbook)), 'checkedReferences': references}


def validate_clipboard(case, parts):
    original = package(Path(f'fixtures/{case["fixture"]}').read_bytes())
    workbook_part = 'ppt/embeddings/hierarchy1.xlsx'
    chart_parts = ['ppt/charts/chart1.xml', 'ppt/charts/chart2.xml']
    assert sorted(entry for entry in parts if re.fullmatch(r'ppt/charts/chart\d+\.xml', entry)) == chart_parts
    chart = ET.fromstring(parts[chart_parts[0]])
    assert 'Copied current chart' in ''.join(chart.find('.//' + C + 'title').itertext())
    series = chart.findall('.//' + C + 'ser')
    assert len(series) == 3
    assert series[-1].find('.//' + C + 'tx//' + C + 'v').text == 'Copied series'
    xy = case['stem'].endswith('-xy')
    block = series[0].find(C + ('yVal' if xy else 'val'))
    cache = next(child for child in block.iter() if child.tag in [C + 'numCache', C + 'numLit'])
    assert cache_points(cache)[1] == '876'
    if xy:
        assert cache_points(cache)[4] == '41'
    else:
        levels = series[0].find('.//' + C + 'multiLvlStrCache').findall(C + 'lvl')
        assert cache_points(levels[0])[5] == 'Copied category'
    references = 0
    if workbook_part in parts:
        workbook = package(parts[workbook_part])
        cells = cell_values(workbook)
        references = sum(validate_references(ET.fromstring(parts[part]), lambda _: cells) for part in chart_parts)
        source = package(original[workbook_part])
        for entry in source.keys() - {'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml'}:
            assert workbook[entry] == source[entry], entry
    else:
        assert parts[chart_parts[1]] == original[chart_parts[1]]
        assert chart.find(C + 'externalData') is None
    targets = []
    for index in [1, 2, 3]:
        slide = f'ppt/slides/slide{index}.xml'
        relations = {node.get('Id'): node.get('Target')
                     for node in ET.fromstring(parts[f'ppt/slides/_rels/slide{index}.xml.rels'])}
        for node in ET.fromstring(parts[slide]).iter(C + 'chart'):
            rid = node.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            targets.append(posixpath.normpath(posixpath.join('ppt/slides', relations[rid])))
    assert targets == [chart_parts[0], chart_parts[0], chart_parts[1], chart_parts[0]], targets
    return {'frames': len(targets), 'chartParts': 2, 'workbooks': int(workbook_part in parts), 'checkedReferences': references}


reports = []
source = package(Path('fixtures/sample-chart-shared.pptx').read_bytes())
source_book = package(source['ppt/embeddings/hierarchy1.xlsx'])
for name in ['patched', 'generated']:
    parts = package(Path(f'out/chart-shared/{name}.pptx').read_bytes())
    workbook = package(parts['ppt/embeddings/hierarchy1.xlsx'])
    cells = cell_values(workbook)
    assert cells['C1'] == 'Round trip series'
    assert cells['C3'] == 651
    assert cells['B5'] == 'Round trip leaf'
    for part in source_book.keys() - {'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml'}:
        assert workbook[part] == source_book[part], part
    for index in [1, 2, 3]:
        rels = ET.fromstring(parts[f'ppt/slides/_rels/slide{index}.xml.rels'])
        charts = [node.get('Target') for node in rels if node.get('Type').endswith('/chart')]
        assert charts == [f'../charts/chart{2 if index == 2 else 1}.xml'], charts
    references = 0
    for index in [1, 2]:
        rels = ET.fromstring(parts[f'ppt/charts/_rels/chart{index}.xml.rels'])
        assert any(node.get('Target') == '../embeddings/hierarchy1.xlsx' for node in rels)
        chart = ET.fromstring(parts[f'ppt/charts/chart{index}.xml'])
        references += validate_references(chart, lambda _: cells)
    reports.append({'file': name, 'frames': 3, 'chartParts': 2, 'workbooks': 1, 'checkedReferences': references})

def validate_joint(case, category, xy):
    if case['joint'] == 'aligned':
        values = [20, None, 40, 617, 71]
        dimensions = [values, [28, 60, None, 618, 72], [1600, 2500, None, 619, 73]]
        label_index, label = 3, 'Joint category'
    elif case['joint'] == 'partial':
        values = [0, 20, None, 812, 40, None]
        dimensions = [[0, 20, None, 812], [20, 845, 60, 72], [400, 1600, 2500, 73]]
        label_index, label = 5, 'Outside range'
    else:
        values, dimensions = [717], [[717], [718], [719]]
        label_index, label = 0, 'Rebuilt category'
    for block, field, expected in [(category, 'val', values), *zip([xy] * 3, ['xVal', 'yVal', 'bubbleSize'], dimensions)]:
        cache = block.find(C + field + '/' + C + 'numRef/' + C + 'numCache')
        assert int(cache.find(C + 'ptCount').get('val')) == len(expected)
        assert {index: float(value) for index, value in cache_points(cache).items()} == {
            index: value for index, value in enumerate(expected) if value is not None}, (case['stem'], field)
    hierarchy = category.find('.//' + C + 'multiLvlStrCache')
    labels = hierarchy.findall(C + 'lvl')[0] if hierarchy is not None else category.find(C + 'cat/' + C + 'strRef/' + C + 'strCache')
    assert cache_points(labels)[label_index] == label


def validate_mixed(case, parts, workbook):
    source = package(Path(f'fixtures/{case["fixture"]}').read_bytes())
    source_book = package(source['ppt/embeddings/hierarchy1.xlsx'])
    writable = set()
    for number in [1, 2]:
        part = f'ppt/charts/chart{number}.xml'
        chart = ET.fromstring(parts[part])
        category = chart.findall('.//' + C + 'barChart/' + C + 'ser')
        xy = chart.findall('.//' + C + 'bubbleChart/' + C + 'ser')
        assert len(category) == 2 and len(xy) == 1
        if case.get('joint'):
            validate_joint(case, category[0], xy[0])
        else:
            values = category[0].find(C + 'val/' + C + 'numRef/' + C + 'numCache')
            assert cache_points(values) == {0: '10', 1: '20', 3: '40', 4: '617'}
            levels = category[0].find('.//' + C + 'multiLvlStrCache').findall(C + 'lvl')
            assert cache_points(levels[0])[4] == 'Mixed category'
            for field, expected in [('xVal', [25, 40, 55, 81]), ('yVal', [35, 28, 60, 82]), ('bubbleSize', [900, 1600, 2500, 83])]:
                cache = xy[0].find(C + field + '/' + C + 'numRef/' + C + 'numCache')
                assert [float(value) for value in cache_points(cache).values()] == expected
        source_chart = ET.fromstring(source[part])
        for block in [source_chart, chart]:
            for series in block.findall('.//' + C + 'ser'):
                for data in series:
                    if data.tag not in [C + name for name in ['cat', 'val', 'xVal', 'yVal', 'bubbleSize']]:
                        continue
                    for formula in data.iter(C + 'f'):
                        writable.update(sum(range_cells(formula.text), []))
    original, saved = cell_values(source_book), cell_values(workbook)
    # 共同轴预留的空白格可以显式物化；缺失单元格与没有值的单元格都表示空白。
    changed = {key: (original.get(key), saved.get(key)) for key in original.keys() | saved.keys()
               if key not in writable and original.get(key) != saved.get(key)}
    assert not changed, (case['stem'], '混合图不得改写区域外单元格', changed)


for case in json.loads(Path('tooling/chart-shared-cases.json').read_text()):
    for mode in ['patched', 'generated']:
        name = f'{case["stem"]}-{mode}'
        parts = package(Path(f'out/chart-shared/{name}.pptx').read_bytes())
        if case.get('clipboard'):
            reports.append({'file': name, **validate_clipboard(case, parts)})
            continue
        if case.get('transition'):
            reports.append({'file': name, **validate_transition(case, parts)})
            continue
        if case.get('cache'):
            validate_cache_case(case, parts)
            reports.append({'file': name, 'frames': 3, 'chartParts': 2, 'workbooks': 0, 'checkedLevels': case['depth']})
            continue
        workbook = package(parts['ppt/embeddings/hierarchy1.xlsx'])
        originals = package(package(Path(f'fixtures/{case["fixture"]}').read_bytes())['ppt/embeddings/hierarchy1.xlsx'])
        targets = {node.get('Id'): node.get('Target') for node in ET.fromstring(workbook['xl/_rels/workbook.xml.rels'])}
        sheets = {sheet.get('name'): cell_values(workbook, 'xl/' + targets[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')])
                  for sheet in ET.fromstring(workbook['xl/workbook.xml']).find(S + 'sheets')}
        references = sum(validate_references(ET.fromstring(parts[f'ppt/charts/chart{index}.xml']), sheets.__getitem__) for index in [1, 2])
        if case.get('mixed'):
            validate_mixed(case, parts, workbook)
        if case['stem'] == 'category-parent':
            assert sheets['Sheet1']['A6'] == 'Renamed inserted'
            assert sheets['Sheet1']['C6'] == 40
        if case['stem'] == 'category-inherited':
            assert sheets['Sheet1']['A7'] == 'Renamed tail'
            assert sheets['Sheet1']['A8'] == 'Flat originated'
            assert sheets['Sheet1'].get('B8') is None
        if case['stem'].startswith('source-xy'):
            chart = ET.fromstring(parts['ppt/charts/chart1.xml'])
            series = chart.findall('.//' + C + 'ser')
            values = [cache_points(item.find(C + 'yVal/' + C + 'numRef/' + C + 'numCache')) for item in series]
            if 'rebuilt' in case['stem']:
                assert values == [{0: '132', 1: '432'}]
            elif case['stem'].endswith('-views'):
                assert values[0][2] == '71' and values[0][3] == '515'
            elif case['stem'].endswith('-shared-x'):
                assert values[0][3] == '71' and values[1][3] == '72'
            elif case['stem'].endswith('-empty'):
                assert values == [{0: '92'}, {}]
            elif case['stem'].endswith('-sheets'):
                assert values[0][4] == '71'
                source_chart = package(Path(f'fixtures/{case["fixture"]}').read_bytes())['ppt/charts/chart2.xml']
                assert parts['ppt/charts/chart2.xml'] == source_chart
            else:
                assert values[0][0] == '515' and values[0][3] == '432'
        for part in originals.keys() - {'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml'}:
            assert workbook[part] == originals[part], part
        for index in [1, 2]:
            rels = ET.fromstring(parts[f'ppt/charts/_rels/chart{index}.xml.rels'])
            assert any(node.get('Target') == '../embeddings/hierarchy1.xlsx' for node in rels)
        for index in [1, 2, 3]:
            rels = ET.fromstring(parts[f'ppt/slides/_rels/slide{index}.xml.rels'])
            charts = [node.get('Target') for node in rels if node.get('Type').endswith('/chart')]
            assert charts == [f'../charts/chart{2 if index == 2 else 1}.xml'], charts
        reports.append({'file': name, 'frames': 3, 'chartParts': 2, 'workbooks': 1, 'checkedReferences': references})

Path('out/chart-shared/native-reader-proof.json').write_text(json.dumps(reports, indent=2) + '\n')
print('共享图表：Python ZIP/XML 独立读取器验证缓存、工作簿与原生引用通过')
