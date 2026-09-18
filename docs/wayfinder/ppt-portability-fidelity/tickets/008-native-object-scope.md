---
title: 确定 SmartArt 与 OLE 的下一批原生编辑范围
status: closed
priority: P3
labels:
  - wayfinder:research
parent: ../map.md
blocked_by: []
---

## Question

在现有布局族、XLSX 单元格与 DOCX 普通段落基础上，哪些新增原生内容有足够样本、可逆写入规则与浏览器预览方案？

## Answer

调查结论见下文；实现已由 [013](013-smartart-matrix-radial.md)、[014](014-ole-docx-runs-tables.md)、[015](015-ole-xlsx-styles-richtext.md) 关闭。真实 Office 语料哈希仍可后续补入外部目录，不阻塞本轮功能交付。

## 调查范围

| 方向 | 首先核实 |
|---|---|
| SmartArt | 按样本盘点布局定义、约束、连接与样式；区分仅改文字可保留缓存和结构变化必须重排 |
| DOCX | run 级格式与表格单元格文字；不跨域、修订或内容控件边界直接拼接替换 |
| XLSX | 常用单元格样式、共享样式表及富文本；公式缓存/预览更新不能假装已重算 |
| 未知宿主 | 维持框架操作及原包保留；不在浏览器内承诺调用任意 OLE 应用 |

## 输出与退出条件

- 逐格式的真实样本来源、哈希、现状截图、原生结构分析和明确的首批支持矩阵。
- 选出可独立交付的具体布局/内容，不以“支持更多”作为实现票标题或验收条件。
- 分别新建 SmartArt、DOCX、XLSX 实现票，写清模型、原生内容/预览一致性、历史/协同和独立读取验收。
- 将尚无预览或可逆写入方案的范围继续登记待调查；本研究关闭不表示对象编辑完成。

## 调查结论

2026-09-18 范围调查（只读代码 + 固件盘点）。**不关闭本票**：结论用于拆实现票；关闭前仍需真实 Office 样本哈希与截图补齐退出条件。

### 现状边界

| 能力 | 入口 | 已交付 | 明确缺口 |
|---|---|---|---|
| SmartArt | `@web-ppt/edit-core/smartart`；布局族在 `core/pptx/diagram.ts` | 六族引擎：`linear` / `cycle` / `pyramid` / `hierarchy` / `snake` / `radial`；面板可改字、增删节点、改父子与同级排序；保存重写 DiagramML + drawing 缓存；固件含 matrix1 / radial1（见 [013](013-smartart-matrix-radial.md)） | 不实现 `constrLst`/`ruleLst` 完整约束；无节点样式 API；`.ppt` SmartArt 未做；与 PPT 像素一致未宣称 |
| OLE | `@web-ppt/edit-core/ole` | 三容器：直接 OOXML Zip、CFB `Package`、`Ole10Native`；XLSX 普通单元格值；DOCX `editable` 普通段落整段替换；未改部件保留；公式格可改成值并标全量重算 | 无单元格样式 / 富文本 sharedStrings；DOCX 无 run 级 API、无表格单元格；域/修订/sdt/drawing 整段拒绝；未知宿主 `此 OLE 类型不支持内容编辑` |
| Ink（同族上下文，非本票深化） | `@web-ppt/edit-core/ink` | 笔刷/点列/压力/InkML | 不纳入本票首批实现 |

`expanded-capabilities.md`：未知 OLE 宿主、布局能力外 SmartArt 不宣称完整内部编辑——与代码一致。

### 已有确定性固件

| 文件 | SHA-256 | 覆盖 |
|---|---|---|
| `fixtures/sample-smartart.pptx` | `255e91d69611f393d41a1ea48426700481b83b5e9e13ca07797a8a5c9c880ac2` | process1 / cycle2 / pyramid1 / orgChart1 / vList2 / **matrix1** / **radial1** |
| `fixtures/sample-smartart-edit.pptx` | `dc04b3701d0f6549063d553a011f7ea3f5d7e1571501cf6be5267e26d3f923a2` | 上者 + GUID 身份与未知 data 扩展 |
| `fixtures/sample-ole.pptx` | `fe7e755f452e61ca59c96deff80a5e7a96c1124e0b689cee6b6f0a2ce74444e5` | 预览路径（多为空 bin） |
| `fixtures/sample-ole-edit.pptx` | `111d96faa868183377df7d551ce326dc7be62c51d471c8dacd40d7c98ae3f630` | 直接 XLSX、CFB Package DOCX、Ole10Native XLSX |

生成脚本：`tooling/make-smartart-fixture.mjs`、`make-smartart-edit-fixture.mjs`、`make-ole-fixture.mjs`、`make-ole-edit-fixture.mjs`。

### 建议首批实现范围

1. **SmartArt**：补固件并验收 `.../layout/matrix1`（或 `grid` → snake）与 `.../layout/radial1`（或 radial uid）；操作仍限节点树 + 族级重排，不承诺与 PPT 像素一致。可选旁支：仅改字时是否复用原 drawing 缓存（结构变仍必重排）。
2. **OLE DOCX**：单段多 run 下改字不丢相邻 `w:b`/`w:i`/`w:u`/`w:sz`/`w:color`；`w:tbl`→`w:tc` 内普通段落文字（仍排除域/sdt/drawing/修订）。
3. **OLE XLSX**：单元格 `s` → `styles.xml` font/fill/border（优先复用既有 xf）；`sharedStrings` 多 `<r>` 有限读写。

### 明确排除

- 任意 OLE 宿主原位激活；Visio / Equation / 旧 `.xls` 等未知 progId。
- DiagramML 完整约束求解；节点配色/样式面板；`.ppt` SmartArt。
- 浏览器内公式求值；数组/共享公式单格替换；受保护工作表。
- 修订、内容控件、域、跨节拼接替换。
- 标题或验收写「支持更多 SmartArt / OLE」。

### 所需真实样本（关闭本票前）

| 样本 | 用途 |
|---|---|
| PPTX：matrix / radial / 含真实 layoutDef+constrLst 的 orgChart | 族边界与改字 vs 重排 |
| PPTX：嵌入 Word（表格 + 粗斜体多 run） | DOCX 深度 |
| PPTX：嵌入 Excel（样式、富文本、普通公式） | XLSX 深度 |
| 各文件 SHA-256 + PowerPoint/LibreOffice 截图 | 退出条件 |

确定性 make 固件可并行补 snake/radial，但**不能替代**真实 Office 样本。

### 建议下一张实现票标题

分别新建（编号自 012 起，避开已占用的 011 字体票）：

1. **实现 SmartArt matrix1/radial1 原生编辑与重排验收**
2. **实现 OLE DOCX run 格式与表格单元格文字**
3. **实现 OLE XLSX 单元格样式与富文本 sharedStrings**

本票关闭条件：三票已建、首批矩阵写进各票、真实样本清单有哈希；关闭≠对象编辑完成。

已建实现票：[013 SmartArt matrix/radial](013-smartart-matrix-radial.md)、[014 OLE DOCX](014-ole-docx-runs-tables.md)、[015 OLE XLSX](015-ole-xlsx-styles-richtext.md)。真实 Office 样本哈希仍缺，本票暂保持 open。
