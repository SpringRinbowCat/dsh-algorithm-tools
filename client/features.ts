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
    prompt: '请调用 icpc_today 工具，给我今天的三档训练推荐并说明选题理由。',
  },
  {
    id: 'plans',
    group: 'training',
    label: '训练计划',
    description: '查看、生成与打卡',
    icon: 'plans',
    prompt: '请调用 icpc_manage_plan 工具列出我的训练计划；如果没有计划，再询问我计划天数并准备生成。',
  },
  {
    id: 'reviews',
    group: 'training',
    label: '复习库',
    description: '到期复评与遗忘曲线',
    icon: 'reviews',
    prompt: '请调用 icpc_review 工具列出我的复习库，并优先展示今天到期的题目。',
  },
  {
    id: 'templates',
    group: 'training',
    label: '模板库',
    description: '114 课算法模板与进度',
    icon: 'templates',
    prompt: '请调用 icpc_templates 工具浏览我的模板课程，并推荐下一课。',
  },
]

export function featurePrompt(id: string): string {
  const feature = WORKBENCH_FEATURES.find((item) => item.id === id)
  if (!feature?.prompt) throw new Error(`feature ${id} has no prompt`)
  return feature.prompt
}
