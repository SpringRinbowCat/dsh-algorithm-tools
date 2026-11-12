import { useEffect, useRef, useState, type ReactNode } from 'react'
import { activateWorkbench } from './api.ts'
import { VizPanel, type ContestItem, type Overview, type Stats } from './VizPanel.tsx'
import {
  FEATURE_GROUPS,
  WORKBENCH_FEATURES,
  featurePrompt,
  type FeatureIcon,
  type WorkbenchFeature,
} from './features.ts'

export interface InputActions {
  setDraft(text: string): void
  submit(): void
}

export interface WorkbenchPanelProps {
  sessionId?: string
  inputActions?: InputActions
}

/** 安全读 JSON：接口 404/空响应/非 JSON 都返回 null，不让单个接口拖垮整个面板 */
async function readJson(url: string, init?: RequestInit): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(url, init)
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text) as Record<string, any>
    } catch {
      return null
    }
  } catch {
    return null
  }
}

export function WorkbenchPanel({
  sessionId,
  inputActions,
}: WorkbenchPanelProps): ReactNode {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [vizError, setVizError] = useState<string | null>(null)
  const [contests, setContests] = useState<ContestItem[] | null>(null)
  const lastKickRef = useRef(0)
  const loadRef = useRef<() => void>(() => {})

  useEffect(() => {
    let alive = true
    const load = (): void => {
      Promise.all([
        readJson('/icpc-workbench/overview?days=84'),
        readJson('/icpc-workbench/stats'),
        readJson('/icpc-workbench/contests'),
      ])
        .then(([o, s, c]: Array<{ ok?: boolean; error?: string } & Record<string, unknown>>) => {
          if (!alive) return
          if (o?.ok) {
            setOverview(o as unknown as Overview)
            setVizError(null)
            // 今日训练完成 → 自动从 Codeforces 拉最新数据（10 分钟内只触发一次）
            const done = (o as unknown as Overview).today?.done === true
            if (done && Date.now() - lastKickRef.current > 10 * 60 * 1000) {
              lastKickRef.current = Date.now()
              readJson('/icpc-workbench/sync?force=1', { method: 'POST' })
                .then(() => { if (alive) loadRef.current() })
                .catch(() => {})
            }
          } else {
            setVizError(o?.error ?? '总览加载失败')
          }
          if (s?.ok) setStats((s as unknown as { stats: Stats }).stats)
          if (Array.isArray((c as unknown as { contests?: ContestItem[] })?.contests)) {
            setContests((c as unknown as { contests: ContestItem[] }).contests)
          }
        })
        .catch((e: unknown) => {
          if (alive) setVizError(e instanceof Error ? e.message : String(e))
        })
    }
    loadRef.current = load
    load()
    // 打开训练台时自动增量同步（服务端 30 分钟内只拉一次），完成后刷新概览
    readJson('/icpc-workbench/sync', { method: 'POST' })
      .then((res: { ok?: boolean; synced?: Array<{ skipped: boolean }> } | null) => {
        if (!alive) return
        if (res?.ok && res.synced?.some((s) => !s.skipped)) load()
      })
      .catch(() => {})
    const timer = setInterval(load, 60_000)
    const onFocus = (): void => load()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // 红点 = 今天还没抽过今日训练（没有训练索引），点过「今日训练」就消失
  const trainingStarted = (overview?.today.training.total ?? 0) > 0
  const showTodayDot = overview !== null && !trainingStarted

  async function runFeature(feature: WorkbenchFeature): Promise<void> {
    if (!sessionId) {
      setError('当前会话不可用')
      return
    }

    setBusy(feature.id)
    setError(null)
    try {
      await activateWorkbench(sessionId)
      if (!inputActions) {
        setError('Harness 输入框不可用')
        return
      }
      inputActions.setDraft(featurePrompt(feature.id))
      queueMicrotask(() => inputActions.submit())
      // 工具在后台跑（抽题 / 同步 / 打卡），隔几个时间点重新拉一次总览，
      // 这样日历与红点能跟上真实状态，而不是等 60 秒轮询。
      for (const ms of [1500, 4000, 8000, 15000]) {
        window.setTimeout(() => loadRef.current(), ms)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="icpc-workbench">
      <style>{PANEL_CSS}</style>
      <div className="icpc-workbench__scroll">
      <header className="icpc-workbench__header">
        <div className="icpc-workbench__mark">
          <Icon name="trophy" size={16} />
        </div>
        <div>
          <h2>Algorithm Practice Space</h2>
          <p>训练工作台 · v0.1.7</p>
        </div>
      </header>

      <VizPanel
        overview={overview}
        stats={stats}
        contests={contests}
        error={vizError}
        onExtraTraining={() => void runFeature(WORKBENCH_FEATURES.find((f) => f.id === 'extra')!)}
      />

      {error ? <div className="icpc-workbench__error" role="alert">{error}</div> : null}

      <div className="icpc-workbench__groups">
        {FEATURE_GROUPS.map((group) => (
          <section className="icpc-workbench__group" key={group.id}>
            <h3>{group.label}</h3>
            <div className="icpc-workbench__items">
              {WORKBENCH_FEATURES.filter((feature) => feature.group === group.id && !feature.hidden).map((feature) => (
                <button
                  className="icpc-workbench__item"
                  type="button"
                  key={feature.id}
                  disabled={busy !== null || !sessionId || !inputActions}
                  onClick={() => void runFeature(feature)}
                >
                  <span className="icpc-workbench__icon">
                    <Icon name={feature.icon} size={17} />
                  </span>
                  <span className="icpc-workbench__copy">
                    <span className="icpc-workbench__label">
                      {feature.label}
                      {feature.id === 'today' && showTodayDot
                        ? <i className="icpc-workbench__dot" aria-label="今天还没抽今日训练" title="今天还没抽今日训练" />
                        : null}
                    </span>
                    <span className="icpc-workbench__description">{feature.description}</span>
                  </span>
                  <span className="icpc-workbench__status" aria-hidden="true">
                    {busy === feature.id ? '…' : ''}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      </div>
    </div>
  )
}

export interface HeaderActionProps {
  open: () => void
}

export function HeaderAction({ open }: HeaderActionProps): ReactNode {
  return (
    <button
      className="icpc-header-action"
      type="button"
      title="打开 Algorithm Practice Space"
      aria-label="打开 Algorithm Practice Space"
      onClick={open}
    >
      <Icon name="trophy" size={16} />
    </button>
  )
}

export function WorkbenchGlyph({ size = 16 }: { size?: number }): ReactNode {
  return <Icon name="trophy" size={size} />
}

function Icon({ name, size = 16 }: { name: FeatureIcon | 'trophy'; size?: number }): ReactNode {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'today':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4V2M20 12h2M12 20v2M4 12H2" /></svg>
    case 'reviews':
      return <svg {...common}><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 12a8 8 0 0 1 13.7-5.6L20 8.5" /><path d="M4 20v-4.5h4.5M20 4v4.5h-4.5" /></svg>
    case 'problems':
      return <svg {...common}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
    case 'sync':
      return <svg {...common}><path d="M20 7h-5V2M4 17h5v5" /><path d="M18.4 16A7 7 0 0 1 6 18l-2-1M5.6 8A7 7 0 0 1 18 6l2 1" /></svg>
    case 'trophy':
      return <svg {...common}><path d="M8 4h8v4a4 4 0 0 1-8 0zM10 15h4M12 12v3M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M8 20h8M9 20v-2h6v2" /></svg>
  }
}

const PANEL_CSS = `
.icpc-workbench {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
}
.icpc-workbench__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 14px 14px 64px;
  scrollbar-gutter: stable;
}
.icpc-workbench__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.icpc-workbench__mark {
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  place-items: center;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 8px;
}
.icpc-workbench h2,
.icpc-workbench h3,
.icpc-workbench p {
  margin: 0;
}
.icpc-workbench h2 {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
}
.icpc-workbench__header p {
  margin-top: 2px;
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
}
.icpc-workbench__groups {
  display: grid;
  gap: 18px;
}
.icpc-workbench__group h3 {
  margin: 0 0 7px;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
}
.icpc-workbench__items {
  display: grid;
  gap: 4px;
}
.icpc-workbench__item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 7px 8px;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
.icpc-workbench__item:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l4);
}
.icpc-workbench__item:disabled {
  cursor: default;
  opacity: .6;
}
.icpc-workbench__icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: var(--dsw-alias-label-secondary);
}
.icpc-workbench__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.icpc-workbench__label,
.icpc-workbench__description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icpc-workbench__label {
  font-size: 13px;
  line-height: 1.35;
}
.icpc-workbench__dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 5px;
  border-radius: 50%;
  background: #ef4444;
  vertical-align: middle;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.18);
}
.icpc-workbench__description {
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 1.35;
}
.icpc-workbench__status {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  text-align: center;
}
.icpc-workbench__error {
  margin-bottom: 12px;
  padding: 8px 10px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-interactive-bg-hover));
  border: 1px solid var(--dsw-alias-border-l4);
  border-radius: 8px;
  font-size: 12px;
}
.icpc-header-action {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.icpc-header-action:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
`
