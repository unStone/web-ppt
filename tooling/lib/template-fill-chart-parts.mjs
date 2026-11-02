import { posix } from 'node:path';
import { JSDOM } from 'jsdom';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/** 独立 DOM XML 读取器按关系定位图表，不依赖生成器选择的部件文件名。 */
export function inspectTemplateFillChartParts(parts, assert, expected = { series: 2, categories: 2 }) {
  const window = new JSDOM('').window;
  const parser = new window.DOMParser();
  const read = (part) => {
    assert(parts[part], `关系目标必须存在：${part}`);
    const xml = parser.parseFromString(new TextDecoder().decode(parts[part]), 'application/xml');
    assert.equal(xml.getElementsByTagName('parsererror').length, 0, `${part} 必须是有效 XML`);
    return xml;
  };
  const charts = [];
  try {
    for (const [part] of Object.entries(parts).filter(([name]) => name.endsWith('.rels'))) {
      const relations = read(part);
      for (const relation of relations.getElementsByTagNameNS(REL, 'Relationship')) {
        if (relation.getAttribute('Type') !== `${OFFICE_REL}/chart`) continue;
        assert.notEqual(relation.getAttribute('TargetMode'), 'External', '生成图表不能使用外部关系');
        const target = posix.normalize(posix.join(posix.dirname(posix.dirname(part)), relation.getAttribute('Target')));
        const xml = read(target);
        assert.equal(xml.documentElement.localName, 'chartSpace');
        assert.equal(xml.documentElement.namespaceURI, CHART);
        charts.push({ part: target, series: xml.getElementsByTagNameNS(CHART, 'ser').length,
          categoryReferences: xml.getElementsByTagNameNS(CHART, 'cat').length,
          embeddedData: xml.getElementsByTagNameNS(CHART, 'externalData').length });
      }
    }
    assert.equal(charts.length, 1, '生成大纲的一页图表必须指向一个原生 chart part');
    assert.equal(charts[0].series, expected.series, '图表原生 XML 必须包含预期的数据系列');
    assert.equal(charts[0].categoryReferences, expected.categories, '原生类别引用数量必须与图表类型和系列一致');
    assert.equal(charts[0].embeddedData, 1, '图表必须关联真实嵌入工作簿');
    return charts;
  } finally { window.close(); }
}

export function inspectTemplateFillSlideNumbers(parts, assert) {
  const window = new JSDOM('').window;
  const parser = new window.DOMParser();
  const read = (part) => parser.parseFromString(new TextDecoder().decode(parts[part]), 'application/xml');
  try {
    const presentation = read('ppt/presentation.xml');
    const relationships = read('ppt/_rels/presentation.xml.rels');
    const slides = new Map([...relationships.getElementsByTagNameNS(REL, 'Relationship')]
      .filter(relation => relation.getAttribute('Type') === `${OFFICE_REL}/slide`)
      .map(relation => [relation.getAttribute('Id'), posix.normalize(posix.join('ppt', relation.getAttribute('Target')))]));
    const fields = [...presentation.getElementsByTagNameNS(PRESENTATION, 'sldId')].map((slide, index) => {
      const id = slide.getAttributeNS(OFFICE_REL, 'id');
      assert(slides.has(id), `第 ${index + 1} 页必须有有效的 slide 关系`);
      const part = slides.get(id);
      const xml = read(part);
      assert.equal(xml.getElementsByTagName('parsererror').length, 0, `${part} 必须是有效 XML`);
      const placeholders = [...xml.getElementsByTagNameNS(PRESENTATION, 'sp')].filter(shape =>
        [...shape.getElementsByTagNameNS(PRESENTATION, 'ph')].some(ph => ph.getAttribute('type') === 'sldNum'));
      assert.equal(placeholders.length, 1, `第 ${index + 1} 页必须保留原生页码占位符`);
      const shape = placeholders[0];
      const dynamic = [...shape.getElementsByTagNameNS(DRAWING, 'fld')].filter(field => field.getAttribute('type') === 'slidenum');
      assert.equal(dynamic.length, 1, `第 ${index + 1} 页必须保留 slidenum 字段`);
      assert.equal(shape.getElementsByTagNameNS(DRAWING, 'normAutofit').length, 1, '字段文字适配必须使用原生 normAutofit');
      return { part, type: dynamic[0].getAttribute('type'), cachedText: dynamic[0].textContent };
    });
    return fields;
  } finally { window.close(); }
}
