---
title: 主题库与 .thmx / .potx 交换
status: open
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

用户怎样从更多内置主题和变体中选择，并与 PowerPoint 交换主题文件和模板文件？

## 现状

`SetTheme` 与主题目录、版式 / 母版设计画布已实现，内置三套按需模板；不能导入或导出 `.thmx`，也不能把文稿另存为 `.potx`。

## 范围

| 部分 | 说明 |
|---|---|
| 主题库 | 扩充本仓库原创的主题（配色 12 槽、标题 / 正文字体、效果与背景样式列表、母版与版式），每套带若干颜色变体；按需加载 |
| `.thmx` 导入 | 读取主题包中的主题与母版，应用到全部或选中页面 |
| `.thmx` 导出 | 把当前母版与主题写成主题包 |
| `.potx` | 打开模板时新建文稿；另存为模板时改写内容类型 |
| 产品入口 | 设计菜单的主题与变体库（产品待确认） |

## 完成条件

- 导出的 `.thmx` / `.potx` 由 LibreOffice 与 Open XML SDK 校验器接受；PowerPoint 存出的 `.thmx` 样本可导入。
- 主题库每套主题有固件与快照，应用后保存重开一致。

## 参考

上游 `src/internal/presentationml/default-masters.ts` 与 `src/api/fn/theme.ts`（MIT，`18b7e75`）可用于核对主题与母版部件写法。
