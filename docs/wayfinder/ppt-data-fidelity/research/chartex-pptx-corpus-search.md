# ChartEx 原始 PPTX 补充检索

核查日期：2026-09-06。范围：ticket 002 的真实语料取证；不实现原生绘图，不把 XLSX、生成器输出或移植 XML 计入 PowerPoint PPTX 验收。

## 结论

本轮新增可验收的 **PowerPoint 原始 PPTX：0 份**。最有价值的新证据是作者公开的瀑布图**解包目录**：包含 ChartEx 缓存、内嵌工作簿、图片回退与生产器元数据，但没有拿到对应原始 ZIP。它可以约束数据模型及关系解析，不能升级为原始 PPTX 端到端验收。作者在上游 PR 中说明了分享 PPT 解包内容的用途。[作者 PR #778](https://github.com/scanny/python-pptx/pull/778)、[固定版本解包目录](https://github.com/sanand0/python-pptx/tree/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall)

此前已验证的漏斗 PPTX 与八份 XLSX 沿用[现有研究](chartex-primary-sources.md)和[语料清单](../../../../fixtures/chartex-corpus.json)，本轮不重复计数。树状图、旭日、直方图、Pareto、箱线、瀑布仍缺可直接验收的新增原始 PPTX；regionMap 也未补齐。

## 1. 瀑布：可读取的作者解包样本

### 出处与证据等级

| 项目 | 核实结果 |
|---|---|
| 发布者与上下文 | `sanand0` 在 `scanny/python-pptx` 的瀑布图支持 PR 中提供解包内容；这是贡献者发布的分析样本，不是本项目生成器输出。[PR](https://github.com/scanny/python-pptx/pull/778) |
| 固定版本 | `sanand0/python-pptx@1e7ede71c03931c32c742926454ee78fc2d6a8bb`；目录 `docs/dev/analysis/cht-waterfall-chart/waterfall/`。[目录](https://github.com/sanand0/python-pptx/tree/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall) |
| 包外形 | 非截断的递归树列出该目录下 43 个 blob，包含内容类型、根关系、演示文稿、1 个 slide、布局/母版、ChartEx、图片和内嵌 XLSX。只证明公开目录内容，不证明原始 ZIP 的字节或完整性。[固定版本树 API](https://api.github.com/repos/sanand0/python-pptx/git/trees/1e7ede71c03931c32c742926454ee78fc2d6a8bb?recursive=1) |
| 生产器线索 | `docProps/app.xml` 声明 `Microsoft Office PowerPoint`、`AppVersion=16.0000`、`Slides=1`；与作者说明相互支持，但元数据本身不是不可伪造的生产证明，不能确定具体 Office build/操作系统。[app.xml](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall/docProps/app.xml) |
| 本轮操作 | 读取固定版本 XML 与内嵌 XLSX 字节，在内存解包核对；没有保存候选二进制、重打包 PPTX、执行渲染或截图对比。 |

### ChartEx → 工作簿、MC → 图片的实际关系

| 源部件 | 实际内容 / 关系 | 一级来源 |
|---|---|---|
| `ppt/slides/slide1.xml` | `mc:Choice Requires="cx1"`；`cx1` 是 `http://schemas.microsoft.com/office/drawing/2015/9/8/chartex`；其 `graphicData uri` 是 `http://schemas.microsoft.com/office/drawing/2014/chartex`，图表引用 `rId2`。 | [slide1.xml](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall/ppt/slides/slide1.xml) |
| 同一 `mc:AlternateContent` | `mc:Fallback` 是 `p:pic`，`a:blip r:embed="rId3"`。Choice 的 graphicFrame 与 Fallback 图片均为 `id=4 / name=Chart 3`；位置尺寸同为 `off=(2032000,719666)`、`ext=(8128000,5418667)`（EMU）。 | [slide1.xml](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall/ppt/slides/slide1.xml) |
| `ppt/slides/_rels/slide1.xml.rels` | `rId2` 的 ChartEx 关系指向 `../charts/chartEx1.xml`；`rId3` 的 image 关系指向 `../media/image1.png`。目录树确认图片 blob 存在，12,127 bytes；本轮未检查图片视觉内容。 | [slide 关系](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall/ppt/slides/_rels/slide1.xml.rels) |
| `ppt/charts/chartEx1.xml` | ChartEx 命名空间为 2014/chartex；`externalData r:id="rId1" autoUpdate="0"`；series 的 `layoutId="waterfall"`、`dataId=0`。 | [chartEx1.xml](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall/ppt/charts/chartEx1.xml) |
| `ppt/charts/_rels/chartEx1.xml.rels` | `rId1` 为 package 关系，指向 `../embeddings/Microsoft_Excel_Worksheet.xlsx`；另有 `style1.xml`、`colors1.xml` 关系。 | [ChartEx 关系](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall/ppt/charts/_rels/chartEx1.xml.rels) |

这是**两个不同 chartex URI**共同出现的实物证据：`Choice/@Requires` 解析到 2015/9/8，而 `graphicData/@uri` 是 2014。不能仅以两者字符串相同作为分支支持判断。此处只证明发布目录中的关系，不证明所有 Office 图表都有图片回退。

### 8 点数据与小计

ChartEx 的 `data id=0` 包含 `strDim type="cat"`（公式 `Sheet1!$A$2:$A$9`）和 `numDim type="val"`（公式 `Sheet1!$B$2:$B$9`）；两者都有 `lvl ptCount="8"` 缓存。系列标题公式为 `Sheet1!$B$1`，缓存值 `Series1`。`layoutPr/subtotals/idx/@val` 为 `0,4,7`。[chartEx1.xml](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall/ppt/charts/chartEx1.xml)

| 点索引 | 类别 | 工作簿数值单元格 | 数值（与 ChartEx 缓存一致） | 出现在 `subtotals` |
|---|---|---|---:|---|
| 0 | Category 1 | B2 | 100 | 是 |
| 1 | Category 2 | B3 | 20 | 否 |
| 2 | Category 3 | B4 | 50 | 否 |
| 3 | Category 4 | B5 | -40 | 否 |
| 4 | Category 5 | B6 | 130 | 是 |
| 5 | Category 6 | B7 | -60 | 否 |
| 6 | Category 7 | B8 | 70 | 否 |
| 7 | Category 8 | B9 | 140 | 是 |

内嵌 XLSX 实际解包核实：`xl/workbook.xml` 只有 `Sheet1`，经 `rId1` 指向 `worksheets/sheet1.xml`，其 `dimension=A1:B9`。`A1` 没有 cell 节点；`B1` 与 `A2:A9` 的 `t="s"` 引用 `xl/sharedStrings.xml`（标题与八个类别）；`B2:B9` 是无 `t` 的普通数值 cell，均无单元格公式。工作簿元数据为 `Microsoft Excel / AppVersion=16.0300`。上述单元格结构来自实际读取该 8,800-byte ZIP，不是从 ChartEx 公式推测。[内嵌工作簿原文件](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/docs/dev/analysis/cht-waterfall-chart/waterfall/ppt/embeddings/Microsoft_Excel_Worksheet.xlsx)

这一样本具有真实缓存，可以与现有无缓存 XLSX 形成互补；但不应由这 8 个数值自行推定所有瀑布图的小计累积/重置规则。原生柱体位置、连接线和标签布局仍需渲染基准验收。

### 固定版本字节校验

以下是读取 raw URL 返回字节计算的 SHA256；路径均相对上述固定目录。不是原始 PPTX 的 SHA256。

| 路径 | SHA256 |
|---|---|
| `docProps/app.xml` | `05ea7eb999aa4b9be5052066d19c035274156746fc33b6fa6db713f86fea044f` |
| `ppt/slides/slide1.xml` | `b2bfa46ad65b0f7cb64a5ae7230ef9e5bafcdbdcf7373d82d1bd9623d1e31bd3` |
| `ppt/slides/_rels/slide1.xml.rels` | `b09a299ab87da20984cd135e31e44a1d8a9ded7752a6f427b2a75bbd844574e9` |
| `ppt/charts/chartEx1.xml` | `a99fc13e67c69268a924b81c44dc2950d14edaf18e7750a472c9d83fc086cd01` |
| `ppt/charts/_rels/chartEx1.xml.rels` | `cf344d550c1ce757f0b3d1e34a2e0d14db4ec39202db51c89a0349ab302c1de2` |
| `ppt/embeddings/Microsoft_Excel_Worksheet.xlsx` | `bc813f5669ec22671028d9b131fb2f0d89994d5ab97233a7a6b7d80012e6738d` |

## 2. 其余候选：阻断点与拒收理由

| 候选 | 已核实的一级来源信息 | 本轮判定 |
|---|---|---|
| Aspose 论坛树状图 | 发帖者称模板由 Windows 10 上 PowerPoint 2016 `16.0.7766.7080` 创建；讨论记录其在其他读取环境被视为图片。当前帖子正文未保留可下载附件 URL。[原帖](https://forum.aspose.com/t/treemap-chart-seen-as-pictureframe/7822) | 只有作者陈述，未拿到 PPTX 字节/生产器元数据/MC 结构；不计入验收。 |
| Aspose 论坛瀑布图 | 发帖者称附件含原生瀑布图 `input.pptx`；页面附件 `AsposeSlidesBug.zip` 链接存在。本轮直接读取附件返回 HTTP 401，未尝试绕过权限。[原帖](https://forum.aspose.com/t/powerpoint-waterfall-chart-loses-chart-characteristics/211870)、[附件入口](https://forum.aspose.com/uploads/default/37305) | 无文件、无 hash、无 ZIP 实测；不能据帖子判定内部格式或 Office 版本。 |
| Aspose .NET `Funnel.pptx` | 实际只读解包：`Application=Aspose.Slides for .NET`，`AppVersion=21.1200`；有传统图表部件和 `layoutId=funnel` 的 ChartEx 部件。[固定样本](https://raw.githubusercontent.com/aspose-slides/Aspose.Slides-for-.NET/97642e5f738e467b724d4633bda1211fe34433fc/Examples/Data/Charts/Funnel.pptx) | 第三方生成器产物，不补 PowerPoint 生产器证据，也不是本轮缺失类型。70,299 bytes；SHA256 `da4197cad20b062e69eee5fcb4ddaef22cd89b6c4870fcd73fbeb94f69b08015`。 |
| Aspose Java `Funnel.pptx` | 实际只读解包：元数据同样声明 `Aspose.Slides for .NET`，`AppVersion=19.0600`，不能因为仓库名是 Java 就推测生产器。[固定样本](https://raw.githubusercontent.com/aspose-slides/Aspose.Slides-for-Java/18cf3796d1873cfe167ede4bef4a2010c14824d7/Examples/Data/Charts/Funnel.pptx) | 不计入 PowerPoint 语料。55,096 bytes；SHA256 `75b1591ecef55e7fec73c4b9f0843c212ce8ba5d1def223e95fce3ac2fdc5989`。 |

## 3. 官方规范能证明什么

本轮核对的是 Microsoft 的 `[MS-ODRAWXML]` ChartEx 类型定义。下表只记录文档明确内容，不将类型定义补写为绘图算法。

| 问题 | 已证事实 | 尚不能由此推出 |
|---|---|---|
| 瀑布小计 | `CT_Subtotals` 是小计数据点索引列表；`CT_SubtotalIndex/@val` 是必填 unsignedInt。[CT_Subtotals](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/4fc38c3f-c55e-4453-8a06-21f92056554e)、[CT_SubtotalIndex](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/cd69de6d-a670-45fe-b6b3-b8b4384350d9) | 这两节未给出小计后的累积/重置算法、负小计画法或连接线几何。 |
| 分箱参数 | `CT_Binning` 可选择 `binSize` 或 `binCount`，二者不能同时出现；该选择也可以省略。另有可选的 `intervalClosed`、`underflow`、`overflow`。[CT_Binning](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/2e5dfc5a-d3b7-4390-bc00-188a2fefcb3a) | 省略参数时 Office 如何自动选箱数/宽度，不能由 schema 推断。 |
| 分箱边界 | `ST_IntervalClosedSide` 的 `l` / `r` 分别表示左闭/右闭；`ST_DoubleOrAutomatic` 允许 double 或 `auto`。[闭区间侧](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/21a3a14c-7dde-4b9f-9812-a2f9a96fc5fe)、[数值或自动](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/7d4f4fcd-1ae3-4d1c-a090-c0f956d3a490) | 尚无真实直方图/Pareto PPTX 证明边界值、下溢/上溢箱的最终视觉行为。 |
| 层级数据与空值 | `CT_StringDimension` 允许公式引用配 0 个或多个缓存 `lvl`，或直接使用 1 个以上 literal `lvl`。[CT_StringDimension](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/ab157fdd-8e5a-4b42-8205-aaf41384d457) | 此节没有规定树状图/旭日空白父类别的继承、合并、跳过或补齐规则；“有公式但无缓存”也不等于空数据。 |

## 4. 检索边界与许可

检索采用公开网页定位，再核对第一方仓库树、raw 部件或作者论坛正文。搜索摘要不作为文件实测。以下是本轮的有限仓库检查范围；文件名筛选会漏掉无语义命名的 PPTX，结果不是“互联网上不存在”的证明。

| 一级来源 | 固定版本 / 检查范围 | 结果 |
|---|---|---|
| [Aspose .NET](https://github.com/aspose-slides/Aspose.Slides-for-.NET/tree/97642e5f738e467b724d4633bda1211fe34433fc) | `97642e5f738e467b724d4633bda1211fe34433fc`；完整递归树，目标类型文件名筛选 | 找到漏斗二进制及其他类型生成代码；前者生产器不符，后者不作为文件证据。 |
| [Aspose Java](https://github.com/aspose-slides/Aspose.Slides-for-Java/tree/18cf3796d1873cfe167ede4bef4a2010c14824d7) | `18cf3796d1873cfe167ede4bef4a2010c14824d7`；同上 | 同上。 |
| [Aspose C++](https://github.com/aspose-slides/Aspose.Slides-for-C/tree/878647a8ba2d319eae1cf26a781e4340d8d5d0e7) | `878647a8ba2d319eae1cf26a781e4340d8d5d0e7`；完整递归树，图表相关文件名筛选 | 未发现目标类型命名的原始 PPTX。 |
| [python-pptx 上游](https://github.com/scanny/python-pptx/tree/278b47b1dedd5b46ee84c286e77cdfb0bf4594be) | `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`；完整递归树与 PR #778 | 上游目标文件名未命中；PR 指向作者 fork 的瀑布解包目录。 |
| [pptx-svg](https://github.com/t-ujiie-g/pptx-svg/tree/47a7e90842274aeb15abb6ef61bd040b22ffba2b)、[office-open-xml-viewer](https://github.com/yukiyokotani/office-open-xml-viewer/tree/84f531b53efaacc764bf4053b675c99478e33bde) | 各固定版本完整递归树；目标图表名/PPTX 文件名筛选 | 没有发现能推进本轮原始 PPTX 验收的候选；没有遍历检查所有通用命名文件的 ZIP 内容。 |

另检索了 LibreOffice Bugzilla 的目标类型线索，未获得可补齐的新增原始 PPTX。`ONLYOFFICE/document-server-testing` 树 API 返回 404，不能据此判断仓库不存在还是不可访问。没有继续穷举仓库或重试受限附件。

许可边界：

- `sanand0/python-pptx` 固定版本根目录是 MIT 许可证，要求保留版权与许可声明；但样本中的 Office 解包资产没有逐项独立的来源/再许可声明，本报告不把仓库根许可证自动等同于每项资产均已完成权利审查。[固定 LICENSE](https://raw.githubusercontent.com/sanand0/python-pptx/1e7ede71c03931c32c742926454ee78fc2d6a8bb/LICENSE)
- 论坛可公开阅读不等于附件可以重新分发；树状图附件缺失、瀑布附件需要权限，均不导入仓库。
- Microsoft 规范用于解释格式，不是实际 Office 文件或视觉基准；解包目录、XLSX 与原始 PPTX 的证据等级分别记录。
- 本轮只新增本报告，不保存或提交下载二进制；未来若拿到可用原始文件，先核对生产器、关系链、缓存/工作簿、SHA256 与许可，再添加到忽略的 `corpus/chartex` 及对应清单。

最短后续路径是补齐一份可授权的原始瀑布 PPTX，以及树状图/旭日中含空白父类别的原始 PPTX；直方图/Pareto 另需明确箱数、箱宽、边界值和 underflow/overflow 的样本。当前证据足以细化数据读取探针，尚不足以宣布六类 ChartEx 原生绘图完成。
