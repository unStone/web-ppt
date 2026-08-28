---
title: 建立空白新建文稿闭环
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./064-generated-pptx-save.md
---

## Question

`createEmptyDoc` 已存在（[document.ts:194](../../../../packages/edit-core/src/document.ts)）但既无默认
母版 / 版式 / 主题资产，也无法保存。如何让「新建 → 加页 → 插入内容 → 保存」成为与打开文件同强度的闭环？

| 维度 | 要求 |
|---|---|
| 默认资产 | 内置一套最小主题 + 母版 + 常用版式（标题页 / 标题内容 / 空白），与 AddSlide 的 edit-only 版式目录（票据 041）同源 |
| 尺寸 | 默认 16:9（12192000×6858000 EMU），构造参数可覆盖 |
| 体积 | 默认资产随生成入口按需加载，打开文件的用户零成本 |
| 产品层 | editor.html 增加「新建」入口；无文件状态不再只能等待打开 |

验收：新建 → 插入形状/文字/图片/表格 → 撤销重做 → 保存，生成物 LibreOffice 无修复打开且重解析投影指纹一致；
新建文稿的动态字段（页码）正确；全部门禁绿。
