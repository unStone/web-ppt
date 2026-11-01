# Agent 命令工具面

004 的工具面放在 `@web-ppt/edit-core/agent`，不与 005 合并。该层只负责 JSON 契约、会话编排和稳定错误；005 的 MCP SDK 与 stdio 生命周期进入独立 Node 包，后续 WebMCP 也可复用同一入口。

| 决策 | 契约与原因 |
|---|---|
| 命令类型 | `AgentCommand` 直接覆盖现有 `Command` 联合类型；三条图片命令仅把 `Uint8Array` 映射为 Base64 字符串，不复制命令定义 |
| Schema | `ts-json-schema-generator` 从 `AgentToolInputMap` 生成全部工具输入；Ajv standalone 生成校验器并打进按需产物，运行时无 Ajv 依赖，也不使用动态代码编译 |
| 原子提交 | 先做整批 Schema 校验、Base64 解码和目标预检，再只调用一次 `Editor.exec` 或 `execDesign`；不逐条提交后补偿撤销 |
| 出错定位 | Agent 在结构化克隆上顺序调用 `commandPatches` 与本地 patch 预检并附 `commandIndex`，新增命令的身份分配不触碰真文档，也不改变 `Editor` 默认热路径或体积预算 |
| 设计画布 | 单批可组合同一画布的命令；混合多个画布在提交前以 `mixed-design-target` 拒绝，避免拆分事务 |
| 查询 | describe、样式、lint 和渲染都读取当前有效投影；样式直接调用既有 headless 查询，不复制继承或主题求值 |
| 编辑观察 | 提交完成后异步运行 lint，并把报告过滤到受影响且仍存在的页面；观察失败单独标记，不回滚已成功事务 |
| 保存 | `Editor.saveDetailed` 自动选择补丁 / 生成路径，工具只增加 Base64 传输和结果描述 |
| 成本 | 独立 Vite 入口；默认 core / edit-core 闭包逐文件哈希不变。生成器与 Ajv 都只保留在开发依赖 |

| 实施顺序 | 可验证节点 |
|---|---|
| 命令 JSON 类型、Schema 与校验器 | 类型契约覆盖命令名无缺失；图片字节只接受字符串；Schema check 能发现新增命令未再生成 |
| 原子编辑与错误 | Schema、目标、语义三类失败前后文档和历史逐字节不变；批量第二条失败定位到 index 1；一次 undo 整体回退 |
| 查询与观察 | describe / 样式 / lint / SVG 真实调用；观察只含受影响页；异步失败显式分离 |
| 保存与发布 | 补丁 / 生成保存重开、LibreOffice 与 Quick Look 外部读取、dist 契约、npm 内容和外部 TS 调用 |
| 成本与全仓 | 独立进程冷加载 / 编辑耗时 / 堆增量；默认入口逐字节证明；check → test → build → verify |

资源作用域与现有编辑器一致：打开会话拥有文档和来源资源；由既有 `EditDoc` 创建的会话不释放调用方文档。渲染、lint 和保存都使用提交时的同一文档，不引入额外后台任务或世代。
