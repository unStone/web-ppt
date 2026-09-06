# ChartEx 按需原生解析

原生实现已提供；完整 Office 保真验收仍在进行。SDK 默认继续使用文件中的 Office 预览，宿主可显式启用：

```ts
import { parse, setChartExParser } from '@web-ppt/core';
import { parseChartEx } from '@web-ppt/core/chart-ex';

setChartExParser(parseChartEx);
const presentation = await parse(file, { edit: true, keepPackage: true });
// 文稿在打开时固定解析能力；关闭 hook 不改变已经打开的惰性页面或编辑投影。
setChartExParser(null);
```

`renderChartExXml(xml, width, height, env)` 可单独输出 `SlideElement[]`。`env.readPart` 只读取 OPC 包内字节，
不访问外部工作簿或网络。两个入口均无 DOM 依赖，输出复用现有屏幕、独立 SVG、PNG 与打印路径。
官网和查看器已使用 `@web-ppt/core/modern-charts` 检查内容类型并自动按需加载；普通文件不下载布局模块，
加载失败保留来源预览。SDK 默认入口行为不变，完整真实语料与 Office 原生保真验收仍单独登记。

| 类型 | 实现 | 明确的退化 |
|---|---|---|
| 树状图 | 稳定面积排序、squarify、父标签、类别图例与点颜色 | 父路径歧义、负面积、重复完整叶路径、权重下溢回退 |
| 旭日图 | 父子权重、分层圆弧、短分支、整圆 | 同上；零值和空值不产生面积 |
| 直方图 / Pareto | 固定宽度/数量、Scott 自动分箱、左右闭合、上下溢出、类别聚合、累计百分比 | 无观测、无效边界、超限分箱回退 |
| 箱线图 | inclusive/exclusive 四分位、1.5 IQR 须、均值、内部点及异常点 | 空系列回退；隐藏异常点时仍为可见均值保留坐标范围 |
| 瀑布图 | 正负增量、累计连接、小计重置、点颜色 | 累计值非有限时回退 |
| 漏斗图 | 按源顺序居中的比例横条、类别与数值标签 | 负宽度、无正值回退 |
| 地图 / 未知类型 | Office fallback | 不附带或下载地图数据 |

输入按命名空间识别，不依赖 XML 前缀。`dataId`、维度、点索引和类别长度必须唯一且对应；稀疏数值保持
`null`，空字符串不能变成零。定义名称与 A1 矩形范围可解析到内嵌工作簿，缓存与工作簿冲突时整对象回退。
公式计算、外链、歧义名称、错误单元格和缺失工作簿不会被猜测为有效数据。

解析器参考 Microsoft 的 [数值维度](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/37fbbd78-c3e6-4f33-9d0b-3fe428ad1c09)、
[系列布局属性](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/1ff5c9ad-828a-4d0c-be72-07754eba3588)与
[分箱定义](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/2e5dfc5a-d3b7-4390-bc00-188a2fefcb3a)。
自动布局的像素位置、字体和样式不声明与所有版本 Office 等价。

图表保持原子框架身份。画布可移动、复制、删除整图，不能单独编辑解析生成的孩子；源 ChartEx、工作簿和
MC 回退依赖继续保留。补丁保存、原包释放后的生成保存、恢复与外部补丁回放均保留源图表字节。
通用 OPC 子包继续只处理字节；主题/母版的派生视图及编辑文档接收新保存包时才继承解析上下文。
高级宿主自行派生解析包时可调用 `inheritPptxParsingContext(source, target)`，目标须属于同一文稿。

| 验证 | 证据与边界 |
|---|---|
| 默认回归 | `npm run test:chartex`；确定性八页固件，数学边界、命名空间、两条文本路径、编辑与保存 |
| 真实漏斗 | `node tooling/test-chartex-native.mjs --corpus`；额外验证真实漏斗原生输入与缓存冲突回退 |
| 真实浏览器 | `npm run test:editor:functional`；八页屏幕、独立 SVG 解码、PNG 像素与打印 HTML |
| LibreOffice | `npm run test:v08:libreoffice`；统一清单的无修复打开与 PDF 导出，不能单独证明原生布局等价 |
| Windows PowerPoint | 16.0 Build 4266 的交互桌面探针可打开八页固件及真实漏斗，但均显示图片；不构成原生布局 oracle |
| 体积 | `tooling/check-chartex-boundary.mjs`；默认 core/worker 不含布局与工作簿实现，独立 OPC 不引入 core |

当前真实 PPTX 仍只有漏斗；其余 XLSX 的数据证据不能替代原始 PPTX、Office 原生截图与混合产品旅程。
因此 [语料票](wayfinder/ppt-data-fidelity/tickets/002-chartex-fallback-corpus.md)、
[层级票](wayfinder/ppt-data-fidelity/tickets/003-chartex-hierarchy-rendering.md)、
[统计票](wayfinder/ppt-data-fidelity/tickets/004-chartex-statistical-rendering.md)及
[集成票](wayfinder/ppt-data-fidelity/tickets/007-v08-integration-readiness.md)保持开放。
