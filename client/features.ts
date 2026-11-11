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
    prompt: '同步数据：严格按仓库根目录 docs/sync.md 执行。',
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
