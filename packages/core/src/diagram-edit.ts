import type { ChartEnv } from './chart/hook';
import type { SlideElement, TextBody } from './types';
import { parseXml } from './xml';
import { parseTextBody } from './pptx/text';
import { buildDiagram, parseDataModel, pointTxBody, layoutFamily, isVertical, parseDiagramColors } from './pptx/diagram';
import { engineShapesToElements, evaluateLayoutDef } from './diagram-engine';

/** 编辑预览与无 drawing 的 SmartArt 共用节点树和布局算法。 */
export function layoutDiagramXml(
  data: string,
  layout: string | undefined,
  colors: string | undefined,
  width: number,
  height: number,
  env: ChartEnv,
): { elements: SlideElement[]; nodes: string[] } {
  const root = parseXml(data),
    layoutRoot = layout ? parseXml(layout) : null;
  const raw = parseDiagramColors(colors ? parseXml(colors) : null);
  const palette = (raw.length ? raw : ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']).map((value) =>
    /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : `#${env.ctx.theme[env.ctx.clrMap[value] ?? value] ?? '4472C4'}`,
  );
  const nodes: string[] = [];
  const dataModel = parseDataModel(root);
  const textOfEngine = (id: string): TextBody | null => {
    nodes.push(id);
    const body = parseTextBody(pointTxBody(root, id), {
      ctx: env.ctx,
      fonts: env.fonts,
      chain: [],
      defaultColor: 'rgb(255,255,255)',
      slideNum: 1,
    });
    return body ? { ...body, anchor: 'middle', paragraphs: body.paragraphs.map((p) => ({ ...p, align: 'center' })) } : null;
  };
  // 桌面 001：布局定义引擎优先；覆盖守恒等 reason 触发时回退启发式族布局
  const engine = evaluateLayoutDef(layoutRoot, dataModel, width, height);
  const elements: SlideElement[] = [];
  if (!engine.reason) {
    elements.push(...engineShapesToElements(engine, dataModel, { colors: palette, textOf: textOfEngine }));
  }
  if (!elements.length) {
    elements.push(
      ...buildDiagram(dataModel, width, height, {
        family: layoutFamily(layoutRoot),
        vertical: isVertical(layoutRoot),
        colors: palette,
        textOf: textOfEngine,
      }),
    );
  }
  return { elements, nodes };
}

export function renderDiagramXml(
  data: string,
  layout: string | undefined,
  colors: string | undefined,
  width: number,
  height: number,
  env: ChartEnv,
): SlideElement[] {
  return layoutDiagramXml(data, layout, colors, width, height, env).elements;
}
