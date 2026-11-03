---
title: 新建图表
status: open
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

用户怎样在任意页上从零插入一个原生可编辑的图表（含内嵌工作簿），之后沿用现有的数据、类型与样式编辑？

## 现状

`edit-core/chart`、`chart-design`、`chart-shared`、`chart-ex` 只能编辑文件中已有的图表；官网没有“插入图表”入口。[0.8 票据 001](../../ppt-data-fidelity/tickets/001-chart-data-editing.md) 已为生成保存预留同一数据集模型。

## 范围

| 部分 | 说明 |
|---|---|
| 命令 | 按需入口新增插入图表命令：类型、位置、类别、系列（含空值）；进入历史、恢复与协同 |
| 经典类型 | ECMA-376 全部 16 种绘图类型：柱 / 条（簇状、堆积、百分比）、折线、面积、饼、复合饼、环、散点、气泡、雷达、股价、曲面，以及 3D 变体和组合图 |
| 现代类型 | ChartEx 七类（瀑布、旭日、树状、直方、箱形、漏斗、帕累托）：复用 `edit-core/chart-ex` 的分层数据模型生成 `cx:chartSpace`，同时写出 `mc:AlternateContent` 兼容回退图 |
| 原生内容 | 生成 `c:chartSpace`、内嵌 `.xlsx`（单元格引用与缓存一致）、关系与内容类型；补丁保存与生成保存都写出 |
| 默认外观 | 按当前主题的强调色与字体生成，与 PowerPoint 新建图表的默认样式一致 |
| 产品入口 | 官网插入菜单的图表类型选择器与数据表编辑（产品待确认） |
| Agent | 命令进入 `edit-core/agent` 生成的 Schema |

## 完成条件

- 16 种经典类型与 7 种现代类型各生成一份固件，保存后由 LibreOffice、Open XML SDK 校验器（[005](005-ooxml-validation-gate.md)）与独立读取器无修复打开，图表数据与工作簿一致。
- 新建图表立即可被现有数据编辑、类型 / 样式编辑和共享工作簿逻辑识别，撤销 / 重做 / 恢复往返一致。
- 非法输入（类别与系列长度不符、XY 图缺数值）原子拒绝并给出稳定 reason。
- 默认闭包体积不变。

## 参考

上游 `src/internal/chartml/chart-builder.ts`、`chart-spec.ts`、`embedded-xlsx.ts`、`secondary-axis.ts`、`sheet-layout.ts`（MIT，`18b7e75`），以及 `test/fn-chart-*.test.ts` 的类型覆盖方式。

## 不做

- 链接到外部工作簿：浏览器无法按路径读取用户本机的其他文件，没有可行路径；只生成内嵌工作簿。
- 地图图表新建：需要地理边界数据，现有能力只读取文件自带的 geoCache，不请求地图服务。
