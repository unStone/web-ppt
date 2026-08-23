---
title: 实现 ZIP 原始条目直通保存
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./005-prove-m0-equivalence.md
  - ./011-render-element-api.md
  - ./012-render-text-html-api.md
  - ./013-layout-text-api.md
---

## Question

如何解析中央目录并原样搬运未修改条目的本地头、额外字段和压缩流，同时对 zip64、数据描述符、注释与加密条目做可解释降级？

## Resolution

新增按需入口 `@web-ppt/edit-core/opc`，公开纯字节
`patchOpcPackage(package, changes)`。无有效改动返回原字节与原句柄（`identity`）；普通修改只重写脏
part（`passthrough`）；不兼容但可解压的 ZIP 确定性整包重压（`repacked`），并以
`fallbackReason` 让 UI 解释慢路径。新增与删除 part 均支持，新增项按代码单元稳定排序后追加，原中央目录
顺序不变。

| 输入特性 | 行为 |
|---|---|
| 单磁盘经典 ZIP、stored / deflate、ASCII / UTF-8 文件名 | 净条目的完整本地头、文件名字节、extra 与压缩流逐字直通；脏条目保留时间、flags、方法及 local / central extra 和 entry comment |
| zip64 哨兵、EOCD locator / record 或 `0x0001` extra | `zip64` 重压 |
| data descriptor、加密、存档注释、多磁盘、旧编码非 ASCII 文件名、未知压缩 | 对应原因重压 |
| 损坏的签名、边界、重复名称或不一致元数据 | 明确拒绝，不伪装为成功保存 |

保存边界复制脏 `Uint8Array`，防止调用方复用缓冲后让 `package.parts` 与 ZIP 字节分叉；每次保存返回带
最新压缩区间的包句柄，连续第二次修改另一页仍可直通。把新句柄放回 `EditDoc.package` 后，
`disposeDoc()` 会同时释放原包与最新包；独立持有者可调用 `disposeOpcPackage()`。默认编辑入口不引入
`fflate`，实测 gzip 2.95KB；XML / OPC 按需入口分别为 7.14KB / 4.27KB，dry-run tarball 为
31,033 bytes。

确定性固件 `sample-zip-passthrough.pptx` 同时含 stored / deflate、脏/净条目的 local / central extra
与 entry comment；连续生成 SHA-256 均为
`40ba997d128dafd057a67bdd65f9ba2d7e1641fc1a05a75c1e35e5f198f088ed`。契约覆盖固定种子 50 轮
part 增删改、重复保存、调用方缓冲变异、Worker 无 DOM、完整中央顺序、解析投影与 HTML/SVG 双路径
渲染相等。临时篡改净条目时间字段时，三条字节保全断言按预期失败，证明测试压到直通分支。

210 页 / 50.6MB、修改并序列化 3 张幻灯片后保存为 84.0ms，436 条目直通，低于 500ms 预算；
编辑常驻内存增量 +5.4%。LibreOffice 已真实打开最终保存产物并导出非空 PDF，CI 新增同一
外部打开门禁。最终 `npm run check`、`npm test`、`npm run build` 全绿：1987 + 140 + 130 项断言、
162 个快照、23 份固件 / 100 页 / 200 对独立进程 SVG 指纹。
