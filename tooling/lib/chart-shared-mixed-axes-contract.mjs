export function testSharedMixedAxes({ renderChartXml, assert }) {
  const env = {
    ctx: { theme: {}, clrMap: {} }, rels: {},
    fonts: { major: { latin: 'Arial', ea: '', cs: '', scripts: {} }, minor: { latin: 'Arial', ea: '', cs: '', scripts: {} } },
  };
  const numberData = (name, values) => `<c:${name}><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numLit></c:${name}>`;
  const categoryData = values => `<c:cat><c:strLit><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}</c:strLit></c:cat>`;
  const axis = (id, position, kind, cross, { hidden = false, min, max } = {}) => `<c:${kind}Ax><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>${min === undefined ? '' : `<c:min val="${min}"/>`}${max === undefined ? '' : `<c:max val="${max}"/>`}</c:scaling><c:delete val="${hidden ? 1 : 0}"/><c:axPos val="${position}"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:${kind}Ax>`;
  const color = value => `<c:spPr><a:solidFill><a:srgbClr val="${value}"/></a:solidFill></c:spPr>`;
  const series = (index, name, paint, data, marker = '') => `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${name}</c:v></c:tx>${color(paint)}${marker}${data}</c:ser>`;
  const bar = (values, labels, axes = [1, 2]) => `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series(0, 'Bar', 'FF0000', categoryData(labels) + numberData('val', values))}${axes.map(id => `<c:axId val="${id}"/>`).join('')}</c:barChart>`;
  const scatter = (index, paint, xs, ys, axes) => `<c:scatterChart><c:scatterStyle val="marker"/>${series(index, `XY${index}`, paint, numberData('xVal', xs) + numberData('yVal', ys), `<c:marker><c:symbol val="circle"/><c:size val="5"/>${color(paint)}</c:marker>`)}${axes.map(id => `<c:axId val="${id}"/>`).join('')}</c:scatterChart>`;
  const render = (plots, axes) => renderChartXml(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:x val="0.2"/><c:y val="0.2"/><c:w val="0.6"/><c:h val="0.6"/></c:manualLayout></c:layout>${plots}${axes}</c:plotArea></c:chart></c:chartSpace>`, 600, 400, env);
  const labels = elements => elements.flatMap(element => element.text?.paragraphs?.map(paragraph => paragraph.runs.map(run => run.text).join('')) ?? []);
  const painted = (elements, paint) => elements.filter(element => element.kind === 'shape' && element.fill?.type === 'solid' && element.fill.color === paint);
  const center = element => ({ x: element.x + element.w / 2, y: element.y + element.h / 2 });
  // XY 点数不改变类别轴标签。
  {
    const axes = axis(1, 'b', 'cat', 2) + axis(2, 'l', 'val', 1, { hidden: true, min: 0, max: 10 })
      + axis(3, 'b', 'val', 4, { hidden: true, min: 0, max: 10 }) + axis(4, 'l', 'val', 3, { hidden: true, min: 0, max: 10 });
    const a = labels(render(bar([2, 4], ['A', 'B']) + scatter(1, '0000FF', [1, 2], [3, 3], [3, 4]), axes));
    const b = labels(render(bar([2, 4], ['A', 'B']) + scatter(1, '0000FF', [1, 2, 3, 4, 5], [3, 3, 3, 3, 3], [3, 4]), axes));
    assert.deepEqual(a, ['A', 'B']); assert.deepEqual(b, ['A', 'B']);
  }

  // 柱图与 XY 共用数值轴时同值同纵坐标。
  {
    const axes = axis(1, 'b', 'cat', 2, { hidden: true }) + axis(2, 'l', 'val', 1, { hidden: true })
      + axis(3, 'b', 'val', 2, { hidden: true, min: 0, max: 3 });
    const elements = render(bar([10], ['A']) + scatter(1, '0000FF', [1, 2], [10, 100], [3, 2]), axes);
    const columns = painted(elements, 'rgb(255,0,0)'), dots = painted(elements, 'rgb(0,0,255)');
    assert.equal(columns.length, 1); assert.equal(dots.length, 2);
    const columnTop = columns[0].y, dot = center(dots[0]);
    assert.ok(Math.abs(columnTop - dot.y) < 1e-8, JSON.stringify({ columnTop, firstDotY: dot.y }));
  }

  // 两个不同 XY 轴对共用 Y 轴时同值同纵坐标。
  {
    const axes = axis(11, 'b', 'val', 12, { hidden: true, min: 0, max: 3 }) + axis(12, 'l', 'val', 11, { hidden: true })
      + axis(13, 't', 'val', 12, { hidden: true, min: 0, max: 3 });
    const elements = render(scatter(0, '0000FF', [1, 2], [10, 20], [11, 12]) + scatter(1, '00FF00', [1, 2], [10, 200], [13, 12]), axes);
    const blue = painted(elements, 'rgb(0,0,255)'), green = painted(elements, 'rgb(0,255,0)');
    assert.equal(blue.length, 2); assert.equal(green.length, 2);
    const a = center(blue[0]), b = center(green[0]);
    assert.ok(Math.abs(a.y - b.y) < 1e-8, JSON.stringify({ firstPairY: a.y, secondPairY: b.y }));
  }
  // 共享数值轴只绘制一份刻度标签。
  {
    const axes = axis(11, 'b', 'val', 12, { hidden: true, min: 0, max: 3 }) + axis(12, 'l', 'val', 11)
      + axis(13, 't', 'val', 12, { hidden: true, min: 0, max: 3 });
    const elements = render(scatter(0, '0000FF', [1, 2], [10, 20], [11, 12]) + scatter(1, '00FF00', [1, 2], [10, 200], [13, 12]), axes);
    const values = labels(elements);
    assert.ok(values.length > 0);
    assert.equal(values.length, new Set(values).size, JSON.stringify({ labels: values }));
  }

  // XY 数据标签不读取类别图的标签。
  {
    const axes = axis(1, 'b', 'cat', 2, { hidden: true }) + axis(2, 'l', 'val', 1, { hidden: true })
      + axis(3, 'b', 'val', 4, { hidden: true, min: 0, max: 5 }) + axis(4, 'l', 'val', 3, { hidden: true });
    const xy = scatter(1, '0000FF', [3, 4], [3, 3], [3, 4]).replace('</c:ser>', '<c:dLbls><c:delete val="0"/><c:showCatName val="1"/><c:showVal val="0"/></c:dLbls></c:ser>');
    const pure = labels(render(xy, axes));
    const mixed = labels(render(bar([2, 4], ['A', 'B']) + xy, axes));
    assert.deepEqual(pure, ['3', '4']);
    assert.deepEqual(mixed, pure);
  }
  // 纯 XY 共轴后续系列格式不改变已绘制轴的留白。
  {
    const axes = axis(1, 'b', 'val', 2, { min: 0, max: 10 }) + axis(2, 'l', 'val', 1, { min: 0, max: 10 });
    const first = scatter(0, '0000FF', [3, 4], [3, 4], [1, 2]);
    const second = scatter(1, '00FF00', [3, 4], [3, 4], [1, 2]);
    const auto = plots => renderChartXml(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea>${plots}${axes}</c:plotArea></c:chart></c:chartSpace>`, 600, 400, env);
    const plain = auto(first + second);
    const formatted = auto(first + second.replace(/General/g, '&quot;LONG SECOND SERIES UNIT &quot;0.00000'));
    assert.deepEqual(labels(plain), labels(formatted), '实际显示的轴刻度未变');
    const a = center(painted(plain, 'rgb(0,0,255)')[0]), b = center(painted(formatted, 'rgb(0,0,255)')[0]);
    assert.deepEqual(b, a);
  }
  // 类别图与 XY 共轴时统一使用实际绘制轴的格式留白。
  {
    const axes = axis(1, 'b', 'cat', 2, { hidden: true }) + axis(2, 'l', 'val', 1, { min: 0, max: 10 })
      + axis(3, 'b', 'val', 2, { hidden: true, min: 0, max: 10 });
    const columns = bar([3, 4], ['A', 'B']);
    const xy = scatter(1, '0000FF', [3, 4], [3, 4], [3, 2]);
    const auto = plots => renderChartXml(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea>${plots}${axes}</c:plotArea></c:chart></c:chartSpace>`, 600, 400, env);
    const plain = auto(columns + xy), formatted = auto(columns + xy.replace(/General/g, '&quot;LONG SECOND SERIES UNIT &quot;0.00000'));
    assert.deepEqual(labels(plain), labels(formatted), '实际显示的共享数值轴刻度未变');
    const a = center(painted(plain, 'rgb(0,0,255)')[0]), b = center(painted(formatted, 'rgb(0,0,255)')[0]);
    assert.deepEqual(b, a);
  }
}
