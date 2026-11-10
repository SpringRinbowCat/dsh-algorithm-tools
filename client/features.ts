export type FeatureGroup = 'training'
export type FeatureIcon =
  | 'assistant'
  | 'overview'
  | 'today'
  | 'plans'
  | 'reviews'
  | 'templates'
  | 'problems'
  | 'sync'
  | 'import'
  | 'export'
  | 'checkins'
  | 'contests'
  | 'settings'

export interface WorkbenchFeature {
  id: string
  group: FeatureGroup
  label: string
  description: string
  icon: FeatureIcon
  prompt?: string
  /** true = 只通过卡片里的按钮触发，不出现在右侧功能列表里 */
  hidden?: boolean
}

export const FEATURE_GROUPS: ReadonlyArray<{ id: FeatureGroup; label: string }> = [
  { id: 'training', label: '训练' },
]

export const WORKBENCH_FEATURES: readonly WorkbenchFeature[] = [
  {
    id: 'assistant',
    group: 'training',
    label: 'AI 助手',
    description: '使用当前 Harness 对话',
    icon: 'assistant',
  },
  {
    id: 'today',
    group: 'training',
    label: '今日训练',
    description: '巩固、同段与挑战题',
    icon: 'today',
    prompt: '获取远端今日训练题目，如远端无题目文档，调用 icpc_today 获取训练并同步至日历，将文档推送到远端',
  },
  {
    id: 'plans',
    group: 'training',
    label: '训练计划',
    description: '查看、生成与打卡',
    icon: 'plans',
    prompt: '从远端 taskList 目录列出我的训练计划；如果没有计划，调用 icpc_generate_plan 以 14 天为周期生成一个系统化训练计划（生成后用 icpc_manage_plan 确认并同步到远端）。',
  },
  {
    id: 'sync',
    group: 'training',
    label: '同步数据',
    description: '同步提交记录并推送本地代码',
    icon: 'sync',
    prompt:
      '请先调用 icpc_sync platform=codeforces 同步我的提交记录；然后检查本地算法训练仓库，把未提交的题目代码、训练文档和计划文件提交并推送到远程仓库，只提交源码和训练文档，不要提交 exe、编译产物或临时调试文件。' +
      '如果这次待提交的改动里包含 rank/ 目录，先做比赛号补全，不要直接提交：检查 rank/_pending/ 下的字母目录（A、B、C…），以及 rank/ 里题号为纯字母的目录；' +
      '把发现的题号列给我（例如 A、B、C1），然后问我这场比赛对应的 Codeforces 比赛号是多少（只回一个数字）；' +
      '等我回答后再动手：把 rank/_pending/<字母>/ 重命名为 rank/<比赛号>/<比赛号><字母>/，cpp 文件名从 <字母>.cpp 改成 <比赛号><字母>.cpp，' +
      '文件头第一行的题链改成 https://codeforces.com/problemset/problem/<比赛号>/<字母>，并确认没有残留的 _pending 目录；全部改完再提交推送。' +
      '最后汇报新增提交数、提交了哪些代码、比赛号补全情况以及推送结果。',
  },
  {
    id: 'bank',
    group: 'training',
    label: '题库刷新',
    description: '刷新 Codeforces 题库数据',
    icon: 'problems',
    prompt: '请调用 icpc_sync platform=codeforces bank=true 刷新 Codeforces 题库，只同步题库和提交记录，不要提交或推送本地代码；最后汇报拉取、新增、更新数量及错误。',
  },
  {
    id: 'reviews',
    group: 'training',
    label: 'rank 复盘',
    description: '近期比赛复盘与薄弱项',
    icon: 'reviews',
    prompt: '请调用 icpc_review 工具（action=contests）列出我近期参与的比赛并复盘：每题用时、未通过原因、代码优化点、暴露的薄弱项。',
  },
  {
    id: 'extra',
    group: 'training',
    label: '加训',
    description: '今日训练完成，再换一批挑战题',
    icon: 'today',
    hidden: true,
    prompt: '今天的三档训练已经完成，请调用 icpc_today（带 rotate 换一批）给我 1-2 道挑战区的加练题，并说明选题理由。',
  },
]

export function featurePrompt(id: string): string {
  const feature = WORKBENCH_FEATURES.find((item) => item.id === id)
  if (!feature?.prompt) throw new Error(`feature ${id} has no prompt`)
  return feature.prompt
}
