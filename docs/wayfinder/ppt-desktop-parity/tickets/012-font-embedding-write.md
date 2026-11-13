---
title: 嵌入字体写入 PPTX
status: open
assignee: zcode
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

用户在本机字体下完成的文稿，怎样把许可允许的字体写进 `.pptx`，让没有该字体的电脑也按原样显示？

## 现状

core 能读取嵌入字体（剥 EOT 容器，MTX 经 `setFontDecoder` 注入）；`@web-ppt/fonts/glyphs` 的本机字体只用于预览与导出，不写入 PPTX。

## 范围

| 部分 | 说明 |
|---|---|
| 许可检查 | 读取 OS/2 `fsType`：禁止嵌入的字体拒绝；仅预览打印、可编辑、可安装分别标注 |
| 容器 | 生成 EOT 容器（不压缩，按规范可选异或混淆），常规 / 粗体 / 斜体 / 粗斜体分别写入 `p:embeddedFontLst` |
| 子集 | 可选只嵌入文稿用到的字形（PowerPoint “仅嵌入使用的字符”），保留 `cmap` 与度量 |
| 命令 | 嵌入 / 移除字体命令进入历史、恢复与保存；复制粘贴时随元素携带 |
| 产品入口 | 字体面板中的嵌入开关（产品待确认） |

## 完成条件

- 嵌入后保存重开，core 读回的字体与原字节（或子集）一致；LibreOffice 使用嵌入字体显示。
- `fsType` 各取值有正反例固件；禁止嵌入的字体原子拒绝。
- 复杂脚本、CFF、变量字体的限制与 `api/font-glyphs.md` 现有边界一致，并写明。

## Answer（2026-11-13，SDK 能力已交付；产品入口与子集化待后续）

设计与实施见[设计文档](../../../design/font-embedding-write.md)。已交付：

| 层 | 交付 |
|---|---|
| core | `sfntEmbeddingRights`（OS/2 fsType 权利判定，写入边界拒绝 restricted / bitmap-only）+ `wrapEotContainer`（EOT v1 封装，fsType 回写、XOR 可选、与读侧剥头逐字节往返），[eot-write.ts](../../../../packages/core/src/font/eot-write.ts) |
| edit-core | `EditDoc.fontResources`（内容寻址）+ `SetEmbeddedFont` / `RemoveEmbeddedFont` 命令（历史、撤销重做、协同 patch 同型）+ 补丁保存输出 `ppt/fonts/{hash}.fntdata` + `p:embeddedFontLst`（schema 序插 notesSz 后）+ 关系 + Content-Type；移除回收（部件删除 + 关系与引用剪除）；保存重开读回 sfnt 与登记字节一致 |
| 验收 | core 套含 fsType 正反例、容器往返、XOR 往返、非法家族名 fast-fail；M1 保存契约 606 项（登记 / 移除 / 撤销 / 重做 / 幂等 / 许可拒绝全链）；产物 `font-embedding.pptx` 登记进 Office 外部打开清单 |

完成条件核对：

- ✅ 保存重开读回一致（契约断言逐字节相等）。
- ⚠️ LibreOffice：产物成功打开、文本完整、OOXML 门禁通过；但**本机 LibreOffice 对 PPTX 嵌入字体不做渲染消费**——用 PowerPoint 风格 EOT 的固件样本 `sample-embedfont.pptx` 做对照实验，同样回退系统字体。这是该渲染器的普遍行为而非容器缺陷，登记为环境限制；「使用嵌入字体显示」以本引擎读侧验证为准。
- ✅ fsType 正反例：installable / editable / view-print / restricted / version≥3 混合位拒绝 / 超版本拒绝 / bitmap-only 拒绝；禁止嵌入在命令与保存双边界原子拒绝。
- ✅ 限制写明：仅 sfnt（TTF/glyf、CFF OTF）可写入；TTC 只写首个 face；变量字体按默认轴；MTX 压缩不做（无开源压缩器，读侧经解码器 hook 支持）。

未交付（后续）：

| 项 | 说明 |
|---|---|
| 可选子集化 | 保存侧接 `FontSubsetter`（016 已交付引擎）实现「仅嵌入使用的字符」；当前整字体写入 |
| 产品入口 | 字体面板嵌入开关（票据原注「产品待确认」）；官网「不会写入 PPTX」提示文案同步 |
| 复制粘贴随元素携带 | 嵌入字体是 doc 级资源，跨文稿粘贴的字体闭包策略待定 |

## 参考

上游无字体写入。容器依据 W3C Embedded OpenType 提交文档；嵌入列表依据 ECMA-376 §19.2.1.9。

## 不做

- 绕过字体许可位的嵌入。
