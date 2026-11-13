# 新建图表（AddChart）

状态：SDK 能力已交付（23 型生成 + AddChart 命令 + 保存链路 + 既有编辑链识别）；官网插入菜单入口待产品确认。实施记录见[票据 002](../wayfinder/ppt-desktop-parity/tickets/002-chart-authoring.md)。

## 1. 问题

用户在编辑会话中怎样在任意页上从零插入一张原生可编辑图表（含内嵌工作簿），并沿用既有的数据、类型与样式编辑？

## 2. 设计决策

### D1 生成器独立于模板填充

[chart-authoring/seed.ts](../../packages/edit-core/src/chart-authoring/seed.ts) 覆盖 ECMA-376 全部 16 种经典绘图类型（含 3D 变体与曲面），[seed-chartex.ts](../../packages/edit-core/src/chart-authoring/seed-chartex.ts) 覆盖 ChartEx 七类。结构参照 PowerPoint 新建图表默认值：主题强调色（accent1..6 循环）+ minor 字体（+mn），右侧图例，externalData 指向内嵌工作簿。与 fill/chart-seed 的 8 型生成器并存：模板填充入口冻结不动，本模块面向 16+7 的超集（两者共享 chartFormula 与 OOXML 命名空间助手）。

### D2 数据模型与校验在命令边界 fast-fail

`AddChartData`：kind（23 种）、categories（sunburst / treemap 用「/」分层路径，最多 8 层）、series（name + values，散点 / 气泡带 x、sizes）。规则：股价图系列数按 4 的倍数（OHLC 分组）且等长；饼族单系列；曲面至少两系列；直方图 / 帕累托线只有数值列（分箱由查看器计算），不做类目对齐。上限沿用图表编辑器的 MAX_CHART_SERIES / POINTS / CELLS。

### D3 部件经 doc.chartResources 登记、保存计划按约定命名写出

AddChart 补丁 = 元素树 insert（meta.insertion 携带 graphicFrame 片段与关系）+ `chartResources` 资源 set。部件路径在命令边界按 `ppt/charts/chartN.xml` 约定分配（内容寻址会让图表落在 ppt/media，违反 Office 惯例）；资源移除后保存计划不再产出，created 部件按既有回收语义删除，内容类型 Override 同步剪除。现代图按 PowerPoint 惯例写 mc:AlternateContent：Choice 指向 cx 部件、Fallback 指向经典图部件（同一份数据退化为柱状图，分层类目拍平），工作簿只有一份（回退经典图的 externalData 引用）。

### D4 保存前投影用资源字节；保存后进入既有编辑链

保存前部件尚未落包，扩展的 project 钩子从 chartResources 渲染（现代图渲染回退经典图）。首次保存后部件在包内，`chartPartForElement` 按 graphicFrame 的 r:id 解析到新部件，chart-data / chart-design / chart-shared 编辑链自动识别——测试证明：保存 → 重开 → 数据面板改值 9876 → 缓存与内嵌工作簿同步写回。插入闭包不变量（包关系目标必须存在）为「计划中的图表部件」放行：目标已在 chartResources 登记。

### D5 不做

- 链接外部工作簿（浏览器无路径读取能力，只生成内嵌工作簿）。
- 地图图表新建（geoCache 只读文件自带边界）。
- 生成保存（无原包）下的 AddChart——生成文档的图表由模板填充承担。

## 3. 验收

- 23 型各生成一份保存产物（out/chart-authoring/），进入 OOXML 门禁（XSD + SDK 双通道）；经典图 XSD 预检零错误（五处序列问题在预检中修正：view3D 位序、pie3D / ofPie 无 firstSliceAng、radar 无 smooth、stock / surface 无 varyColors、bar3D 无 overlap）。
- test-chart-authoring：全型生成 / 保存 / 重开渲染、既有编辑链识别与数据写回（缓存 + 工作簿）、撤销重做与孤儿回收、六类 fast-fail、LibreOffice 无修复打开抽样（8 型）。
- chart-authoring 子入口进入包公开面（check-package-surface）与 OOXML 产物收集清单。
