/**
 * 新建图表编辑入口（桌面 002）：AddChart 命令 + 保存计划 + 保存前投影。
 *
 * 保存前图表部件尚未落包，投影直接从 doc.chartResources 的字节渲染（现代图
 * 用经典回退部件——回退就是为不支持 ChartEx 的查看器准备的）；首次保存后
 * 部件进入包内，既有 chart-data / chart-design / chart-shared 编辑链按包内
 * 部件路径自动识别（无需本模块参与）。历史、恢复与协同共用主编辑器：命令
 * 产生结构补丁与资源补丁，字节在协同传输面被剥离、对端按保存产物重建。
 */
import { renderChartXml } from '@web-ppt/core/chart-edit';
import type { SlideElement } from '@web-ppt/core';
import type { Editor } from '../editor';
import type { EditDoc, ElementId } from '../types';
import { registerEditExtension } from '../extension-runtime';
import { base64ToBytes } from '../clipboard-binary';
import { relativeTarget } from '../clipboard-source';
import { addChartPatches } from '../commands/chart-authoring';
import { chartRenderContext } from '../chart/context';
import { chartAuthoringSavePlan } from './save';
import type { AddChartCommand } from './types';

export { CLASSIC_CHART_KINDS, CHARTEX_KINDS } from './types';
export type { AddChartData, AddChartCommand, ChartKind, ClassicChartKind, ChartExKind } from './types';
export { chartAuthoringSavePlan } from './save';

let registered = false;

/** 接收恢复 / 协同数据前显式调用，避免仅副作用导入被打包器移除。 */
export function registerChartAuthoring(): void {
  if (registered) return;
  registerEditExtension('chart-authoring', {
    command: addChartPatches,
    project: (doc: EditDoc, id: ElementId, element: SlideElement) => {
      const record = doc.elements[id];
      if (!record?.meta.created || element.kind !== 'group') return element;
      // 部件归属按插入关系的相对目标反查资源；资源不存在（已保存落包）时交给常规投影链。
      const target = record.meta.insertion?.relationships?.[0]?.target;
      const resource = target
        ? Object.values(doc.chartResources ?? {}).find(
            (candidate) =>
              relativeTarget(record.meta.origin!.part, candidate.part) === target
              || (candidate.fallback && relativeTarget(record.meta.origin!.part, candidate.fallback.part) === target),
          )
        : undefined;
      if (!resource) return element;
      // 现代图渲染经典回退（回退就是为不支持 ChartEx 的消费方准备的）；经典图渲染本体。
      const chosen = resource.fallback ?? { bytes: resource.bytes };
      const xml = new TextDecoder().decode(base64ToBytes(chosen.bytes));
      return {
        ...element,
        children: renderChartXml(xml, element.w, element.h, chartRenderContext(doc, id, record.meta.origin!.part)),
      };
    },
  });
  registered = true;
}

/** 按需命令只产生现有 Patch，历史、恢复与协同仍共用主编辑器。 */
export function createChartAuthoringEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  registerChartAuthoring();
  return {
    add(command: AddChartCommand): ElementId {
      const result = editor.exec({ type: 'Extension', namespace: 'chart-authoring', id: command.slideId, payload: command });
      return result.forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements')!.path[1];
    },
    savePlan: () => chartAuthoringSavePlan(editor.doc),
  };
}
