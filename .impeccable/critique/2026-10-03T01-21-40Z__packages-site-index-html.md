---
target: 官网排版
total_score: 24
max_score: 36
na_heuristics: 7
p0_count: 0
p1_count: 2
target_identity: "file:/Users/chenlei/program/AI/PPT/packages/site/index.html"
target_fingerprint: "sha256:51aa11445379eece631f38e23fc96c43fa9167591bbfe340679ebcf4870f257f"
target_path: /Users/chenlei/program/AI/PPT/packages/site/index.html
timestamp: 2026-10-03T01-21-40Z
slug: packages-site-index-html
---
# 官网排版评审

Method: dual-agent (A: home_design · B: home_evidence)

目标：`packages/site/index.html`。模式：Persuade。实测浅色桌面与 390×844 手机。

| 启发式 | 分数 | 依据 |
|---|---:|---|
| 状态可见 | 3 | Demo 页码、耗时与文件状态清楚 |
| 符合用户语言 | 3 | 用途直白，但协议缩写密集 |
| 控制与退出 | 3 | 桌面路径清楚，手机导航入口缺失 |
| 一致性 | 3 | 色彩、间距与组件统一 |
| 错误预防 | 3 | 文件输入格式约束与隐私说明就近呈现 |
| 识别优于记忆 | 2 | 手机隐藏站内导航，长页缺少就近目录 |
| 灵活与效率 | 不适用 | 营销首页不依赖专业快捷操作 |
| 简约与层级 | 2 | 样本、矩阵与代码示例同级过多 |
| 错误恢复 | 3 | 加载失败有本地文件替代路径，未主动制造错误 |
| 帮助与说明 | 2 | 有接入示例，推荐起点不突出 |
| **合计** | **24/36** | **Acceptable（67%）** |

## 产品特异性

真实 PPT Demo 与保真对照明确属于 Web-PPT；首屏的居中标题、双按钮和四指标布局仍较通用。1280×720 下 Demo 起点约在文档 y=738，首屏看不到真实 PPT；保真对照约在 y=5120。

## 有效设计

- 主标题直接说明产品用途，橙色主按钮明确。
- 本地文件按钮旁的隐私说明回答试用前顾虑。
- 疑难案例采用真实渲染对照，差异容易观察。

## 优先问题

| 优先级 | 问题 | 证据 | 建议命令与方向 |
|---|---|---|---|
| P1 | 整页手机横向溢出 | 390px 视口、document.scrollWidth=450；`.cards` 最小列宽 430px，`src/style.css:517` | `/impeccable adapt`：列宽适应容器，仅代码块内部滚动 |
| P1 | 手机站内导航与编辑器入口消失 | `src/style.css:559` 隐藏全部非 GitHub 导航且无替代菜单 | `/impeccable adapt`：保留试用和编辑器入口，长目录折叠 |
| P2 | Demo 入口挤占 PPT 展示 | 运行后可见 10 个样本按钮及“更多17个”；手机样本占六行，默认 144 形状图不可读 | `/impeccable distill`：首显少量代表样本并选可辨认的文稿 |
| P2 | 渲染证据出现过晚 | 首屏无 PPT；22 行矩阵和六份代码示例先于 y≈5120 的保真对照 | `/impeccable layout`：提前展示真实渲染和直观对照，再引导接入 |

## 用户视角与认知负荷

认知负荷 8 项中 3 项失败：分块、选项数和渐进披露。首次访客需从 11 个样本入口判断从哪里开始；移动访客找不到编辑器并遇到整页横向滚动；核对轻量承诺的访客会看到 Hero 的 156KB 与包表的 131.63KB 而无法就地判断口径。

## 检测与限制

Impeccable 检测器命中 7 条（5 warning、2 advisory），但 5 条内边距警告指向表格滚动容器与固定比例对照画布，实际页面未见内容贴边，判为误报。检测器未报全页横向溢出。浏览器安全检查拒绝可变脚本注入，未创建 overlay。未测试英文、暗色、异常文件与实体设备。
