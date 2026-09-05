# ChartEx 官方规范与真实样本证据

核查日期：2026-09-05。范围：[确认扩展图表回退与真实语料边界](../tickets/002-chartex-fallback-corpus.md)的外部资料调查；不包含本项目浏览器验收或 PowerPoint 实机验收。

## 结论

| 问题 | 本轮证据 | 对验收的影响 |
|---|---|---|
| 是否存在真实 PPTX 的 ChartEx + 图片回退？ | LibreOffice 官方测试库的 `funnel-pp1.pptx`，已解包核查 | 可立即建立一个漏斗图的真实回归；不是自造 XML |
| 是否已找到七类 PPTX？ | 尚未；其余类型找到的是 XLSX | XLSX 只能证明 ChartEx 数据格式，不能替代 PowerPoint 的图片回退链路 |
| `mc:Choice` 应如何选择？ | Microsoft SDK 按 `Requires` 中所有前缀解析后的命名空间是否受支持选择首个可用分支 | “解析出了非空对象”不是兼容性条件，未知对象占位不能抢掉 fallback |
| fallback 是否必定是图片？ | 漏斗 PPTX 为 `p:pic`；八个 XLSX 均为 `xdr:sp` 警告文本 | 必须区分“可显示的兼容内容”和“原图预览”，不可宣称一律保真回退 |
| 是否有独立于 MC 的回退？ | 2026 年官方 `CT_ChartSpace` 增加 `fallbackImg` | 尚缺携带该属性的真实文件，需另列版本覆盖缺口 |

## 已证实的规范与 SDK 事实

| 主题 | 事实与一手来源 |
|---|---|
| 规范归属 | 本次找到的 ChartEx 定义在 **[MS-ODRAWXML] §2.24 / §5.22**。`cx:chartSpace` 的命名空间是 `http://schemas.microsoft.com/office/drawing/2014/chartex`。不要把尚未找到的一份“MS-OFFCHARTEX”文档当引用。[官方 chartSpace](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/35fc78ce-59dc-432a-ada5-3d22e51d1aae) |
| OPC 标识 | 内容类型是 `application/vnd.ms-office.chartex+xml`；关系类型是 `http://schemas.microsoft.com/office/2014/relationships/chartEx`。[官方 ChartEx part](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/5d0d453e-adac-43be-a797-59b9916593dd) |
| 数据与样式分离 | `chartSpace/chartData` 存储数据；`chartSpace/chart` 存布局。`externalData` 可指向外链工作簿或包内嵌入的 OOXML 工作簿；电子表格宿主可用公式维护自身引用，不必使用它。[官方 CT_ChartData](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/8a963284-245d-4c2a-935d-cc6aef448b09) |
| 系列类型 | `layoutId` 的枚举含 `boxWhisker`、`clusteredColumn`、`funnel`、`paretoLine`、`regionMap`、`sunburst`、`treemap`、`waterfall`；没有 `histogram`。直方图不能仅按类型名识别。[官方 ST_SeriesLayout](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/2ea3f228-fe39-4f55-b8ec-cee89596e926) |
| MC 选择语义 | 官方 SDK 的 `GetContentFromACBlock` 遍历 Choice，解析每个 `Requires` 前缀并检查支持版本，返回首个满足全部要求的 Choice；否则返回 Fallback。这里没有“子解析结果非空即支持”的条件。[Microsoft SDK MCContext.cs](https://github.com/dotnet/Open-XML-SDK/blob/main/src/DocumentFormat.OpenXml.Framework/MCContext.cs#L384) |
| ChartEx 子关系 | 官方 SDK `ExtendedChartPart` 明确支持嵌入包、图片、图表样式、配色、主题覆盖等子 part；不能把所有 `r:id` 都在 slide 的 `.rels` 中解析。[Microsoft SDK ExtendedChartPart](https://github.com/dotnet/Open-XML-SDK/blob/main/generated/DocumentFormat.OpenXml/DocumentFormat.OpenXml.Generator/DocumentFormat.OpenXml.Generator.OpenXmlGenerator/Part_ExtendedChartPart.g.cs) |
| 新版保存预览 | `CT_ChartSpace.fallbackImg` 是保存时图表图片的关系 ID；在不认识 `version` 或 `featureList` 的客户端可替代图表显示。这是可选属性，不等于 MC 的 Fallback，也不证明旧文件具有该属性。[官方 CT_ChartSpace](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/416e664f-c6f6-4ed9-914b-4eaaa20724dd)、[2026 变更记录](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/60238c6c-2ba5-422f-820b-8652091b1baf) |

上表最后一项是规范事实，不是本轮样本实测；本轮九个文件均不能证明 `fallbackImg` 的生产者行为。

## 真实 PPTX：漏斗图

来源固定在 LibreOffice commit `5c7c41ef9e216bbe95dd6b5e8770ee6483728d55`：
[funnel-pp1.pptx 原文件](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/pptx/funnel-pp1.pptx)。
本地副本为 `corpus/chartex/libreoffice-funnel-pp1.pptx`；本研究重新读取该副本并核查 SHA-256：

```text
8f971346a21010dfdb22799be79bbb883497cc260129cba41d5c9b06967fc3e3
```

| 部件 | 实际观察 |
|---|---|
| `docProps/app.xml` | 声明 `Microsoft Office PowerPoint`、`AppVersion=16.0000`、1 张幻灯片。元数据不能精确证明 Office build 或操作系统 |
| `ppt/slides/slide1.xml` | `mc:Choice Requires="cx2"`，其中 `cx2` 是 `…/2015/10/21/chartex`；其 `graphicData/@uri` 仍是 `…/2014/chartex` |
| Choice 的图表关系 | `cx:chart/@r:id=rId2`，在 slide 自己的 `.rels` 指向 `../charts/chartEx1.xml` |
| Fallback | `p:pic` 的图片关系 `rId3`，在同一 slide `.rels` 指向 `../media/image1.png` |
| 图表的数据关系 | `cx:externalData/@r:id=rId1`，在 **chartEx1 自己的** `.rels` 指向 `../embeddings/Microsoft_Excel_Worksheet.xlsx` |
| 图表数据 | `cx:data` 有 3 个 ID（0、1、2）；每个均有 `strDim cat` 和 `numDim val`，各自的缓存 `lvl/@ptCount=4`；分类公式指向 `Sheet1!$A$2:$A$5`，数值分别指向 B、C、D 列 |
| 已见边界 | 缓存均为正数、分类不重复；不能凭此文件覆盖空值、负值或重复类别 |

关系图来自上述文件的实际 XML，不是生成器设计稿：

```text
slide1.xml
  mc:Choice (Requires cx2)
    graphicFrame → cx:chart rId2 ── slide1.xml.rels ── chartEx1.xml
  mc:Fallback                                           │
    p:pic → rId3 ── slide1.xml.rels ── image1.png          │ externalData rId1
                                                        └─ chartEx1.xml.rels
                                                             └─ embedded .xlsx
```

样本的[引入提交 c84c7b3](https://github.com/LibreOffice/core/commit/c84c7b3c81308fbafa273c76a75f4a71596666b8)
说明它用于 Word/PowerPoint ChartEx 内部数据支持，并明确指出当时的 MSO → LO → MSO round-trip 尚有未完成工作。
当前固定源码中 `testFunnelRendering` 使用该 PPTX 做图形断言；这是上游测试意图，**不是本机 LibreOffice 已跑过的证据**。
[上游测试源码](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/chart2import2.cxx#L581)

## 八个 XLSX：已实读，但不是 PPTX 回退验收

以下均从同一固定 LibreOffice commit 的原始文件读取到内存，用现有 `fflate.unzipSync` 解包，核查 XML、字节长度和 SHA-256；没有转换或重写文件。
**八个 XLSX 本地路径：无（本轮只做内存核查，未落盘）**。下表链接就是实际读取的精确源 URL；后续语料下载器应按这些 URL 获取并核对下面的完整哈希。
后续主线程已将这八份原始文件下载至 `corpus/chartex/<下表文件名>`，逐项核对长度与完整哈希，并用
`tooling/probe-chartex.mjs` 复核下述结构；机器可读来源见
[ChartEx 语料清单](../../../../fixtures/chartex-corpus.json)。原文件仍不入库。
全部 ChartEx part 都是 `xl/charts/chartEx1.xml`，并且数据维度仅含 `_xlchart.v*.N` 公式，**没有 `cx:lvl` / `cx:pt` 缓存**。
因此数值、空值、负值和层级还需解析 workbook 定义名与工作表，不能从“缓存未见负值”得出“没有负值”。

后续本地探针补读工作簿后，确认树状图和旭日图的分类定义名指向 `Sheet1!$B$4:$D$14`（三列），数值指向
`Sheet1!$E$4:$E$14`；瀑布图数值定义名指向 `Sheet1!$C$4:$C$15`，该工作表 12 个数值中有 3 个负数。
这些是 XML 原值与引用范围的观察，不是层级合并规则或图形布局已经验证；探针不会计算公式，也不会把工作表
中所有数字都当成图表系列。

| 类型 / 固定原文件 | 字节 | 实际 layoutId | 实际维度 | Choice 要求 |
|---|---:|---|---|---|
| [树状图 treemap.xlsx](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/treemap.xlsx) | 13631 | treemap | cat + size | cx1 |
| [旭日 sunburst.xlsx](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/sunburst.xlsx) | 11094 | sunburst | cat + size | cx1 |
| [直方图 SimpleHistogram.xlsx](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/SimpleHistogram.xlsx) | 12936 | clusteredColumn，带 binning | val | cx1 |
| [Pareto paretoLine.xlsx](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/paretoLine.xlsx) | 11615 | clusteredColumn + paretoLine，带 binning | val | cx1 |
| [箱线 boxWhisker.xlsx](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/boxWhisker.xlsx) | 13397 | 3 个 boxWhisker 系列 | 3 个 val 维度 | cx1 |
| [瀑布 waterfall.xlsx](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/waterfall.xlsx) | 13218 | waterfall | val | cx1 |
| [漏斗 funnel1.xlsx](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/funnel1.xlsx) | 11503 | funnel | val | cx2 |
| [地图 regionMap.xlsx](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/regionMap.xlsx) | 201594 | regionMap，另含 geography | cat + colorVal | cx4 |

| 前缀（只是样本别名） | 实际命名空间 |
|---|---|
| cx1 | `http://schemas.microsoft.com/office/drawing/2015/9/8/chartex` |
| cx2 | `http://schemas.microsoft.com/office/drawing/2015/10/21/chartex` |
| cx4 | `http://schemas.microsoft.com/office/drawing/2016/5/10/chartex` |

八个文件的 `xl/drawings/drawing1.xml` 的 MC Fallback 均为 `xdr:sp`，不是 `xdr:pic`。
已逐字查看树状图、漏斗、地图的回退文本：它告知当前 Excel 版本不支持图表，并警告编辑该占位形状可能损坏图表。
图表数据命名空间与 MC 功能要求命名空间不同，不能只检查 `graphicData/@uri` 就宣称支持 `Choice.Requires`。

```text
treemap.xlsx         2f08a53fb19ddd8468ec5b52d8428503f0ede06dfb9afc3c4cd02d7cfe2be3eb
sunburst.xlsx        8baf66751b6afa7b28f7e9fbc35ea5d9f7ce39d33c8840d9a67cf21a92dadfa4
SimpleHistogram.xlsx dfe40e742cf92aad408273d17bb0733e1571c309678ec3a3148e10e45a946e56
paretoLine.xlsx      46f96c30f6de3a0bcd8a990d950854bc696aec5a7d2c1c4d051836b4f9c733ac
boxWhisker.xlsx      7c725dda9da6f571ea58824f603bf6eff7bc6c49d122ac4322cc0d6129fa7f92
waterfall.xlsx       f23626e52b75c7e57a6b3a6c69361bdacdbf2648a77c198963daacc4cba2e660
funnel1.xlsx         d3dbb6c78a650d51d2d42e1c1daed23e84be58d0193134e51898a5485e38adf5
regionMap.xlsx       aef6b18c702bd09476b02972f1fb02a95b297de219da42df510812e8b5177215
```

## 许可边界与后续动作

| 材料 | 已核实范围 | 本项目处理边界 |
|---|---|---|
| Microsoft Open XML SDK 源码 | [仓库声明 MIT](https://github.com/dotnet/Open-XML-SDK#license) | 可引用算法来源；SDK 的授权不能自动覆盖来自其他仓库的 Office 文件 |
| LibreOffice 仓库 | 官方提供 [MPL 2.0 文本](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/COPYING.MPL)，另有 GPL/LGPL 文本；本轮未找到这九个二进制文件各自的独立授权声明 | 不将其标成 MIT，不把截图或原文件打进发布包；本地语料保留来源与哈希。正式再分发前核清单文件授权、适用许可和署名条件 |
| Microsoft 规范 | 已读取官方正文和变更记录 | 规范定义不是 PowerPoint 生产者实测，也不授予第三方样本文档的再分发许可 |

这个许可调查尚不足以把“九个文件均可无条件复制进 MIT 仓库”标为通过；本报告也不作该法律结论。

| 仍缺证据 | 最短下一步 |
|---|---|
| 漏斗图在本项目两种 SVG 路径可见 | 用原 PPTX 检查 `image1.png` 能否进入解析结果，再由真实 Chrome 验证屏幕路径和独立 SVG 路径；保留失败/修复后输出 |
| 其余六类 PowerPoint MC envelope | 从权利明确的 PowerPoint 2016+ 文件补齐；可将上述 Excel 图复制到 PowerPoint 并由 Office 真正保存，但必须标明新生产者过程，不能手工换 XML 后称“真实 PPTX” |
| 数据边界 | 定义名→工作表解析后登记空值、负值、重复类别、层级与多系列；现有漏斗正数缓存不足以覆盖它们 |
| 地图原生渲染 | `geography` 的存在不等于有可合法离线使用的行政区几何数据；继续按项目既定永久 fallback 边界处理 |
| Office/LibreOffice 行为 | 记录本机应用准确版本和实际导出结果；上游断言或文件 AppVersion 都不替代实机验证 |
| 新版 `fallbackImg` | 补一份实际含此属性、对应图片关系和未知版本/特性的文件 |

本轮有限搜索检查了 LibreOffice `chart2/qa/extras/data/{pptx,xlsx}` 目录、`sd/qa/unit/data/pptx` 的 407 个目录条目，以及 Microsoft SDK 完整非截断文件树中的相关名称；**未逐个下载所有 PPTX**，所以“尚未找到”不代表仓库中不存在其余样本。
SDK 的 [SunburstChartExample](https://github.com/dotnet/Open-XML-SDK/tree/main/samples/SunburstChartExample) 是代码生成示例，不计入真实 Office 保存文件证据。
