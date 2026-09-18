---
title: 实现旧 PPT 写入：渐变/图案、图片矩形裁剪、预设虚线与默认箭头
status: closed
assignee: cursor
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./010-legacy-ppt-scope.md
---

## Question

如何在原生 `.ppt` 生成保存中写入双色线性渐变、图案填充、图片矩形裁剪、预设虚线与默认尺寸箭头，并保证本仓库独立读取与 LibreOffice 重开一致？

## 范围与路径

- 承接 [010 调查结论](010-legacy-ppt-scope.md)：只做外观层「先」类；读写对称，尤其修复 reader 的 `crop: null`。
- 入口保持 `@web-ppt/edit-core/ppt`；映射对照 MS-ODRAW / MS-PPT；无法映射继续原子拒绝，不静默降级为图片。
- 确定性固件 `sample-ppt-appearance-save.pptx` + `savePpt` → `parse` + LibreOffice。

## Answer

| 项 | 结果 |
|---|---|
| 写入 | `appearance.ts`：双色 shade（fillType=7 + fillAngle）、fillPattern(388)、cropFrom*、预设虚线、默认档箭头 |
| 读取 | `escher.shapeFill` / `shapeCrop`；`parser` 恢复 crop 与 `wzName`（896）形状名 |
| 固件 | `tooling/make-ppt-appearance-save-fixture.mjs` → `fixtures/sample-ppt-appearance-save.pptx`（已入 `postfixtures`） |
| 契约 | `tooling/test-ppt-save.mjs`：渐变角度 / 端点色、smGrid、五种箭头、crop、以及滤镜 / 径向 / 自定义虚线 / 非默认箭头尺寸的原子拒绝 |
| 独立读取 | `savePpt` → `parse` 语义往返通过（断言合计含外观块后 pptSave=66） |
| LibreOffice | `soffice --convert-to pptx` 无修复；渐变 / 箭头 / crop 保留。图案在 LO 的 ppt→pptx 转换中栅格化为图片填充（LO 导出行为，非本仓库 silent 降级） |
| 类型检查 | `npm run check` 通过 |
| 保存矩阵 | **未改** `docs/expanded-capabilities.md`（等共同完成条件 / 四项门禁） |

### 证据命令

```bash
node tooling/make-ppt-appearance-save-fixture.mjs
node tooling/test-ppt-save.mjs   # pptSave=66
npm run check
soffice --headless --convert-to pptx --outdir out/ppt-save/lo out/ppt-save/appearance.ppt
```
