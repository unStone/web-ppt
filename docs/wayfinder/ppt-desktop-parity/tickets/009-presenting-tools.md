---
title: 笔工具、放映工具与文件放映设置
status: open
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

演讲者怎样在放映时使用独立的演讲者窗口、笔与激光笔，并让文件里设定的放映方式（自定义放映、循环、展台、计时）真正生效？

## 现状

官网放映有备注与下一页（`site/src/speaker-aids.ts`）、黑白屏、跳页与网格；viewer-core 遵循 `advTm` 自动换片。没有观众 / 演讲者双窗口、放映中的笔与激光笔，也不读取 `p:custShowLst` 与 `presProps.xml` 的 `p:showPr`。

## 范围

| 部分 | 说明 |
|---|---|
| 演讲者视图 | 观众画面在第二个窗口（支持 Window Management API 时放到另一块屏幕），演讲者窗口显示当前 / 下一步动画、备注、计时器、时钟；两窗口状态同步 |
| 笔工具 | 放映与编辑共用的笔、荧光笔、橡皮擦、激光笔；放映结束时询问是否保留墨迹，保留为原生 InkML（沿用 `edit-core/ink`） |
| 墨迹转形状 | 把笔画拟合为直线、矩形、椭圆、三角形等预设形状，不依赖识别模型 |
| 放映设置 | 解析并遵循 `p:showPr`（演讲者 / 窗口 / 展台、循环、页范围、是否使用计时、笔与激光颜色）与 `p:custShowLst`；编辑命令写回 |
| 排练计时 | 记录每页停留时间写入 `advTm` |
| 字幕 | 只用浏览器本机语音识别生成实时字幕；不支持本机识别时不显示该入口 |
| 归属 | 状态与同步在 viewer-core；窗口与界面在产品层（产品待确认） |

## 完成条件

- 双窗口同步、窗口被关闭、第二屏不可用三种情况都有浏览器测试。
- 带 `showPr` / `custShowLst` 的固件按设置播放；编辑后保存重开设置一致。
- 墨迹保留后 LibreOffice 与独立读取器可显示，转形状结果有确定性断言。

## 参考

上游 `src/api/fn/show-properties.ts`、`custom-shows.ts`（MIT，`18b7e75`）可用于核对 `p:showPr` 与 `p:custShowLst` 的字段和写法；功能面参照 HeyPuter README，不移植其代码。

## 不做

- 需要云端语音服务的字幕：违背音频不出浏览器的约束。
