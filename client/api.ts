export interface ActivationResponse {
  ok: true
  sessionId: string
  tools: string[]
}

interface ErrorResponse {
  ok?: false
  error?: string
  message?: string
}

export interface OverviewResponse {
  ok: true
  today: {
    date: string
    ac: number
    submissions: number
    tasks: { total: number; checked: number }
    done: boolean
    advice: { kind: 'catchup' | 'extra'; title: string; items: string[] }
  }
  streak: { current: number; longest: number; totalDays: number }
  days: Array<{ date: string; ac: number; submissions: number; tasks: number; checked: number; done: boolean }>
}

export async function fetchOverview(days = 84): Promise<OverviewResponse> {
  const response = await fetch(`/icpc-workbench/overview?days=${days}`)
  const body = (await response.json().catch(() => null)) as OverviewResponse | null
  if (!response.ok || !body || body.ok !== true) {
    throw new Error(`overview failed (${response.status})`)
  }
  return body
}

export async function activateWorkbench(sessionId: string): Promise<ActivationResponse> {
  const response = await fetch('/icpc-workbench/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  const body = await response.json().catch(() => null) as ActivationResponse | ErrorResponse | null
  if (!response.ok || !body || body.ok !== true) {
    const failure = body as ErrorResponse | null
    throw new Error(failure?.message ?? failure?.error ?? `activation failed (${response.status})`)
  }
  return body
}
