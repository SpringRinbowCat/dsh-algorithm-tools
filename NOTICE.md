# 来源与致谢

本插件不是从零开始写的。它源自一个已有的开源项目，在它的基础上做了大幅裁剪和重写。

## 上游项目

| 项 | 值 |
|---|---|
| 仓库 | [ZF3373/icpc-workbench](https://github.com/ZF3373/icpc-workbench) |
| 描述 | ICPC 备赛工作台：多平台刷题同步 + 个人模板库 + AI 训练计划 + 弱项分析 + 日历打卡 |
| 许可 | **GNU General Public License v3.0** |

## 我们保留并移植的部分

以下模块的算法逻辑来自上游，移植时去掉了 Node/数据库依赖，改为纯函数或纯 `fetch`：

| 本仓库文件 | 来源 | 改动 |
|---|---|---|
| `src/analysis/stats.ts` | 上游统计引擎 | 去掉 DB 依赖，纯函数化 |
| `src/analysis/today.ts` | 上游训练计划选题 | 改为「巩固 / 同段 / 挑战」三档，去掉 AI 计划 |
| `src/analysis/trend.ts` | 上游趋势分析 | 纯函数化 |
| `src/analysis/tags.ts` | 上游标签净化 | 保留过滤规则 |
| `src/analysis/weakness.ts` | 上游弱项画像 | 纯函数化 |
| `src/adapters/codeforces.ts` | 上游 CF 同步 | 去掉 `node:fs`，改纯 `fetch` |
| `src/adapters/atcoder.ts` | 上游 AtCoder 同步 | 去掉磁盘缓存，改内存 Map |

## 我们删掉的上游功能

上游是一个完整的本地 Web 应用（带 SQLite、题库、模板库、多平台适配器、AI 生成计划、掌握度地图等）。本插件只保留了一个子集：

- 删除全部数据库与后端服务，状态改为单个 JSON 文件
- 删除个人模板库、复习库、掌握度地图、题目管理页
- 删除 AI 训练计划生成（改为本地规则选题）
- 平台适配器只保留 Codeforces / AtCoder
- 删除洛谷 / 牛客 / LeetCode / 计蒜客 / PTA / VJudge / DashOJ 等适配器

## 我们新增的部分

- 以 **DeepSeek Harness 插件**形式重构（Host 工具 + Web 面板）
- 10 个 `icpc_*` agent 工具，按会话激活
- 右侧面板：日历 / 数据概览 / 赛事三个视图
- 每日三档训练（巩固 / 同段 / 挑战）+ 选题理由
- Rank 复盘（按比赛聚合提交，分析每题失分标签）
- 训练仓库集成（`practice/YYYY-MM-DD/`、`rank/<contestId>/`、自动提交推送）
- 换号隔离（提交记录带 `handle` 字段）
- rating 低于 1200 时锁定 1200 的训练下限

## 许可

由于上游采用 **GPL-3.0**，本仓库作为其衍生作品，同样以 **GPL-3.0** 发布，见 [LICENSE](LICENSE)。

如果你要在自己的项目里使用本仓库的代码，或基于它二次开发，请同时遵守上游的 GPL-3.0 条款，并保留本文件与上游链接。
