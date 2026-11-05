window.__ModuleLoader__.load({ id: "dsh-algorithm-tools", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react3 = require("react");

// client/betterSidebar.ts
var BETTER_SIDEBAR_TAB_ID = "dsh-algo-trainer:workbench";
function createBetterSidebarDescriptor(component, icon) {
  return {
    id: BETTER_SIDEBAR_TAB_ID,
    title: () => "Algorithm Practice Space",
    description: () => "\u8BAD\u7EC3\u5DE5\u4F5C\u53F0",
    icon,
    order: 60,
    single: true,
    component
  };
}
function openBetterSidebarTab(service, sessionId) {
  service.openTab({ type: BETTER_SIDEBAR_TAB_ID }, { sessionId });
}
function createConversationInputActions(ctx, sessionId) {
  const conversation = ctx.get?.("conversation");
  const sessions = ctx.get?.("sessions");
  const actx = sessions?.scope?.(sessionId);
  if (!conversation || !actx) return void 0;
  return {
    setDraft(text) {
      conversation.input.for(actx).setDraft(text);
    },
    submit() {
      const click = () => {
        if (typeof document === "undefined") return;
        const labels = ["\u53D1\u9001\u6D88\u606F", "Send message"];
        const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
          const label = candidate.getAttribute("aria-label") ?? candidate.getAttribute("title") ?? "";
          return labels.includes(label.trim());
        });
        if (button instanceof HTMLButtonElement && !button.disabled) button.click();
      };
      setTimeout(click, 0);
    }
  };
}

// client/WorkbenchPanel.tsx
var import_react2 = require("react");

// client/api.ts
async function activateWorkbench(sessionId) {
  const response = await fetch("/icpc-workbench/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok !== true) {
    const failure = body;
    throw new Error(failure?.message ?? failure?.error ?? `activation failed (${response.status})`);
  }
  return body;
}

// client/VizPanel.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var VIEWS = ["\u65E5\u5386", "\u6570\u636E\u6982\u89C8", "\u8D5B\u4E8B", "\u8BA1\u5212"];
function levelOf(cell) {
  if (cell.done && cell.tasks > 0) return 3;
  if (cell.ac >= 3) return 3;
  if (cell.ac >= 1) return 2;
  if (cell.submissions > 0) return 1;
  return 0;
}
function VizPanel({ overview, stats, contests, plan, error = null, onExtraTraining }) {
  const [view, setView] = (0, import_react.useState)(0);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "icpc-viz", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "icpc-viz__arrow",
          "aria-label": "\u4E0A\u4E00\u4E2A\u89C6\u56FE",
          onClick: () => setView((v) => (v + VIEWS.length - 1) % VIEWS.length),
          children: "\u2039"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: VIEWS[view] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "icpc-viz__dots", children: VIEWS.map((name2, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { className: i === view ? "on" : "" }, name2)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "icpc-viz__arrow",
          "aria-label": "\u4E0B\u4E00\u4E2A\u89C6\u56FE",
          onClick: () => setView((v) => (v + 1) % VIEWS.length),
          children: "\u203A"
        }
      )
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__error", role: "alert", children: error }) : null,
    !overview || !stats ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__loading", children: "\u52A0\u8F7D\u4E2D\u2026" }) : null,
    view === 0 && overview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarView, { data: overview, onExtraTraining }) : null,
    view === 1 && stats ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatsView, { data: stats }) : null,
    view === 2 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ContestsView, { data: contests }) : null,
    view === 3 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PlanView, { data: plan }) : null
  ] });
}
function PlanView({ data }) {
  if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__loading", children: "\u52A0\u8F7D\u8BA1\u5212\u2026" });
  if (!data.plan) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__muted", children: "\u8FD8\u6CA1\u6709\u8BAD\u7EC3\u8BA1\u5212\uFF1A\u70B9\u300C\u8BAD\u7EC3\u8BA1\u5212\u300D\u751F\u6210\u4E00\u4EFD\uFF08\u6BCF\u5468\u4E00\u4E2A\u65B9\u5411\uFF09" });
  }
  const p = data.plan;
  const pct = data.progress && data.progress.total > 0 ? Math.round(data.progress.checked / data.progress.total * 100) : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__state", children: p.title }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__meta", children: [
      p.startDate,
      " \u2192 ",
      p.endDate,
      " \xB7 \u5269\u4F59 ",
      data.daysLeft ?? 0,
      " \u5929 \xB7 \u4ECA\u65E5\u4EFB\u52A1 ",
      data.today?.checked ?? 0,
      "/",
      data.today?.total ?? 0
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__focus", children: data.currentWeek ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      "\u672C\u5468\u65B9\u5411\uFF1A",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: data.currentWeek.direction })
    ] }) : "\u672C\u5468\u65B9\u5411\uFF1A\u672A\u8BBE\u7F6E\uFF08\u65E7\u8BA1\u5212\u6CA1\u6709\u5468\u65B9\u5411\uFF09" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__pbar", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { style: { width: `${pct}%` } }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__legend", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        "\u8BA1\u5212\u8FDB\u5EA6 ",
        data.progress?.checked ?? 0,
        "/",
        data.progress?.total ?? 0
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "icpc-viz__total", children: [
        pct,
        "%"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__weeks", children: data.weeks.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `icpc-viz__weekchip${w.done ? " is-done" : ""}`, title: `\u7B2C ${w.index} \u5468 \xB7 ${w.direction}`, children: [
      "W",
      w.index,
      " ",
      w.checked,
      "/",
      w.total
    ] }, w.index)) })
  ] });
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatCountdown(ms) {
  if (ms <= 0) return "\u5DF2\u5F00\u59CB";
  const totalSec = Math.floor(ms / 1e3);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor(totalSec % 86400 / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d} \u5929 ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}
function ContestsView({ data }) {
  const [now, setNow] = (0, import_react.useState)(() => Date.now());
  (0, import_react.useEffect)(() => {
    const timer = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(timer);
  }, []);
  if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__loading", children: "\u52A0\u8F7D\u8D5B\u4E8B\u2026" });
  if (data.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__muted", children: "\u8FD1\u671F\u6CA1\u6709 Codeforces \u8D5B\u4E8B" });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__section", children: "Codeforces \u8FD1\u671F\u8D5B\u4E8B" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "icpc-viz__contests", children: data.map((c) => {
      const startMs = c.startTimeIso ? new Date(c.startTimeIso).getTime() : null;
      const endMs = startMs === null ? null : startMs + c.durationMinutes * 6e4;
      const running = startMs !== null && endMs !== null && now >= startMs && now < endMs;
      const soon = startMs !== null && now < startMs && startMs - now < 60 * 60 * 1e3;
      const when = startMs === null ? "\u65F6\u95F4\u5F85\u5B9A" : new Date(startMs).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const countdown = running && endMs !== null ? `\u8FDB\u884C\u4E2D \xB7 \u8FD8\u5269 ${formatCountdown(endMs - now)}` : startMs === null ? "\u2014" : formatCountdown(startMs - now);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "icpc-viz__ctime", children: when }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: c.url, target: "_blank", rel: "noreferrer", className: "icpc-viz__cname", title: c.name, children: c.name }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `icpc-viz__count ${running ? "is-live" : soon ? "is-soon" : ""}`, children: countdown })
      ] }, c.id);
    }) })
  ] });
}
function CalendarView({ data, onExtraTraining }) {
  const t = data.today;
  const weeks = [];
  for (let i = 0; i < data.days.length; i += 7) weeks.push(data.days.slice(i, i + 7));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__state", children: t.done ? "\u4ECA\u65E5\u8BAD\u7EC3\u5DF2\u5B8C\u6210" : t.training.total === 0 && t.planTasks.total === 0 ? "\u4ECA\u65E5\u672A\u5F00\u59CB" : "\u4ECA\u65E5\u8BAD\u7EC3\u672A\u5B8C\u6210" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__meta", children: [
          "\u8BAD\u7EC3 ",
          t.training.completed,
          "/",
          t.training.total,
          t.planTasks.total > 0 ? ` + \u8BA1\u5212 ${t.planTasks.completed}/${t.planTasks.total}` : "",
          " \xB7 ",
          "\u4ECA\u65E5\u7D2F\u8BA1 AC ",
          t.ac,
          " \u9898 \xB7 \u7D2F\u8BA1\u63D0\u4EA4 ",
          t.submissions,
          " \u6B21"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__streak", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "icpc-viz__num", children: data.streak.current }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "icpc-viz__unit", children: "\u8FDE\u7EED\u5929" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `icpc-viz__advice icpc-viz__advice--${t.advice.kind}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__advice-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t.advice.title }),
        t.done && onExtraTraining ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "icpc-viz__extra", onClick: onExtraTraining, children: "\u52A0\u8BAD" }) : null
      ] }),
      t.advice.items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: t.advice.items.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: item }, i)) }) : null,
      t.planTasks.remaining.length > 0 || t.training.remaining.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__left", children: [
        t.training.remaining.map((r) => r.url ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: r.url, target: "_blank", rel: "noreferrer", title: `\u6253\u5F00 ${r.problemKey}`, children: r.problemKey }, r.problemKey) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: r.problemKey }, r.problemKey)),
        t.planTasks.remaining.length > 0 && t.training.remaining.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "icpc-viz__sep", "aria-hidden": "true" }) : null,
        t.planTasks.remaining.map((r) => r.url ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: r.url, target: "_blank", rel: "noreferrer", title: `\u6253\u5F00 ${r.problemKey}`, children: r.problemKey }, `p-${r.problemKey}`) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: r.problemKey }, `p-${r.problemKey}`))
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__grid", title: "\u6700\u8FD1 12 \u5468\uFF1A\u989C\u8272\u8D8A\u6DF1 = \u5F53\u5929 AC \u8D8A\u591A\u6216\u8BA1\u5212\u5DF2\u5B8C\u6210", children: weeks.map((week, wi) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__week", children: week.map((cell) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "div",
      {
        className: `icpc-viz__cell icpc-viz__cell--${levelOf(cell)}`,
        title: `${cell.date} \xB7 AC ${cell.ac} \xB7 \u63D0\u4EA4 ${cell.submissions}${cell.trainingTotal > 0 ? ` \xB7 \u8BAD\u7EC3 ${cell.trainingDone}/${cell.trainingTotal}` : ""}${cell.tasks > 0 ? ` \xB7 \u4EFB\u52A1 ${cell.checked}/${cell.tasks}` : ""}`
      },
      cell.date
    )) }, wi)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__legend", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5C11" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "icpc-viz__swatch icpc-viz__cell--0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "icpc-viz__swatch icpc-viz__cell--1" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "icpc-viz__swatch icpc-viz__cell--2" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "icpc-viz__swatch icpc-viz__cell--3" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u591A" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "icpc-viz__total", children: [
        "\u7D2F\u8BA1 ",
        data.streak.totalDays,
        " \u5929\u6709 AC \xB7 \u6700\u957F ",
        data.streak.longest,
        " \u5929"
      ] })
    ] })
  ] });
}
function StatsView({ data }) {
  const t = data.totals;
  const items = data.byDifficulty.filter((d) => d.attempts > 0);
  const total = items.reduce((sum, d) => sum + d.attempts, 0) || 1;
  const palette = ["#4ade80", "#60a5fa", "#f59e0b", "#f87171", "#a78bfa", "#f472b6", "#22d3ee", "#facc15"];
  const R = 38;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const segs = items.map((d, i) => {
    const pct = d.attempts / total * 100;
    const seg = { ...d, pct, color: palette[i % palette.length], offset };
    offset += pct / 100 * C;
    return seg;
  });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__numbers", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: t.ac }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "AC" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: t.attempts }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u63D0\u4EA4" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
          t.acRate,
          "%"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "AC \u7387" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: t.solvedProblems }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5DF2\u89E3\u51B3" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__section", children: "\u96BE\u5EA6\u5206\u5E03\uFF08\u6309\u63D0\u4EA4\u91CF\uFF09" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__donutwrap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className: "icpc-viz__donut", viewBox: "0 0 100 100", role: "img", "aria-label": "\u96BE\u5EA6\u5206\u5E03\u6247\u5F62\u56FE", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "50", cy: "50", r: R, fill: "none", stroke: "var(--dsw-alias-interactive-bg-hover)", strokeWidth: "13" }),
        segs.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "circle",
          {
            cx: "50",
            cy: "50",
            r: R,
            fill: "none",
            stroke: s.color,
            strokeWidth: "13",
            strokeDasharray: `${s.pct / 100 * C} ${C}`,
            strokeDashoffset: -s.offset,
            transform: "rotate(-90 50 50)"
          },
          s.bucket
        )),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", { x: "50", y: "49", textAnchor: "middle", fontSize: "15", fontWeight: "700", fill: "currentColor", children: total }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", { x: "50", y: "61", textAnchor: "middle", fontSize: "7", fill: "currentColor", opacity: "0.6", children: "\u6B21\u63D0\u4EA4" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__lglist", children: segs.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "icpc-viz__lg", title: `${s.attempts} \u6B21\u63D0\u4EA4 \xB7 ${s.ac} \u6B21 AC`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { background: s.color } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "icpc-viz__lgname", children: s.bucket }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "icpc-viz__lgval", children: [
          Math.round(s.pct),
          "%"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "icpc-viz__lgac", children: [
          s.acRate,
          "% AC"
        ] })
      ] }, s.bucket)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__section", children: "\u5F31\u9879\uFF08gap \u8D8A\u5927\u8D8A\u5F31\uFF0C\u76F8\u5BF9\u4F60\u7684\u5E73\u5747 AC \u7387\uFF09" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "icpc-viz__tags", children: data.weakTags.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "icpc-viz__muted", children: "\u6837\u672C\u8FD8\u4E0D\u591F\uFF0C\u591A\u63D0\u4EA4\u4E00\u4E9B\u518D\u770B" }) : data.weakTags.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "icpc-viz__tag", title: `${w.attempts} \u6B21\u5C1D\u8BD5 \xB7 AC \u7387 ${w.acRate}%`, children: [
      w.tag,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: w.gap.toFixed(1) })
    ] }, w.tag)) })
  ] });
}
var CSS = `
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
.icpc-viz__advice-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.icpc-viz__extra { padding: 4px 12px; font-size: 12px; border-radius: 6px; cursor: pointer; border: 1px solid #16a34a; background: transparent; color: inherit; }
.icpc-viz__extra:hover { background: rgba(22, 163, 74, 0.12); }
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
`;

// client/features.ts
var FEATURE_GROUPS = [
  { id: "training", label: "\u8BAD\u7EC3" }
];
var WORKBENCH_FEATURES = [
  {
    id: "assistant",
    group: "training",
    label: "AI \u52A9\u624B",
    description: "\u4F7F\u7528\u5F53\u524D Harness \u5BF9\u8BDD",
    icon: "assistant"
  },
  {
    id: "today",
    group: "training",
    label: "\u4ECA\u65E5\u8BAD\u7EC3",
    description: "\u5DE9\u56FA\u3001\u540C\u6BB5\u4E0E\u6311\u6218\u9898",
    icon: "today",
    prompt: "\u8BF7\u8C03\u7528 icpc_today \u5DE5\u5177\uFF0C\u7ED9\u6211\u4ECA\u5929\u7684\u4E09\u6863\u8BAD\u7EC3\u63A8\u8350\u5E76\u8BF4\u660E\u9009\u9898\u7406\u7531\u3002"
  },
  {
    id: "plans",
    group: "training",
    label: "\u8BAD\u7EC3\u8BA1\u5212",
    description: "\u67E5\u770B\u3001\u751F\u6210\u4E0E\u6253\u5361",
    icon: "plans",
    prompt: "\u8BF7\u8C03\u7528 icpc_manage_plan \u5DE5\u5177\u5217\u51FA\u6211\u7684\u8BAD\u7EC3\u8BA1\u5212\uFF1B\u5982\u679C\u6CA1\u6709\u8BA1\u5212\uFF0C\u518D\u8BE2\u95EE\u6211\u8BA1\u5212\u5929\u6570\u5E76\u51C6\u5907\u751F\u6210\u3002"
  },
  {
    id: "reviews",
    group: "training",
    label: "rank \u590D\u76D8",
    description: "\u8FD1\u671F\u6BD4\u8D5B\u590D\u76D8\u4E0E\u8584\u5F31\u9879",
    icon: "reviews",
    prompt: "\u8BF7\u8C03\u7528 icpc_review \u5DE5\u5177\uFF08action=contests\uFF09\u5217\u51FA\u6211\u8FD1\u671F\u53C2\u4E0E\u7684\u6BD4\u8D5B\u5E76\u590D\u76D8\uFF1A\u6BCF\u9898\u7528\u65F6\u3001\u672A\u901A\u8FC7\u539F\u56E0\u3001\u4EE3\u7801\u4F18\u5316\u70B9\u3001\u66B4\u9732\u7684\u8584\u5F31\u9879\u3002"
  },
  {
    id: "extra",
    group: "training",
    label: "\u52A0\u8BAD",
    description: "\u4ECA\u65E5\u8BAD\u7EC3\u5B8C\u6210\uFF0C\u518D\u6362\u4E00\u6279\u6311\u6218\u9898",
    icon: "today",
    hidden: true,
    prompt: "\u4ECA\u5929\u7684\u4E09\u6863\u8BAD\u7EC3\u5DF2\u7ECF\u5B8C\u6210\uFF0C\u8BF7\u8C03\u7528 icpc_today\uFF08\u5E26 rotate \u6362\u4E00\u6279\uFF09\u7ED9\u6211 1-2 \u9053\u6311\u6218\u533A\u7684\u52A0\u7EC3\u9898\uFF0C\u5E76\u8BF4\u660E\u9009\u9898\u7406\u7531\u3002"
  }
];
function featurePrompt(id) {
  const feature = WORKBENCH_FEATURES.find((item) => item.id === id);
  if (!feature?.prompt) throw new Error(`feature ${id} has no prompt`);
  return feature.prompt;
}

// client/WorkbenchPanel.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function WorkbenchPanel({
  sessionId,
  inputActions,
  collapseSidebar
}) {
  const [busy, setBusy] = (0, import_react2.useState)(null);
  const [error, setError] = (0, import_react2.useState)(null);
  const [overview, setOverview] = (0, import_react2.useState)(null);
  const [stats, setStats] = (0, import_react2.useState)(null);
  const [vizError, setVizError] = (0, import_react2.useState)(null);
  const [contests, setContests] = (0, import_react2.useState)(null);
  const [plan, setPlan] = (0, import_react2.useState)(null);
  const lastKickRef = (0, import_react2.useRef)(0);
  const loadRef = (0, import_react2.useRef)(() => {
  });
  (0, import_react2.useEffect)(() => {
    let alive = true;
    const load = () => {
      Promise.all([
        fetch("/icpc-workbench/overview?days=84").then((r) => r.json()),
        fetch("/icpc-workbench/stats").then((r) => r.json()),
        fetch("/icpc-workbench/contests").then((r) => r.json()),
        fetch("/icpc-workbench/plan").then((r) => r.json())
      ]).then(([o, s, c, pl]) => {
        if (!alive) return;
        if (o?.ok) {
          setOverview(o);
          setVizError(null);
          const done = o.today?.done === true;
          if (done && Date.now() - lastKickRef.current > 10 * 60 * 1e3) {
            lastKickRef.current = Date.now();
            fetch("/icpc-workbench/sync?force=1", { method: "POST" }).then((r) => r.json()).then(() => {
              if (alive) loadRef.current();
            }).catch(() => {
            });
          }
        } else {
          setVizError(o?.error ?? "\u603B\u89C8\u52A0\u8F7D\u5931\u8D25");
        }
        if (s?.ok) setStats(s.stats);
        if (Array.isArray(c?.contests)) {
          setContests(c.contests);
        }
        if (pl?.ok) {
          setPlan(pl.plan);
        }
      }).catch((e) => {
        if (alive) setVizError(e instanceof Error ? e.message : String(e));
      });
    };
    loadRef.current = load;
    load();
    fetch("/icpc-workbench/sync", { method: "POST" }).then((r) => r.json()).then((res) => {
      if (!alive) return;
      if (res?.ok && res.synced?.some((s) => !s.skipped)) load();
    }).catch(() => {
    });
    const timer = setInterval(load, 6e4);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  const trainingStarted = (overview?.today.training.total ?? 0) > 0;
  const showTodayDot = overview !== null && !trainingStarted;
  async function runFeature(feature) {
    if (!sessionId) {
      setError("\u5F53\u524D\u4F1A\u8BDD\u4E0D\u53EF\u7528");
      return;
    }
    setBusy(feature.id);
    setError(null);
    try {
      await activateWorkbench(sessionId);
      if (feature.id === "assistant") {
        collapseSidebar?.();
        return;
      }
      if (!inputActions) {
        setError("Harness \u8F93\u5165\u6846\u4E0D\u53EF\u7528");
        return;
      }
      inputActions.setDraft(featurePrompt(feature.id));
      queueMicrotask(() => inputActions.submit());
      for (const ms of [1500, 4e3, 8e3, 15e3]) {
        window.setTimeout(() => loadRef.current(), ms);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "icpc-workbench", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: PANEL_CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "icpc-workbench__scroll", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "icpc-workbench__header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "icpc-workbench__mark", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "trophy", size: 16 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: "Algorithm Practice Space" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u8BAD\u7EC3\u5DE5\u4F5C\u53F0 \xB7 v0.1.1" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        VizPanel,
        {
          overview,
          stats,
          contests,
          plan,
          error: vizError,
          onExtraTraining: () => void runFeature(WORKBENCH_FEATURES.find((f) => f.id === "extra"))
        }
      ),
      error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "icpc-workbench__error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "icpc-workbench__groups", children: FEATURE_GROUPS.map((group) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "icpc-workbench__group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: group.label }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "icpc-workbench__items", children: WORKBENCH_FEATURES.filter((feature) => feature.group === group.id && !feature.hidden).map((feature) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "button",
          {
            className: "icpc-workbench__item",
            type: "button",
            disabled: busy !== null || !sessionId || !inputActions && feature.id !== "assistant",
            onClick: () => void runFeature(feature),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "icpc-workbench__icon", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: feature.icon, size: 17 }) }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "icpc-workbench__copy", children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "icpc-workbench__label", children: [
                  feature.label,
                  feature.id === "today" && showTodayDot ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("i", { className: "icpc-workbench__dot", "aria-label": "\u4ECA\u5929\u8FD8\u6CA1\u62BD\u4ECA\u65E5\u8BAD\u7EC3", title: "\u4ECA\u5929\u8FD8\u6CA1\u62BD\u4ECA\u65E5\u8BAD\u7EC3" }) : null
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "icpc-workbench__description", children: feature.description })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "icpc-workbench__status", "aria-hidden": "true", children: busy === feature.id ? "\u2026" : "" })
            ]
          },
          feature.id
        )) })
      ] }, group.id)) })
    ] })
  ] });
}
function HeaderAction({ open }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "button",
    {
      className: "icpc-header-action",
      type: "button",
      title: "\u6253\u5F00 Algorithm Practice Space",
      "aria-label": "\u6253\u5F00 Algorithm Practice Space",
      onClick: open,
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "trophy", size: 16 })
    }
  );
}
function WorkbenchGlyph({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "trophy", size });
}
function Icon({ name: name2, size = 16 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  };
  switch (name2) {
    case "assistant":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "4", y: "7", width: "16", height: "12", rx: "3" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M12 3v4M8 12h.01M16 12h.01M9 16h6" })
      ] });
    case "overview":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { ...common, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M5 20V10M12 20V4M19 20v-7" }) });
    case "today":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "12", cy: "12", r: "8" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M12 4V2M20 12h2M12 20v2M4 12H2" })
      ] });
    case "plans":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { ...common, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" }) });
    case "reviews":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 12a8 8 0 0 1 13.7-5.6L20 8.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M4 20v-4.5h4.5M20 4v4.5h-4.5" })
      ] });
    case "templates":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { ...common, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "m9 18-6-6 6-6M15 6l6 6-6 6M14 4l-4 16" }) });
    case "problems":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M6 3h8l4 4v14H6z" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M14 3v5h5M9 13h6M9 17h6" })
      ] });
    case "sync":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M20 7h-5V2M4 17h5v5" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M18.4 16A7 7 0 0 1 6 18l-2-1M5.6 8A7 7 0 0 1 18 6l2 1" })
      ] });
    case "import":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { ...common, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M12 3v12M7 10l5 5 5-5M5 21h14" }) });
    case "export":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { ...common, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M12 15V3M7 8l5-5 5 5M5 21h14" }) });
    case "checkins":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "3", y: "5", width: "18", height: "16", rx: "2" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" })
      ] });
    case "contests":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { ...common, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M5 21V4M5 5h12l-2 4 2 4H5" }) });
    case "settings":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...common, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" })
      ] });
    case "trophy":
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { ...common, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M8 4h8v4a4 4 0 0 1-8 0zM10 15h4M12 12v3M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M8 20h8M9 20v-2h6v2" }) });
  }
}
var PANEL_CSS = `
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
`;

// client/index.ts
var inject = ["slots", "sidebarRight", "sidebarRightTabs"];
var name = "dsh-algorithm-tools";
var TAB_ID = "dsh-algo-trainer.workbench";
var TAB_KIND = "icpc-workbench";
function apply(ctx) {
  const betterSidebar = ctx.get?.("betterSidebar");
  if (betterSidebar) {
    registerBetterSidebar(ctx, betterSidebar);
  } else {
    const disposeNative = registerNativeSidebar(ctx);
    ctx.inject?.(["betterSidebar"], (injectedCtx) => {
      const service = injectedCtx.get?.("betterSidebar");
      if (!service) return;
      disposeNative();
      registerBetterSidebar(injectedCtx, service);
    });
  }
  ctx.effect(() => ctx.slots.inject(
    "conversation.session.header.actions",
    () => ctx.slots.register(
      {
        name: "conversation.session.header.actions",
        id: `${name}.open`,
        order: 80,
        inject: (sessionId) => ({
          open: () => {
            const service = ctx.get?.("betterSidebar");
            if (service && typeof sessionId === "string") {
              openBetterSidebarTab(service, sessionId);
              return;
            }
            ctx.sidebarRight.openTab(TAB_KIND);
          }
        })
      },
      HeaderAction
    )
  ));
  ctx.effect(() => ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: `${name}-settings`,
        order: 50,
        label: "\u7B97\u6CD5\u8BAD\u7EC3\u53F0"
      },
      SettingsPanel
    )
  ));
}
function registerNativeSidebar(ctx) {
  const disposers = [];
  disposers.push(ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => "Algorithm Practice Space"
  })));
  disposers.push(ctx.effect(() => ctx.slots.inject(
    "sidebar.right.pane.tab",
    () => ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: TAB_ID,
        inject: () => ({
          collapseSidebar: () => ctx.sidebarRight.toggleExpanded()
        })
      },
      WorkbenchPanel
    )
  )));
  return () => {
    while (disposers.length > 0) disposers.pop()?.();
  };
}
function registerBetterSidebar(ctx, service) {
  ctx.effect(() => service.registerTab(createBetterSidebarDescriptor(
    BetterSidebarWorkbenchTab,
    (size) => (0, import_react3.createElement)(WorkbenchGlyph, { size })
  )));
}
function BetterSidebarWorkbenchTab(props) {
  return (0, import_react3.createElement)(WorkbenchPanel, {
    sessionId: props.scope.sessionId,
    inputActions: createConversationInputActions(props.ctx, props.scope.sessionId),
    collapseSidebar: () => props.ctx.sidebarRight.toggleExpanded()
  });
}
function SettingsPanel() {
  const tools = [
    ["icpc_sync", "\u540C\u6B65 CF/AtCoder \u5237\u9898\u8BB0\u5F55"],
    ["icpc_stats", "\u7EDF\u8BA1 / \u5F31\u9879\u753B\u50CF / \u8D8B\u52BF"],
    ["icpc_today", "\u4ECA\u65E5\u4E09\u6863\u8BAD\u7EC3\u63A8\u8350"],
    ["icpc_generate_plan", "\u751F\u6210\u8BAD\u7EC3\u8BA1\u5212"],
    ["icpc_manage_plan", "\u8BA1\u5212\u7BA1\u7406 / \u6253\u5361"],
    ["icpc_review", "rank \u590D\u76D8 / \u590D\u4E60"],
    ["icpc_contests", "\u8D5B\u4E8B\u4E2D\u5FC3"],
    ["icpc_problems", "\u6D4F\u89C8 / \u641C\u7D22\u9898\u76EE\u5E93"],
    ["icpc_checkin", "\u4ECA\u65E5\u5B8C\u6210\u5EA6 / \u65E5\u5386\u6253\u5361"]
  ];
  return (0, import_react3.createElement)(
    "div",
    { style: { padding: "16px", fontFamily: "system-ui, -apple-system, sans-serif" } },
    (0, import_react3.createElement)("h2", { style: { margin: "0 0 8px 0", fontSize: "18px" } }, "Algorithm Practice Space"),
    (0, import_react3.createElement)(
      "p",
      { style: { margin: "0 0 12px 0", fontSize: "13px", color: "var(--dsw-alias-label-caption)" } },
      "\u5728\u4F1A\u8BDD\u5934\u90E8\u6253\u5F00 Algorithm Practice Space\uFF1B\u70B9\u51FB\u529F\u80FD\u5165\u53E3\u540E\u624D\u4F1A\u628A\u8BAD\u7EC3\u5DE5\u5177\u6CE8\u518C\u5230\u5F53\u524D\u4F1A\u8BDD\u3002"
    ),
    (0, import_react3.createElement)(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "4px" } },
      tools.map(([id, description]) => (0, import_react3.createElement)(
        "div",
        { key: id, style: { fontSize: "12px" } },
        (0, import_react3.createElement)("code", { style: { fontWeight: 600, marginRight: "6px" } }, id),
        (0, import_react3.createElement)("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, description)
      ))
    )
  );
}
return module.exports;
} });
