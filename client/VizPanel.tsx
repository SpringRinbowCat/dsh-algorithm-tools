import { useEffect, useState, type ReactNode } from 'react'

export interface DayCell {
  date: string
  ac: number
  submissions: number
  tasks: number
  checked: number
  trainingTotal: number
  trainingDone: number
  done: boolean
}

export interface Overview {
  ok: true
  today: {
    date: string
    ac: number
    submissions: number
    tasks: { total: number; checked: number }
    training: {
      total: number
      completed: number
      started: boolean
      done: boolean
      remaining: Array<{ problemKey: string; url: string | null }>
    }
    planTasks: {
      total: number
      completed: number
      remaining: Array<{ problemKey: string; url: string | null }>
    }
    done: boolean
    advice: { kind: 'catchup' | 'extra'; title: string; items: string[] }
  }
  streak: { current: number; longest: number; totalDays: number }
  days: DayCell[]
}

export interface Stats {
  totals: { attempts: number; ac: number; acRate: number; solvedProblems: number; touched: number }
  byDifficulty: Array<{ bucket: string; attempts: number; ac: number; acRate: number }>
  platforms: Array<{ platform: string; attempts: number; ac: number; acRate: number; solved: number }>
  weakTags: Array<{ tag: string; attempts: number; acRate: number; gap: number }>
}

export interface ContestItem {
  id: string
  name: string
  startTimeIso: string | null
  durationMinutes: number
  phase: string
  url: string
}

export interface PlanSnapshot {
  plan: { id: number; title: string; goal: string; startDate: string; endDate: string } | null
  currentWeek: { index: number; direction: string; tags: string[] } | null
  weeks: Array<{ index: number; startDate: string; direction: string; tags: string[]; total: number; checked: number; done: boolean }>
  today: { total: number; checked: number } | null
  progress: { checked: number; total: number } | null
  daysLeft: number | null
}

const VIEWS = ['日历', '数据概览', '赛事', '计划'] as const

function levelOf(cell: DayCell): 0 | 1 | 2 | 3 {
  if (cell.done && cell.tasks > 0) return 3
  if (cell.ac >= 3) return 3
  if (cell.ac >= 1) return 2
  if (cell.submissions > 0) return 1
  return 0
}

export interface VizPanelProps {
  overview: Overview | null
  stats: Stats | null
  contests: ContestItem[] | null
  plan: PlanSnapshot | null
  error?: string | null
}

export function VizPanel({ overview, stats, contests, plan, error = null }: VizPanelProps): ReactNode {
  const [view, setView] = useState(0)

  return (
    <section className="icpc-viz">
      <style>{CSS}</style>
      <div className="icpc-viz__bar">
        <button
          type="button"
          className="icpc-viz__arrow"
          aria-label="上一个视图"
          onClick={() => setView((v) => (v + VIEWS.length - 1) % VIEWS.length)}
        >
          ‹
        </button>
        <div className="icpc-viz__title">
          <span>{VIEWS[view]}</span>
          <i className="icpc-viz__dots">
            {VIEWS.map((name, i) => (
              <b key={name} className={i === view ? 'on' : ''} />
            ))}
          </i>
        </div>
        <button
          type="button"
          className="icpc-viz__arrow"
          aria-label="下一个视图"
          onClick={() => setView((v) => (v + 1) % VIEWS.length)}
        >
          ›
        </button>
      </div>

      {error ? <div className="icpc-viz__error" role="alert">{error}</div> : null}
      {!overview || !stats ? <div className="icpc-viz__loading">加载中…</div> : null}

      {view === 0 && overview ? <CalendarView data={overview} /> : null}
      {view === 1 && stats ? <StatsView data={stats} /> : null}
      {view === 2 ? <ContestsView data={contests} /> : null}
      {view === 3 ? <PlanView data={plan} /> : null}
    </section>
  )
}

function PlanView({ data }: { data: PlanSnapshot | null }): ReactNode {
  if (!data) return <div className="icpc-viz__loading">加载计划…</div>
  if (!data.plan) {
    return <div className="icpc-viz__muted">还没有训练计划：点「训练计划」生成一份（每周一个方向）</div>
  }
  const p = data.plan
  const pct = data.progress && data.progress.total > 0
    ? Math.round((data.progress.checked / data.progress.total) * 100)
    : 0
  return (
    <>
      <div className="icpc-viz__state">{p.title}</div>
      <div className="icpc-viz__meta">
        {p.startDate} → {p.endDate} · 剩余 {data.daysLeft ?? 0} 天 · 今日任务 {data.today?.checked ?? 0}/{data.today?.total ?? 0}
      </div>

      <div className="icpc-viz__focus">
        {data.currentWeek
          ? <>本周方向：<b>{data.currentWeek.direction}</b></>
          : '本周方向：未设置（旧计划没有周方向）'}
      </div>

      <div className="icpc-viz__pbar"><b style={{ width: `${pct}%` }} /></div>
      <div className="icpc-viz__legend">
        <span>计划进度 {data.progress?.checked ?? 0}/{data.progress?.total ?? 0}</span>
        <span className="icpc-viz__total">{pct}%</span>
      </div>

      <div className="icpc-viz__weeks">
        {data.weeks.map((w) => (
          <span key={w.index} className={`icpc-viz__weekchip${w.done ? ' is-done' : ''}`} title={`第 ${w.index} 周 · ${w.direction}`}>
            W{w.index} {w.checked}/{w.total}
          </span>
        ))}
      </div>
    </>
  )
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 倒计时统一精确到秒：≥1 天用「N 天 HH:MM:SS」，否则 HH:MM:SS / MM:SS */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '已开始'
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d} 天 ${pad2(h)}:${pad2(m)}:${pad2(s)}`
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
  return `${pad2(m)}:${pad2(s)}`
}

function ContestsView({ data }: { data: ContestItem[] | null }): ReactNode {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!data) return <div className="icpc-viz__loading">加载赛事…</div>
  if (data.length === 0) return <div className="icpc-viz__muted">近期没有 Codeforces 赛事</div>
  return (
    <>
      <div className="icpc-viz__section">Codeforces 近期赛事</div>
      <ul className="icpc-viz__contests">
        {data.map((c) => {
          const startMs = c.startTimeIso ? new Date(c.startTimeIso).getTime() : null
          const endMs = startMs === null ? null : startMs + c.durationMinutes * 60_000
          const running = startMs !== null && endMs !== null && now >= startMs && now < endMs
          const soon = startMs !== null && now < startMs && startMs - now < 60 * 60 * 1000
          const when = startMs === null
            ? '时间待定'
            : new Date(startMs).toLocaleString('zh-CN', {
              month: '2-digit', day: '2-digit', weekday: 'short',
              hour: '2-digit', minute: '2-digit', hour12: false,
            })
          const countdown = running && endMs !== null
            ? `进行中 · 还剩 ${formatCountdown(endMs - now)}`
            : startMs === null
              ? '—'
              : formatCountdown(startMs - now)
          return (
            <li key={c.id}>
              <span className="icpc-viz__ctime">{when}</span>
              <a href={c.url} target="_blank" rel="noreferrer" className="icpc-viz__cname" title={c.name}>{c.name}</a>
              <span className={`icpc-viz__count ${running ? 'is-live' : soon ? 'is-soon' : ''}`}>{countdown}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function CalendarView({ data }: { data: Overview }): ReactNode {
  const t = data.today
  const weeks: DayCell[][] = []
  for (let i = 0; i < data.days.length; i += 7) weeks.push(data.days.slice(i, i + 7))
  return (
    <>
      <div className="icpc-viz__head">
        <div>
          <div className="icpc-viz__state">
            {t.done
              ? '今日训练已完成'
              : t.training.total === 0 && t.planTasks.total === 0
                ? '今日未开始'
                : '今日训练未完成'}
          </div>
          <div className="icpc-viz__meta">
            训练 {t.training.completed}/{t.training.total}
            {t.planTasks.total > 0 ? ` + 计划 ${t.planTasks.completed}/${t.planTasks.total}` : ''}
            {' · '}今日累计 AC {t.ac} 题 · 累计提交 {t.submissions} 次
          </div>
        </div>
        <div className="icpc-viz__streak">
          <span className="icpc-viz__num">{data.streak.current}</span>
          <span className="icpc-viz__unit">连续天</span>
        </div>
      </div>

      <div className={`icpc-viz__advice icpc-viz__advice--${t.advice.kind}`}>
        <strong>{t.advice.title}</strong>
        <ul>{t.advice.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
        {(t.planTasks.remaining.length > 0 || t.training.remaining.length > 0) ? (
          <div className="icpc-viz__left">
            {t.planTasks.remaining.map((r) => (r.url
              ? <a key={`p-${r.problemKey}`} href={r.url} target="_blank" rel="noreferrer" title={`打开 ${r.problemKey}`}>{r.problemKey}</a>
              : <span key={`p-${r.problemKey}`}>{r.problemKey}</span>))}
            {t.planTasks.remaining.length > 0 && t.training.remaining.length > 0
              ? <i className="icpc-viz__sep" aria-hidden="true" />
              : null}
            {t.training.remaining.map((r) => (r.url
              ? <a key={r.problemKey} href={r.url} target="_blank" rel="noreferrer" title={`打开 ${r.problemKey}`}>{r.problemKey}</a>
              : <span key={r.problemKey}>{r.problemKey}</span>))}
          </div>
        ) : null}
      </div>

      <div className="icpc-viz__grid" title="最近 12 周：颜色越深 = 当天 AC 越多或计划已完成">
        {weeks.map((week, wi) => (
          <div className="icpc-viz__week" key={wi}>
            {week.map((cell) => (
              <div
                key={cell.date}
                className={`icpc-viz__cell icpc-viz__cell--${levelOf(cell)}`}
                title={`${cell.date} · AC ${cell.ac} · 提交 ${cell.submissions}${cell.trainingTotal > 0 ? ` · 训练 ${cell.trainingDone}/${cell.trainingTotal}` : ''}${cell.tasks > 0 ? ` · 任务 ${cell.checked}/${cell.tasks}` : ''}`}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="icpc-viz__legend">
        <span>少</span>
        <i className="icpc-viz__swatch icpc-viz__cell--0" />
        <i className="icpc-viz__swatch icpc-viz__cell--1" />
        <i className="icpc-viz__swatch icpc-viz__cell--2" />
        <i className="icpc-viz__swatch icpc-viz__cell--3" />
        <span>多</span>
        <span className="icpc-viz__total">累计 {data.streak.totalDays} 天有 AC · 最长 {data.streak.longest} 天</span>
      </div>
    </>
  )
}

function StatsView({ data }: { data: Stats }): ReactNode {
  const t = data.totals
  const items = data.byDifficulty.filter((d) => d.attempts > 0)
  const total = items.reduce((sum, d) => sum + d.attempts, 0) || 1
  const palette = ['#4ade80', '#60a5fa', '#f59e0b', '#f87171', '#a78bfa', '#f472b6', '#22d3ee', '#facc15']
  const R = 38
  const C = 2 * Math.PI * R
  let offset = 0
  const segs = items.map((d, i) => {
    const pct = (d.attempts / total) * 100
    const seg = { ...d, pct, color: palette[i % palette.length], offset }
    offset += (pct / 100) * C
    return seg
  })

  return (
    <>
      <div className="icpc-viz__numbers">
        <div><b>{t.ac}</b><span>AC</span></div>
        <div><b>{t.attempts}</b><span>提交</span></div>
        <div><b>{t.acRate}%</b><span>AC 率</span></div>
        <div><b>{t.solvedProblems}</b><span>已解决</span></div>
      </div>

      <div className="icpc-viz__section">难度分布（按提交量）</div>
      <div className="icpc-viz__donutwrap">
        <svg className="icpc-viz__donut" viewBox="0 0 100 100" role="img" aria-label="难度分布扇形图">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--dsw-alias-interactive-bg-hover)" strokeWidth="13" />
          {segs.map((s) => (
            <circle
              key={s.bucket}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="13"
              strokeDasharray={`${(s.pct / 100) * C} ${C}`}
              strokeDashoffset={-s.offset}
              transform="rotate(-90 50 50)"
            />
          ))}
          <text x="50" y="49" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor">{total}</text>
          <text x="50" y="61" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.6">次提交</text>
        </svg>
        <div className="icpc-viz__lglist">
          {segs.map((s) => (
            <div className="icpc-viz__lg" key={s.bucket} title={`${s.attempts} 次提交 · ${s.ac} 次 AC`}>
              <i style={{ background: s.color }} />
              <span className="icpc-viz__lgname">{s.bucket}</span>
              <span className="icpc-viz__lgval">{Math.round(s.pct)}%</span>
              <span className="icpc-viz__lgac">{s.acRate}% AC</span>
            </div>
          ))}
        </div>
      </div>

      <div className="icpc-viz__section">弱项（gap 越大越弱，相对你的平均 AC 率）</div>
      <div className="icpc-viz__tags">
        {data.weakTags.length === 0
          ? <span className="icpc-viz__muted">样本还不够，多提交一些再看</span>
          : data.weakTags.map((w) => (
            <span className="icpc-viz__tag" key={w.tag} title={`${w.attempts} 次尝试 · AC 率 ${w.acRate}%`}>
              {w.tag}<i>{w.gap.toFixed(1)}</i>
            </span>
          ))}
      </div>
    </>
  )
}

const CSS = `
.icpc-viz { padding: 8px 4px 14px; border-bottom: 1px solid var(--dsw-alias-border-l4); margin-bottom: 12px; }
.icpc-viz__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.icpc-viz__title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.icpc-viz__dots { display: flex; gap: 4px; }
.icpc-viz__dots b { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-interactive-bg-hover); }
.icpc-viz__dots b.on { background: var(--dsw-alias-label-secondary); }
.icpc-viz__arrow { width: 24px; height: 24px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 14px; line-height: 1; }
.icpc-viz__arrow:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.icpc-viz__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-top: 12px; }
.icpc-viz__state { font-size: 13px; font-weight: 600; }
.icpc-viz__meta { margin-top: 3px; font-size: 11px; color: var(--dsw-alias-label-caption); }
.icpc-viz__streak { text-align: right; line-height: 1.1; }
.icpc-viz__num { display: block; font-size: 20px; font-weight: 700; }
.icpc-viz__unit { font-size: 10px; color: var(--dsw-alias-label-caption); }
.icpc-viz__advice { margin-top: 10px; padding: 8px 10px; font-size: 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-interactive-bg-hover)); border: 1px solid var(--dsw-alias-border-l4); }
.icpc-viz__advice--catchup { border-color: #d97706; }
.icpc-viz__advice--extra { border-color: #16a34a; }
.icpc-viz__advice ul { margin: 6px 0 0; padding-left: 16px; color: var(--dsw-alias-label-secondary); }
.icpc-viz__left { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.icpc-viz__left a, .icpc-viz__left span { font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l4); text-decoration: none; color: var(--dsw-alias-label-primary); }
.icpc-viz__left a:hover { background: var(--dsw-alias-interactive-bg-hover); text-decoration: underline; }
.icpc-viz__left span { opacity: 0.6; }
.icpc-viz__sep { width: 1px; height: 12px; background: var(--dsw-alias-border-l4); align-self: center; margin: 0 2px; }
.icpc-viz__grid { display: flex; gap: 3px; margin-top: 12px; overflow-x: auto; }
.icpc-viz__week { display: grid; grid-template-rows: repeat(7, 10px); gap: 3px; }
.icpc-viz__cell { width: 10px; height: 10px; border-radius: 2px; background: var(--dsw-alias-interactive-bg-hover); }
.icpc-viz__cell--0 { background: var(--dsw-alias-interactive-bg-hover); }
.icpc-viz__cell--1 { background: #bbf7d0; }
.icpc-viz__cell--2 { background: #4ade80; }
.icpc-viz__cell--3 { background: #15803d; }
.icpc-viz__legend { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 10px; color: var(--dsw-alias-label-caption); }
.icpc-viz__swatch { width: 10px; height: 10px; border-radius: 2px; }
.icpc-viz__total { margin-left: auto; }
.icpc-viz__numbers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 12px; }
.icpc-viz__numbers div { padding: 8px 6px; text-align: center; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-interactive-bg-hover)); }
.icpc-viz__numbers b { display: block; font-size: 16px; }
.icpc-viz__numbers span { font-size: 10px; color: var(--dsw-alias-label-caption); }
.icpc-viz__section { margin-top: 12px; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-caption); }
.icpc-viz__donutwrap { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.icpc-viz__donut { width: 96px; height: 96px; flex: none; color: var(--dsw-alias-label-primary); }
.icpc-viz__lglist { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.icpc-viz__lg { display: grid; grid-template-columns: 8px 1fr auto auto; align-items: center; gap: 5px; font-size: 10px; }
.icpc-viz__lg i { width: 8px; height: 8px; border-radius: 2px; }
.icpc-viz__lgname { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icpc-viz__lgval { color: var(--dsw-alias-label-primary); }
.icpc-viz__lgac { color: var(--dsw-alias-label-caption); }
.icpc-viz__tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.icpc-viz__tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; font-size: 10px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-interactive-bg-hover)); border: 1px solid var(--dsw-alias-border-l4); }
.icpc-viz__tag i { font-style: normal; color: #d97706; }
.icpc-viz__muted { font-size: 11px; color: var(--dsw-alias-label-caption); }
.icpc-viz__contests { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.icpc-viz__contests li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 11px; }
.icpc-viz__count { white-space: nowrap; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.icpc-viz__count.is-soon { color: #d97706; }
.icpc-viz__count.is-live { color: #16a34a; font-weight: 600; }
.icpc-viz__cname { color: var(--dsw-alias-label-primary); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icpc-viz__cname:hover { text-decoration: underline; }
.icpc-viz__ctime { color: var(--dsw-alias-label-caption); white-space: nowrap; }
.icpc-viz__focus { margin-top: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.icpc-viz__focus b { color: var(--dsw-alias-label-primary); }
.icpc-viz__pbar { height: 8px; margin-top: 8px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
.icpc-viz__pbar b { display: block; height: 100%; background: #4ade80; }
.icpc-viz__weeks { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
.icpc-viz__weekchip { font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l4); color: var(--dsw-alias-label-secondary); }
.icpc-viz__weekchip.is-done { color: #15803d; border-color: #86efac; }
.icpc-viz__loading, .icpc-viz__error { padding: 10px 4px; font-size: 12px; color: var(--dsw-alias-label-caption); }
`
