---
title: 用真实样本确定高级渲染的首批修正
status: closed
priority: P3
labels:
  - wayfinder:research
parent: ../map.md
blocked_by: []
---

## Question

哪些 EMF+、艺术字和三维偏差可复现、可用格式语义解释，并有明确的修正与验收方法？

## Answer

调查结论见下文；首批 EMF+ 拒绝项与混合图外观已由 [016](016-emf-plus-mixed-chart-fidelity.md) 关闭。艺术字包络与三维材质/接缝仍登记后续，不因本调查关闭而宣称完成。

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

原始、补丁及生成保存的输入哈希、两条路径截图、差异指标和修复前基线见[混合图渲染报告](../mixed-chart-rendering.md)。气泡原始输入 HTML SSIM 从 0.8444 降至 0.8213，生成保存从 0.8056 降至 0.7956；调查须解释具体区域差异，不把本条登记当作功能完成。

## 输出与退出条件

- 每个候选问题有样本、定位到记录/对象的根因、两条文字路径截图与差异指标。
- 为能解释且可验证的具体项新建实现/原型票，分别列支持范围和外部读者回退；不创建“实现全部高保真”的无限任务。
- 无可信样本或仍受字体/平台限制的项保留未决；不把更新快照当作修复证据。

## 调查结论

2026-09-18 范围调查（只读代码 + 固件/报告盘点）。**不关闭本票**：关闭前每个落地项须有样本、根因、两条文字路径截图与差异指标；本节约为可拆实现票的切片。

### 现状边界

| 方向 | 入口 | 已交付 | 与票面点名对齐的缺口 |
|---|---|---|---|
| EMF+ | `@web-ppt/core/emf-plus`（`advanced-rendering` 扫魔数自动加载） | 路径/透明/渐变/基本形状样条/图片/文字/裁剪/继续对象/GetDC；Dual 失败整份 GDI 回退，Only → unsupported | 拒绝串已落地：`暂不支持该裁剪组合`（仅 Replace/Intersect）、`SourceCopy`、`图片颜色变换`、`字形索引/竖排驱动文本`、`竖排字符串`、画刷 type∉{0,1,4}、网纹 style>5、双向渐变、非对称线帽、嵌套图元 |
| 艺术字 | `render/text-svg.ts` + `text-warp-presets.ts`（15 预设）；非 `advanced-rendering` 加载项 | **基线弯曲**：`<textPath>`；Inflate/Deflate 仅改曲线振幅 | **字形包络**未做；依赖字体轮廓（011 Provider 已交付，渲染未接）；HTML/编辑态仍 unwarped |
| 三维 | `@web-ppt/core/three-d` | XYZ 相机、正交/透视、挤出、背面、曲线斜角；透视正面可保留原生 SVG 字 | 材质/光照/网格为近似；不靠材质改真实深度；SVG 阅读器可能仍有网格接缝 |
| 混合图外观（003 留下） | 见 [mixed-chart-rendering.md](../mixed-chart-rendering.md) | 共享数据闭环；按 axId 绑轴，整组 XY 遗漏已修 | 自动轴域、同侧独立轴标签、气泡半径、多级父级轴呈现仍登记为外观差异 |

### 已有确定性固件 / 证据

| 文件 | SHA-256 | 用途 |
|---|---|---|
| `fixtures/sample-emf-plus.pptx` | `46239d9e4af9908adf9196b3e29ff1286c89b74c512fa51064833ad7a1c166ee` | Only/Dual happy path（路径、透明、渐变、裁剪、图片、中文） |
| `fixtures/sample-effects.pptx` | `494d417df68bd61b5f16a4c5b9be944d64573f2dfde7816b8e36066e5a25258b` | 15 种 textWarp 预设 |
| `fixtures/sample-three-d.pptx` | `dcdf2019862ddaa6a3c5d9f922e01ed6e0bb92344e9f561350d56768d310963f` | 相机/旋转/透视/背面/斜角/孔洞 |
| `fixtures/sample-chart-shared-mixed-records.pptx` | `c5682887209458261c8780a42c65ff50cb07be1ffe347d7d50e590fd7112cd5d` | 混合图外观（票内既有） |
| `fixtures/sample-chart-shared-mixed-scatter.pptx` | `c21221dabb06c495cec28a3a9ed9865b02b39ad668681b18a76c017bfadb2d5b` | 气泡混合图外观（票内既有） |

EMF+ 拒绝分支的**真实 Office Only** 样本仍缺；现有固件不足以验收 SourceCopy / ImageAttributes / 竖排 / XOR·Exclude clip。

### 建议首批实现范围

1. **EMF+ 拒绝记录补齐（可解释语义）**：SourceCopy（`0x4023`）明确实现或 Dual 回退策略；DrawImage `attrs≠0xffffffff` → SVG filter；竖排 `DrawString`（format flag 2）及 DriverString 竖排位（**不含** glyph-index）；clip mode 2/3 若 SVG 可表达则做，否则保持拒绝并写清原因。
2. **混合图外观（固件已齐）**：自动轴域对照 OOXML `scaling`；同侧双轴标签避让；气泡半径（`bubbleScale` / `sizeRepresents` area vs width）。不得靠隐藏系列抬 SSIM。
3. **三维（可选小票）**：同几何/相机下材质与 lightRig 对照；网格接缝策略——不改挤出深度语义。

### 明确排除 / 后置

- 「实现全部 EMF+ 记录」；纹理/路径渐变画刷全量；嵌套图元；glyph-index（需 cmap）。
- **字形包络艺术字**单独后置（依赖 011 轮廓 API）；首批若动艺术字只限 Arch/Wave/Curve 基线族偏差，不宣称 Inflate 完成。
- 把 LibreOffice 像素差一律当引擎 bug；用快照更新冒充修复。

### 所需真实样本

| 主题 | 建议 |
|---|---|
| EMF+ | Office 导出 Only+Dual：SourceCopy、ImageAttributes、竖排 DrawString、非 0/1 clip、TextureBrush |
| WordArt 包络（后置票） | Inflate/Deflate/Triangle 大字号单字 + 可嵌入字体 |
| 3D | 同形状同相机，仅改 `prstMaterial` / lightRig |
| 混合图 | 既有两份 SHA 固件 + `out/chart-shared/` 指标即可开实现票 |

### 建议下一张实现票标题

1. **实现 EMF+ SourceCopy·色变换·竖排与扩展裁剪**
2. **修正混合图自动轴域、同侧轴标签与气泡半径**
3. （后置）**实现艺术字字形包络（依赖 fonts/glyphs）**
4. （可选）**收紧三维材质光照与网格接缝**

本票关闭条件：至少前两项实现票已建且样本/根因可验收；未决项登记待调查。关闭≠高保真完成。
