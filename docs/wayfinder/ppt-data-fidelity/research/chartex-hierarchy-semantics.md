# ChartEx 层级数据语义：已证规则与不可推断边界

核查日期：2026-09-06。范围：ticket 002 的层级输入语义；只读规范、固定源码和已有原始 XLSX，未新增原始 PPTX、运行 Office 或实现原生绘图。

## 结论

| 问题 | 本轮结果 | 实现决策 |
|---|---|---|
| 普通稀疏父标签是否继承？ | Excel 团队明确说明父层在左，空父类别使用上一行类别。见下文产品说明。 | 有依据支持普通稀疏父层；不是任意空槽全列填充规则。 |
| 缓存 `lvl` 是否等于从左到右的工作表列？ | 官方 SDK 旭日示例按 `Leaf → Stem → Branch` 追加缓存，工作表却为 `Branch → Stem → Leaf`。 | 保留 XML 层序与物理矩形方向，不能逐层同位置比较后宣布语义差异。 |
| 两路数据是否必定一致？ | 同一官方示例的缓存和内嵌工作簿有实际标签差异。 | 分别报告；没有依据擅自选择优先级。 |
| LibreOffice 能否提供这两类原生几何基准？ | 下述固定版本将两类服务分派到 `UnsupportedChart`。 | 该版本不能验证层级几何；仍可查包结构、兼容内容及其他受支持类型。 |

前三项的证据等级分别是**产品团队说明、官方生成代码、代码内嵌数据**，不能升级为原始 PowerPoint PPTX 实测。

## 1. Microsoft 格式规范的精确边界

以下逐节核对 Microsoft `[MS-ODRAWXML]` 正文及 schema。这里的“未规定”仅指这些被核对的小节，不宣称所有 Microsoft 文档均无规定。

| 规范 | 明确规定 | 本节未给出的规则 |
|---|---|---|
| [CT_Data §2.24.3.15](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/b895f5cf-d6a5-4fc1-b566-7b594b2a4e60) | data ID；一个或多个数字/字符串维度，随后可有扩展。 | 根/叶层序、父节点合并、缓存优先级。 |
| [CT_StringDimension §2.24.3.81](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/ab157fdd-8e5a-4b42-8205-aaf41384d457) | 公式配可选 `nf` 和零至多个缓存 `lvl`，或者一个以上字面 `lvl`。 | `lvl` 第一项究竟是父层还是叶层。 |
| [CT_StringLevel §2.24.3.82](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/83fa07e1-6090-4757-acc8-8dd35dac0b63) | 一个维度层；零至多个 `pt`，必填 `ptCount`，可选层名 `name`。 | 稀疏点是否继承、缺点和显式空串是否等义。 |
| [CT_StringValue §2.24.3.83](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/50e379c7-84c2-4506-a36e-4ded3d30a5ba) | 字符串值具有必填 unsignedInt `idx`，表示该值的索引。 | 用标签代替索引的身份规则、重复索引冲突选择。 |
| [CT_Formula](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/174c9b33-29d8-4764-a3c8-7ad71abf4424)、[ST_FormulaDirection](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/dc4c0e17-c0a4-4ceb-ab6c-e3be112af187) | `dir` 默认 `col`；`col/row` 分别按列/行产生维度。 | “按列”不等于“XML 缓存第一层就是最左列”，也未规定树的根方向。 |

因此可立即实现**按 `idx` 保留稀疏位置**和**按 `dir` 投影工作簿物理矩形**；根/叶语义应另有显式映射。重复/越界索引宜作为诊断，不能静默后值覆盖前值——这是防止歧义的数据读取策略，不冒称规范的冲突处理算法。

## 2. Excel 团队对稀疏父类别的说明

Microsoft 在 2015-08-11 的图表介绍中说明：层级表从左侧父类到右侧子类；稀疏表的空父类别沿用上一/上方行的父类别，也支持将父类别逐行填满的表。文章同时展示不等深分支。它支持**普通父空白继承**，没有给出首行全空、祖先改变而中间父槽为空、显式空串与缺失单元格等全部边界的算法。[Excel 团队原文](https://www.microsoft.com/en-us/microsoft-365/blog/2015/08/11/breaking-down-hierarchical-data-with-treemap-and-sunburst-charts/)

Microsoft Support 则明确旭日图最内圈对应最高层，每圈表示一个层级；只有一层分类时类似圆环。这是显示层级方向，不是 `cx:lvl` 的序列定义。[旭日图产品说明](https://support.microsoft.com/en-us/office/create-a-sunburst-chart-in-office-4a127977-62cd-4c11-b8c7-65b84a358e0c)

**设计推论**：父路径已明确且处于同一祖先分支内时，可以建立普通继承规则的测试；末端空槽不能不加区分地继承上一叶子，否则会把短分支错误接到旧叶子。后者须补实际 Office 图形证据，不宜用产品介绍自动推出所有退化行为。

## 3. 官方 SDK 旭日示例：反向层序与两路不一致

来源固定为 `dotnet/Open-XML-SDK@e2d90ca5abd04bc020f941efd19060056655dee6`。该目录 README 明确把它称为使用 SDK 生成 Office 2016 旭日图的示例；**不是原始 Office 保存 PPTX**。[固定 README](https://github.com/dotnet/Open-XML-SDK/blob/e2d90ca5abd04bc020f941efd19060056655dee6/samples/SunburstChartExample/README.md)

`Program.cs` 按 `Leaf → Stem → Branch` 追加三个缓存层，均声明 16 点，类别公式为 `Sheet1!$A$2:$C$17`；最细层缺少索引 `5,6,8,15`。代码附带的工作簿常量经内存解包后，A/B/C 列实际为 `Branch → Stem → Leaf`。因此本例的缓存层序与物理列序相反。[缓存构造 L88–141](https://github.com/dotnet/Open-XML-SDK/blob/e2d90ca5abd04bc020f941efd19060056655dee6/samples/SunburstChartExample/Program.cs#L88)、[工作簿常量 L1322](https://github.com/dotnet/Open-XML-SDK/blob/e2d90ca5abd04bc020f941efd19060056655dee6/samples/SunburstChartExample/Program.cs#L1322)

| 点索引 / 源地址 | 缓存标签 | 工作簿标签 |
|---|---|---|
| 5 / B7 | Stem 6 | Leaf 6 |
| 6 / B8 | Stem 7 | Leaf 7 |
| 8 / B10 | Stem 9 | Leaf 9 |
| 15 / B17 | Stem 16 | Leaf 16 |
| 15 / A17 | Branch 5 | Branch 3 |

以上差异在**反向匹配层序后依然存在**。不能将示例作为“两路相同”正例，也不能据此推定哪一路是 PowerPoint 显示值。该工作簿常量为 9,842 bytes，SHA256 `a57eaf9ced11ef3103b20d7118e8eba7b6f9bf968e42332b564f967c495c952d`；`docProps/app.xml` 声明 Microsoft Excel / 16.0300。没有运行 C#、生成 PPTX、提取图片或把该常量导入语料清单。[同一固定 Program.cs](https://github.com/dotnet/Open-XML-SDK/blob/e2d90ca5abd04bc020f941efd19060056655dee6/samples/SunburstChartExample/Program.cs#L1322)

本例只支持“存在这种层序与不一致”，不是所有生产者的规范性排序证明；也不能把示例中的类型构造习惯当作完整 schema 校验结果。

## 4. 已有原始 XLSX：重复叶与短分支边界

重新只读核对现有固定文件；哈希和原址沿用[语料清单](../../../../fixtures/chartex-corpus.json)。两份的 `B4:D14` 分类矩形与 `E4:E14` 数值相同，ChartEx 均只有公式、无 `lvl` 缓存。下表 `—` 表示缺失单元格，不是已推断的父类别或空字符串。[treemap 原文件](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/treemap.xlsx)、[sunburst 原文件](https://raw.githubusercontent.com/LibreOffice/core/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/qa/extras/data/xlsx/sunburst.xlsx)

| 行 | B | C | D | E |
|---|---|---|---|---:|
| 4 | Best | First | A | 3 |
| 5 | — | — | B | 4 |
| 6 | — | — | C | 2 |
| 7 | — | — | D | 3 |
| 8 | — | — | E | 4 |
| 9 | — | Second | C | 5 |
| 10 | — | — | D | 6 |
| 11 | Worst | Third | E | 4 |
| 12 | — | Fourth | — | 3 |
| 13 | — | Fifth | — | 4 |
| 14 | — | Sixth | F | 5 |

这些原值与普通稀疏父继承的产品说明相符，但本次未在 Office 显示验证。`C/D/E` 重复出现，不能只按叶标签全局归并；第 12/13 行末端为空而数值非空，必须保留位置，不能先压缩空槽再拼接。这里“不全局归并、保留空槽”是避免丢信息的输入策略，不宣称已验证同路径重复叶如何累计。

## 5. LibreOffice 固定版本的真实能力边界

固定版本 `5c7c41ef9e216bbe95dd6b5e8770ee6483728d55` 的分派链已逐段核对：

| 环节 | 源码事实 |
|---|---|
| ChartEx `layoutId` | 将 `sunburst/treemap` 映射到对应 CX token。[plotareacontext.cxx L214](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/oox/source/drawingml/chart/plotareacontext.cxx#L214) |
| token → 图表服务 | 分别映射到 SunburstChartType 和 TreemapChartType。[typegroupconverter.cxx L114](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/oox/source/drawingml/chart/typegroupconverter.cxx#L114)、[L197](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/oox/source/drawingml/chart/typegroupconverter.cxx#L197) |
| 服务返回类型 | 模型返回各自服务名，并非把层级图伪装为 Pie。[SunburstChartType.cxx L44](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/source/model/template/SunburstChartType.cxx#L44)、[TreemapChartType.cxx L44](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/source/model/template/TreemapChartType.cxx#L44) |
| 类型 → 绘图器 | 完整 `createSeriesPlotter` 无上述两种类型分支，落入 `UnsupportedChart`；Funnel 有单独分支。[VSeriesPlotter.cxx L2874–2913](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/source/view/charttypes/VSeriesPlotter.cxx#L2874) |
| 不支持绘图器 | `createShapes()` 建立说明文本，使用 `STR_UNSUPPORTED_CHART_TYPE`，不构造树矩形或旭日扇区。[UnsupportedChart.cxx L81–112](https://github.com/LibreOffice/core/blob/5c7c41ef9e216bbe95dd6b5e8770ee6483728d55/chart2/source/view/charttypes/UnsupportedChart.cxx#L81) |

因此，**该固定源码版本有层级类型模型和导入通路，不等于有原生层级绘图器**。不能拿其不支持提示当成几何 ground truth。本次没有执行本机 LibreOffice；其他版本或外层 MC 回退的最终行为仍须单独实测。未来层级图验收应保留 LibreOffice 对照记录，但几何参考必须来自可验证的 Office 输出或其他确实具备该类型绘图能力的参照。

## 6. 当前可实现规则与保守回退

以下是结合证据提出的**输入层设计**，不是已发布 API 或所有 Office 行为承诺。

| 输入状态 | 现在可以安全做 | 暂不做 |
|---|---|---|
| 一个字面/缓存层 | 按 `idx/ptCount` 保留原始点、空串、缺点、诊断。 | 将缺点默认解释为数值零或继承。 |
| 工作簿矩形 | 按显式/默认 `dir` 输出物理维度，保留单元格地址。 | 为凑成树删除空位或用叶名去重。 |
| 两路只有一层且类型兼容 | 对齐索引报告原值相等/差异，不选择来源。 | 相等就声称全部 ChartEx/图形等价。 |
| 多层缓存与工作簿 | 分别输出，标明层序尚未解释；可以展示有明确标识的候选映射。 | 用未声明映射报告语义相等或语义冲突。 |
| 已知普通稀疏父层 | 在保留原值的派生视图里支持有边界的父继承测试。 | 对所有层、所有空槽全列向下填充。 |
| 首行缺父、祖先切换后缺中间父、同路径重复、两路冲突 | 记录不确定原因，原生入口逐对象回退。 | 发明父节点、拼入旧分支或静默确定缓存优先级。 |

优先补一份真实 Office 保存的多层 ChartEx PPTX，要求缓存、内嵌工作簿、原图预览同时可核查；单独制作并保存“父空白、末端空白、祖先切换、跨分支同名叶、同路径重复”边界。必须记录生产过程与授权，不把 SDK 输出或手工移植 XML 标为原始 Office 产物。现有证据已能推进无损数据读取；尚不足以关闭 ticket 002 或宣告层级原生绘图完成。
