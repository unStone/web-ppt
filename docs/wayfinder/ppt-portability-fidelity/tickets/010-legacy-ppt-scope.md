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

## Answer

调查结论见下文；首批外观实现已由 [012](012-legacy-ppt-appearance-write.md) 关闭。复杂文字 / 超链接 / 切换动画 / 表格图表仍为后续候选，不因本票关闭而记入支持矩阵。

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

## 调查结论

2026-09-18 范围调查（只读 `edit-core/ppt` + `core/ppt/escher` + 固件）。**不关闭本票**：关闭前须有实现票与「Schema → Escher → 独立 parse」矩阵骨架；**不得**在实现前改 `expanded-capabilities.md` 支持状态。

### 现状边界（与文档矩阵一致）

入口：`savePpt` / `PptSaveError`（`@web-ppt/edit-core/ppt`）。已写：页尺寸/顺序/隐藏、纯色填充、实线描边、**默认尺寸**箭头类型、自定义几何、≤8 层组合、无裁剪 PNG/JPEG、横排基础文字、备注。

票候选「先」类对应的拒绝串（均可开实现）：

| Schema 语义 | 拒绝字符串 | 代码 |
|---|---|---|
| 渐变 / 图案 / 图片形状填充 | `PPT 写入暂不支持渐变、图案或图片形状填充` | `appearance.ts` |
| 图片 crop / 效果 / 音视频 | `PPT 写入暂不支持裁剪、图片效果或音视频` | `drawing.ts` |
| 任意非空 `stroke.dash` | `PPT 写入暂不支持自定义虚线` | `appearance.ts` |
| 箭头 `w/h ≠ 3` | `PPT 写入暂不支持自定义箭头尺寸` | `appearance.ts` |

读取侧 `core/ppt/escher.ts` 已有对称属性常量；写入未接：`fillType` 4–7 / pattern、`cropFrom*` **256–259**、`lineDashing` **462**（reader `DASH_MAP`）。注意：**core 读路径当前 `crop: null`**，实现须读写对称，否则无法做独立读取证据。

「再 / 后 / 单独」类已有明确拒绝（超链接、自动适应、切换/动画/批注/节、表格、frame 对象、特效三维等），首批不纳入。

### 已有固件

| 文件 | SHA-256 / 角色 |
|---|---|
| `fixtures/sample-ppt-edit.pptx` | `deb5ef2a34a0971db91b5b94022adf7d0ff7ebe44a597b28836c4e2bf84a91bc` — 正向：文字、椭圆、组合、PNG、备注、隐藏（**无**渐变/虚线/crop） |
| `fixtures/sample.ppt` | 最小 CFB 往返 |
| `fixtures/sample-ppt-unsupported.ppt` | 未知 MSOSPT + OLE 旗标 → frame，保存拒绝 |
| `showcase.ppt` 等 | LibreOffice 转换样本，非 `savePpt` 增量矩阵 |

测试：`tooling/test-ppt-save.mjs`、官网 `site-ppt-save-browser-contract.mjs`。

### 建议首批实现范围

按票候选「先」收口为**外观层一小票**：

1. **双色线性渐变**：`Fill.type==='gradient'` → Escher `fillType` **384** ∈ {4,5,6,7} + **385/387**；`stops.length>2` 或 `radial` 无明确旧表达则继续拒绝。
2. **图案填充**：`fillType=1` + preset↔MSO 索引表；未知 preset 拒绝，不降级纯色。
3. **图片矩形裁剪**：`ImageElement.crop` → **256–259**；仍拒 clipPath/filter/duotone/alpha/media；**同步修复 reader 还原 crop**。
4. **预设虚线**：`Stroke.dash` ↔ `lineDashing` **462**（反用 `DASH_MAP`）；无法映射则保持现拒绝串。
5. **默认箭头类型**：已写 **464/465**；用固件锁住五类 + `w=h=3`；非默认尺寸仍拒绝。

### 明确排除（首批）

- 复杂文字、超链接、自动适应；页面切换、旧动画、批注、节。
- 表格、图表、SmartArt/OLE/墨迹/音视频/公式/三维/frame。
- 复合线型、图片形状填充（可列为同批余力或第二小票）、自定义箭头尺寸。
- 静默降级为图片；用图片证明「原生可编辑」。
- 未知二进制逐字节保留（生成写入器本就不承诺）。

### 所需样本

| 样本 | 用途 |
|---|---|
| 新建确定性 `sample-ppt-appearance-save.pptx`（make 脚本） | 双色渐变、一种 pattern、四边 crop PNG、prstDash→dash 数组、双端默认箭头 |
| `savePpt` → 本仓库 `parse` + LibreOffice 重开 | 输入语义 → FOPT → 独立读取矩阵 |

### 建议下一张实现票标题

**实现旧 PPT 写入：渐变/图案、图片矩形裁剪、预设虚线与默认箭头**

副验收：读写对称；映射表对照 MS-ODRAW/MS-PPT；LibreOffice 重开；其余外观继续拒绝。实现及共同完成条件通过后，才更新 `expanded-capabilities.md` 保存矩阵。
