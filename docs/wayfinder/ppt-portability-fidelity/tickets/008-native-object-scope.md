---
title: 确定 SmartArt 与 OLE 的下一批原生编辑范围
status: open
priority: P3
labels:
  - wayfinder:research
parent: ../map.md
blocked_by: []
---

## Question

在现有布局族、XLSX 单元格与 DOCX 普通段落基础上，哪些新增原生内容有足够样本、可逆写入规则与浏览器预览方案？

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

## 当前进度

基于代码与确定性固件的范围已拆成三张实现票：[013 SmartArt matrix1 / radial1](013-smartart-matrix-radial.md)、[014 DOCX run 与表格单元格](014-ole-docx-runs-tables.md)、[015 XLSX 样式与富文本](015-ole-xlsx-styles-richtext.md)。
退出条件里的真实样本（来源、哈希、截图）尚未取得，所以本票保持 open；确定性固件不能替代真实 Office 样本。

| 待取得的真实样本 | 用途 |
|---|---|
| PowerPoint 存出的 matrix / radial / 带 constrLst 的组织结构图 | 核对布局族边界，以及仅改字时能否保留缓存 |
| 嵌入 Word（表格、多 run 粗斜体） | DOCX 改写后由 Word / LibreOffice 打开验证 |
| 嵌入 Excel（样式、富文本、普通公式） | XLSX 改写后由 Excel / LibreOffice 打开验证 |

## 样本获取路径

Windows 真机暂缓期间，样本先从已钉住来源的公开测试语料获取。语料只作为本地测试输入，放在 `corpus/`（已 gitignore），来源与 git blob SHA1 登记在 `fixtures/corpus.json`，不入库、不分发。2026-10-19 扫描本地 POI 语料（`apache/poi@29c9cac` 的 `test-data/slideshow`）的结果如下，生成程序取自 `docProps/app.xml`：

| 用途 | 已有真实样本 | 生成程序 | 仍缺 |
|---|---|---|---|
| SmartArt 线性 / 层级布局族 | `60810.pptx`（vList5、lProcess2、hProcess9）、`customGeo.pptx`（hierarchy4、hList1）、`ae.ac.uaeu.faculty_nafaachbili_GeomLec1.pptx`（vList3）、`SmartArt.pptx`（default）、`smartart-simple.pptx`（venn1）、`smartart-rotated-text.pptx`（AlternatingHexagons） | PowerPoint 12 / 14 / 16（Windows 与 Mac） | matrix、radial、带 constrLst 的组织结构图 |
| 嵌入 Word | `bug62513.pptx`：5 个 DOCX，其中 1 个含表格，粗体 run 13–84 处，1 个含斜体 run | PowerPoint 14 | — |
| 嵌入 Excel | 仅 `aascu.org_workarea_downloadasset.aspx_id=5864.pptx` 的 `.xls`（旧二进制格式，不在 015 范围） | PowerPoint 12 | PowerPoint 存出的嵌入 `.xlsx` |

缺口的下一个来源是 LibreOffice 测试语料 `sd/qa/unit/data/pptx`，其中有 `tdf145528_SmartArt_Matrix.pptx`、`smartart-cycle-matrix.pptx`、`smartart-org-chart.pptx`、`smartart-org-chart2.pptx`、`smartart-snake-rows.pptx`、`ole.pptx`。这些文件不一定由 PowerPoint 存出：加入 `fixtures/corpus.json` 前逐个核对 `docProps/app.xml`，只有 PowerPoint 生成的文件计为真实 Office 样本。

## 完成本票的步骤

| 顺序 | 动作 | 产出 |
|---|---|---|
| 1 | 把核对通过的 LibreOffice 样本作为新语料集登记进 `fixtures/corpus.json`（上表 POI 样本已在清单中） | 来源、提交、SHA1 |
| 2 | 对每个样本记录现状：两条文字路径截图、解析得到的布局族，以及仅改字后 drawing 缓存是否保留 | 本票 Answer 中的逐样本矩阵 |
| 3 | 用 `bug62513.pptx` 的 DOCX 验证 014：改 run 与表格单元格后由 LibreOffice 打开 | 014 的外部读取证据 |
| 4 | 嵌入 `.xlsx` 仍无 PowerPoint 样本时，015 的外部读取证据登记为缺失，不用合成文件代替 | 015 的边界说明 |
| 5 | 按矩阵把已有实现能覆盖的样本记为支持，其余登记为后续候选或排除原因 | 关闭本票 |
