---
title: 动画预设目录与运动路径编辑
status: open
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

用户怎样像在 PowerPoint 动画库里一样给对象加任意入场、强调、退出与运动路径效果，并在时间轴上调整顺序、延迟和时长？

## 现状

`edit-core/animation-catalog.ts` 的可编辑目录只有 8 个效果（appear、fade、fly、wipe、zoom、dissolve、spin、grow），不含运动路径；文件中其他效果由 core 播放并原样直通，但用户无法新增或修改。

## 范围

| 部分 | 说明 |
|---|---|
| 预设目录 | PowerPoint 动画库全部预设（presetClass × presetID × presetSubtype），每个预设有规范编码、方向选项与默认时长 |
| 运动路径 | 预设路径、自定义折线 / 曲线绘制、锁定与反转路径、路径端点编辑 |
| 时间设置 | 开始方式（单击 / 与上一项同时 / 上一项之后）、延迟、时长、重复、触发器、播放后效果 |
| 文字动画 | 按段落级别、按字词 / 字母 |
| 动画刷 | 复制一个对象的全部动画到其他对象，沿用格式刷的连续使用交互 |
| 播放 | viewer-core 对新增预设逐个实现或给出稳定 reason 的回退（回退到淡入并记录） |
| 产品入口 | 动画库、效果选项、动画窗格与时间轴（产品待确认） |

## 完成条件

- 每个预设生成固件，保存后时间树结构与 PowerPoint 写法一致（LibreOffice 重开可识别），Open XML SDK 校验零错误。
- viewer-core 对每个预设的播放有像素或关键帧断言；未实现的预设回退路径有测试。
- 动画窗格的重排、时间修改可撤销 / 重做 / 恢复。

## 参考

上游 `src/internal/presentationml/animation-presets.generated.ts`、`animation-builder.ts`、`animation-emphasis-options.ts` 与 `test/fn-animation-*.test.ts`（MIT，`18b7e75`），README 声明覆盖 95 个动画库预设。
