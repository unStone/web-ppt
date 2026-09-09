# 类别与 XY 混合图的实际绘制

任务 003 的外部图像验收发现：同一个 `plotArea` 同时包含类别图与散点/气泡时，旧渲染器只选择类别分支，XY 图形和图例整组缺失。原始固件也能复现，不能将其归为字体或抗锯齿差异。

## 修复范围

| 约束 | 实现 |
|---|---|
| 各组坐标来源 | 按原生 `axId` 解析数值轴，不使用混合图中的第一条轴 |
| 共轴同值同位置 | 汇总引用该轴的类别数值、X/Y 值域，复用实际绘制的完整轴视图 |
| 共轴标签与留白 | 每条轴只绘制一次；隐藏的第二套系列格式不参与留白 |
| 类别域与 XY 标签 | 类别数量只取类别组；XY 数据标签读取本系列的 X 标签 |
| 绘制顺序 | 共同绘图区与背景；先全部轴及网格，再绘制类别组和 XY 组；图例包含所有参与组 |
| 编辑投影 | X、Y、气泡大小的修改改变所有关联框架的实际几何；点增删、撤销重做和两种保存重开保留结果 |

`chart/xy.ts` 承担数值轴绑定、共享视图与 XY 绘制。`frame.ts` 复用轴线、标签、留白和数值坐标映射；相对修复前的独立探针，4,436 组输入逐元素相同。`render/` 依赖边界不变。

构建复用图表编辑包已有的 terser 配置：`module: true`、`compress: false`，保留纯调用注解和导出。它只移除空白、缩短内部名称，不引入 SDK 运行时依赖；原体积预算不变。

## 验证入口

| 验证 | 入口与证据 |
|---|---|
| 源码与发布包共享契约 | 每条入口 2,320 项断言、45 组旧迁移、118 份原生文件与 406 对 SVG；`out/chart-shared/mixed-render-{source,dist}-proof.json` 绑定输入及产物哈希 |
| 七项坐标与标签回归 | `tooling/lib/chart-shared-mixed-axes-contract.mjs`，纳入源码及发布包共享图表测试 |
| 实际编辑与几何 | `chart-shared-mixed-render-contract.mjs`；纵向、横向气泡与混合散点三种确定性固件 |
| 独立进程 SVG | `check-chart-shared-render.mjs` 额外比较三种实际几何编辑的两种保存产物，两条文字路径均覆盖 |
| 旧轴行为等价 | `out/chart-shared/mixed-axis-review/frame-layout-equivalence.json`：768 + 768 + 2,560 + 240 + 100 组 |
| 复核收口 | `mixed-axis-review/final-green.json`：七项实际复现全部通过，无剩余 P1/P2 |
| 固件确定性 | `mixed-render-fixture-determinism.log`：157 份物理固件连续两次逐字节一致 |
| 外部图像 | `node tooling/measure-chart-shared-visual.mjs`：原始、补丁与生成保存的首页面，LibreOffice 实际 PNG 对照 HTML/SVG 两条文字路径 |

旧图像与比较报告保留在 `out/chart-shared/visual-before-mixed-render/`。外部工具差异按实际图像记录，不设 SSIM 及格线，也不把两种保存路径的引擎像素一致误写成 LibreOffice 像素一致。

`mixed-render-final-gates.log` 中 check、全量 test、build 按顺序通过。首次 verify 发现八处过期体积/固件数字，按实测修正后，`mixed-render-final-verify.log` 完整通过（546 项一致性检查及全部发布包专项）；文档收口后 `mixed-render-docs-final-verify.log` 包含 553 项一致性检查。实现与测试输入未变化，官网包表仅更新实测体积。

最终发布包成本与图像复验均已完成。任务 003 验收的是共享数据、历史、恢复和保存闭环；下述外观差异保留为明确边界。

## 外部图像结果

LibreOffice 26.2.5.2，首页面 1280×720；12 份输入完成。比较器按源码打包引擎，406 对保存 SVG 另已在源码与发布包之间逐字节验证一致；记录为 `out/chart-shared/mixed-render-visual-proof.json`。

| 场景 | 保存方式 | HTML SSIM | SVG SSIM | HTML MAE | 差异像素 Δ>8 |
|---|---|---:|---:|---:|---:|
| category-growth | original | 0.8567 | 0.8568 | 5.54 | 6.75% |
| category-growth | patched | 0.8581 | 0.8584 | 3.69 | 5.00% |
| category-growth | generated | 0.8583 | 0.8586 | 3.62 | 5.00% |
| cache-square | original | 0.8567 | 0.8568 | 5.54 | 6.75% |
| cache-square | patched | 0.8441 | 0.8444 | 5.50 | 5.97% |
| cache-square | generated | 0.8443 | 0.8446 | 5.46 | 5.97% |
| mixed-records | original | 0.8213 | 0.8227 | 13.06 | 13.50% |
| mixed-records | patched | 0.7953 | 0.7966 | 11.17 | 13.79% |
| mixed-records | generated | 0.7956 | 0.7969 | 11.06 | 13.79% |
| render-mixed-scatter | original | 0.7971 | 0.7987 | 11.34 | 12.64% |
| render-mixed-scatter | patched | 0.7972 | 0.7988 | 11.33 | 12.64% |
| render-mixed-scatter | generated | 0.7972 | 0.7988 | 11.33 | 12.64% |

类别新增和方形缓存场景的图像指标与修复前相同。混合气泡原始输入的 HTML SSIM 从 0.8444 降至 0.8213，生成保存从 0.8056 降至 0.7956：整组遗漏已消除，但不能据此宣称整体保真提升。逐图检查确认三颗气泡、散点及图例存在，未被后绘制背景遮盖。

剩余差异包括自动轴域、同侧独立轴的标签重叠、类别/数值轴的布局、气泡半径，以及既有多级类别父级呈现；它们不是字体或抗锯齿差异的同义词。已登记到 [009 渲染调查](tickets/009-render-fidelity-scope.md)，后续必须分别解释格式语义并验收。

四组补丁/生成保存的引擎 PNG 在两条文字路径内分别相同。LibreOffice 仅混合散点组的两份 PNG 相同，另外三组不同；此处不承诺两种保存文件在 Office 中逐像素相同。
