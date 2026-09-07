---
title: 验证按需字体与字形能力
status: open
priority: P1
labels:
  - wayfinder:prototype
parent: ../map.md
blocked_by: []
---

## Question

怎样在纯浏览器和现有包边界内，取得可嵌入的字体字节、字形位置与 Unicode 映射，让 PDF 和艺术字使用同一份字体依据？

## 原型范围

| 输入 | 验证 |
|---|---|
| 显式提供的 TTF 字节、合法嵌入字体 | 家族/字重映射、缺字处理、字形轮廓、字体许可标志及资源生命周期 |
| 中英混排、组合字符与连字 | 字形位置和 Unicode 映射；区分简单映射与需要复杂整形的文字 |
| EOT/MTX、OTF/CFF、WOFF/WOFF2 | 核实已有解码 hook 能提供什么；首版必须列出支持/拒绝范围，不默认为全格式 |
| 系统只有字体名称 | 明确字节不可得时的结果，不假设能从 Canvas 提取字体或轮廓 |

## 输出与退出条件

- 小型可运行原型、固定字体样本及来源说明、公开接口草案、字体嵌入/映射证据和实际加载/内存数据。
- 比较自实现与可注入按需模块，维持 core 唯一运行时依赖；不把字体字节放进默认包。
- 若可行，明确首版字体格式与语言范围，并创建正式实现票；矢量 PDF 依赖须改接正式实现票。
- 若不可行，记录具体缺失条件与替代路径，不能仅关闭原型票就放行 PDF 实现。
- 参考：[PDF 字体嵌入与映射](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdflsdk/apireference/PDFEdit_Layer/PDEFont.html)。
