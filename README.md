# dsh-algorithm-tools

算法训练台 — [DeepSeek Harness](https://github.com/deepseek-ai) 插件。

把 Codeforces / AtCoder 的刷题数据接进 DSH：同步提交、弱项分析、每日三档训练、Rank 复盘、赛事列表、日历打卡。能力分两层：

- **10 个 `icpc_*` agent 工具** — 在对话里直接让 AI 帮你同步、选题、复盘
- **右侧面板** — 日历 / 数据概览 / 赛事 三个视图，外加一键功能按钮

当前版本 **0.1.6**。

---

## 快速上手

```bash
# 1. 安装（会转发给 pnpm，在 profile 目录里执行）
dsh plugin --profile desktop add github:SpringRinbowCat/dsh-algorithm-tools
```

2. **重启 DeepSeek Harness**（Host 侧插件不支持热重载）
3. 打开任意会话 → 点右上角图标打开 **Algorithm Practice Space** 面板（**必须打开一次**，`icpc_*` 工具才会注册进当前会话）
4. 在对话里依次执行：

```
icpc_settings action=set_account platform=codeforces handle=你的CF用户名
icpc_settings action=set_local_root root=/Volumes/kingston/codeforces
icpc_sync platform=codeforces bank=true     # 首次同步题库约 10–30 秒
icpc_today                                   # 生成今天的训练
```

---

## 面板

三个视图，用左右箭头切换：

| 视图 | 内容 |
|---|---|
| **日历** | 近 12 周训练热力图、连续打卡、今日训练进度 |
| **数据概览** | 提交/AC 统计、难度分布、标签分布、12 周趋势、弱项 |
| **赛事** | CF + AtCoder 近期比赛（进行中 / 即将开始） |

右侧功能按钮（点击后把对应指令交给当前会话的 agent）：

| 按钮 | 作用 |
|---|---|
| 今日训练 | 生成/读取今天的 6 道题（巩固 2 / 同段 3 / 挑战 1） |
| 同步数据 | `icpc_sync_all`：同步提交 + 提交并推送本地仓库 |
| 题库刷新 | `icpc_sync bank=true`：只拉题库，不动代码 |
| rank 复盘 | `icpc_review action=contests`：近期比赛复盘 |
| 加训 | 今日完成后出现，换一批挑战题 |

**打开面板时会自动增量同步**（服务端 30 分钟内只拉一次）；今日训练完成后会额外拉一次最新数据。

---

## Agent 工具（10 个）

| 工具 | 主要 action / 参数 | 说明 |
|---|---|---|
| `icpc_sync` | `platform`(all/codeforces/atcoder)、`handle`、`bank` | 增量同步提交；`bank=true` 顺带刷题库 |
| `icpc_sync_all` | `contestId` | 同步 + 处理 `rank/_pending` + 提交推送仓库 |
| `icpc_stats` | `type`(overall/weakness/trend) | 统计分析 |
| `icpc_today` | `consolidation`/`core`/`challenge`/`rotate`/`windowDays` | 今日三档训练，写入 `<日期>.md` |
| `icpc_review` | `contests` / `contest` | Rank 复盘 |
| `icpc_contests` | `action`(upcoming/finished) | 赛事列表 |
| `icpc_checkin` | `status/streak/month/date/checkin/uncheck` | 日历打卡 |
| `icpc_problems` | `platform/difficulty/tag/q/bank` | 浏览题库 |
| `icpc_settings` | `get/set_account/set_ai/set_adapter/set_cookies/set_reminder/set_local_root` | 设置（返回时密钥脱敏） |
| `icpc_maintenance` | `stats/clear_submissions/clear_all` | 数据维护：查看量级、清空提交/复习 |

> 工具是**按会话注册**的：新会话需要先打开一次右侧面板。没打开时调用会报 `unknown tool "icpc_*"`。

---

## 今日训练怎么算

`icpc_today` 的三档推荐：

1. **能力值 = 当前 rating**：直接取 Codeforces 当前 rating，四舍五入到 100 分档。
   拉不到 rating 时才回退到「近 60 天刷题 AC 难度中位数 × 0.6 + 比赛 AC 难度中位数 × 0.4」。
2. **按目录锁定**：先看 `<训练根>/practice/<今天>/`，已经有题目文件夹就按已有的出推荐，不重新抽题——
   这样两台电脑从 GitHub 同步同一份目录时不会各抽一套。目录为空才新抽。
3. **落盘成文档**：把三档题目和选题理由写成 `practice/<今天>/<今天>.md`，随仓库提交，另一台机器打开就是同样的安排。

选题依据：弱项标签命中 → 近期比赛失分标签 → 本周训练方向，按距离档位中心的距离排序。

---

## 训练仓库约定

推荐结构（`localRoot` 指向仓库根）：

```
codeforces/
├── practice/<YYYY-MM-DD>/<题目>/<题目>.cpp     # 日常训练 & 赛后补题
├── practice/<YYYY-MM-DD>/<YYYY-MM-DD>.md       # 当天训练安排
├── rank/<比赛号>/<比赛号><题号>/<比赛号><题号>.cpp   # 比赛代码
```

兼容旧格式：`practise/<日期>/...`；只要目录名或 `.cpp` 文件名能匹配 `2283C` / `1858E1` 这类题号即可。

> 0.1.7 起移除了独立的「训练计划」体系（计划视图、计划按钮、`taskList/*.md`、`icpc_generate_plan`/`icpc_manage_plan`）。每日训练本身已经覆盖了它的作用。

### 比赛当场不输比赛号：`rank/_pending`

比赛时不知道 contest id 也能建题：

1. Sublime 里按 `Ctrl+Alt+R` → 输 `A`/`B`/`C1` → 文件落在 `rank/_pending/A/A.cpp`
2. 赛后点「同步数据」→ 插件发现 `_pending`，先返回 `needContestId` 和题号列表，**不提交**
3. 你回一个比赛号 → 自动重命名成 `rank/<比赛号>/<比赛号>A/<比赛号>A.cpp`、改写题链，再提交推送

对应工具调用：`icpc_sync_all`，有 `_pending` 时先不带 `contestId`，拿到清单后再带 `contestId=2280`。

### 冲突策略：远端为准

`icpc_today` / `icpc_sync` / `icpc_generate_plan` 动手前都会 `git pull`。pull 冲突时：

1. `git rebase --abort` / `merge --abort`，不让仓库卡在冲突状态
2. 只把「安排类」路径强制对齐远端（`practice/<日期>/<日期>.md`）
3. 同一批差异里的 `*.cpp` 也按远端覆盖，其他文件不动
4. 对齐后立即同步进面板，不再追问

---

## 换 Codeforces 账号

```bash
icpc_settings action=set_account platform=codeforces handle=新用户名
icpc_sync platform=codeforces
```

**不需要手动清数据**：提交记录从 0.1.3 起带 `handle` 字段，统计、日历、弱项都按当前绑定账号过滤：

- 换号时，没有 `handle` 的旧记录会自动归到**旧账号**名下，不会算成新号的账
- 想彻底清空历史（比如重建）：`icpc_maintenance action=clear_all`

> 注意：`icpc_maintenance` 必须在插件进程内部执行。直接改磁盘上的 state 文件会被运行中的进程用内存副本覆盖——退出时还会再刷一次盘。

---

## 数据与目录

| 内容 | 位置 |
|---|---|
| 插件状态（题库缓存 / 提交 / 训练索引 / 设置） | `$DSH_HOME/.icpc-data/icpc-state.json`，未设 `DSH_HOME` 时是 `~/.icpc-data/icpc-state.json` |
| 启动探针 | 同目录 `icpc-boot.log`（排查数据目录用） |
| 训练仓库 | `icpc_settings action=set_local_root` 设置；未设置时依次尝试 `D:\codeforces`、`~/codeforces` |

state 文件**不跟 git 同步**：每台机器路径和账号绑定不同。能算出来的数据（提交、AC、弱项、打卡）都可以从 CF 重新拉；题库缓存重建约 10–30 秒。

**读写模型**：启动时读一次进内存 → 运行中改内存 → 500 ms 防抖落盘 → 退出时再写一次。所以：

- 运行中直接编辑 state 文件无效
- 清库必须走 `icpc_maintenance`
- 文件损坏时插件会把坏文件改名成 `.corrupt-<时间戳>` 留档，然后从空状态启动

---

## 配置

`cordis.patch.yml` 里的挂载行（profile 层）：

```yaml
- insert:
    - id: algo-trainer
      name: 'dsh-algorithm-tools'
      config:
        dataDir: ''          # 留空 = $DSH_HOME/.icpc-data
        localRoot: ''        # 留空 = D:\codeforces → ~/codeforces
        ai:
          enabled: false
          baseURL: 'https://api.deepseek.com/v1'
          apiKey: ''
          model: 'deepseek-chat'
```

`dataDir` / `localRoot` / `ai` 也可以运行时用 `icpc_settings` 改（持久化进 JSON），`get` 返回的 apiKey / cookie 是脱敏的。

---

## 目录结构

```
dsh-algorithm-tools/
├── package.json              # dsh.bundle（patch）+ dsh.client（platform: web）
├── cordis.patch.yml          # 挂载行
├── tsconfig.json / tsconfig.client.json
├── scripts/wrap-client.mjs   # 把 client bundle 包成 __ModuleLoader__ 格式
├── src/                      # Host 侧
│   ├── index.ts              # apply()：store 初始化 + 路由 + 工具注册
│   ├── activation.ts         # 按会话激活工具（ICPC_TOOL_NAMES + /icpc-workbench/activate）
│   ├── dsh-compat.ts         # Context / Tool / Fs / Config 兼容层
│   ├── types.ts
│   ├── workbench-overview.ts # GET /icpc-workbench/overview（日历视图）
│   ├── workbench-contests.ts # GET /icpc-workbench/contests（赛事视图）
│   ├── workbench-sync.ts     # POST /icpc-workbench/sync（面板自动同步）
│   ├── store/
│   │   ├── schema.ts         # JSON 数据模型（含 SubmissionRecord.handle）
│   │   └── index.ts          # IcpcStore：内存索引 + 防抖落盘
│   ├── adapters/             # codeforces.ts / atcoder.ts / types.ts
│   ├── analysis/             # stats / weakness / trend / tags / today（纯函数）
│   ├── util/                 # local-scan / local-date / git 等
│   └── tools/                # 10 个工具，一个文件一个（maintenance.ts 是数据维护）
├── client/                   # Client 侧（面板 UI）
│   ├── index.ts              # apply()：注册 tab、header 按钮、设置项
│   ├── WorkbenchPanel.tsx    # 主面板：功能按钮 + 视图切换
│   ├── VizPanel.tsx          # 三个视图：日历 / 数据概览 / 赛事
│   ├── features.ts           # 功能目录（按钮 → 提示词）
│   ├── betterSidebar.ts      # 有 better-sidebar 时的适配
│   └── api.ts
└── tests/                    # 37 个测试（5 个文件）
```

---

## 开发

```bash
pnpm install
pnpm build          # tsdown 打包 + wrap-client 包装
pnpm test           # tsx --test tests/**/*.test.ts
pnpm typecheck      # Host 侧类型检查（仓库里存在若干历史类型告警）
pnpm typecheck:client
```

仓库自带构建好的 `lib/`，直接安装不需要本地编译；改源码才需要 build。

本地调试：

```bash
dsh plugin --profile desktop add file:/path/to/dsh-algorithm-tools
```

---

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 调用报 `unknown tool "icpc_*"` | 该会话还没激活：打开一次右侧面板（或 POST `/icpc-workbench/activate` 带 `sessionId`） |
| 面板点开全白 | 客户端组件渲染时抛错。用 `renderToStaticMarkup(<WorkbenchPanel />)` 跑一遍能直接看到异常（历史上就踩过残留 prop 导致的 `xxx is not defined`） |
| 控制台 `Unexpected end of JSON input` | 某个接口返回 404 空响应。面板已用 `readJson` 兜底：空 body / 非 JSON 返回 `null`，不再拖垮整个面板 |
| 数据改了又被改回去 | 运行中的进程用内存覆盖磁盘。清数据走 `icpc_maintenance`，或退出 App 后再改文件 |
| 换号后统计还是旧的 | 确认插件是 0.1.3+（提交记录带 `handle`）；仍不对就 `icpc_maintenance action=clear_all` 再同步 |

---

## Client 契约

`package.json` 里：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-ui-conversation",
      "@deepseek-ai/dsh-client-ui-slots",
      "@deepseek-ai/dsh-client-ui-sidebar-right"
    ],
    "external": []
  }
}
```

- Host 侧 `inject = ['tools', 'agents', 'webServer']`：工具注册、按会话激活、面板数据路由
- Client 侧注册一个 tab（`dsh-algo-trainer.workbench`）、会话头部按钮（`Algorithm Practice Space`）、设置页条目（算法训练台）
- 装了 `dsh-better-sidebar` 时走 `ctx.betterSidebar`（tab id `dsh-algo-trainer:workbench`），否则回退 DSH 原生右侧栏

---

## 测试

```bash
pnpm test
```

37 个用例，覆盖：纯函数分析（难度分档、弱项打分、趋势、Markdown 渲染）、工具按会话注册、客户端功能目录、better-sidebar 描述符、换号后的数据隔离。
