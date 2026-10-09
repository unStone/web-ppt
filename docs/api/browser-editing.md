# 浏览器编辑增强

官网自动启用对象阅读目录，并在支持 EditContext 的浏览器启用输入增强。SDK 宿主通过两个独立入口选择使用：

```ts
import { createCanvasAccessibility } from '@web-ppt/editor/accessibility';
import { enableEditContext } from '@web-ppt/editor/edit-context';

const view = session.mount(container);
const accessibility = createCanvasAccessibility(session, view);
const input = enableEditContext(session, view);
// input.supported 表示当前窗口提供 EditContext；否则保持 contenteditable。

function dispose() {
  input.dispose();
  accessibility.dispose();
  session.dispose();
}
```

| 能力 | 行为 |
|---|---|
| 编辑模式阅读 | 独立对象目录提供名称、替代文字、文字内容、选择状态、锁定状态；隐藏对象退出目录 |
| 阅读顺序 | 绘制顺序与组合树前序；原子兼容对象不暴露不可编辑的内部孩子 |
| 键盘焦点 | 画布 `aria-activedescendant` 跟随选择，增量绘制保留对象辅助节点身份 |
| 分组变化 | 组合、解组、撤销之后，激活对象使用当前父级 |
| 查看模式 | 使用文档语义，恢复原始文本和链接的阅读；文本输入仍由独立 textbox 承担 |
| 原生输入 | EditContext 输入进入既有文本事务、格式、历史、选区及协同重基 |
| 输入法 | 预编辑只更新覆盖层；结束后一次提交，字符边界与候选位置同步 |
| 渐进增强 | 不支持 API 或官网按需块加载失败时保留 contenteditable；不影响文件打开 |

已通过真实 Chromium 的原生预编辑、提交、连续输入和单事务撤销，另有模拟事件覆盖格式、字符边界、
多段输入与关闭增强。操作系统输入法候选窗口及真实读屏软件仍应在发布前单独验收；按用户要求暂不执行 Windows 真机验证。

## 现代图表自动准备

```ts
import { parse } from '@web-ppt/core';
import { prepareModernCharts } from '@web-ppt/core/modern-charts';

await prepareModernCharts(bytes);
const presentation = await parse(bytes);
```

该入口检查 PPTX 内容类型，遇到 ChartEx 才下载原生布局模块。普通文件不下载该模块；加载失败继续显示来源预览。
官网查看页、样本页、编辑页与独立查看器已接入。SDK 的 `parse()` 默认行为不变；地图图表继续使用 Office 自带图片。
