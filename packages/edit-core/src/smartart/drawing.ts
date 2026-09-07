import type { SlideElement, TextBody } from '@web-ppt/core';
import { parseXmlTree, serializeXmlTreeBytes, xmlElementChildren, createXmlElement,
  insertXmlChildUnchecked as append, setXmlAttribute,
  cloneXmlNodeWithNamespaceClosure as clone, cloneXmlNode, insertXmlInOrder } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { customGeometryMarkup } from '../generate/custom-geometry';
import { A, DSP, attr, child, children, smartArtIdentity } from './model';
import type { SmartArtNode } from './model';

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const emu = (value: number) => String(Math.round(value * 9525));
const color = (value: string) => value.startsWith('#') ? value.slice(1) : value.match(/[\d.]+/g)!.slice(0, 3)
  .map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('');
const solid = (value: string) => `<a:solidFill><a:srgbClr val="${color(value)}"/></a:solidFill>`;

function textBody(source: XmlElement, effective: TextBody): XmlElement {
  const body = createXmlElement('dsp:txBody', { attributes: [['xmlns:dsp', DSP], ['xmlns:a', A]] });
  for (const node of source.children) append(body, node.type === 'element' ? clone(node, body) : cloneXmlNode(node));
  let properties = xmlElementChildren(body).find((n) => n.namespaceUri === A && n.localName === 'bodyPr');
  if (!properties) { properties = createXmlElement('a:bodyPr'); append(body, properties, body.children[0] ?? null); }
  setXmlAttribute(properties, 'anchor', 'ctr');
  xmlElementChildren(body).filter((n) => n.namespaceUri === A && n.localName === 'p').forEach((p, index) => {
    let pr = child(p, 'pPr'); if (!pr) { pr = createXmlElement('a:pPr'); append(p, pr, p.children[0] ?? null); }
    setXmlAttribute(pr, 'algn', 'ctr');
    const paragraph = effective.paragraphs[index]; if (!paragraph) return;
    children(p).filter((n) => ['r', 'fld', 'br'].includes(n.localName)).forEach((run, runIndex) => {
      const value = paragraph.runs[runIndex]; if (!value) return;
      let rPr = child(run, 'rPr'); if (!rPr) { rPr = createXmlElement('a:rPr'); append(run, rPr, run.children[0] ?? null); }
      setXmlAttribute(rPr, 'sz', String(Math.round(value.size * 75)));
      setXmlAttribute(rPr, 'b', value.b ? '1' : '0'); setXmlAttribute(rPr, 'i', value.i ? '1' : '0');
      const hasFill = (node: XmlElement | null) => children(node).some((n) => n.localName.endsWith('Fill'));
      if (!hasFill(rPr) && !hasFill(child(pr, 'defRPr'))) {
        const fill = parseXmlTree(`<a:solidFill xmlns:a="${A}"><a:srgbClr val="${color(value.color)}"/></a:solidFill>`).root;
        insertXmlInOrder(rPr, clone(fill, rPr));
      }
      for (const [at, slot] of ['latin', 'ea', 'cs'].entries()) {
        if (child(rPr, slot) || !value.fonts.length) continue;
        const font = createXmlElement(`a:${slot}`, { attributes: [['typeface', value.fonts[at] ?? value.fonts[0]]] });
        insertXmlInOrder(rPr, font);
      }
    });
  });
  return body;
}

export function smartArtDrawing(xml: string, elements: SlideElement[], nodeIds: string[], nodes: SmartArtNode[]): Uint8Array {
  const root = parseXmlTree(xml).root, points = child(root, 'ptLst');
  const drawing = parseXmlTree(`<dsp:drawing xmlns:dsp="${DSP}" xmlns:a="${A}"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/></dsp:spTree></dsp:drawing>`);
  const tree = child(drawing.root, 'spTree')!;
  const edges: string[] = [];
  const walk = (id: string) => {
    const descendants = nodes.filter((n) => n.parentId === id); edges.push(...descendants.map((n) => n.id));
    for (const node of descendants) walk(node.id);
  };
  for (const node of nodes.filter((n) => n.parentId === null)) walk(node.id);
  let at = 0, edge = 0;
  for (const [index, element] of elements.entries()) {
    if (element.kind !== 'shape' || !element.path) throw new Error('SmartArt 布局输出不是原生形状');
    const id = element.name === 'SmartArt 连线' ? smartArtIdentity(`parent:${edges[edge++]}`) : nodeIds[at++];
    const fill = element.fill?.type === 'solid' ? solid(element.fill.color) : '<a:noFill/>';
    const stroke = element.stroke ? `<a:ln w="${emu(element.stroke.width)}">${solid(element.stroke.color)}</a:ln>` : '<a:ln><a:noFill/></a:ln>';
    const shape = parseXmlTree(`<dsp:sp xmlns:dsp="${DSP}" xmlns:a="${A}" modelId="${esc(id)}"><dsp:nvSpPr><dsp:cNvPr id="${index + 1}" name="${esc(element.name ?? '')}"/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.w)}" cy="${emu(element.h)}"/></a:xfrm>${customGeometryMarkup(element.path, element.w, element.h, !!element.openGeom)}${fill}${stroke}</dsp:spPr></dsp:sp>`).root;
    const point = children(points, 'pt').find((p) => attr(p, 'modelId') === id), text = point && child(point, 't');
    if (text && element.text) append(shape, textBody(text, element.text));
    append(tree, clone(shape, tree));
  }
  return serializeXmlTreeBytes(drawing);
}
