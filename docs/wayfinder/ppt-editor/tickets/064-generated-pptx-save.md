---
title: 实现生成式 PPTX 保存
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

`saveEditDoc` 在 `doc.meta.source !== 'pptx' || !doc.package` 时直接抛「当前版本尚未实现生成式
PPTX 保存」（[save/index.ts:103](../../../../packages/edit-core/src/save/index.ts)）。如何按
[CONTEXT.md](../../../../CONTEXT.md) 的「生成保存」语义，从没有可补丁原包的 EditDoc 构造完整合法的
`.pptx`，并让它与补丁保存共享同一验收强度？

| 维度 | 要求 |
|---|---|
| 触发场景 | `createEmptyDoc`（[document.ts:194](../../../../packages/edit-core/src/document.ts)）、`.ppt` 解析（`source: 'ppt'`）、原包已显式释放 |
| 包闭包 | `[Content_Types].xml`、presentation / slideMaster / slideLayout / theme / slides / notes 及全部 rels、媒体闭包——生成物必须自洽，不引用不存在的 part |
| 复用 | 优先复用 `save/materialize.ts`、`save/insertion.ts` 已有的 part 物化与媒体内容寻址，不做第二套 XML 拼接 |
| 边界 | 有原包时仍走补丁保存，生成器只做无包兜底；两条路径不合并 |
| 体积 | 生成器独立按需入口（如 `edit-core/generate`），补丁保存用户零增重 |

验收（全部自动化）：

- 同一 EditDoc 两次生成逐字节一致（确定性）；
- 生成物重解析后的有效投影与保存前投影在干净进程中指纹一致（两条文本路径）；
- LibreOffice 无修复打开、页数一致并导出 PDF；产物纳入 `office-artifacts.json` 清单，
  接受 [powerpoint-runner](../../../powerpoint-runner.md) 真机验收；
- 空文稿、单页多元素、含图片/表格/备注的固件由 `tooling/make-*.mjs` 确定性生成；
- `npm run check && npm test && npm run build` 全绿。
