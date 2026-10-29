---
title: 用真实样本确定高级渲染的首批修正
status: open
priority: P3
labels:
  - wayfinder:research
parent: ../map.md
blocked_by: []
---

## Question

哪些 EMF+、艺术字和三维偏差可复现、可用格式语义解释，并有明确的修正与验收方法？

## 调查范围

- EMF+：逐项核对当前拒绝的裁剪组合、SourceCopy、图片颜色变换、竖排/字形索引文本及画刷记录；不能把全部差异归为 SVG 无解。
- 艺术字：区分基线弯曲和字形包络变形；后者依赖实际字体轮廓，正式实现须依赖字体能力实现票。
- 三维：在相同几何/相机/字体下分离材质、光照、曲线细分及透明网格接缝；不靠材质参数改变真实深度。
- 对比改动前的浏览器、独立 SVG 阅读器与 LibreOffice 结果；其差异是调查证据，不是自动认定某个引擎永远正确。

## 003 验收留下的图表外观样本

共享数据闭环已通过，混合图仍有自动轴域、同侧独立轴标签布局、气泡半径及既有父级轴呈现差异。逐项核对原生轴绑定、交叉位置、数值格式和尺寸语义；应同时保留正确的数据位置、图例、类别域及两条文字路径，不能通过隐藏系列提高 SSIM。

| 确定性样本 | SHA-256 |
|---|---|
| `fixtures/sample-chart-shared-mixed-records.pptx` | `c5682887209458261c8780a42c65ff50cb07be1ffe347d7d50e590fd7112cd5d` |
| `fixtures/sample-chart-shared-mixed-scatter.pptx` | `c21221dabb06c495cec28a3a9ed9865b02b39ad668681b18a76c017bfadb2d5b` |

原始、补丁及生成保存的输入哈希、两条路径截图、差异指标和修复前基线见[混合图渲染报告](../notes/mixed-chart-rendering.md)。气泡原始输入 HTML SSIM 从 0.8444 降至 0.8213，生成保存从 0.8056 降至 0.7956；调查须解释具体区域差异，不把本条登记当作功能完成。

## 外部语料中的样本

2026-10-19 扫描本地 POI 语料（`apache/poi@29c9cac` 的 `test-data/slideshow`，已登记在 `fixtures/corpus.json`）。以下文件均由 PowerPoint 存出（`docProps/app.xml`），只作为本地测试输入：

| 方向 | 样本 | 内容 |
|---|---|---|
| EMF+ | `bug54570.pptx`、`at.ecodesign.www_downloads_Vertiefungsvortrag_elektronik.pptx`、`aascu.org_workarea_downloadasset.aspx_id=5864.pptx` | 共 4 个含 EMF+ 注释记录的 EMF 部件 |
| 三维 | `customGeo.pptx`、`aascu.org_workarea_downloadasset.aspx_id=5864.pptx`、`ae.ac.uaeu.faculty_nafaachbili_GeomLec1.pptx`、`60810.pptx`、`ca.ubc.cs.people_~emhill_presentations_HowWeRefactor.pptx`、`KEY02.pptx` | 共 32 个 `a:sp3d`、26 个 `a:scene3d` |
| 艺术字变形 | 无 | POI 语料中没有 `textNoShape` 以外的 `a:prstTxWarp` |

艺术字的下一个来源是 LibreOffice 测试语料 `sd/qa/unit/data/pptx` 中的 `tdf125573_FontWorkScaleX.pptx` 与 `tdf140865Wordart3D.pptx`；加入 `fixtures/corpus.json` 前核对生成程序，非 PowerPoint 生成的文件只能作为格式输入，不能作为外观证据。

## 完成本票的步骤

| 顺序 | 动作 | 产出 |
|---|---|---|
| 1 | 对上表样本运行 `npm run compare`，按页记录 SSIM / MAE 与差异区域 | 候选清单：样本、页、差异区域 |
| 2 | 每个候选定位到具体记录或对象（EMF+ 记录类型、`sp3d` 属性），区分本仓库缺陷、LibreOffice 差异与字体差异 | 本票 Answer 中的根因矩阵 |
| 3 | 混合图样本按「003 验收留下的图表外观样本」逐项核对 | 同一矩阵 |
| 4 | 为根因明确且可验收的项各建一张实现票；其余写明未决原因 | 关闭本票 |

## 输出与退出条件

- 每个候选问题有样本、定位到记录/对象的根因、两条文字路径截图与差异指标。
- 为能解释且可验证的具体项新建实现/原型票，分别列支持范围和外部读者回退；不创建“实现全部高保真”的无限任务。
- 无可信样本或仍受字体/平台限制的项保留未决；不把更新快照当作修复证据。
