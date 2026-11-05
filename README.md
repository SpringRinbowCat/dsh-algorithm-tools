# dsh-algorithm-tools

算法学习训练台 — DeepSeek Harness 插件。

将 [icpc-workbench](https://github.com/ZF3373/icpc-workbench) 的核心训练能力（刷题同步、弱项分析、今日推荐、训练计划、间隔复习、模板库、赛事中心、打卡）封装为 dsh agent 工具，让 AI agent 能直接帮选手完成训练全流程。

## 安装

> 需要 **DeepSeek Harness 桌面版**（插件运行在 Host 进程里，依赖 dsh 的 `tools` / `webServer` 服务）。

### 从 GitHub 安装（推荐，macOS / Windows 通用）

```bash
dsh plugin --profile desktop add github:SpringRinbowCat/dsh-algorithm-tools
```

安装后**重启 DeepSeek Harness**（宿主侧插件不会热重载），然后：

1. 任意会话 → 打开右侧「ICPC Workbench」面板（这一步才会把 `icpc_*` 工具注册进当前会话）
2. 打开右侧面板即会自动增量同步（30 分钟节流）；今日训练完成后还会自动拉一次最新数据，题库每天自动刷新

仓库里已经带了构建好的 `lib/`，**不需要本地编译**；只有改源码时才需要 `pnpm install && pnpm build`。

### 从本地目录安装（开发调试）

```bash
dsh plugin --profile desktop add file:/path/to/dsh-algorithm-tools
```

## 复习库是手动的

训练/同步**不再自动把本地题目收进复习库**（那是旧流程的冗余，训练质量已经改用 `icpc_review action=contest` 的 Rank 复盘来判断）。

需要复习时显式操作：

- `icpc_review action=add platform=codeforces problemKey=2020A` 单题入库
- `icpc_review action=scan` 扫一遍本地目录，把没入库的题批量收进来（默认扫 `localRoot`）

## 冲突策略：远端为准

`icpc_today` / `icpc_sync` / `icpc_generate_plan` 在动手前都会先 `git pull`。
如果本地改动和远端冲突（pull 失败），会**自动放弃本地那份安排**：

1. `git rebase --abort` / `merge --abort`，不让仓库卡在冲突状态
2. 只把「安排类」路径强制对齐远端（`practice/<日期>/<日期>.md` 或 `taskList/`）
3. 题目代码（`*.cpp`）不动，不会被覆盖
4. 对齐后立即同步进面板（今日训练索引 / 计划列表），不需要再问

## 今日训练怎么算

`icpc_today` 的三档推荐有两个特点：

1. **不读 rating**：能力值 = 近 60 天「AC 题目难度中位数 × 0.6」+ 近 60 天「比赛中 AC 的题目难度中位数 × 0.4」。
   某一侧没有数据就退化为另一侧；两边都空才回落到 1200。
2. **按目录锁定**：先读本地 `<训练根>/practice/<今天>/`，如果已经有题目文件夹，就按这些题出推荐（不再重新抽题），
   这样两台电脑从 GitHub 同步同一份目录时不会各抽一套。只有目录为空时才新抽题。

每次生成还会把当天的三档题目和选题理由写成 `<训练根>/practice/<今天>/<今天>.md`，随仓库一起提交，
在另一台机器上打开就能看到同样的安排。

本地训练根目录可以用 `icpc_settings action=set_local_root root=/path/to/codeforces` 设置，
也可以用插件配置里的 `localRoot`（都没设置时退回默认扫描根：`D:\codeforces` / `~/codeforces`）。

## 数据与目录约定

| 内容 | 位置 |
|---|---|
| 插件数据（题库/提交/计划/复习/索引） | `~/.icpc-data/icpc-state.json`（Windows 为 `C:\Users\<你>\.icpc-data\`） |
| 本地题目目录 | 优先用 `icpc_settings action=set_local_root` 设置；未设置时 `D:\codeforces` → `~/codeforces` |

本地题目目录的约定是 `<日期>/<题号>/<题号>.cpp`（例如 `2026-11-05/2283C/2283C.cpp`），也兼容 `practise/<日期>/<题号>/`。目录名或 `.cpp` 文件名能匹配 `2283C` / `1858E1` 这类题号即可。

## 设计方案

**不搬 Express/SQLite**——用 dsh 原生服务重建数据层与适配层：

| 层 | 原项目 | 本插件 |
|---|---|---|
| 数据持久化 | SQLite (node:sqlite) | JSON 文件（node:fs 落盘到 DSH_HOME/.icpc-data/） |
| 网络请求 | Node `fetch` | 全局 `fetch`（Host 进程内可用） |
| 适配范围 | CF + AtCoder + 洛谷 + 牛客 | **CF + AtCoder**（洛谷/牛客需 Cookie/反爬，首版不支持） |
| Agent 接口 | Express REST 路由 | dsh `ctx.tools.register()`（11 个 `icpc_` 前缀工具） |
| 前端 | React SPA | dsh Slot UI 面板（设置页引导面板） |
| 分析引擎 | 依赖 DB 的函数 | **纯函数**（输入 `SubmissionRow[]`，无 IO 依赖） |

> 说明：`ctx.fs`（dsh fs 服务）的接口是 `resolve/readText/writeText/stat` 风格，
> 与本插件假设的 `readFile/writeFile/mkdir` 不兼容，且 host 侧不存在 `rpc` 服务。
> 因此数据层统一使用 node:fs（文件插件运行在 Host Node 进程中，可靠且已验证），
> client 半边为静态引导面板，不做 client→host RPC。

## 目录结构

```
dsh-algorithm-tools/
├── package.json              # dsh 插件包定义（dsh.bundle + dsh.client）
├── tsconfig.json             # host 侧 tsconfig
├── tsconfig.client.json      # client 侧 tsconfig
├── cordis.patch.yml          # dsh 配置补丁行
├── scripts/
│   └── wrap-client.mjs       # 将 ESM client bundle 包装为 __ModuleLoader__ 格式
├── README.md
├── src/                      # Host 半边
│   ├── index.ts              # 插件入口：apply(ctx, config) — store 初始化 + 13 工具注册
│   ├── dsh-compat.ts         # dsh 类型兼容层（Context / ToolDefinition / FsService / Config）
│   ├── types.ts              # 跨模块共享类型（PlatformId / Verdict / WeaknessProfile / TodayPlan / ...）
│   ├── store/
│   │   ├── schema.ts         # JSON 数据模型（ProblemRecord / SubmissionRecord / PlanRecord / ...）
│   │   └── index.ts          # IcpcStore 类：内存索引 + 防抖落盘（替代 SQLite）
│   ├── adapters/
│   │   ├── types.ts          # PlatformAdapter / ContestAdapter 接口
│   │   ├── codeforces.ts     # CF 适配器（user.status + contest.list，knownExternalIds 增量终止）
│   │   └── atcoder.ts        # AtCoder 适配器（kenkoooo API，from_second 增量，内存缓存题目资源）
│   ├── analysis/             # 纯函数分析引擎（无 DB 依赖）
│   │   ├── stats.ts          # 总体统计（attempts/AC/AC率/各平台/各难度/各标签）
│   │   ├── weakness.ts       # 弱项画像（标签/难度 gap 打分）
│   │   ├── trend.ts          # 12 周趋势（ISO 周键，空周补 0）
│   │   ├── tags.ts           # 标签净化（过滤赛事/年份/地区等噪声标签）
│   │   └── today.ts          # 今日三档选题（刷题+比赛双路能力值、落档、Markdown 渲染）
│   ├── reviews/
│   │   └── schedule.ts       # 间隔复习调度（1/3/7/14/30/60 天阶梯，hard/ok/easy 调档）
│   ├── plans/
│   │   └── planService.ts    # 训练计划服务（AI 生成 + 模板降级 + JSON 解析容错）
│   ├── templates/
│   │   ├── curriculum.ts     # 114 课算法模板大纲（数据文件）
│   │   └── progress.ts       # 学习进度管理（todo/learning/mastered + 下一课推荐）
│   ├── tools/                # 11 个 agent 工具
│   │   ├── helpers.ts        # textOutput / num / str 辅助
│   │   ├── sync.ts           # icpc_sync — 同步刷题记录
│   │   ├── stats.ts          # icpc_stats — 统计分析
│   │   ├── today.ts          # icpc_today — 今日三档训练
│   │   ├── plans.ts          # icpc_generate_plan + icpc_manage_plan
│   │   ├── reviews.ts        # icpc_review — 间隔复习库
│   │   ├── templates.ts      # icpc_templates — 模板库
│   │   ├── contests.ts       # icpc_contests — 赛事中心
│   │   ├── checkins.ts       # icpc_checkin — 日历打卡
│   │   ├── settings.ts       # icpc_settings — 设置
│   │   ├── problems.ts       # icpc_problems — 题目浏览
├── client/
│   └── index.ts              # Client 半边：设置页引导面板（Slot UI）
└── tests/
    └── analysis.test.ts      # 24 个纯函数测试
```

## 安装

```bash
# 在 dsh profile 中添加
dsh plugin --profile web add dsh-algorithm-tools

# 或从源码
cd dsh-algorithm-tools
npm install        # prepare 钩子会自动构建 lib/
```

## 配置

```yaml
# cordis.patch.yml
- insert:
    - id: algo-trainer
      name: 'dsh-algorithm-tools'
      config:
        dataDir: ''           # 数据目录，留空则用 $DSH_HOME/.icpc-data/
        ai:
          enabled: false
          baseURL: 'https://api.deepseek.com/v1'
          apiKey: ''
          model: 'deepseek-chat'
```

AI 配置也可运行时通过 `icpc_settings` 工具修改（持久化到 JSON）。
注意：`icpc_settings get` 返回的 apiKey / cookie 会脱敏显示。

## Agent 工具（11 个）

| 工具 | 功能 |
|------|------|
| `icpc_sync` | 同步 CF/AtCoder 提交记录（增量，支持 all 批量） |
| `icpc_stats` | 统计分析：overall / weakness / trend |
| `icpc_today` | 今日三档训练推荐（巩固/同段/挑战；能力值=近 N 天刷题 60% + 比赛 40%；当天目录已有题就锁定；自动写 `<日期>.md`） |
| `icpc_generate_plan` | AI 生成训练计划（无 key 降级模板） |
| `icpc_manage_plan` | 计划管理：list/detail/checkin/uncheck/delete/import/update_task/delete_task |
| `icpc_review` | 间隔复习库：list/add/feedback/remove |
| `icpc_templates` | 114 课模板库：browse/next/set_status/set_content/自建/例题 |
| `icpc_contests` | 多平台赛事（CF+AtCoder 聚合） |
| `icpc_checkin` | 日历打卡：streak/month/date/checkin/uncheck |
| `icpc_settings` | 设置：get/set_account/set_ai/set_adapter/set_cookies/set_reminder |
| `icpc_problems` | 浏览/搜索题目库（platform/difficulty/tag/q/bank） |

## Client 面板

设置页中注册「算法训练台」引导面板（`settings.section`），列出全部工具与使用方式。
由于文件插件没有 client→host RPC 通道（host 侧无 `rpc` 服务），面板为静态内容，
数据读写一律通过 `icpc_*` 工具在对话中完成。

## 侧边栏与按需激活

插件在会话头部注册 `ICPC Workbench` 按钮。点击后打开 Harness 右侧栏，
侧栏按“训练”和“记录与设置”分组展示现有能力。

打开侧栏不会向 Agent 注入任何 ICPC 工具或提示词。只有用户在当前会话点击
“AI 助手”或某个具体功能项后，插件才会把 `icpc_*` 工具注册到该会话对应的
Agent 作用域，并由 Harness 当前对话执行后续请求。其他会话不受影响。

安装 `dsh-better-sidebar` 后，插件会通过其公开的 `ctx.betterSidebar`
服务注册 `dsh-algorithm-tools:workbench` tab，ICPC 页面由 better-sidebar
的原生 tab 宿主承载；未安装时自动回退到 DSH 原生右侧栏。

## 测试

```bash
npx tsx --test tests/**/*.test.ts
```

32 个测试覆盖纯函数、按需工具注册、会话激活和客户端功能目录。

## dsh 插件契约

- **`name`**: `'dsh-algorithm-tools'`
- **`inject`**: `['tools']` — 只依赖 dsh tools 服务；fs 接口不兼容、rpc 服务不存在，故均不注入
- **`apply(ctx, config)`**: 加载 JSON 存储（load 完成后工具才可安全读写）→ 初始化 CF/AtCoder 适配器 → 注册 11 个工具 → `ctx.effect()` 注册 dispose 落盘
- **`Config`**: 结构兼容的配置 schema（dataDir / ai）
- **`dsh.client`**: `{ platform: 'web' }` — client 半边由构建后的 `lib/client.mjs`（`__ModuleLoader__` 包装）提供
