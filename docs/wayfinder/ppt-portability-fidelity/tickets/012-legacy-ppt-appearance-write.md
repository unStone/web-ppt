---
title: 实现旧 PPT 写入：线性渐变、预设虚线、默认箭头与图片矩形裁剪
status: closed
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./010-legacy-ppt-scope.md
---

## Question

如何在原生 `.ppt` 生成保存中写入首尾两色线性渐变、预设虚线、默认尺寸箭头与图片矩形裁剪，并让本仓库读取与 LibreOffice 重开结果一致？

## 范围

承接 [010 的映射矩阵](010-legacy-ppt-scope.md#answer)。入口仍是 `@web-ppt/edit-core/ppt` 的 `savePpt`；无法映射的外观继续以 `PptSaveError` 原子拒绝，不降级为图片或纯色。

## Answer

| 部分 | 结果 |
|---|---|
| 写入 | `edit-core/ppt/appearance.ts`：fillType 7 + 两端颜色与透明度 + fillAngle、lineDashing、默认尺寸箭头、cropFrom*；`drawing.ts` 接入图片裁剪 |
| 读取 | `core/ppt/escher.ts`：按 fillAngle 符号与 fillFocus 还原首尾色（焦点 40–60 为轴向渐变），读 fillBackOpacity 与 cropFrom*；`parser.ts` 读取 wzName 形状名 |
| 拒绝 | 图案 / 图片形状填充、多色标、非端点色标、径向渐变、自定义虚线、非默认尺寸箭头、异形裁剪与图片效果 |
| 固件 | `tooling/make-ppt-appearance-save-fixture.mjs` → `fixtures/sample-ppt-appearance-save.pptx`：四象限渐变（45° 终点半透明）、五种箭头、四边不同的裁剪 |
| 契约 | `tooling/test-ppt-save.mjs` 按形状名逐项检查往返与拒绝；`tooling/test-core.mjs` 用合成属性锁定首尾色规则 |
| 独立读取 | LibreOffice 26.2：本仓库写出的 `.ppt` 转回 PPTX 后四个角度的方向与首尾色、透明度和 srcRect 一致；LibreOffice 写出的 `.ppt` 由本仓库读回同样一致 |
| 既有样本 | `showcase.ppt` 第 2 页渐变改按文件角度渲染（45° 与 0°，与源 PPTX 一致），第 5 页图片按 cropFrom* 裁剪（与源 PPTX 的 srcRect 一致） |

Windows PowerPoint 真机按用户要求继续暂缓。
