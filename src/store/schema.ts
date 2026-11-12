/** 存储数据模型：JSON 文件结构（替代 SQLite 表） */

import type { PlatformId, Verdict } from '../types.ts'

export interface ProblemRecord {
  platform: PlatformId
  problemKey: string
  title: string
  difficulty: number | null
  url: string | null
  tags: string[]
}

export interface SubmissionRecord {
  platform: PlatformId
  problemKey: string
  verdict: Verdict
  language?: string
  submittedAt: string
  externalId: string
  /** 产生这条提交的 Codeforces 用户名；换号后用于把旧账号的数据过滤掉 */
  handle?: string
}

export interface PlatformAccountRecord {
  platform: PlatformId
  handle: string
  lastSyncAt: string | null
  enabled: boolean
}

export interface SettingsRecord {
  accounts: Partial<Record<PlatformId, PlatformAccountRecord>>
  ai: {
    enabled: boolean
    baseURL: string
    apiKey: string
    model: string
  }
  adapterEnabled: Partial<Record<PlatformId, boolean>>
  cookies: Partial<Record<PlatformId, { cookie?: string; csrf?: string }>>
  reminder: {
    enabled: boolean
    time: string
  }
  /** 本地题目根目录（如 /Volumes/kingston/codeforces）；留空则用插件配置或默认扫描根 */
  localRoot?: string
}

/** 全部存储状态（一个 JSON 文件） */
export interface StoreState {
  problems: ProblemRecord[]
  submissions: SubmissionRecord[]
  settings: SettingsRecord
  /** 每日训练索引：日期 → 当天「今日训练」抽到的题（`platform:problemKey`），用于判定今日是否完成 */
  trainingIndex: Record<string, string[]>
  /** 上次题库同步时间（ISO）；每天自动刷一次题库用 */
  bankSyncedAt: string | null
}

export function defaultState(): StoreState {
  return {
    problems: [],
    submissions: [],
    trainingIndex: {},
    bankSyncedAt: null,
    settings: {
      accounts: {},
      ai: {
        enabled: false,
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: '',
        model: 'deepseek-chat',
      },
      adapterEnabled: {},
      cookies: {},
      reminder: { enabled: false, time: '20:00' },
    },
  }
}
