---
title: 导入解压上限与 ZIP 安全
status: open
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

打开不可信的 `.pptx` / `.potx` / 内嵌 OOXML 时，怎样在解压前就拒绝压缩炸弹、伪造大小和异常条目，而不是让标签页耗尽内存？

## 现状

`core/src/pptx/package-reader.ts` 与 `zip-preview.ts` 直接调用 fflate `unzipSync`，没有声明大小上限、条目数上限或压缩比检查；`edit-core/opc/zip.ts`、OLE 内嵌 OOXML 读取同样如此。fflate 的同步解压在声明大小与实际输出不符时不会主动拒绝。

## 范围

| 检查 | 说明 |
|---|---|
| 中央目录 | 校验 EOCD 与注释长度、条目数、目录边界；ZIP64 明确支持或以稳定 reason 拒绝 |
| 大小 | 声明的解压总量、单条目大小与压缩比上限；解压时实际输出超过声明立即终止 |
| 名称 | 反斜杠规范化、重复名（含大小写与分隔符变体）拒绝、路径穿越拒绝 |
| 配置 | `parse()` 选项允许宿主调整上限，默认值写入 API 文档；超限抛出带 reason 的类型化错误 |
| 覆盖 | core 解析、编辑保存时的原包读取、OLE / 图表内嵌工作簿、字体与媒体部件 |

## 完成条件

- 压缩炸弹、伪造大小、超多条目、重复名、路径穿越各有确定性固件，全部在解压前或输出越界时以稳定 reason 拒绝，内存峰值有断言。
- 现有全部固件与语料打开结果不变，性能基准无回退。
- `api/format-limitations.md` 与 `api/viewer.md` 写明默认上限与覆盖方式。

## 参考

上游 `src/internal/opc/zip.ts` 的条目顺序与名称处理（MIT，`18b7e75`）。HeyPuter 对 fflate 的补丁属于 AGPL，只作为问题存在的旁证，不移植；本仓库的解压上限按自己的读取路径实现。
