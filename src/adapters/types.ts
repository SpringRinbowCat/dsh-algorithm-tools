import type { NormalizedSubmission, PlatformId } from '../types.ts'

export interface FetchOptions {
  since?: string
  knownExternalIds?: Set<string>
}

/** 题库题目：只有元数据，不产生提交记录 */
export interface BankProblem {
  platform: PlatformId
  problemKey: string
  title: string
  difficulty: number | null
  url: string | null
  tags: string[]
}

export interface PlatformAdapter {
  readonly platform: PlatformId
  readonly knownIdsFilter?: boolean
  fetchUserSubmissions(handle: string, opts?: FetchOptions): Promise<NormalizedSubmission[]>
  problemUrl(problemKey: string): string
  /** 可选：拉取平台题库，供「今日三档」从未做过的题里选题；不支持的平台不实现即可 */
  fetchProblemBank?(): Promise<BankProblem[]>
}

export interface ContestAdapter {
  fetchContests(): Promise<Array<{
    id: string
    platform: PlatformId
    name: string
    category: string
    startTimeIso: string | null
    durationMinutes: number
    phase: string
    url: string
  }>>
}
