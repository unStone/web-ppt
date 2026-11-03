---
title: 嵌入字体写入 PPTX
status: open
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

## 参考

上游无字体写入。容器依据 W3C Embedded OpenType 提交文档；嵌入列表依据 ECMA-376 §19.2.1.9。

## 不做

- 绕过字体许可位的嵌入。
