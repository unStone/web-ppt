---
title: 布局检查 lint
status: open
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-structured-describe.md
---

## Question

哪些版面问题可以不看图、用确定性计算发现，并给出 Agent 能直接定位和修正的结果？

## 检查项

| reason | 判定依据 | 复用 |
|---|---|---|
| `text-overflow` | 文字排版高度超出文本框，且没有生效的 autofit | `layoutText`、`resolveTextScale` |
| `element-overlap` | 同页非组合内元素的包围盒交叠超过阈值；背景与装饰元素按规则排除 | 001 的包围盒 |
| `off-canvas` | 元素包围盒越出页面 | 同上 |
| `low-contrast` | 文字颜色与其下方有效填充的对比度低于阈值 | 有效填充与主题色求值 |
| `missing-font` | 文字使用的字体既未嵌入也不在宿主提供的字体列表中 | `collectFonts`、字体 Provider |
| `placeholder-prompt-left` | 占位符仍显示版式的提示文字 | 占位符继承 |
| `image-distorted` | 图片显示宽高比与原图宽高比偏差超过阈值，且不是裁剪造成的 | `readImageMetadata`、裁剪信息 |

每项输出 reason、页号、元素 id（与 001 一致）、包围盒及触发阈值的实测值。

## 完成条件

- 每个检查项都有正例与反例固件，固件由 `tooling/make-*.mjs` 确定性生成。
- 在全部现有固件上运行，逐条复核报告；误报写入本票 Answer 并据此确定阈值，不预设数值。
- 测字在 Node 中走注入的测量函数（字体 Provider），在浏览器中走 Canvas；两种环境给出相同 reason 集合，差异逐条解释。
- 结果在独立进程中两次运行逐字节一致。

## 不做

- 不评价审美（配色、留白比例）；不自动修复，修复由 Agent 通过 004 的命令完成。
