---
title: 导入解压上限与 ZIP 安全
status: closed
assignee: kimi
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

## Answer

新增 `core/zip` 的 `ZipReader`：构造时校验 EOCD、中央目录、本地头、条目名称和声明上限，同时缓存压缩负载位置；读取时使用 fflate 解压，并以声明大小 + 1 字节的有界输出缓冲区识别静默截断。ZIP64 以 `zip64-unsupported` 明确拒绝。

`parse(..., { zip })` 与 `parseInWorker(..., { zip })` 可覆盖默认上限。核心解析、惰性补解、OPC 保存、OLE、模板填充、经典图表 / ChartEx 工作簿及官网格式识别均使用同一实现；OPC 不支持直通时仍按既有 reason 整包重压，安全校验不改变这条兼容路径。

| 默认限制 | 值 |
|---|---:|
| 条目数 | 4096 |
| 单条目解压大小 | 128 MiB |
| 总解压大小 | 512 MiB |
| 压缩比 | 1000 |

确定性恶意固件隔离在 `fixtures/zip-security/`。`npm run test:zip` 实测 57 项断言，伪造的 8 MiB 输出在 16 字节声明边界被拒绝，堆容量增长与回收后堆增量均有 2 MiB 上限断言；`test:zip:dist` 复验同一发布入口。

210 页 / 12,810 个元素的交替对照中，旧发布产物解析中位数为 308.35ms，新实现为 276.31ms，约下降 10.4%；负载位置缓存避免惰性补解重复扫描。原始采样保存在 `out/zip-security/performance.json`。

## Resolution（2026-11-05）

| 验收项 | 结果 |
|---|---|
| 恶意输入与内存 | 压缩炸弹、伪造大小、条目数、大小写 / 分隔符重复、路径穿越、ZIP64 与 EOCD 负例均由稳定 reason 拒绝；堆容量增长和回收后占用有硬上限 |
| 兼容与性能 | 全部固件、172 份无编辑保存、212 个快照通过；POI 208/208 个有效文件与旧产物一致，ChartEx 1/1、PPT Master 21/21 渲染干净；210 页性能无回退 |
| 发布边界 | `@web-ppt/core/zip` 由下游按需包外部复用；`npm run test:zip:dist` 通过 |
| 工程门禁 | `npm run check`、`npm test`、`npm run build`、`npm run verify` 全部通过 |

Windows PowerPoint 真机仍按用户要求暂缓，未计为通过。
