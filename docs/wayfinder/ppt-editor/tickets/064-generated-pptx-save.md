---
title: 实现生成式 PPTX 保存
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
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

## Resolution

- 新增独立按需入口 `@web-ppt/edit-core/generate`：`Editor.saveDetailed()` 仅在 `.pptx` 原包仍存活时走既有补丁保存，其余场景动态加载生成器；构建产物 `save.js` 不引用生成器，生成 chunk 为 28.71 kB（gzip 9.37 kB）。
- 生成器从有效投影确定性构造完整 OPC 闭包，覆盖 presentation、theme、master、layout、slides、notes、关系与媒体；形状、组合、表格、页面背景、超链接、音视频和 M/L/C/Q/A/Z 自由路径均可重开，无法无损表达的高级语义会明确拒绝而非静默丢失。
- 新增确定性 `sample-generated-save.pptx` 与公开入口黑盒契约；连续生成 SHA-256 均为 `c87934358cb1312d7f676131c680f6518c54f8a04baae3ad58dcd385e1e9c7c0`，生成前后 HTML / 原生 SVG 独立进程指纹一致，`.ppt`、已释放原包和空文稿路径均纳入验收。
- 三个生成产物已纳入 `office-artifacts.json` 与 CI：LibreOffice 无修复打开并导出 PDF；空文稿在模型中保持 0 页，LibreOffice 会合成 1 页空白 PDF，清单分别记录两种口径。PowerPoint 真机仍由既有外部 runner 验收。
- `npm run check && npm test && npm run build` 整链全绿：2145 + 874 + 383 + 9 + 360 + 9 + 130 项断言、176 个快照、67 份固件 / 240 页 / 480 对独立进程指纹、七个发布包构建通过；两路最终审查无剩余 P1/P2。
