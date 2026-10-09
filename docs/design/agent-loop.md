# Agent Loop 调研与本仓库落地

> 结论先行：本仓库已具备 loop 开发（spec 驱动的 agent 循环）的全部组件——spec（wayfinder 票据）、constitution（AGENTS.md）、背压（四条门禁）、converge 证据（红绿 log）——缺的只是自动回环这一层。照搬 Ralph 的无人值守 `while true` 与本仓库约束直接冲突，正确形态是**限定域循环**：验收完全机器可判的任务才进循环，其余保持人驱动。

## 1. 两个来源方案

| | [Ralph Wiggum loop](https://ghuntley.com/ralph/) | [GitHub Spec Kit](https://github.com/github/spec-kit) |
|---|---|---|
| 本质 | Bash 死循环反复以全新上下文驱动 agent：`while :; do cat PROMPT.md \| agent ; done` | 五阶段流程 constitution → specify → plan → tasks → implement ⇄ converge，全部为可编辑的 Markdown 工件 |
| 信念 | 生成已廉价，工程价值在背压（类型/测试/静态分析拒绝错误生成）与回环（自我评估写回 AGENT.md） | 先定义 what/why，再决定 how；intent 与 evidence 领先于实现 |
| spec 组织 | `specs/` 一文件一条 + `fix_plan.md` 当前进度 + `AGENT.md` 沉淀学习 | `.specify/` 下 spec / plan / tasks 分层工件，bug 修复与想法评估为扩展 |
| 防失控 | 每轮只做一件事；跑偏 `git reset --hard` 重来；TODO 清单可整份重建 | 每次只调一个技能，人审后再继续；converge 未达标就回到 implement |
| 适用边界 | 作者明确**不用于存量代码库**；绿地项目期望做到 90%，仍需工程师引导 | 通用，但对流程纪律依赖大于对自动化的依赖 |

## 2. 本仓库已有的循环组件

| Loop 概念 | 本仓库对应物 | 状态 |
|---|---|---|
| constitution | [AGENTS.md](../../AGENTS.md)（约束 / 陷阱 / 门禁命令）+ [CONTEXT.md](../../CONTEXT.md)（领域语言） | 已有 |
| specs/ | `docs/wayfinder/*/map.md` + `plan.md` + tickets，票据内写明「共同完成条件」 | 已有 |
| fix_plan.md | [roadmap.md](../roadmap.md) 与各 map 的 status（open / closed） | 已有 |
| 背压 | `check` / `test` / `build` / `verify` 四门禁 + readiness 审计 + counts 实测比对 | 已有，且强于多数项目 |
| converge 证据 | [cordis-editor.md](cordis-editor.md) 的红绿 log 表（`out/**/*.log`） | 已有，手工驱动 |
| 回环沉淀 | AGENTS.md 陷阱表「踩过的坑改动前先读」 | 已有 |

缺的只有**自动回环**：从「门禁失败输出」自动回到「agent 下一轮输入」的这一层。

## 3. 为什么不能照搬 Ralph

| 冲突 | Ralph 做法 | 本仓库约束 |
|---|---|---|
| 存量库 | 作者明确拒绝在现有代码库上使用 | 本仓库是高约束存量库（数千断言、186 快照、6 个边界审计） |
| 纠偏手段 | 跑偏就 `git reset --hard` 重来 | 仓库规范明令禁止 git 恢复命令，人工审查差异是流程一部分 |
| 无人值守压力 | 长循环自主决策 | 「禁止硬编码通过测试、fallback 必须来自产品需求并完整测试」是高压线，恰是长循环高发区 |
| 验证方式 | agent 自评 | 渲染结果同进程不可重复、性能预算受环境影响（曾因环境自检超标误判，见 cordis-editor.md 页面服务段），需固定环境与独立进程 |

## 4. 落地设计：限定域循环

### 4.1 任务准入判据

四条全满足才进循环；任一不满足保持人驱动：

| 判据 | 说明 |
|---|---|
| 验收机器可判 | 一条门禁命令（或其组合）输出即裁决，无需人眼 |
| spec 已存在 | wayfinder 票据或等价验收条件文件，循环不发明目标 |
| 失败反馈可用 | 测试 / 审计输出足以定位下一轮动作 |
| 无产品权衡 | 不涉及交互取舍、预算决策、对外承诺 |

### 4.2 本仓库的具体域

| 域 | 循环体 | 验收 | 为什么适合 |
|---|---|---|---|
| 固件覆盖盲区 | 逐格式逐特性写 `make-*-fixture.mjs` + 断言 | `npm run fixtures` 两次字节一致 + 对应 test 绿 | 历史教训：隐藏页零固件让真 bug 存活很久；验收完全确定 |
| 文档数字对齐 | 按 verify 输出漂移项改声明 | `node tooling/verify-consistency.mjs` 绿 | 失败输出即待办清单 |
| 已关票据回归 | 按票据验收条件复跑 | 对应 readiness / test 绿 | spec 与证据链现成 |
| 类型与死代码清理 | 按 check 输出逐项修 | `npm run check` 绿 | 反馈直接 |

不适合进循环的域：架构决策、性能调优（预算判定受环境噪声干扰）、Cordis 生命周期类需真实浏览器操作剧本的任务、涉及对外 API 承诺的变更。

### 4.3 三级执行形态

```mermaid
flowchart LR
  A["① 手动 ralph<br/>（今天可用）"] --> B["② ZCode 动态工作流<br/>（脚本化回环）"] --> C["③ 闲时无人值守<br/>（OffPeak / Cron）"]
```

| 级 | 形态 | 说明 |
|---|---|---|
| ① | 手动循环 | 以票据为 spec 重复派发 agent 会话，每轮以四门禁收尾；Huntley 认可「半手动也算 ralph」，关键在上下文工程 |
| ② | 动态工作流 | 用 ZCode 的 workflow 机制写显式回环：`loop { 派发 subagent(spec) → 运行门禁 → 不绿则带失败输出重派 }`，停止条件与轮数上限写在脚本里，等价于 Ralph 的 bash 循环但护栏显式 |
| ③ | 闲时无人值守 | 把②排入闲时队列，每轮证据落盘 `out/`（延续红绿 log 文化），人事后审 diff |

### 4.4 护栏（写入循环的 spec，与 constitution 同级）

1. 每轮只做一件事；跑偏收紧为单任务，不扩循环。
2. 停止条件：门禁全绿，或达到轮数上限；无「再试一次」例外。
3. 禁止 git 恢复命令纠偏；禁止为通过测试修改生产行为或硬编码结果。
4. 每轮落盘证据 log；差异审查在循环之外由人完成。
5. 涉及数字声明（断言数、体积、快照数）的轮次，verify 必须在同轮跑过才算绿。

## 5. 与文档架构的关系

loop 依赖 spec 与 constitution 的可机读性，这正是文档架构中「规范象限」的职责——补齐贡献者规范（测试规范、发布运维）等于同时为 loop 提供更完整的 constitution。两个议题互为支撑。
