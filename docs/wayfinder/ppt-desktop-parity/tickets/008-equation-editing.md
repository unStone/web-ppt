---
title: 公式插入与编辑
status: open
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

用户怎样插入新公式、修改文件里已有的 OMML 公式，并保存为 PowerPoint 可继续编辑的原生公式？

## 现状

core 已能解析并以结构化 SVG 排版 OMML（分式、根式、脚标、大算符、矩阵、定界符、重音、极限）；`edit-core/generate` 能原样写入与跨文稿复制公式原子。没有插入与修改公式的命令和输入界面。

## 范围

| 部分 | 说明 |
|---|---|
| 输入 | UnicodeMath 线性格式与 LaTeX 常用子集双向转换为 OMML；结构与符号面板 |
| 命令 | 插入公式（独立文本框或行内）、替换公式内容；进入历史、恢复与协同 |
| 原生内容 | 写出 `a14:m` / `m:oMathPara`，同时写出 `mc:AlternateContent` 回退图片，旧版读取器可显示 |
| 编辑回显 | 选中公式时把 OMML 转回线性格式供修改，转换不可逆的结构给出稳定 reason |
| 产品入口 | 插入菜单与公式编辑面板（产品待确认） |

## 完成条件

- OMML → 线性格式 → OMML 往返在现有全部公式固件上结构一致。
- 新建公式保存后 LibreOffice 与 Open XML SDK 校验通过，渲染与现有 OMML 排版一致。
- 非法输入原子拒绝并定位到字符位置。

## 参考

上游没有 OMML 能力；HeyPuter 把公式存成图片加私有源码，不采用。线性格式依据 Unicode Technical Note #28（UnicodeMath）。

## 不做

- 手写输入公式：跨平台浏览器没有本机手写识别（见地图 Out of scope）。
