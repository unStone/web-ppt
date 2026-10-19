---
title: 确定旧 PPT 写入器的下一批能力
status: closed
priority: P3
labels:
  - wayfinder:research
parent: ../map.md
blocked_by: []
---

## Question

现有 CFB/Escher 写入器拒绝的内容中，哪些有明确旧格式表达，可以保持原生可编辑结构而无需静默降级？

## 候选顺序

| 顺序 | 候选 | 核实重点 |
|---|---|---|
| 先 | 渐变/图案、图片裁剪、虚线与箭头 | 当前 Schema 与 Escher 属性的映射、单位及有效范围 |
| 再 | 复杂文字、超链接、自动适应 | 样式记录、字符跨度、段落继承与可编辑语义 |
| 后 | 页面切换、旧动画、批注 | 记录依赖、对象引用和播放/审阅语义；以确实存在的旧格式表达为限 |
| 单独决策 | 表格与图表 | 旧文件对象模型和编辑方式；不能用图片证明原生编辑，也不假定存在与 PPTX 一一对应的结构 |

## 输出与退出条件

- 对照 [MS-PPT](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/6be79dde-33c1-4c1b-8ccc-4b2301c08662)
  与对应绘图规范，产出“输入语义 → 二进制记录 → 独立读取结果”矩阵及可复现样本。
- 为首批可做内容建立小范围实现票；未知记录完整保留、现代对象等价转换继续列出限制。
- LibreOffice 无修复读取及转回 PPTX 后核验原生对象作为本机证据；Windows 工件登记但继续暂缓真机。
- 研究关闭不扩写已交付保存矩阵，只有实现及[共同完成条件](../plan.md#共同完成条件)通过后才更新支持状态。

## Answer

「先」类收口为实现票 [012](012-legacy-ppt-appearance-write.md)，其余三类仍是后续候选，保存矩阵只随 012 的验收更新。

| 输入语义 | 二进制记录（OfficeArtFOPT） | 独立读取结果 |
|---|---|---|
| 首尾两色线性渐变 | fillType 7、fillColor / fillBackColor、fillOpacity / fillBackOpacity、fillAngle ∈ [−360, 0) | LibreOffice 转回 PPTX：0° / 45° / 90° / 180° 方向与首尾色一致，终点 50% 透明度保留 |
| 预设虚线 | lineDashing 1–10 | 本仓库读取还原 dash 数组 |
| 默认尺寸箭头 | lineStartArrowhead / lineEndArrowhead 1–5 | 五种类型往返一致 |
| 图片矩形裁剪 | cropFromTop / Bottom / Left / Right（16.16 定点） | LibreOffice 转回 PPTX 的 srcRect 四边与输入一致（差异 ≤ 0.1 个百分点） |
| 形状名 | wzName | 本仓库读取还原 |

图案填充在 OfficeArt 中是 fillType 1 加 fillBlip 指向的图案位图，没有预设名可写，继续原子拒绝；多色标、径向渐变同样没有对应记录。
fillAngle 的符号与 fillFocus 一起决定首尾色（LibreOffice `ImportGradientColor` 按 PowerPoint 实测实现），所以 0 与 −360 方向相反，写入统一落在 [−360, 0)。
