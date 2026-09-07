import type { ChartEnv } from './chart/hook';
import type { SlideElement } from './types';
import { parseXml } from './xml';
import { parseTextBody } from './pptx/text';
import { buildDiagram, parseDataModel, pointTxBody, layoutFamily, isVertical, parseDiagramColors } from './pptx/diagram';

/** 编辑预览与无 drawing 的 SmartArt 共用节点树和布局算法。 */
export function layoutDiagramXml(data: string, layout: string | undefined, colors: string | undefined,
  width: number, height: number, env: ChartEnv): { elements: SlideElement[]; nodes: string[] } {
  const root = parseXml(data), layoutRoot = layout ? parseXml(layout) : null;
  const raw = parseDiagramColors(colors ? parseXml(colors) : null);
  const palette = (raw.length ? raw : ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'])
    .map((value) => /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : `#${env.ctx.theme[env.ctx.clrMap[value] ?? value] ?? '4472C4'}`);
  const nodes: string[] = [];
  const elements = buildDiagram(parseDataModel(root), width, height, {
    family: layoutFamily(layoutRoot), vertical: isVertical(layoutRoot), colors: palette,
    textOf(id) {
      nodes.push(id);
      const body = parseTextBody(pointTxBody(root, id), { ctx: env.ctx, fonts: env.fonts,
        chain: [], defaultColor: 'rgb(255,255,255)', slideNum: 1 });
      return body ? { ...body, anchor: 'middle', paragraphs: body.paragraphs.map((p) => ({ ...p, align: 'center' })) } : null;
    },
  });
  return { elements, nodes };
}

export function renderDiagramXml(data: string, layout: string | undefined, colors: string | undefined,
  width: number, height: number, env: ChartEnv): SlideElement[] {
  return layoutDiagramXml(data, layout, colors, width, height, env).elements;
}
