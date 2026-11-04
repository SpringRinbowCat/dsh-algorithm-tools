import fs from "node:fs";
import path from "node:path";
// src/dsh-compat.ts
/**
* 把作者侧的「属性表」编译成 dsh 期望的原始 JSON Schema。
*
* dsh 的 ctx.tools.register() 不会改写 parameters，而是原样发给模型接口；
* 属性表直接下发时，名为 `type` 的参数会覆盖 schema 根上的 `type` 关键字
* （变成 { type: 'string', ... }），DeepSeek 接口会以 400 Invalid schema 拒绝
* 整个请求。统一编译成 { type: 'object', properties, required } 可避免这类
* 关键字冲突，并让模型真正看到每个参数的说明。
*/
/**
* 参数 schema 允许下发的关键字白名单。
*
* 模型接口（DeepSeek / OpenAI 兼容）只接受 JSON Schema 的一个子集，property 上出现
* `default` 这类注解会让接口以 400 Invalid schema 拒绝**整个请求**，错误形如：
*   {"type":"string","enum":["upcoming","finished"],"default":"upcoming"}
*   is not valid under any of the schemas listed in the 'anyOf' keyword
* 由于工具 schema 会随该会话的每一次请求上报，一个坏关键字会让后续每一轮对话都 400。
* 因此这里只下发白名单关键字，并把默认值降级写进 description。
*/
const PARAMETER_KEYWORDS = [
	"type",
	"description",
	"enum",
	"items",
	"properties"
];
function sanitizeSpec(spec) {
	const source = spec;
	const out = {};
	for (const key of PARAMETER_KEYWORDS) if (source[key] !== void 0) out[key] = source[key];
	if (spec.default !== void 0) {
		const note = `（默认 ${JSON.stringify(spec.default)}）`;
		out.description = typeof out.description === "string" ? `${out.description}${note}` : note;
	}
	return out;
}
function compileParameters(params) {
	const properties = {};
	const required = [];
	for (const [paramName, spec] of Object.entries(params ?? {})) {
		if (!spec || typeof spec !== "object") {
			properties[paramName] = spec;
			continue;
		}
		properties[paramName] = sanitizeSpec(spec);
		if (spec.required === true) required.push(paramName);
	}
	return {
		type: "object",
		properties,
		...required.length > 0 ? { required } : {}
	};
}
function defineTool(def) {
	if (!def.name || !def.description || !def.execute) throw new Error("Invalid tool definition: missing required field");
	return {
		...def,
		parameters: compileParameters(def.parameters)
	};
}
/**
* Standard Schema compatible config contract.
* Cordis reads only `Config['~standard'].validate()`; keeping the local
* implementation avoids a runtime dependency on schemastery in file plugins.
*/
const Config = { "~standard": {
	version: 1,
	vendor: "schemastery",
	validate(raw) {
		return { value: resolveConfig(raw && typeof raw === "object" ? raw : {}) };
	}
} };
function resolveConfig(raw = {}) {
	return {
		dataDir: raw.dataDir ?? "",
		ai: {
			enabled: raw.ai?.enabled ?? false,
			baseURL: raw.ai?.baseURL ?? "https://api.deepseek.com/v1",
			apiKey: raw.ai?.apiKey ?? "",
			model: raw.ai?.model ?? "deepseek-chat"
		}
	};
}
// src/store/schema.ts
function defaultState() {
	return {
		problems: [],
		submissions: [],
		plans: [],
		reviews: [],
		templateProgress: [],
		customTemplates: [],
		trainingIndex: {},
		bankSyncedAt: null,
		settings: {
			accounts: {},
			ai: {
				enabled: false,
				baseURL: "https://api.deepseek.com/v1",
				apiKey: "",
				model: "deepseek-chat"
			},
			adapterEnabled: {},
			cookies: {},
			reminder: {
				enabled: false,
				time: "20:00"
			}
		}
	};
}
// src/util/local-date.ts
/** 本地日期工具：插件内部所有「今天」都走这里，避免 UTC 偏移（东八区凌晨会差一天） */
function pad2(n) {
	return String(n).padStart(2, "0");
}
function localDay$1(input = /* @__PURE__ */ new Date()) {
	const d = typeof input === "string" ? new Date(input) : input;
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDaysLocal(base, n) {
	const d = /* @__PURE__ */ new Date(`${base}T00:00:00`);
	d.setDate(d.getDate() + n);
	return localDay$1(d);
}
// src/analysis/tags.ts
/** 标签净化：过滤非算法能力维度的噪声标签（移植自原 icpc-workbench） */
const CF_NOISE_PREFIX = "*";
const CONTEST_SOURCE_KEYWORDS = [
	"蓝桥杯",
	"NOIP",
	"NOI",
	"省选",
	"联赛",
	"洛谷",
	"Codeforces",
	"AtCoder",
	"ABC",
	"ARC",
	"AGC",
	"牛客",
	"GESP",
	"USACO",
	"IOI",
	"ICPC",
	"COCI",
	"POI",
	"NERC",
	"CERC",
	"eJOI",
	"Code+",
	"夏令营",
	"导刊",
	"青少年",
	"信息与未来"
];
const REGION_TAGS = /* @__PURE__ */ new Set([
	"北京",
	"天津",
	"安徽",
	"江苏",
	"湖南",
	"福建",
	"浙江",
	"上海",
	"广东",
	"四川",
	"重庆",
	"河北",
	"河南",
	"山东",
	"陕西",
	"湖北"
]);
const MISC_NOISE_TAGS = /* @__PURE__ */ new Set([
	"O2优化",
	"Special Judge",
	"SPJ",
	"提交答案",
	"提答",
	"模板题",
	"入门"
]);
function isYearTag(tag) {
	return /^(19|20)\d{2}$/.test(tag);
}
function isContestSourceTag(tag) {
	return CONTEST_SOURCE_KEYWORDS.some((k) => tag.includes(k));
}
function isNoiseTag(tag) {
	const t = tag.trim();
	if (t === "") return true;
	if (t.startsWith(CF_NOISE_PREFIX)) return true;
	if (isYearTag(t)) return true;
	if (isContestSourceTag(t)) return true;
	if (REGION_TAGS.has(t)) return true;
	if (MISC_NOISE_TAGS.has(t)) return true;
	return false;
}
function filterNoiseTags(tags) {
	return tags.filter((t) => !isNoiseTag(t));
}
// src/analysis/stats.ts
function bucketForDifficulty(difficulty) {
	if (difficulty === null || difficulty === void 0 || !Number.isFinite(difficulty)) return "未知";
	const bounds = [
		1200,
		1400,
		1600,
		1900,
		2200
	];
	const labels = [
		"<1200",
		"1200-1399",
		"1400-1599",
		"1600-1899",
		"1900-2199",
		"2200+"
	];
	for (let i = 0; i < bounds.length; i += 1) if (difficulty < bounds[i]) return labels[i];
	return labels[labels.length - 1];
}
function bump$2(map, key, isAc) {
	const cur = map.get(key) ?? {
		attempts: 0,
		ac: 0
	};
	cur.attempts += 1;
	if (isAc) cur.ac += 1;
	map.set(key, cur);
}
function rate(attempts, ac) {
	return attempts === 0 ? 0 : Math.round(ac / attempts * 1e3) / 10;
}
const round2 = (n) => Math.round(n * 100) / 100;
function computeOverall(rows, filter = {}) {
	const filtered = rows.filter((r) => {
		if (filter.platform && r.platform !== filter.platform) return false;
		if (filter.from && r.submittedAt < filter.from) return false;
		if (filter.to && r.submittedAt > filter.to) return false;
		return true;
	});
	const PLATFORMS = ["codeforces", "atcoder"];
	const byPlatform = /* @__PURE__ */ new Map();
	for (const p of PLATFORMS) byPlatform.set(p, {
		attempts: 0,
		ac: 0
	});
	const byDifficulty = /* @__PURE__ */ new Map();
	const byTag = /* @__PURE__ */ new Map();
	const solvedSet = /* @__PURE__ */ new Set();
	const solvedByTag = /* @__PURE__ */ new Map();
	const solvedByPlatform = /* @__PURE__ */ new Map();
	for (const r of filtered) {
		const isAc = r.verdict === "AC";
		bump$2(byPlatform, r.platform, isAc);
		bump$2(byDifficulty, bucketForDifficulty(r.difficulty), isAc);
		for (const tag of filterNoiseTags(r.tags)) {
			bump$2(byTag, tag, isAc);
			if (isAc) {
				if (!solvedByTag.has(tag)) solvedByTag.set(tag, /* @__PURE__ */ new Set());
				solvedByTag.get(tag).add(`${r.platform}:${r.problemKey}`);
			}
		}
		if (isAc) {
			solvedSet.add(`${r.platform}:${r.problemKey}`);
			if (!solvedByPlatform.has(r.platform)) solvedByPlatform.set(r.platform, /* @__PURE__ */ new Set());
			solvedByPlatform.get(r.platform).add(r.problemKey);
		}
	}
	const toStat = (s) => ({
		attempts: s.attempts,
		ac: s.ac,
		acRate: rate(s.attempts, s.ac)
	});
	return {
		attempts: filtered.length,
		ac: filtered.filter((r) => r.verdict === "AC").length,
		acRate: rate(filtered.length, filtered.filter((r) => r.verdict === "AC").length),
		solvedProblems: solvedSet.size,
		byPlatform: [...byPlatform.entries()].map(([platform, s]) => ({
			platform,
			...toStat(s),
			solved: solvedByPlatform.get(platform)?.size ?? 0
		})),
		byDifficulty: [...byDifficulty.entries()].map(([bucket, s]) => ({
			bucket,
			...toStat(s)
		})),
		byTag: [...byTag.entries()].map(([tag, s]) => ({
			tag,
			...toStat(s),
			solved: solvedByTag.get(tag)?.size ?? 0
		}))
	};
}
// src/store/index.ts
const STATE_FILE = "icpc-state.json";
const SAVE_DEBOUNCE_MS = 500;
var IcpcStore = class {
	state = defaultState();
	fs;
	dataDir;
	saveTimer = null;
	nextPlanId = 1;
	nextReviewId = 1;
	nextTaskId = 1;
	nextCustomId = 1;
	/** 提交索引：`${platform}:${problemKey}` → SubmissionRecord[]，避免 O(n×m) 全量扫描 */
	subIndex = /* @__PURE__ */ new Map();
	/** 排序后的提交缓存（按时间降序），插入时追加、读取时直接用 */
	sortedSubs = null;
	/** load() 完成信号：任何写盘（flush）必须等它，避免用空 state 覆盖磁盘上的真实数据 */
	ready = Promise.resolve();
	loaded = false;
	constructor(fs, dataDir) {
		this.fs = fs;
		this.dataDir = dataDir;
		this.ready = this.load();
	}
	/** 等待存储加载完成（首次调用前 await，避免读到空状态或写盘覆盖） */
	awaitReady() {
		return this.ready;
	}
	/** 重建提交索引（load 后或批量插入后调用） */
	rebuildSubIndex() {
		this.subIndex = /* @__PURE__ */ new Map();
		for (const s of this.state.submissions) {
			const key = `${s.platform}:${s.problemKey}`;
			const arr = this.subIndex.get(key) ?? [];
			arr.push(s);
			this.subIndex.set(key, arr);
		}
		this.sortedSubs = null;
	}
	/** 获取按时间降序排序的提交（缓存） */
	getSortedSubs() {
		if (!this.sortedSubs) this.sortedSubs = [...this.state.submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
		return this.sortedSubs;
	}
	async load() {
		try {
			const filePath = `${this.dataDir}/${STATE_FILE}`;
			if (await this.fs.exists(filePath)) {
				const raw = await this.fs.readFile(filePath);
				this.state = {
					...defaultState(),
					...JSON.parse(raw)
				};
				if (!this.state.customTemplates) this.state.customTemplates = [];
				if (!this.state.settings.adapterEnabled) this.state.settings.adapterEnabled = {};
				if (!this.state.settings.cookies) this.state.settings.cookies = {};
				if (!this.state.settings.reminder) this.state.settings.reminder = {
					enabled: false,
					time: "20:00"
				};
				if (!this.state.settings.accounts) this.state.settings.accounts = {};
				if (!this.state.trainingIndex) this.state.trainingIndex = {};
				if (!this.state.bankSyncedAt) this.state.bankSyncedAt = null;
			}
		} catch (e) {
			console.warn(`[icpc-store] load failed, starting fresh: ${e.message}`);
		}
		for (const p of this.state.plans) {
			if (p.id >= this.nextPlanId) this.nextPlanId = p.id + 1;
			for (const t of p.tasks) if (t.id >= this.nextTaskId) this.nextTaskId = t.id + 1;
		}
		for (const r of this.state.reviews) if (r.id >= this.nextReviewId) this.nextReviewId = r.id + 1;
		for (const c of this.state.customTemplates) if (c.id >= this.nextCustomId) this.nextCustomId = c.id + 1;
		this.rebuildSubIndex();
		this.loaded = true;
	}
	scheduleSave() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
	}
	async flush() {
		await this.ready;
		try {
			await this.fs.mkdir(this.dataDir);
			await this.fs.writeFile(`${this.dataDir}/${STATE_FILE}`, JSON.stringify(this.state, null, 2));
		} catch (e) {
			console.error(`[icpc-store] flush failed: ${e.message}`);
		}
	}
	getSettings() {
		return this.state.settings;
	}
	updateSettings(patch) {
		if (patch.ai) this.state.settings.ai = {
			...this.state.settings.ai,
			...patch.ai
		};
		if (patch.adapterEnabled) this.state.settings.adapterEnabled = {
			...this.state.settings.adapterEnabled,
			...patch.adapterEnabled
		};
		if (patch.cookies) this.state.settings.cookies = {
			...this.state.settings.cookies,
			...patch.cookies
		};
		if (patch.reminder) this.state.settings.reminder = {
			...this.state.settings.reminder,
			...patch.reminder
		};
		this.scheduleSave();
	}
	getHandle(platform) {
		return this.state.settings.accounts[platform]?.handle;
	}
	getAccount(platform) {
		const a = this.state.settings.accounts[platform];
		return a ? {
			handle: a.handle,
			lastSyncAt: a.lastSyncAt,
			enabled: a.enabled
		} : void 0;
	}
	setAccount(platform, handle) {
		const existing = this.state.settings.accounts[platform];
		this.state.settings.accounts[platform] = {
			platform,
			handle,
			lastSyncAt: existing && existing.handle === handle ? existing.lastSyncAt : null,
			enabled: true
		};
		this.scheduleSave();
	}
	setAccountSyncTime(platform, time) {
		const a = this.state.settings.accounts[platform];
		if (a) {
			a.lastSyncAt = time;
			this.scheduleSave();
		}
	}
	setAdapterEnabled(platform, enabled) {
		this.state.settings.adapterEnabled[platform] = enabled;
		this.scheduleSave();
	}
	getAdapterEnabled(platform) {
		return this.state.settings.adapterEnabled[platform] !== false;
	}
	setCookie(platform, cookie, csrf) {
		if (!this.state.settings.cookies[platform]) this.state.settings.cookies[platform] = {};
		if (cookie !== void 0) {
			if (cookie === "") delete this.state.settings.cookies[platform].cookie;
			else this.state.settings.cookies[platform].cookie = cookie;
		}
		if (csrf !== void 0) {
			if (csrf === "") delete this.state.settings.cookies[platform].csrf;
			else this.state.settings.cookies[platform].csrf = csrf;
		}
		if (this.state.settings.cookies[platform] && Object.keys(this.state.settings.cookies[platform]).length === 0) delete this.state.settings.cookies[platform];
		this.scheduleSave();
	}
	getCookie(platform) {
		return this.state.settings.cookies[platform];
	}
	setReminder(enabled, time) {
		if (enabled !== void 0) this.state.settings.reminder.enabled = enabled;
		if (time !== void 0) this.state.settings.reminder.time = time;
		this.scheduleSave();
	}
	upsertProblem(p) {
		const idx = this.state.problems.findIndex((x) => x.platform === p.platform && x.problemKey === p.problemKey);
		if (idx >= 0) this.state.problems[idx] = {
			...this.state.problems[idx],
			...p,
			difficulty: p.difficulty ?? this.state.problems[idx].difficulty
		};
		else this.state.problems.push(p);
		this.scheduleSave();
	}
	/**
	* 批量 upsert 题库题（不产生提交），difficulty 保留已有值（COALESCE），tags 仅非空时覆盖。
	* 全站题库约 1 万题，用 key→下标 的 Map 代替 findProblem 的线性查找，避免 O(n²)。
	*/
	upsertBankProblems(rows) {
		const index = /* @__PURE__ */ new Map();
		for (let i = 0; i < this.state.problems.length; i++) {
			const p = this.state.problems[i];
			index.set(`${p.platform}:${p.problemKey}`, i);
		}
		const stats = /* @__PURE__ */ new Map();
		for (const r of rows) {
			const key = `${r.platform}:${r.problemKey}`;
			const bucket = stats.get(r.platform) ?? {
				inserted: 0,
				updated: 0,
				seen: /* @__PURE__ */ new Set()
			};
			stats.set(r.platform, bucket);
			if (bucket.seen.has(key)) continue;
			bucket.seen.add(key);
			const at = index.get(key);
			if (at === void 0) {
				this.state.problems.push(r);
				index.set(key, this.state.problems.length - 1);
				bucket.inserted++;
			} else {
				const existing = this.state.problems[at];
				this.state.problems[at] = {
					...existing,
					title: r.title || existing.title,
					difficulty: existing.difficulty ?? r.difficulty,
					url: r.url ?? existing.url,
					tags: r.tags.length > 0 ? r.tags : existing.tags
				};
				bucket.updated++;
			}
		}
		this.scheduleSave();
		return [...stats].map(([platform, s]) => ({
			platform,
			inserted: s.inserted,
			updated: s.updated
		}));
	}
	findProblem(platform, problemKey) {
		return this.state.problems.find((p) => p.platform === platform && p.problemKey === problemKey);
	}
	/** 题库条数（可按平台），用于判断题库是否还没同步过 */
	countProblems(platform) {
		if (!platform) return this.state.problems.length;
		let n = 0;
		for (const p of this.state.problems) if (p.platform === platform) n++;
		return n;
	}
	/** 浏览题目：支持 platform/difficulty/tag/q 关键词过滤，bank=1 包含未做题 */
	browseProblems(opts = {}) {
		const limit = opts.limit ?? 300;
		let rows = this.state.problems.map((p) => {
			const subs = this.subIndex.get(`${p.platform}:${p.problemKey}`) ?? [];
			const acSubs = subs.filter((s) => s.verdict === "AC");
			const lastAcAt = acSubs.length > 0 ? acSubs.map((s) => s.submittedAt).sort().pop() ?? null : null;
			return {
				...p,
				attempts: subs.length,
				acCount: acSubs.length,
				lastAcAt,
				status: acSubs.length > 0 ? "ac" : subs.length > 0 ? "tried" : "none"
			};
		});
		if (!opts.bank) rows = rows.filter((r) => r.attempts > 0);
		if (opts.platform) rows = rows.filter((r) => r.platform === opts.platform);
		if (opts.q && opts.q.trim()) {
			const q = opts.q.trim();
			rows = rows.filter((r) => r.title.includes(q) || r.problemKey.includes(q));
		}
		rows = rows.sort((a, b) => (b.difficulty ?? -1) - (a.difficulty ?? -1));
		if (opts.difficulty) rows = rows.filter((r) => bucketForDifficulty(r.difficulty) === opts.difficulty);
		if (opts.tag) rows = rows.filter((r) => r.tags.includes(opts.tag));
		return rows.slice(0, limit);
	}
	insertSubmissions(subs) {
		const existing = new Set(this.state.submissions.map((s) => s.externalId));
		let imported = 0;
		let skipped = 0;
		for (const s of subs) {
			if (existing.has(s.externalId)) {
				skipped++;
				continue;
			}
			existing.add(s.externalId);
			this.state.submissions.push(s);
			const key = `${s.platform}:${s.problemKey}`;
			const arr = this.subIndex.get(key) ?? [];
			arr.push(s);
			this.subIndex.set(key, arr);
			if (!this.findProblem(s.platform, s.problemKey)) {
				this.state.problems.push({
					platform: s.platform,
					problemKey: s.problemKey,
					title: s.problemKey,
					difficulty: null,
					url: null,
					tags: []
				});
				this.scheduleSave();
			}
			imported++;
		}
		this.sortedSubs = null;
		this.scheduleSave();
		return {
			imported,
			skipped
		};
	}
	getKnownExternalIds(platform) {
		return new Set(this.state.submissions.filter((s) => !platform || s.platform === platform).map((s) => s.externalId));
	}
	getSubmissionRows(filter = {}) {
		const problemMap = new Map(this.state.problems.map((p) => [`${p.platform}:${p.problemKey}`, p]));
		return this.state.submissions.filter((s) => {
			if (filter.platform && s.platform !== filter.platform) return false;
			if (filter.from && s.submittedAt < filter.from) return false;
			if (filter.to && s.submittedAt > filter.to) return false;
			return true;
		}).map((s) => {
			const p = problemMap.get(`${s.platform}:${s.problemKey}`);
			return {
				platform: s.platform,
				verdict: s.verdict,
				submittedAt: s.submittedAt,
				problemKey: s.problemKey,
				difficulty: p?.difficulty ?? null,
				tags: p?.tags ?? []
			};
		});
	}
	/** 获取某道题的提交记录（用索引，O(1) 查找） */
	getSubmissionsForProblem(platform, problemKey) {
		return this.subIndex.get(`${platform}:${problemKey}`) ?? [];
	}
	getAcKeys() {
		const set = /* @__PURE__ */ new Set();
		for (const s of this.state.submissions) if (s.verdict === "AC") set.add(`${s.platform}:${s.problemKey}`);
		return set;
	}
	getRecentAcDifficulties(since) {
		const problemMap = new Map(this.state.problems.map((p) => [`${p.platform}:${p.problemKey}`, p]));
		const diffs = [];
		const seen = /* @__PURE__ */ new Set();
		for (const s of this.getSortedSubs()) {
			if (s.verdict !== "AC" || s.submittedAt < since) continue;
			const key = `${s.platform}:${s.problemKey}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const p = problemMap.get(key);
			if (p?.difficulty != null) diffs.push(p.difficulty);
		}
		return diffs;
	}
	getUnsolvedCandidates() {
		const acKeys = this.getAcKeys();
		return this.state.problems.map((p, i) => ({
			...p,
			id: i + 1
		})).filter((p) => p.difficulty != null && !acKeys.has(`${p.platform}:${p.problemKey}`));
	}
	createPlan(plan) {
		const record = {
			...plan,
			id: this.nextPlanId++,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		for (const t of record.tasks) t.id = this.nextTaskId++;
		this.state.plans.push(record);
		this.scheduleSave();
		return record;
	}
	listPlans() {
		return [...this.state.plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}
	getPlan(id) {
		return this.state.plans.find((p) => p.id === id);
	}
	/** 覆盖指定日期的计划（v4.1 每周方向用） */
	getActivePlan(date) {
		return this.state.plans.find((p) => p.startDate <= date && p.endDate >= date);
	}
	/** 当前周方向：第几周、方向文案、该周聚焦标签；没有计划或旧计划（无 weeks）返回 null */
	currentFocus(date) {
		const plan = this.getActivePlan(date);
		if (!plan?.weeks?.length) return null;
		const start = (/* @__PURE__ */ new Date(`${plan.startDate}T00:00:00Z`)).getTime();
		const day = (/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).getTime();
		const idx = Math.max(0, Math.floor((day - start) / 864e5 / 7));
		const w = plan.weeks.find((x) => x.index === idx + 1) ?? plan.weeks[plan.weeks.length - 1];
		return w ? {
			planId: plan.id,
			week: w.index,
			direction: w.direction,
			tags: w.tags
		} : null;
	}
	/** 今日训练完成后，把当天的计划任务自动勾掉；返回勾选数量 */
	autoCheckPlanTasks(date) {
		let n = 0;
		for (const plan of this.state.plans) for (const t of plan.tasks) {
			if (t.taskDate !== date || t.checked) continue;
			t.checked = true;
			n++;
		}
		if (n > 0) this.scheduleSave();
		return n;
	}
	deletePlan(id) {
		const idx = this.state.plans.findIndex((p) => p.id === id);
		if (idx < 0) return false;
		this.state.plans.splice(idx, 1);
		this.scheduleSave();
		return true;
	}
	findTask(taskId) {
		for (const plan of this.state.plans) {
			const task = plan.tasks.find((t) => t.id === taskId);
			if (task) return {
				plan,
				task
			};
		}
	}
	updateTask(taskId, patch) {
		const found = this.findTask(taskId);
		if (!found) return false;
		Object.assign(found.task, patch);
		this.scheduleSave();
		return true;
	}
	deleteTask(taskId) {
		for (const plan of this.state.plans) {
			const idx = plan.tasks.findIndex((t) => t.id === taskId);
			if (idx >= 0) {
				plan.tasks.splice(idx, 1);
				this.scheduleSave();
				return true;
			}
		}
		return false;
	}
	toggleCheckin(taskId, checked) {
		const found = this.findTask(taskId);
		if (!found) return;
		found.task.checked = checked;
		this.scheduleSave();
	}
	getTasksByDate(date) {
		const tasks = [];
		for (const plan of this.state.plans) for (const t of plan.tasks) if (t.taskDate === date) tasks.push(t);
		return tasks;
	}
	/** 记录某天「今日训练」抽到的题（platform:problemKey），用于判定当天训练是否完成 */
	setTrainingIndex(date, keys) {
		this.state.trainingIndex[date] = [...new Set(keys)];
		this.scheduleSave();
	}
	getTrainingIndex(date) {
		return this.state.trainingIndex[date] ?? [];
	}
	setBankSyncedAt(iso) {
		this.state.bankSyncedAt = iso;
		this.scheduleSave();
	}
	getBankSyncedAt() {
		return this.state.bankSyncedAt ?? null;
	}
	getMonthView(month) {
		const byDate = /* @__PURE__ */ new Map();
		for (const plan of this.state.plans) for (const t of plan.tasks) if (t.taskDate.startsWith(month)) {
			const cur = byDate.get(t.taskDate) ?? {
				total: 0,
				checked: 0
			};
			cur.total++;
			if (t.checked) cur.checked++;
			byDate.set(t.taskDate, cur);
		}
		return [...byDate.entries()].map(([date, v]) => ({
			date,
			...v
		})).sort((a, b) => a.date.localeCompare(b.date));
	}
	getStreak(todayStr) {
		const dates = /* @__PURE__ */ new Set();
		for (const plan of this.state.plans) for (const t of plan.tasks) if (t.checked) dates.add(t.taskDate);
		if (dates.size === 0) return {
			current: 0,
			longest: 0,
			totalDays: 0
		};
		const toDayNum = (s) => Number((/* @__PURE__ */ new Date(`${s}T00:00:00Z`)).getTime() / 864e5) | 0;
		const days = [...dates].map(toDayNum).sort((a, b) => a - b);
		let longest = 1;
		let run = 1;
		for (let i = 1; i < days.length; i++) {
			run = days[i] - days[i - 1] === 1 ? run + 1 : 1;
			if (run > longest) longest = run;
		}
		const today = toDayNum(todayStr);
		const set = new Set(days);
		let cursor = set.has(today) ? today : today - 1;
		let current = 0;
		while (set.has(cursor)) {
			current++;
			cursor--;
		}
		return {
			current,
			longest,
			totalDays: days.length
		};
	}
	addReview(problem) {
		const todayStr = localDay$1();
		const existing = this.state.reviews.find((r) => r.platform === problem.platform && r.problemKey === problem.problemKey);
		if (existing) return existing;
		const record = {
			id: this.nextReviewId++,
			platform: problem.platform,
			problemKey: problem.problemKey,
			title: problem.title,
			difficulty: problem.difficulty,
			url: problem.url,
			tags: problem.tags,
			stage: 0,
			note: null,
			nextDueOn: todayStr,
			lastReviewedAt: null,
			addedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		this.state.reviews.push(record);
		this.scheduleSave();
		return record;
	}
	listReviews(dueOnly = false) {
		const todayStr = localDay$1();
		return [...this.state.reviews].filter((r) => !dueOnly || r.nextDueOn <= todayStr).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn));
	}
	getReview(id) {
		return this.state.reviews.find((r) => r.id === id);
	}
	updateReview(id, patch) {
		const r = this.getReview(id);
		if (!r) return false;
		Object.assign(r, patch);
		this.scheduleSave();
		return true;
	}
	deleteReview(id) {
		const idx = this.state.reviews.findIndex((r) => r.id === id);
		if (idx < 0) return false;
		this.state.reviews.splice(idx, 1);
		this.scheduleSave();
		return true;
	}
	getDueCount() {
		const todayStr = localDay$1();
		return this.state.reviews.filter((r) => r.nextDueOn <= todayStr).length;
	}
	getTemplateProgress(templateId) {
		return this.state.templateProgress.find((t) => t.templateId === templateId);
	}
	setTemplateProgress(templateId, patch) {
		const existing = this.getTemplateProgress(templateId);
		if (existing) Object.assign(existing, patch);
		else this.state.templateProgress.push({
			templateId,
			status: "todo",
			note: null,
			code: null,
			idea: null,
			complexity: null,
			url: null,
			masteredAt: null,
			...patch
		});
		this.scheduleSave();
	}
	getAllProgress() {
		return new Map(this.state.templateProgress.map((t) => [t.templateId, t]));
	}
	createCustomTemplate(input) {
		const record = {
			...input,
			id: this.nextCustomId++,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			updatedAt: null
		};
		this.state.customTemplates.push(record);
		this.scheduleSave();
		return record;
	}
	getCustomTemplate(id) {
		return this.state.customTemplates.find((c) => c.id === id);
	}
	updateCustomTemplate(id, patch) {
		const c = this.getCustomTemplate(id);
		if (!c) return false;
		Object.assign(c, patch);
		c.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		this.scheduleSave();
		return true;
	}
	deleteCustomTemplate(id) {
		const idx = this.state.customTemplates.findIndex((c) => c.id === id);
		if (idx < 0) return false;
		this.state.customTemplates.splice(idx, 1);
		this.state.templateProgress = this.state.templateProgress.filter((t) => t.templateId !== `c-${id}`);
		this.scheduleSave();
		return true;
	}
	listCustomTemplates() {
		return [...this.state.customTemplates].sort((a, b) => a.id - b.id);
	}
	/** 例题练习状态：是否已入库、是否已 AC */
	loadExampleStatus(pairs) {
		const acKeys = this.getAcKeys();
		const problemKeys = new Set(this.state.problems.map((p) => `${p.platform}:${p.problemKey}`));
		const map = /* @__PURE__ */ new Map();
		for (const { platform, key } of pairs) {
			const k = `${platform}:${key}`;
			map.set(k, {
				inBank: problemKeys.has(k),
				ac: acKeys.has(k)
			});
		}
		return map;
	}
};
// src/adapters/codeforces.ts
const API_BASE = "https://codeforces.com/api";
const PAGE_SIZE = 1e3;
const VERDICT_MAP = {
	OK: "AC",
	WRONG_ANSWER: "WA",
	TIME_LIMIT_EXCEEDED: "TLE",
	RUNTIME_ERROR: "RE",
	MEMORY_LIMIT_EXCEEDED: "MLE",
	COMPILATION_ERROR: "CE"
};
const sleep$1 = (ms) => new Promise((r) => setTimeout(r, ms));
function splitKey(key) {
	const m = /^(\d+)(.+)$/.exec(key);
	return m ? {
		contestId: m[1],
		index: m[2]
	} : { index: key };
}
function problemUrlFor(contestId, index) {
	if (contestId === void 0) return `https://codeforces.com/problemset/problem/${index}`;
	return `https://codeforces.com/${contestId >= 1e5 ? "gym" : "contest"}/${contestId}/problem/${index}`;
}
function normalize(s) {
	const { contestId, index } = s.problem;
	return {
		problem: {
			platform: "codeforces",
			problemKey: contestId !== void 0 ? `${contestId}${index}` : index,
			title: s.problem.name,
			...s.problem.rating !== void 0 ? { difficulty: s.problem.rating } : {},
			url: problemUrlFor(contestId, index),
			tags: s.problem.tags ?? []
		},
		verdict: s.verdict ? VERDICT_MAP[s.verdict] ?? "SKIPPED" : "SKIPPED",
		...s.programmingLanguage ? { language: s.programmingLanguage } : {},
		submittedAt: (/* @__PURE__ */ new Date(s.creationTimeSeconds * 1e3)).toISOString(),
		externalId: String(s.id)
	};
}
function createCodeforcesAdapter(fetchFn = fetch) {
	return {
		platform: "codeforces",
		knownIdsFilter: true,
		async fetchUserSubmissions(handle, opts) {
			const known = opts?.knownExternalIds;
			const out = [];
			let from = 1;
			for (;;) {
				const res = await fetchFn(`${API_BASE}/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${PAGE_SIZE}`, { signal: AbortSignal.timeout(15e3) });
				if (!res.ok) throw new Error(`Codeforces API HTTP ${res.status}`);
				const data = await res.json();
				if (data.status !== "OK") throw new Error(`Codeforces API: ${data.comment ?? "unknown error"}`);
				const page = data.result ?? [];
				let unknownInPage = 0;
				for (const s of page) {
					if (known?.has(String(s.id))) continue;
					unknownInPage += 1;
					out.push(normalize(s));
				}
				if (page.length < PAGE_SIZE) break;
				if (known && unknownInPage === 0) break;
				from += PAGE_SIZE;
				await sleep$1(500);
			}
			return out;
		},
		problemUrl(problemKey) {
			const { contestId, index } = splitKey(String(problemKey));
			if (!contestId) return `https://codeforces.com/problemset/problem/${String(problemKey)}`;
			return `https://codeforces.com/${Number(contestId) >= 1e5 ? "gym" : "contest"}/${contestId}/problem/${index}`;
		},
		async fetchContests() {
			const res = await fetchFn(`${API_BASE}/contest.list`, { signal: AbortSignal.timeout(15e3) });
			if (!res.ok) throw new Error(`Codeforces contest.list HTTP ${res.status}`);
			const data = await res.json();
			if (data.status !== "OK") return [];
			return (data.result ?? []).map((c) => ({
				id: `cf-${c.id}`,
				platform: "codeforces",
				name: c.name,
				category: c.type === "CF" ? "Div.2/3" : c.type,
				startTimeIso: (/* @__PURE__ */ new Date(c.startTimeSeconds * 1e3)).toISOString(),
				durationMinutes: Math.round(c.durationSeconds / 60),
				phase: c.rel,
				url: `https://codeforces.com/contest/${c.id}`
			}));
		},
		/**
		* 题库：problemset.problems 一次返回全站约 1 万题（含 rating/tags），
		* 只需一个请求，用于「今日三档」从未做过的题里出题。
		*/
		async fetchProblemBank() {
			const res = await fetchFn(`${API_BASE}/problemset.problems`, { signal: AbortSignal.timeout(3e4) });
			if (!res.ok) throw new Error(`Codeforces problemset HTTP ${res.status}`);
			const data = await res.json();
			if (data.status !== "OK") throw new Error(`Codeforces API: ${data.comment ?? "unknown error"}`);
			return (data.result?.problems ?? []).filter((p) => p.contestId !== void 0).map((p) => ({
				platform: "codeforces",
				problemKey: `${p.contestId}${p.index}`,
				title: p.name,
				difficulty: p.rating ?? null,
				url: problemUrlFor(p.contestId, p.index),
				tags: p.tags ?? []
			}));
		}
	};
}
// src/adapters/atcoder.ts
const API = "https://kenkoooo.com/atcoder";
const SUBMISSION_PAGE = 500;
const MAX_PAGES = 100;
const RESULT_MAP = {
	AC: "AC",
	WA: "WA",
	TLE: "TLE",
	MLE: "MLE",
	RE: "RE",
	CE: "CE",
	OLE: "RE",
	IE: "RE",
	WJ: "SKIPPED",
	WR: "SKIPPED",
	JUDGE: "SKIPPED"
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function createAtcoderAdapter(fetchFn = fetch) {
	let problems = null;
	let models = null;
	async function ensureMaps() {
		if (problems && models) return;
		const [probRes, modelRes] = await Promise.all([fetchFn(`${API}/resources/problems.json`, { signal: AbortSignal.timeout(2e4) }), fetchFn(`${API}/resources/problem-models.json`, { signal: AbortSignal.timeout(2e4) })]);
		if (!probRes.ok || !modelRes.ok) throw new Error("AtCoder resources fetch failed");
		const probData = await probRes.json();
		const modelData = await modelRes.json();
		problems = new Map(probData.map((p) => [p.id, p]));
		models = new Map(Object.entries(modelData));
	}
	function normalize(s, probs, mods) {
		const title = probs.get(s.problem_id)?.title ?? s.problem_id;
		const difficulty = mods.get(s.problem_id)?.difficulty ?? void 0;
		return {
			problem: {
				platform: "atcoder",
				problemKey: s.problem_id,
				title,
				...typeof difficulty === "number" && Number.isFinite(difficulty) ? { difficulty } : {},
				url: `https://atcoder.jp/contests/${s.contest_id}/tasks/${s.problem_id}`,
				tags: []
			},
			verdict: RESULT_MAP[s.result] ?? "SKIPPED",
			language: s.language,
			submittedAt: (/* @__PURE__ */ new Date(s.epoch_second * 1e3)).toISOString(),
			externalId: String(s.id)
		};
	}
	return {
		platform: "atcoder",
		async fetchUserSubmissions(handle, opts) {
			const since = opts?.since ? Math.floor(Date.parse(opts.since) / 1e3) : 0;
			const seen = /* @__PURE__ */ new Set();
			const raws = [];
			let fromSecond = since;
			for (let page = 0; page < MAX_PAGES; page++) {
				const res = await fetchFn(`${API}/atcoder-api/v3/user/submissions?user=${encodeURIComponent(handle)}&from_second=${fromSecond}`, { signal: AbortSignal.timeout(2e4) });
				if (!res.ok) throw new Error(`AtCoder API HTTP ${res.status}`);
				const data = await res.json();
				if (!Array.isArray(data)) {
					const msg = data.message ?? "unknown error";
					throw new Error(`AtCoder API: ${msg}`);
				}
				const rows = data;
				if (rows.length === 0) break;
				let added = 0;
				let maxSecond = 0;
				let maxSecondCount = 0;
				for (const s of rows) {
					if (seen.has(String(s.id))) continue;
					seen.add(String(s.id));
					raws.push(s);
					added += 1;
					if (s.epoch_second > maxSecond) {
						maxSecond = s.epoch_second;
						maxSecondCount = 1;
					} else if (s.epoch_second === maxSecond) maxSecondCount += 1;
				}
				if (rows.length < SUBMISSION_PAGE || added === 0) break;
				fromSecond = maxSecondCount < SUBMISSION_PAGE ? maxSecond + 1 : maxSecond;
				await sleep(1e3);
			}
			if (raws.length === 0) return [];
			await ensureMaps();
			return raws.map((s) => normalize(s, problems ?? /* @__PURE__ */ new Map(), models ?? /* @__PURE__ */ new Map()));
		},
		problemUrl(problemKey) {
			return `https://atcoder.jp/tasks/${String(problemKey)}`;
		},
		async fetchContests() {
			const res = await fetchFn(`${API}/resources/contests.json`, { signal: AbortSignal.timeout(2e4) });
			if (!res.ok) throw new Error(`AtCoder contests HTTP ${res.status}`);
			return (await res.json()).map((c) => ({
				id: `at-${c.id}`,
				platform: "atcoder",
				name: c.title,
				category: c.id.startsWith("abc") ? "ABC" : c.id.startsWith("arc") ? "ARC" : c.id.startsWith("agc") ? "AGC" : "Other",
				startTimeIso: (/* @__PURE__ */ new Date(c.start_epoch_second * 1e3)).toISOString(),
				durationMinutes: Math.round(c.duration_second / 60),
				phase: "",
				url: `https://atcoder.jp/contests/${c.id}`
			}));
		}
	};
}
// src/tools/helpers.ts
/** 工具层共享辅助 */
function textOutput(value) {
	return [{
		type: "text",
		text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
	}];
}
const ANY_OUTPUT = { type: "object" };
function str(v) {
	return typeof v === "string" && v !== "" ? v : void 0;
}
function num(v, fallback, min, max) {
	const n = Number(v);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(n)));
}
// src/tools/sync-helpers.ts
async function syncPlatform(host, platform, handle) {
	const { store, adapters } = host;
	const result = {
		platform,
		handle,
		imported: 0,
		skipped: 0,
		errors: []
	};
	if (!store.getAdapterEnabled(platform)) {
		result.errors.push(`平台 ${platform} 已禁用（可在设置中开启）`);
		return result;
	}
	const adapter = adapters[platform];
	if (!adapter) {
		result.errors.push(`未注册适配器: ${platform}`);
		return result;
	}
	const since = store.getAccount(platform)?.lastSyncAt ?? void 0;
	const known = store.getKnownExternalIds(platform);
	try {
		const subs = await adapter.fetchUserSubmissions(handle, {
			...since ? { since } : {},
			knownExternalIds: known
		});
		for (const s of subs) store.upsertProblem({
			platform: s.problem.platform,
			problemKey: s.problem.problemKey,
			title: s.problem.title,
			difficulty: s.problem.difficulty ?? null,
			url: s.problem.url ?? null,
			tags: s.problem.tags
		});
		const insertResult = store.insertSubmissions(subs.map((s) => ({
			platform: s.problem.platform,
			problemKey: s.problem.problemKey,
			verdict: s.verdict,
			language: s.language,
			submittedAt: s.submittedAt,
			externalId: s.externalId
		})));
		result.imported = insertResult.imported;
		result.skipped = insertResult.skipped;
		store.setAccountSyncTime(platform, (/* @__PURE__ */ new Date()).toISOString());
	} catch (e) {
		result.errors.push(e.message);
	}
	return result;
}
/** 同步平台题库（题目元数据，不产生提交）：让「今日三档」能从未做过的题里出题 */
async function syncBank(host, platform) {
	const { store, adapters } = host;
	const result = {
		platform,
		fetched: 0,
		inserted: 0,
		updated: 0,
		errors: []
	};
	const adapter = adapters[platform];
	if (!adapter?.fetchProblemBank) {
		result.errors.push(`平台 ${platform} 没有题库接口`);
		return result;
	}
	try {
		const rows = await adapter.fetchProblemBank();
		result.fetched = rows.length;
		const mine = store.upsertBankProblems(rows.map((r) => ({
			platform: r.platform,
			problemKey: r.problemKey,
			title: r.title,
			difficulty: r.difficulty,
			url: r.url,
			tags: r.tags
		}))).find((s) => s.platform === platform);
		result.inserted = mine?.inserted ?? 0;
		result.updated = mine?.updated ?? 0;
	} catch (e) {
		result.errors.push(e.message);
	}
	return result;
}
// src/reviews/local.ts
/**
* 本地 Codeforces 目录扫描：把「我实际写过代码的题」收集出来，用于自动收进复习库。
*
* 目录约定（来自用户现有工作流）：
*   D:\codeforces\<YYYY-MM-DD>\<problemKey>\<problemKey>.cpp
*   D:\codeforces\practise\<YYYY-MM-DD>\<problemKey>\...
* 但也兼容任意深度：只要目录名或 .cpp 文件名长得像题号，就当作一道题。
*/
/** 2283A / 1926D / 1858E1 这类题号 */
const KEY_RE = /^(\d{3,6})([A-Z]\d?)$/i;
const SKIP_DIRS = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	".svn",
	".idea",
	".vscode",
	"build",
	"bin",
	"obj"
]);
function collect(root, maxDepth = 5, explicitRoot = false) {
	const result = {
		root,
		files: 0,
		dirs: 0,
		problems: [],
		errors: []
	};
	const seen = /* @__PURE__ */ new Map();
	const walk = (dir, depth) => {
		if (depth > maxDepth) return;
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (e) {
			result.errors.push(`${dir}: ${e.message}`);
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				result.dirs++;
				const m = KEY_RE.exec(entry.name);
				if (m) {
					const key = `${m[1]}${m[2].toUpperCase()}`;
					if (!seen.get(key)) seen.set(key, {
						file: full,
						mtime: 0
					});
				}
				walk(full, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			if (!/\.(cpp|cc|cxx|py)$/i.test(entry.name)) continue;
			result.files++;
			const base = entry.name.replace(/\.[^.]+$/, "");
			const m = KEY_RE.exec(base);
			if (!m) continue;
			const key = `${m[1]}${m[2].toUpperCase()}`;
			let mtime = 0;
			try {
				mtime = fs.statSync(full).mtimeMs;
			} catch {
				mtime = 0;
			}
			const prev = seen.get(key);
			if (!prev || mtime > prev.mtime) seen.set(key, {
				file: full,
				mtime
			});
		}
	};
	if (fs.existsSync(root)) walk(root, 0);
	else if (explicitRoot) result.errors.push(`目录不存在: ${root}`);
	for (const [problemKey, v] of seen) result.problems.push({
		problemKey,
		file: v.file,
		mtime: v.mtime > 0 ? new Date(v.mtime).toISOString() : ""
	});
	result.problems.sort((a, b) => a.problemKey.localeCompare(b.problemKey));
	return result;
}
/** 默认扫描根：优先 D:\codeforces，其次用户目录下的 codeforces */
function defaultLocalRoots() {
	const roots = ["D:\\codeforces"];
	const home = process.env.USERPROFILE ?? process.env.HOME;
	if (home) roots.push(path.join(home, "codeforces"));
	return roots;
}
/** 扫描多个根目录，按题号去重 */
function scanLocalProblems(root) {
	const scanned = (root ? [root] : defaultLocalRoots()).map((r) => collect(r, 5, Boolean(root)));
	const merged = /* @__PURE__ */ new Map();
	for (const r of scanned) for (const p of r.problems) if (!merged.has(p.problemKey)) merged.set(p.problemKey, p);
	return {
		scanned,
		problems: [...merged.values()]
	};
}
// src/reviews/collect.ts
/**
* 把本地 Codeforces 目录里出现过的题收进复习库：
* - 题库里有这道题 → 入队（未 AC 的标注「本地 · 待补」）
* - 题库里没有 → 计入 unknown（通常是还没同步题库）
* - 已在复习库 → 跳过
*/
function collectLocalReviews(store, opts = {}) {
	const { scanned, problems } = scanLocalProblems(opts.root);
	const stats = {
		scannedRoots: scanned.map((s) => s.root),
		localProblems: problems.length,
		added: 0,
		skipped: 0,
		unknown: 0,
		notAc: 0,
		errors: scanned.flatMap((s) => s.errors)
	};
	const acKeys = store.getAcKeys();
	const existing = new Set(store.listReviews(false).map((r) => `${r.platform}:${r.problemKey}`));
	for (const item of problems) {
		const problem = store.findProblem("codeforces", item.problemKey);
		if (!problem) {
			stats.unknown++;
			continue;
		}
		if (existing.has(`codeforces:${item.problemKey}`)) {
			stats.skipped++;
			continue;
		}
		const ac = acKeys.has(`codeforces:${item.problemKey}`);
		const review = store.addReview(problem);
		if (!ac) {
			stats.notAc++;
			store.updateReview(review.id, { note: `本地文件 · 待补（${item.file}）` });
		}
		existing.add(`codeforces:${item.problemKey}`);
		stats.added++;
	}
	return stats;
}
// src/tools/sync.ts
function registerSyncTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_sync",
		description: "同步 OJ 平台刷题记录与题库。platform=all 同步所有已绑定账号；指定平台时需提供 handle 或使用已绑定账号。同步为增量：仅拉取上次同步后的新提交。bank=true 时额外拉取题库（Codeforces 约 1 万题，首次 10-30 秒），题库让「今日三档」从未做过的题里选题。",
		parameters: {
			platform: {
				type: "string",
				required: true,
				enum: [
					"all",
					"codeforces",
					"atcoder"
				],
				description: "同步平台"
			},
			handle: {
				type: "string",
				description: "平台用户名（留空则使用已绑定的 handle）"
			},
			bank: {
				type: "boolean",
				description: "是否同时同步题库（默认 false）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const { store, adapters } = host;
			const platform = args.platform;
			const wantBank = args.bank === true;
			const bankTargets = Object.keys(adapters).filter((pf) => typeof adapters[pf]?.fetchProblemBank === "function");
			if (platform === "all") {
				const settings = store.getSettings();
				const results = [];
				for (const [pf, account] of Object.entries(settings.accounts)) {
					if (!account?.handle || !account.enabled) continue;
					const r = await syncPlatform(host, pf, account.handle);
					results.push({
						...r,
						durationMs: 0
					});
				}
				const banks = [];
				if (wantBank) for (const pf of bankTargets) banks.push(await syncBank(host, pf));
				if (results.length === 0 && banks.length === 0) return {
					ok: false,
					error: "没有已绑定的启用账号，请先通过 icpc_settings 绑定平台账号"
				};
				return {
					ok: true,
					results,
					...banks.length > 0 ? { banks } : {}
				};
			}
			if (platform !== "codeforces" && platform !== "atcoder") return {
				ok: false,
				error: `platform 非法: ${platform}`
			};
			let handle = typeof args.handle === "string" ? args.handle.trim() : "";
			if (!handle) handle = store.getHandle(platform) ?? "";
			if (!handle && !wantBank) return {
				ok: false,
				error: `未提供 handle 且没有已绑定的 ${platform} 账号`
			};
			const out = { ok: true };
			if (handle) out.result = await syncPlatform(host, platform, handle);
			if (wantBank) out.bank = await syncBank(host, platform);
			out.reviews = collectLocalReviews(store);
			return out;
		},
		presentCall: (args) => ({
			card: "generic",
			title: `同步 ${args.platform}`
		})
	}));
}
// src/analysis/weakness.ts
function bump$1(map, key, isAc) {
	const cur = map.get(key) ?? {
		attempts: 0,
		ac: 0
	};
	cur.attempts += 1;
	if (isAc) cur.ac += 1;
	map.set(key, cur);
}
function computeWeakness(rows, opts = {}) {
	const minAttempts = opts.minAttempts ?? 5;
	const topN = opts.topN ?? 10;
	const totalAc = rows.filter((r) => r.verdict === "AC").length;
	const avgAcRate = rate(rows.length, totalAc);
	const tagMap = /* @__PURE__ */ new Map();
	const solvedByTag = /* @__PURE__ */ new Map();
	for (const r of rows) {
		const isAc = r.verdict === "AC";
		for (const tag of filterNoiseTags(r.tags)) {
			bump$1(tagMap, tag, isAc);
			if (isAc) {
				if (!solvedByTag.has(tag)) solvedByTag.set(tag, /* @__PURE__ */ new Set());
				solvedByTag.get(tag).add(`${r.platform}:${r.problemKey}`);
			}
		}
	}
	const items = [...tagMap.entries()].map(([tag, s]) => ({
		tag,
		attempts: s.attempts,
		ac: s.ac,
		acRate: rate(s.attempts, s.ac),
		avgAcRate,
		gap: round2(avgAcRate - rate(s.attempts, s.ac)),
		solved: solvedByTag.get(tag)?.size ?? 0
	})).filter((i) => i.attempts >= minAttempts).sort((a, b) => b.gap - a.gap).slice(0, topN);
	const diffMap = /* @__PURE__ */ new Map();
	for (const r of rows) bump$1(diffMap, bucketForDifficulty(r.difficulty), r.verdict === "AC");
	return {
		items,
		byDifficulty: [...diffMap.entries()].map(([bucket, s]) => ({
			bucket,
			attempts: s.attempts,
			ac: s.ac,
			acRate: rate(s.attempts, s.ac),
			gap: round2(avgAcRate - rate(s.attempts, s.ac))
		})).filter((i) => i.attempts >= minAttempts).sort((a, b) => b.gap - a.gap),
		generatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
// src/analysis/trend.ts
function getWeekKey(d) {
	const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const dayNum = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - dayNum + 3);
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 864e5 - 3 + (firstThursday.getUTCDay() + 6) % 7) / 7);
	return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function bump(map, key, isAc) {
	const cur = map.get(key) ?? {
		attempts: 0,
		ac: 0
	};
	cur.attempts += 1;
	if (isAc) cur.ac += 1;
	map.set(key, cur);
}
function computeTrend(rows, weeks = 12, now = /* @__PURE__ */ new Date()) {
	const byWeek = /* @__PURE__ */ new Map();
	const solvedByWeek = /* @__PURE__ */ new Map();
	const acDifficultyByWeek = /* @__PURE__ */ new Map();
	const distByWeek = /* @__PURE__ */ new Map();
	for (const r of rows) {
		const wk = getWeekKey(new Date(r.submittedAt));
		const isAc = r.verdict === "AC";
		bump(byWeek, wk, isAc);
		if (isAc) {
			if (!solvedByWeek.has(wk)) solvedByWeek.set(wk, /* @__PURE__ */ new Set());
			solvedByWeek.get(wk).add(`${r.platform}:${r.problemKey}`);
			if (r.difficulty !== null && Number.isFinite(r.difficulty)) {
				if (!acDifficultyByWeek.has(wk)) acDifficultyByWeek.set(wk, []);
				acDifficultyByWeek.get(wk).push(r.difficulty);
			}
			const bucket = bucketForDifficulty(r.difficulty);
			if (!distByWeek.has(wk)) distByWeek.set(wk, /* @__PURE__ */ new Map());
			const dist = distByWeek.get(wk);
			dist.set(bucket, (dist.get(bucket) ?? 0) + 1);
		}
	}
	const cursor = /* @__PURE__ */ new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (weeks - 1) * 7 * 864e5);
	const points = [];
	for (let i = 0; i < weeks; i++) {
		const wk = getWeekKey(cursor);
		const s = byWeek.get(wk) ?? {
			attempts: 0,
			ac: 0
		};
		const diffs = acDifficultyByWeek.get(wk) ?? [];
		const avg = diffs.length === 0 ? null : Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length * 10) / 10;
		const dist = {};
		for (const [bucket, count] of distByWeek.get(wk) ?? /* @__PURE__ */ new Map()) dist[bucket] = count;
		points.push({
			week: wk,
			attempts: s.attempts,
			ac: s.ac,
			solved: solvedByWeek.get(wk)?.size ?? 0,
			avgDifficulty: avg,
			difficultyDist: dist
		});
		cursor.setUTCDate(cursor.getUTCDate() + 7);
	}
	return points;
}
// src/tools/stats.ts
function registerStatsTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_stats",
		description: "查询刷题统计。metric=overall 总体统计（尝试/AC/AC率/各平台/各难度/各标签）；metric=weakness 弱项画像（各标签/难度桶相对自身均值的偏差，gap>0 为弱项）；metric=trend 最近 N 周趋势。",
		parameters: {
			metric: {
				type: "string",
				enum: [
					"overall",
					"weakness",
					"trend"
				],
				default: "overall"
			},
			from: {
				type: "string",
				description: "起始时间 ISO8601（overall）"
			},
			to: {
				type: "string",
				description: "截止时间 ISO8601（overall）"
			},
			platform: {
				type: "string",
				enum: ["codeforces", "atcoder"],
				description: "限定平台（overall）"
			},
			weeks: {
				type: "number",
				description: "趋势周数（trend，默认 12）"
			},
			minAttempts: {
				type: "number",
				description: "弱项最小尝试次数（默认 5）"
			},
			topN: {
				type: "number",
				description: "弱项返回条数（默认 10）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const rows = host.store.getSubmissionRows();
			const metric = args.metric || "overall";
			if (metric === "overall") return {
				ok: true,
				data: computeOverall(rows, {
					from: str(args.from),
					to: str(args.to),
					platform: args.platform
				})
			};
			if (metric === "weakness") return {
				ok: true,
				data: computeWeakness(rows, {
					minAttempts: num(args.minAttempts, 5, 1, 1e3),
					topN: num(args.topN, 10, 1, 100)
				})
			};
			return {
				ok: true,
				data: computeTrend(rows, num(args.weeks, 12, 1, 52))
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: `统计：${args.metric || "overall"}`
		})
	}));
}
// src/analysis/replay.ts
/** 从 problemKey 推出比赛号：2283C → 2283，1858E1 → 1858 */
function contestIdOf(problemKey) {
	const m = /^(\d{3,6})([A-Z]\d?)$/.exec(problemKey);
	return m ? Number(m[1]) : null;
}
function minutesBetween(startIso, atIso) {
	return Math.max(0, Math.round((new Date(atIso).getTime() - new Date(startIso).getTime()) / 6e4));
}
/** 最近 days 天内有过提交的比赛号（按最近提交时间倒序） */
function recentContestIds(store, days = 30) {
	const since = (/* @__PURE__ */ new Date(Date.now() - days * 864e5)).toISOString();
	const seen = /* @__PURE__ */ new Map();
	for (const s of store.getSubmissionRows()) {
		if (s.platform !== "codeforces" || s.submittedAt < since) continue;
		const id = contestIdOf(s.problemKey);
		if (id === null) continue;
		const prev = seen.get(id);
		if (!prev || s.submittedAt > prev) seen.set(id, s.submittedAt);
	}
	return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
}
function buildReplay(store, contestId, meta) {
	const byKey = /* @__PURE__ */ new Map();
	for (const s of store.getSubmissionRows()) {
		if (s.platform !== "codeforces") continue;
		if (contestIdOf(s.problemKey) !== contestId) continue;
		const cur = byKey.get(s.problemKey) ?? {
			verdicts: [],
			times: []
		};
		cur.verdicts.push(s.verdict);
		cur.times.push(s.submittedAt);
		byKey.set(s.problemKey, cur);
	}
	const startIso = meta.startTimeIso;
	const problems = [];
	for (const [problemKey, data] of byKey) {
		const problem = store.findProblem("codeforces", problemKey);
		const ordered = data.verdicts.map((v, i) => ({
			v,
			t: data.times[i]
		})).sort((a, b) => a.t.localeCompare(b.t));
		const times = ordered.map((o) => o.t);
		const solvedAt = ordered.find((o) => o.v === "AC")?.t ?? null;
		const failCounts = /* @__PURE__ */ new Map();
		for (const o of ordered) {
			if (o.v === "AC") continue;
			failCounts.set(o.v, (failCounts.get(o.v) ?? 0) + 1);
		}
		problems.push({
			problemKey,
			index: problemKey.replace(/^\d+/, ""),
			attempts: ordered.length,
			verdicts: ordered.map((o) => o.v),
			firstAt: times[0] ?? null,
			solvedAt,
			firstMinutes: startIso && times[0] ? minutesBetween(startIso, times[0]) : null,
			solvedMinutes: startIso && solvedAt ? minutesBetween(startIso, solvedAt) : null,
			difficulty: problem?.difficulty ?? null,
			tags: problem?.tags ?? [],
			solved: solvedAt !== null,
			failReasons: [...failCounts.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}×${n}`)
		});
	}
	problems.sort((a, b) => (a.firstMinutes ?? 1e9) - (b.firstMinutes ?? 1e9));
	const weights = /* @__PURE__ */ new Map();
	for (const p of problems) {
		const w = !p.solved ? 2 : p.attempts >= 3 ? 1 : 0;
		if (w === 0) continue;
		for (const tag of p.tags) weights.set(tag, (weights.get(tag) ?? 0) + w);
	}
	return {
		contestId,
		name: meta.name,
		startAt: meta.startTimeIso,
		durationMinutes: meta.durationMinutes,
		problems,
		summary: {
			problems: problems.length,
			solved: problems.filter((p) => p.solved).length,
			attempts: problems.reduce((n, p) => n + p.attempts, 0),
			solvedMinutes: problems.reduce((n, p) => n + (p.solvedMinutes ?? 0), 0)
		},
		weakTags: [...weights.entries()].map(([tag, weight]) => ({
			tag,
			weight
		})).sort((a, b) => b.weight - a.weight)
	};
}
/** 最近几场比赛暴露的标签分数（归一化到 0..1），供今日训练与历史弱项各占 50% 融合 */
function replayTagScores(store, metaOf, opts = {}) {
	const ids = recentContestIds(store, opts.days ?? 30).slice(0, opts.contests ?? 3);
	const raw = /* @__PURE__ */ new Map();
	for (const id of ids) {
		const report = buildReplay(store, id, metaOf(id) ?? {
			name: `contest ${id}`,
			startTimeIso: null,
			durationMinutes: 120
		});
		for (const w of report.weakTags) raw.set(w.tag, (raw.get(w.tag) ?? 0) + w.weight);
	}
	const max = Math.max(1, ...raw.values());
	const out = /* @__PURE__ */ new Map();
	for (const [tag, v] of raw) out.set(tag, v / max);
	return out;
}
// src/analysis/today.ts
const BAND_LABELS = {
	consolidation: {
		label: "巩固区",
		description: "略低于当前水平，练稳定性和手感"
	},
	core: {
		label: "同段区",
		description: "贴合当前水平，每天最主要的能力训练"
	},
	challenge: {
		label: "挑战区",
		description: "略高于当前水平，试探新的上限"
	}
};
function bandRanges(level) {
	return {
		consolidation: {
			...BAND_LABELS.consolidation,
			key: "consolidation",
			min: level - 200,
			max: level - 1,
			center: level - 100
		},
		core: {
			...BAND_LABELS.core,
			key: "core",
			min: level,
			max: level + 200,
			center: level + 100
		},
		challenge: {
			...BAND_LABELS.challenge,
			key: "challenge",
			min: level + 201,
			max: level + 400,
			center: level + 300
		}
	};
}
function estimateLevel(acDifficulties, fallback = 1200) {
	const xs = acDifficulties.filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
	if (xs.length === 0) return fallback;
	const mid = Math.floor(xs.length / 2);
	const median = xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
	return Math.round(median / 100) * 100;
}
function weakOverlap(tags, weakTags) {
	const weak = new Set(weakTags);
	return tags.filter((t) => weak.has(t));
}
function pickBand(candidates, band, count, weakTags, excludeIds, rotate = 0, focusTags = [], tagScores) {
	const inBand = candidates.filter((c) => c.difficulty != null && band.min != null && band.max != null && c.difficulty >= band.min && c.difficulty <= band.max && !excludeIds.has(c.id));
	const focus = new Set(focusTags);
	const scoreOf = (tags) => tagScores ? tags.reduce((s, t) => s + (tagScores.get(t) ?? 0), 0) : 0;
	const ordered = inBand.map((c) => ({
		c,
		weak: weakOverlap(c.tags, weakTags),
		focus: c.tags.filter((t) => focus.has(t))
	})).sort((a, b) => b.focus.length * 2 + scoreOf(b.c.tags) - (a.focus.length * 2 + scoreOf(a.c.tags)) || Math.abs((a.c.difficulty ?? 0) - (band.center ?? 0)) - Math.abs((b.c.difficulty ?? 0) - (band.center ?? 0)) || a.c.id - b.c.id);
	const start = ordered.length ? rotate % ordered.length : 0;
	const picked = [...ordered.slice(start), ...ordered.slice(0, start)].slice(0, count);
	return {
		pool: inBand.length,
		problems: picked.map(({ c, weak, focus: hit }) => ({
			id: c.id,
			platform: c.platform,
			problemKey: c.problemKey,
			title: c.title,
			difficulty: c.difficulty,
			url: c.url,
			tags: c.tags,
			weakTags: hit.length > 0 ? [.../* @__PURE__ */ new Set([...hit, ...weak])] : weak
		}))
	};
}
// src/tools/today.ts
const DEFAULT_COUNTS = {
	consolidation: 2,
	core: 3,
	challenge: 1
};
const BAND_KEYS = [
	"consolidation",
	"core",
	"challenge"
];
function registerTodayTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_today",
		description: "获取今日三档训练推荐。系统根据近期 AC 难度中位数估算能力值，按巩固区/同段区/挑战区三档推荐题目，弱项标签优先。同时返回到期复习数和今日计划进度。",
		parameters: {
			consolidation: {
				type: "number",
				description: "巩固区题量（默认 2）"
			},
			core: {
				type: "number",
				description: "同段区题量（默认 3）"
			},
			challenge: {
				type: "number",
				description: "挑战区题量（默认 1）"
			},
			rotate: {
				type: "number",
				description: "换一批偏移量"
			},
			windowDays: {
				type: "number",
				description: "能力值窗口天数（默认 60）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const { store } = host;
			const todayStr = localDay$1();
			const windowDays = num(args.windowDays, 60, 7, 365);
			const since = (/* @__PURE__ */ new Date(Date.now() - windowDays * 864e5)).toISOString();
			let recentDiffs = store.getRecentAcDifficulties(since);
			if (recentDiffs.length < 5) recentDiffs = store.getRecentAcDifficulties("1970-01-01");
			const level = estimateLevel(recentDiffs);
			const planKeys = new Set(store.getTasksByDate(todayStr).filter((t) => t.problemKey && t.platform).map((t) => String(t.platform) + ":" + String(t.problemKey)));
			const candidates = store.getUnsolvedCandidates().filter((p) => !planKeys.has(p.platform + ":" + p.problemKey)).map((p) => ({
				id: p.id,
				platform: p.platform,
				problemKey: p.problemKey,
				title: p.title,
				difficulty: p.difficulty,
				url: p.url,
				tags: p.tags
			}));
			const weakItems = computeWeakness(store.getSubmissionRows(), {
				minAttempts: 5,
				topN: 15
			}).items.filter((i) => i.gap > 0);
			const weakTags = weakItems.map((i) => i.tag);
			const metaMap = /* @__PURE__ */ new Map();
			try {
				for (const c of await host.adapters["codeforces"].fetchContests()) {
					const id = Number(String(c.id).replace(/^cf-/, ""));
					if (Number.isFinite(id)) metaMap.set(id, {
						name: c.name,
						startTimeIso: c.startTimeIso,
						durationMinutes: c.durationMinutes
					});
				}
			} catch {}
			const replayScores = replayTagScores(store, (id) => metaMap.get(id) ?? null);
			const maxGap = Math.max(1, ...weakItems.map((i) => i.gap));
			const tagScores = /* @__PURE__ */ new Map();
			for (const [tag, v] of replayScores) tagScores.set(tag, .5 * v);
			for (const i of weakItems) tagScores.set(i.tag, (tagScores.get(i.tag) ?? 0) + .5 * (i.gap / maxGap));
			const focus = store.currentFocus(todayStr);
			const focusTags = focus?.tags ?? [];
			const ranges = bandRanges(level);
			const rotate = num(args.rotate, 0, 0, 500);
			const exclude = /* @__PURE__ */ new Set();
			const bands = BAND_KEYS.map((key) => {
				const q = Number(args[key]);
				const count = Number.isInteger(q) && q >= 0 && q <= 6 ? q : DEFAULT_COUNTS[key];
				const picked = pickBand(candidates, ranges[key], count, weakTags, exclude, rotate, focusTags, tagScores);
				for (const p of picked.problems) exclude.add(p.id);
				return {
					key,
					label: ranges[key].label,
					description: ranges[key].description,
					range: [ranges[key].min, ranges[key].max],
					problems: picked.problems,
					pool: picked.pool
				};
			});
			const indexed = bands.flatMap((b) => b.problems.map((p) => `${p.platform}:${p.problemKey}`));
			if (indexed.length > 0) store.setTrainingIndex(todayStr, indexed);
			const dueReviews = store.getDueCount();
			const tasks = store.getTasksByDate(todayStr);
			const checked = tasks.filter((t) => t.checked).length;
			const planProblems = tasks.filter((t) => t.problemKey && t.platform).map((t) => ({
				problemKey: t.problemKey,
				url: t.url ?? null,
				title: t.title
			}));
			return {
				ok: true,
				data: {
					date: todayStr,
					level,
					bands,
					dueReviews,
					focus: focus ? {
						week: focus.week,
						direction: focus.direction,
						tags: focus.tags
					} : null,
					planProblems,
					planProgress: tasks.length > 0 ? {
						total: tasks.length,
						checked
					} : null
				}
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "今日训练推荐"
		})
	}));
}
// src/plans/planService.ts
const TASK_KINDS = [
	"practice",
	"review",
	"topic",
	"contest"
];
function today() {
	return localDay();
}
function addDays(dateStr, n) {
	const d = /* @__PURE__ */ new Date(`${dateStr}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}
function parsePlanJson(raw, startDate, days) {
	let text = raw.trim();
	if (text.includes("```")) text = text.replace(/```[a-zA-Z]*\s*/g, "").trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start !== -1 && end > start) text = text.slice(start, end + 1);
	let obj;
	try {
		obj = JSON.parse(text);
	} catch (e) {
		try {
			obj = JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
		} catch {
			throw new Error(`AI 输出不是合法 JSON: ${e.message}`);
		}
	}
	if (typeof obj.title !== "string" || !obj.title.trim()) throw new Error("AI 输出缺少 title");
	if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) throw new Error("AI 输出缺少 tasks");
	const startMs = Date.parse(`${startDate}T00:00:00Z`);
	const endMs = startMs + (days - 1) * 864e5;
	const inRange = (d) => {
		const ms = Date.parse(`${d}T00:00:00Z`);
		return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
	};
	const tasks = obj.tasks.filter((t) => typeof t === "object" && t !== null).filter((t) => typeof t.title === "string" && t.title.trim() && typeof t.date === "string").filter((t) => inRange(t.date)).map((t) => ({
		date: t.date,
		title: t.title,
		kind: TASK_KINDS.includes(t.kind) ? t.kind : "practice",
		platform: t.platform,
		problemKey: t.problemKey,
		url: t.url,
		note: t.note
	}));
	if (tasks.length === 0) throw new Error("AI 输出 tasks 中没有有效任务");
	return {
		title: obj.title,
		goal: typeof obj.goal === "string" ? obj.goal : "",
		startDate,
		days,
		tasks
	};
}
// src/workbench-overview.ts
function dayKey(iso) {
	return localDay$1(iso);
}
/** 每天的活动：AC 题数（去重）/ 提交数 / 计划任务 / 今日训练完成度 */
function buildDayCells(store, days, todayStr) {
	const since = addDaysLocal(todayStr, -(days - 1));
	const map = /* @__PURE__ */ new Map();
	for (const s of store.getSubmissionRows()) {
		const day = dayKey(s.submittedAt);
		if (day < since) continue;
		const cur = map.get(day) ?? {
			ac: /* @__PURE__ */ new Set(),
			submissions: 0
		};
		cur.submissions++;
		if (s.verdict === "AC") cur.ac.add(`${s.platform}:${s.problemKey}`);
		map.set(day, cur);
	}
	const cells = [];
	for (let i = 0; i < days; i++) {
		const date = addDaysLocal(since, i);
		const activity = map.get(date);
		const acSet = activity?.ac ?? /* @__PURE__ */ new Set();
		const tasks = store.getTasksByDate(date);
		const checked = tasks.filter((t) => t.checked).length;
		const index = store.getTrainingIndex(date);
		const trainingDone = index.filter((k) => acSet.has(k)).length;
		cells.push({
			date,
			ac: acSet.size,
			submissions: activity?.submissions ?? 0,
			tasks: tasks.length,
			checked,
			trainingTotal: index.length,
			trainingDone,
			done: index.length > 0 ? trainingDone === index.length : acSet.size > 0
		});
	}
	return cells;
}
function buildTodayStatus(store, todayStr) {
	const cell = buildDayCells(store, 1, todayStr)[0];
	const tasks = store.getTasksByDate(todayStr);
	const pending = tasks.filter((t) => !t.checked);
	const acKeys = store.getAcKeys();
	const index = store.getTrainingIndex(todayStr);
	const completed = index.filter((k) => acKeys.has(k));
	const training = {
		total: index.length,
		completed: completed.length,
		started: completed.length > 0,
		done: index.length > 0 && completed.length === index.length
	};
	const planTaskList = tasks.filter((t) => t.problemKey && t.platform);
	const planRemaining = planTaskList.filter((t) => !acKeys.has(`${t.platform}:${t.problemKey}`)).map((t) => ({
		problemKey: t.problemKey,
		url: t.url ?? null
	}));
	const planTasks = {
		total: planTaskList.length,
		completed: planTaskList.length - planRemaining.length,
		remaining: planRemaining
	};
	const planDone = planTaskList.length === 0 || planRemaining.length === 0;
	const unresolved = [];
	const seen = /* @__PURE__ */ new Set();
	for (const s of store.getSubmissionRows()) {
		if (dayKey(s.submittedAt) !== todayStr) continue;
		const key = `${s.platform}:${s.problemKey}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (!acKeys.has(key)) unresolved.push(s.problemKey);
	}
	if (!training.done || !planDone) {
		const left = index.filter((k) => !acKeys.has(k)).map((k) => {
			const [platform, problemKey] = k.split(":");
			return {
				problemKey,
				url: store.findProblem(platform, problemKey)?.url ?? null
			};
		});
		const items = [];
		if (index.length === 0) items.push("今天还没开始训练：点「今日训练」抽出今天的 3 档题");
		else if (!training.done) items.push(`今日训练还剩 ${left.length} 题`);
		if (!planDone) items.push(`计划任务还剩 ${planRemaining.length} 题：${planRemaining.map((p) => p.problemKey).join("、")}`);
		if (pending.length > 0) items.push(`未完成任务：${pending.slice(0, 3).map((t) => t.title).join("；")}`);
		if (unresolved.length > 0 && !training.done) items.push(`今天试过但没 AC：${unresolved.slice(0, 3).join("、")}`);
		return {
			date: todayStr,
			ac: cell.ac,
			submissions: cell.submissions,
			tasks: {
				total: tasks.length,
				checked: tasks.length - pending.length
			},
			training: {
				...training,
				remaining: left
			},
			planTasks,
			done: false,
			advice: {
				kind: "catchup",
				title: index.length === 0 && planTasks.total === 0 ? "今日未开始" : `今日训练 ${completed.length}/${index.length} + 计划 ${planTasks.completed}/${planTasks.total}`,
				items
			}
		};
	}
	return {
		date: todayStr,
		ac: cell.ac,
		submissions: cell.submissions,
		tasks: {
			total: tasks.length,
			checked: tasks.length
		},
		training: {
			...training,
			remaining: []
		},
		planTasks: {
			...planTasks,
			remaining: []
		},
		done: true,
		advice: {
			kind: "extra",
			title: "今日训练完成，可以加训",
			items: [`今天 AC 了 ${cell.ac} 题（含训练外），可以再从「今日训练」换一批挑战题`, unresolved.length > 0 ? `顺手把没 AC 的 ${unresolved.slice(0, 3).join("、")} 加进复习库` : "把今天的新题型加进复习库（icpc_review add）"]
		}
	};
}
/** 连续打卡：以「当天有 AC」为准，而不是手动勾选 */
function acStreak(store, todayStr) {
	const days = /* @__PURE__ */ new Set();
	for (const s of store.getSubmissionRows()) if (s.verdict === "AC") days.add(dayKey(s.submittedAt));
	if (days.size === 0) return {
		current: 0,
		longest: 0,
		totalDays: 0
	};
	const toNum = (d) => Math.floor((/* @__PURE__ */ new Date(`${d}T00:00:00Z`)).getTime() / 864e5);
	const nums = [...days].map(toNum).sort((a, b) => a - b);
	let longest = 1;
	let run = 1;
	for (let i = 1; i < nums.length; i++) {
		run = nums[i] - nums[i - 1] === 1 ? run + 1 : 1;
		if (run > longest) longest = run;
	}
	const set = new Set(nums);
	const today = toNum(todayStr);
	let cursor = set.has(today) ? today : today - 1;
	let current = 0;
	while (set.has(cursor)) {
		current++;
		cursor--;
	}
	return {
		current,
		longest,
		totalDays: days.size
	};
}
/** 数据概览（客户端右侧视图用的快照，和 icpc_stats 同源） */
function buildStats(store) {
	const rows = store.getSubmissionRows();
	const overall = computeOverall(rows);
	const weakness = computeWeakness(rows, {
		minAttempts: 5,
		topN: 6
	});
	return {
		totals: {
			attempts: overall.attempts,
			ac: overall.ac,
			acRate: overall.acRate,
			solvedProblems: overall.solvedProblems,
			touched: new Set(rows.map((r) => `${r.platform}:${r.problemKey}`)).size
		},
		byDifficulty: overall.byDifficulty,
		platforms: overall.byPlatform,
		weakTags: weakness.items.filter((i) => i.gap > 0).slice(0, 6).map((i) => ({
			tag: i.tag,
			attempts: i.attempts,
			acRate: i.acRate,
			gap: i.gap
		}))
	};
}
function sendJson$4(res, status, body) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
function trustedOrigin$4(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	const host = req.headers.host;
	return origin === `http://${host}` || origin === `https://${host}`;
}
function registerOverviewRoute(ctx, store) {
	if (!ctx.webServer) return;
	ctx.effect(() => {
		const off = ctx.webServer.register({
			kind: "exact",
			path: "/icpc-workbench/overview",
			handler(req, res) {
				if (req.method !== "GET") {
					res.setHeader("allow", "GET");
					sendJson$4(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!trustedOrigin$4(req)) {
					sendJson$4(res, 403, {
						ok: false,
						error: "origin-not-allowed"
					});
					return;
				}
				try {
					const url = new URL(req.url ?? "/", "http://localhost");
					const days = Math.min(371, Math.max(7, Number(url.searchParams.get("days") ?? 84) || 84));
					const todayStr = localDay$1();
					sendJson$4(res, 200, {
						ok: true,
						today: buildTodayStatus(store, todayStr),
						streak: acStreak(store, todayStr),
						days: buildDayCells(store, days, todayStr)
					});
				} catch (e) {
					sendJson$4(res, 500, {
						ok: false,
						error: e.message
					});
				}
			}
		});
		const offStats = ctx.webServer.register({
			kind: "exact",
			path: "/icpc-workbench/stats",
			handler(req, res) {
				if (req.method !== "GET") {
					res.setHeader("allow", "GET");
					sendJson$4(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!trustedOrigin$4(req)) {
					sendJson$4(res, 403, {
						ok: false,
						error: "origin-not-allowed"
					});
					return;
				}
				try {
					sendJson$4(res, 200, {
						ok: true,
						stats: buildStats(store)
					});
				} catch (e) {
					sendJson$4(res, 500, {
						ok: false,
						error: e.message
					});
				}
			}
		});
		return () => {
			off();
			offStats();
		};
	});
}
// src/plans/weekly.ts
const DIRECTION_BY_TAG = {
	"data structures": "数据结构：前缀和 / 树状数组 / 线段树",
	trees: "树上算法：DFS 序、LCA、子树统计",
	"dfs and similar": "搜索与连通性：DFS/BFS 建模",
	graphs: "图论基础：最短路、拓扑排序、并查集",
	dsu: "图论基础：并查集",
	"binary search": "二分：二分答案与判定函数",
	dp: "动态规划：状态设计与转移",
	bitmasks: "位运算：掩码枚举与贪心配对",
	geometry: "计算几何：向量与叉积",
	strings: "字符串：哈希、KMP、字典树",
	hashing: "字符串：哈希",
	"constructive algorithms": "构造：找不变量与特例",
	sortings: "排序与贪心：排序后扫描",
	greedy: "贪心：交换论证",
	"number theory": "数论：整除、同余、筛法",
	"two pointers": "双指针：单调性维护",
	implementation: "实现：细节与边界",
	"brute force": "暴力与剪枝",
	combinatorics: "组合计数：容斥与组合数",
	games: "博弈：状态与奇偶性"
};
function shortDirection(title) {
	const i = title.indexOf("：");
	return i > 0 ? title.slice(0, i) : title;
}
/** 近期（默认 28 天）每个 tag 的 AC 题数，用来避免连续几周练同一个方向 */
function recentAcByTag(store, sinceDays = 28) {
	const since = localDay$1(/* @__PURE__ */ new Date(Date.now() - sinceDays * 864e5));
	const map = /* @__PURE__ */ new Map();
	const seen = /* @__PURE__ */ new Set();
	for (const s of store.getSubmissionRows()) {
		if (s.verdict !== "AC" || s.submittedAt.slice(0, 10) < since) continue;
		const key = `${s.platform}:${s.problemKey}`;
		if (seen.has(key)) continue;
		seen.add(key);
		for (const tag of s.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
	}
	return map;
}
function buildWeeklyPlan(store, opts = {}) {
	const days = Math.min(90, Math.max(7, opts.days ?? 28));
	const startDate = opts.startDate ?? localDay$1();
	const weekCount = Math.ceil(days / 7);
	const weakness = computeWeakness(store.getSubmissionRows(), {
		minAttempts: 5,
		topN: 40
	});
	const recent = recentAcByTag(store);
	const ranked = weakness.items.filter((i) => i.gap > 0).map((i) => ({
		tag: i.tag,
		weight: i.gap - (recent.get(i.tag) ?? 0) * 2,
		gap: i.gap,
		attempts: i.attempts
	})).sort((a, b) => b.weight - a.weight);
	const picked = [];
	for (const item of ranked) {
		if (picked.length >= weekCount) break;
		if (picked.some((p) => p.tag === item.tag)) continue;
		picked.push(item);
	}
	const FALLBACK = [
		"implementation",
		"greedy",
		"binary search",
		"sortings",
		"dp",
		"data structures",
		"trees",
		"graphs",
		"constructive algorithms",
		"two pointers",
		"bitmasks",
		"strings",
		"number theory",
		"geometry"
	];
	for (let k = 0; picked.length < weekCount; k++) picked.push({
		tag: FALLBACK[k % FALLBACK.length],
		gap: 0,
		attempts: 0
	});
	const diffs = store.getRecentAcDifficulties("1970-01-01").sort((a, b) => a - b);
	const median = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 1200;
	const level = Math.round(median / 100) * 100;
	const low = Math.max(800, level - 100);
	const high = level + 300;
	const weeks = [];
	const tasks = [];
	const usedKeys = /* @__PURE__ */ new Set();
	/** 某方向的候选题（题库里未做过的，难度落在计划区间），按离区间中心由近到远 */
	const poolFor = (tag) => {
		const center = (low + high) / 2;
		return store.browseProblems({
			bank: true,
			tag,
			limit: 8e3
		}).filter((p) => p.difficulty != null && p.difficulty >= low && p.difficulty <= high && p.attempts === 0).sort((a, b) => Math.abs((a.difficulty ?? 0) - center) - Math.abs((b.difficulty ?? 0) - center)).map((p) => ({
			platform: p.platform,
			problemKey: p.problemKey,
			title: p.title,
			url: p.url
		}));
	};
	for (let w = 0; w < weekCount; w++) {
		const pick = picked[w] ?? {
			tag: "implementation",
			gap: 0,
			attempts: 0
		};
		const direction = DIRECTION_BY_TAG[pick.tag] ?? `专项：${pick.tag}`;
		const weekStart = addDays(startDate, w * 7);
		const weekEnd = addDays(weekStart, 6);
		const rationale = pick.gap > 0 ? `${pick.tag} 的 AC 率比你的平均低 ${pick.gap.toFixed(1)} 个百分点（${pick.attempts} 次尝试），这周集中补它。` : `巩固 ${pick.tag}：上一轮已经练过，这周用更高一档难度再走一遍。`;
		weeks.push({
			week: w + 1,
			startDate: weekStart,
			endDate: weekEnd,
			direction,
			tags: [pick.tag],
			rationale
		});
		const pool = poolFor(pick.tag);
		let cursor = 0;
		const take = (n) => {
			const out = [];
			while (out.length < n && cursor < pool.length) {
				const p = pool[cursor++];
				const key = `${p.platform}:${p.problemKey}`;
				if (usedKeys.has(key)) continue;
				usedKeys.add(key);
				out.push(p);
			}
			return out;
		};
		for (let d = 0; d < 7; d++) {
			const date = addDays(weekStart, d);
			if (date > addDays(startDate, days - 1)) break;
			if (d === 6) {
				tasks.push({
					date,
					title: `W${w + 1} 复盘：${shortDirection(direction)} · 回看本周错题`,
					kind: "review",
					platform: "codeforces",
					note: "把本周没做出来的题重写一遍；到期复习用 icpc_review list。"
				});
				continue;
			}
			const count = 2 + (w > 0 ? 1 : 0);
			const picks = take(count);
			if (picks.length === 0) {
				tasks.push({
					date,
					title: `W${w + 1} ${shortDirection(direction)} · ${count} 题（${low}–${high}）`,
					kind: "practice",
					platform: "codeforces",
					note: "题库里这个方向的题不够了，用 icpc_today 现选。"
				});
				continue;
			}
			for (const p of picks) tasks.push({
				date,
				title: `W${w + 1} ${shortDirection(direction)} · ${p.problemKey} ${p.title}`,
				kind: "practice",
				platform: p.platform,
				problemKey: p.problemKey,
				url: p.url,
				note: `${shortDirection(direction)} · 难度区间 ${low}–${high}`
			});
		}
	}
	const head = weeks[0]?.direction ?? "基础巩固";
	return {
		title: `${weekCount} 周训练计划 · 每周一个方向`,
		goal: `按周推进：第 1 周「${head}」，之后每周换一个弱项方向。每天题量固定，题目由今日训练按方向现选。`,
		level,
		weeks,
		plan: {
			title: `${weekCount} 周训练计划（v4.1）`,
			goal: `每周一个固定方向，题目在今日训练中现选；难度区间 ${low}–${high}。`,
			startDate,
			endDate: addDays(startDate, days - 1),
			source: "template",
			weeks: weeks.map((w) => ({
				index: w.week,
				startDate: w.startDate,
				direction: w.direction,
				tags: w.tags
			})),
			tasks
		}
	};
}
// src/tools/plans.ts
function registerPlanTools(host, ctx) {
	const disposeGenerate = ctx.tools.register(defineTool({
		name: "icpc_generate_plan",
		description: "生成训练计划（v4.1：每周固定一个大方向）。按弱项 gap 排序，每周一个方向；每日只排题量与难度区间，具体题目在「今日训练」里现选。",
		parameters: {
			days: {
				type: "number",
				description: "计划天数（默认 14，范围 1-90）"
			},
			startDate: {
				type: "string",
				description: "起始日期 YYYY-MM-DD（默认今天）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const days = num(args.days, 14, 1, 90);
			const startDate = str(args.startDate) ?? localDay$1();
			try {
				const built = buildWeeklyPlan(host.store, {
					days,
					startDate
				});
				const plan = host.store.createPlan({
					...built.plan,
					tasks: built.plan.tasks.map((t) => ({
						id: 0,
						taskDate: t.date,
						title: t.title,
						kind: t.kind,
						platform: t.platform,
						problemKey: t.problemKey,
						url: t.url ?? null,
						note: t.note ?? null,
						checked: false
					}))
				});
				return {
					ok: true,
					planId: plan.id,
					title: built.title,
					goal: built.goal,
					level: built.level,
					weeks: built.weeks,
					taskCount: plan.tasks.length
				};
			} catch (e) {
				return {
					ok: false,
					error: e.message
				};
			}
		},
		presentCall: () => ({
			card: "generic",
			title: "生成训练计划"
		})
	}));
	const disposeManage = ctx.tools.register(defineTool({
		name: "icpc_manage_plan",
		description: "管理训练计划。action=list 列出所有计划；action=detail 查看计划详情；action=checkin 打卡；action=uncheck 取消打卡；action=delete 删除计划；action=import 导入 AI 返回的 JSON 计划文本；action=update_task 编辑单条任务（taskDate/title/kind/url/note）；action=delete_task 删除单条任务。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: [
					"list",
					"detail",
					"checkin",
					"uncheck",
					"delete",
					"import",
					"update_task",
					"delete_task"
				]
			},
			planId: {
				type: "number",
				description: "计划 ID（detail/delete）"
			},
			taskId: {
				type: "number",
				description: "任务 ID（checkin/uncheck/update_task/delete_task）"
			},
			raw: {
				type: "string",
				description: "AI JSON 文本（import）"
			},
			days: {
				type: "number",
				description: "计划天数（import，默认 14）"
			},
			startDate: {
				type: "string",
				description: "起始日期（import）"
			},
			taskDate: {
				type: "string",
				description: "任务日期 YYYY-MM-DD（update_task）"
			},
			title: {
				type: "string",
				description: "任务标题（update_task）"
			},
			kind: {
				type: "string",
				enum: [
					"practice",
					"review",
					"topic",
					"contest"
				],
				description: "任务类型（update_task）"
			},
			url: {
				type: "string",
				description: "跳转链接（update_task，空串清除）"
			},
			note: {
				type: "string",
				description: "备注（update_task，空串清除）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const { store } = host;
			const action = args.action;
			switch (action) {
				case "list": return {
					ok: true,
					plans: store.listPlans().map((p) => ({
						id: p.id,
						title: p.title,
						goal: p.goal,
						startDate: p.startDate,
						endDate: p.endDate,
						source: p.source,
						createdAt: p.createdAt,
						taskCount: p.tasks.length,
						checkedCount: p.tasks.filter((t) => t.checked).length
					}))
				};
				case "detail": {
					const id = Number(args.planId);
					const plan = store.getPlan(id);
					if (!plan) return {
						ok: false,
						error: "计划不存在"
					};
					return {
						ok: true,
						plan
					};
				}
				case "checkin": {
					const taskId = Number(args.taskId);
					if (!Number.isInteger(taskId)) return {
						ok: false,
						error: "taskId 必填"
					};
					if (!store.findTask(taskId)) return {
						ok: false,
						error: "任务不存在"
					};
					store.toggleCheckin(taskId, true);
					return { ok: true };
				}
				case "uncheck": {
					const taskId = Number(args.taskId);
					if (!Number.isInteger(taskId)) return {
						ok: false,
						error: "taskId 必填"
					};
					store.toggleCheckin(taskId, false);
					return { ok: true };
				}
				case "delete": {
					const id = Number(args.planId);
					if (!Number.isInteger(id)) return {
						ok: false,
						error: "planId 必填"
					};
					return store.deletePlan(id) ? { ok: true } : {
						ok: false,
						error: "计划不存在"
					};
				}
				case "import": {
					const raw = args.raw;
					if (typeof raw !== "string" || raw.trim() === "") return {
						ok: false,
						error: "raw 必填"
					};
					const sd = str(args.startDate) ?? today();
					const d = num(args.days, 14, 1, 90);
					try {
						const parsed = parsePlanJson(raw, sd, d);
						const plan = store.createPlan({
							title: parsed.title,
							goal: parsed.goal,
							startDate: parsed.startDate,
							endDate: addDays(sd, d - 1),
							source: "ai",
							rawPrompt: raw,
							tasks: parsed.tasks.map((t) => ({
								id: 0,
								taskDate: t.date,
								title: t.title,
								kind: TASK_KINDS.includes(t.kind ?? "") ? t.kind : "practice",
								url: t.url ?? null,
								note: t.note ?? null,
								checked: false
							}))
						});
						return {
							ok: true,
							planId: plan.id,
							title: plan.title,
							taskCount: plan.tasks.length
						};
					} catch (e) {
						return {
							ok: false,
							error: `导入失败：${e.message}`
						};
					}
				}
				case "update_task": {
					const taskId = Number(args.taskId);
					if (!Number.isInteger(taskId)) return {
						ok: false,
						error: "taskId 必填"
					};
					if (!store.findTask(taskId)) return {
						ok: false,
						error: "任务不存在"
					};
					const patch = {};
					if (args.taskDate !== void 0) {
						if (typeof args.taskDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.taskDate)) return {
							ok: false,
							error: "taskDate 格式需为 YYYY-MM-DD"
						};
						patch.taskDate = args.taskDate;
					}
					if (args.title !== void 0) {
						if (typeof args.title !== "string" || !args.title.trim()) return {
							ok: false,
							error: "title 不能为空"
						};
						patch.title = args.title.trim();
					}
					if (args.kind !== void 0) {
						const kind = args.kind;
						if (!TASK_KINDS.includes(kind)) return {
							ok: false,
							error: `kind 非法`
						};
						patch.kind = kind;
					}
					if (args.url !== void 0) patch.url = typeof args.url === "string" && args.url.trim() ? args.url.trim() : null;
					if (args.note !== void 0) patch.note = typeof args.note === "string" && args.note.trim() ? args.note.trim() : null;
					if (Object.keys(patch).length === 0) return {
						ok: false,
						error: "没有可更新字段"
					};
					store.updateTask(taskId, patch);
					return { ok: true };
				}
				case "delete_task": {
					const taskId = Number(args.taskId);
					if (!Number.isInteger(taskId)) return {
						ok: false,
						error: "taskId 必填"
					};
					return store.deleteTask(taskId) ? { ok: true } : {
						ok: false,
						error: "任务不存在"
					};
				}
				default: return {
					ok: false,
					error: `未知 action: ${action}`
				};
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: `计划：${args.action}`
		})
	}));
	return () => {
		disposeGenerate();
		disposeManage();
	};
}
// src/reviews/schedule.ts
const REVIEW_INTERVALS = [
	1,
	3,
	7,
	14,
	30,
	60
];
const MAX_STAGE = REVIEW_INTERVALS.length - 1;
function intervalDaysForStage(stage) {
	return REVIEW_INTERVALS[Math.min(Math.max(0, Math.floor(stage)), MAX_STAGE)];
}
function nextStage(stage, feedback) {
	if (feedback === "hard") return 0;
	if (feedback === "easy") return Math.min(stage + 2, MAX_STAGE);
	return Math.min(stage + 1, MAX_STAGE);
}
function dateAfterDays(baseDate, days) {
	const d = /* @__PURE__ */ new Date(`${baseDate}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
function scheduleNext(stage, feedback, todayStr) {
	const s = nextStage(stage, feedback);
	return {
		stage: s,
		nextDueOn: dateAfterDays(todayStr, intervalDaysForStage(s))
	};
}
// src/tools/reviews.ts
async function contestMetaMap(host) {
	const map = /* @__PURE__ */ new Map();
	try {
		const list = await host.adapters["codeforces"].fetchContests();
		for (const c of list) {
			const id = Number(String(c.id).replace(/^cf-/, ""));
			if (!Number.isFinite(id)) continue;
			map.set(id, {
				name: c.name,
				startTimeIso: c.startTimeIso,
				durationMinutes: c.durationMinutes
			});
		}
	} catch {}
	return map;
}
function registerReviewTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_review",
		description: "Rank 复盘与间隔复习。action=contests 列出近期参与过的比赛（按提交聚合）；action=contest 复盘单场（每题用时/尝试/失败原因/暴露的薄弱标签，并给本地赛事代码路径）；action=list 复习队列（due=true 只看到期）；action=scan 从本地目录自动收题；action=add 手动加题；action=feedback 反馈排期（hard/ok/easy）；action=note 笔记；action=remove 移出。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: [
					"contests",
					"contest",
					"list",
					"scan",
					"add",
					"feedback",
					"note",
					"remove"
				]
			},
			contestId: {
				type: "number",
				description: "比赛号，如 2283（contest 动作）"
			},
			due: {
				type: "boolean",
				description: "list 时只看到期（默认 false）"
			},
			root: {
				type: "string",
				description: "scan 的根目录（默认 D:\\codeforces）"
			},
			platform: {
				type: "string",
				enum: ["codeforces", "atcoder"],
				description: "平台（add）"
			},
			problemKey: {
				type: "string",
				description: "题目标识（add）"
			},
			id: {
				type: "number",
				description: "复习条目 ID（feedback/note/remove）"
			},
			feedback: {
				type: "string",
				enum: [
					"hard",
					"ok",
					"easy"
				],
				description: "复习反馈"
			},
			note: {
				type: "string",
				description: "笔记内容（note）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const { store } = host;
			const action = args.action;
			switch (action) {
				case "contests": {
					const metas = await contestMetaMap(host);
					return {
						ok: true,
						contests: recentContestIds(store, 30).map((id) => {
							const meta = metas.get(id) ?? {
								name: "contest " + id,
								startTimeIso: null,
								durationMinutes: 120
							};
							const r = buildReplay(store, id, meta);
							return {
								contestId: id,
								name: r.name,
								startAt: r.startAt,
								problems: r.summary.problems,
								solved: r.summary.solved,
								attempts: r.summary.attempts,
								weakTags: r.weakTags.slice(0, 3)
							};
						})
					};
				}
				case "contest": {
					const id = Number(args.contestId);
					if (!Number.isInteger(id)) return {
						ok: false,
						error: "contestId 必填"
					};
					const report = buildReplay(store, id, (await contestMetaMap(host)).get(id) ?? {
						name: "contest " + id,
						startTimeIso: null,
						durationMinutes: 120
					});
					return {
						ok: true,
						report,
						codeFiles: scanLocalProblems().problems.filter((p) => report.problems.some((x) => x.problemKey === p.problemKey)).map((p) => ({
							problemKey: p.problemKey,
							file: p.file
						}))
					};
				}
				case "list": return {
					ok: true,
					items: store.listReviews(args.due === true).map((r) => ({
						...r,
						intervalDays: intervalDaysForStage(r.stage)
					}))
				};
				case "scan": return {
					ok: true,
					...collectLocalReviews(store, typeof args.root === "string" && args.root.trim() ? { root: args.root.trim() } : {})
				};
				case "add": {
					const platform = args.platform;
					const problemKey = typeof args.problemKey === "string" ? args.problemKey.trim() : "";
					if (!platform || !problemKey) return {
						ok: false,
						error: "platform 与 problemKey 必填"
					};
					const problem = store.findProblem(platform, problemKey);
					if (!problem) return {
						ok: false,
						error: `题库中不存在 ${platform}/${problemKey}，请先同步`
					};
					return {
						ok: true,
						id: store.addReview(problem).id
					};
				}
				case "feedback": {
					const id = Number(args.id);
					const feedback = args.feedback;
					if (!Number.isInteger(id)) return {
						ok: false,
						error: "id 必填"
					};
					if (!feedback || ![
						"hard",
						"ok",
						"easy"
					].includes(feedback)) return {
						ok: false,
						error: "feedback 需为 'hard' | 'ok' | 'easy'"
					};
					const item = store.getReview(id);
					if (!item) return {
						ok: false,
						error: "复习条目不存在"
					};
					const todayStr = localDay$1();
					const next = scheduleNext(item.stage, feedback, todayStr);
					store.updateReview(id, {
						stage: next.stage,
						nextDueOn: next.nextDueOn,
						lastReviewedAt: (/* @__PURE__ */ new Date()).toISOString()
					});
					return {
						ok: true,
						...next
					};
				}
				case "note": {
					const id = Number(args.id);
					if (!Number.isInteger(id)) return {
						ok: false,
						error: "id 必填"
					};
					if (typeof args.note !== "string") return {
						ok: false,
						error: "note 需为字符串"
					};
					if (!store.updateReview(id, { note: args.note.trim() === "" ? null : args.note })) return {
						ok: false,
						error: "复习条目不存在"
					};
					return { ok: true };
				}
				case "remove": {
					const id = Number(args.id);
					if (!Number.isInteger(id)) return {
						ok: false,
						error: "id 必填"
					};
					if (!store.deleteReview(id)) return {
						ok: false,
						error: "复习条目不存在"
					};
					return { ok: true };
				}
				default: return {
					ok: false,
					error: `未知 action: ${action}`
				};
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: `复盘/复习：${args.action}`
		})
	}));
}
// src/tools/contests.ts
/** 赛事列表 TTL 缓存：CF contest.list / AtCoder contests.json 都是全量数据，避免每次查询都拉一遍 */
const CONTEST_CACHE_TTL_MS = 6e5;
const contestCache = /* @__PURE__ */ new Map();
async function fetchContestsCached(host, pf) {
	const now = Date.now();
	const hit = contestCache.get(pf);
	if (hit && now - hit.at < CONTEST_CACHE_TTL_MS) return hit.data;
	const adapter = host.adapters[pf];
	if (!adapter) return [];
	const data = await adapter.fetchContests();
	contestCache.set(pf, {
		at: now,
		data
	});
	return data;
}
function contestPhase(c, now = Date.now()) {
	if (!c.startTimeIso) return null;
	const start = new Date(c.startTimeIso).getTime();
	const end = start + c.durationMinutes * 6e4;
	if (now < start) return "upcoming";
	if (now < end) return "running";
	return "finished";
}
function registerContestTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_contests",
		description: "查询多平台赛事列表。聚合 Codeforces / AtCoder 公开赛事。type=upcoming 即将开始（按时间升序）；type=finished 已结束（按结束时间降序）。",
		parameters: {
			type: {
				type: "string",
				enum: ["upcoming", "finished"],
				default: "upcoming"
			},
			platform: {
				type: "string",
				enum: ["codeforces", "atcoder"]
			},
			limit: {
				type: "number",
				description: "返回上限（默认 40）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const type = args.type === "finished" ? "finished" : "upcoming";
			const platformFilter = args.platform;
			const limit = num(args.limit, 40, 1, 100);
			const now = Date.now();
			const sources = platformFilter ? [platformFilter] : ["codeforces", "atcoder"];
			const all = [];
			const failures = {};
			for (const pf of sources) try {
				const contests = await fetchContestsCached(host, pf);
				all.push(...contests);
			} catch (e) {
				failures[pf] = e.message;
			}
			if (all.length === 0) return {
				ok: false,
				error: "赛事拉取失败：" + Object.entries(failures).map(([p, m]) => `${p}: ${m}`).join("；")
			};
			return {
				ok: true,
				contests: all.filter((c) => contestPhase(c, now) === type).sort((a, b) => {
					if (type === "upcoming") return new Date(a.startTimeIso).getTime() - new Date(b.startTimeIso).getTime();
					const endA = new Date(a.startTimeIso).getTime() + a.durationMinutes * 6e4;
					return new Date(b.startTimeIso).getTime() + b.durationMinutes * 6e4 - endA;
				}).slice(0, limit),
				failures
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: `赛事：${args.type || "upcoming"}`
		})
	}));
}
// src/tools/checkins.ts
function registerCheckinTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_checkin",
		description: "今日训练完成度与日历打卡。action=status 今天是否完成（含补题/加训建议）；action=streak 连续打卡（以「当天有 AC」为准）；action=month 月视图；action=date 某天任务；action=checkin / action=uncheck 勾选/取消计划任务。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: [
					"status",
					"streak",
					"month",
					"date",
					"checkin",
					"uncheck"
				]
			},
			month: {
				type: "string",
				description: "月份 YYYY-MM（month）"
			},
			date: {
				type: "string",
				description: "日期 YYYY-MM-DD（date）"
			},
			taskId: {
				type: "number",
				description: "任务 ID（checkin/uncheck）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const { store } = host;
			const action = args.action;
			const todayStr = localDay$1();
			switch (action) {
				case "status": return {
					ok: true,
					...buildTodayStatus(store, todayStr),
					streak: acStreak(store, todayStr)
				};
				case "streak": return {
					ok: true,
					...acStreak(store, todayStr)
				};
				case "month": {
					const month = str(args.month) ?? todayStr.slice(0, 7);
					if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return {
						ok: false,
						error: "month 格式需为 YYYY-MM"
					};
					return {
						ok: true,
						days: store.getMonthView(month)
					};
				}
				case "date": {
					const date = str(args.date);
					if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return {
						ok: false,
						error: "date 格式需为 YYYY-MM-DD"
					};
					return {
						ok: true,
						tasks: store.getTasksByDate(date)
					};
				}
				case "checkin": {
					const taskId = Number(args.taskId);
					if (!Number.isInteger(taskId)) return {
						ok: false,
						error: "taskId 必填"
					};
					if (!store.findTask(taskId)) return {
						ok: false,
						error: "任务不存在"
					};
					store.toggleCheckin(taskId, true);
					return {
						ok: true,
						status: buildTodayStatus(store, todayStr)
					};
				}
				case "uncheck": {
					const taskId = Number(args.taskId);
					if (!Number.isInteger(taskId)) return {
						ok: false,
						error: "taskId 必填"
					};
					store.toggleCheckin(taskId, false);
					return { ok: true };
				}
				default: return {
					ok: false,
					error: `未知 action: ${action}`
				};
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: `打卡：${args.action}`
		})
	}));
}
// src/tools/settings.ts
/** 脱敏：保留首尾，中间打码（短值整体打码） */
function maskSecret(v) {
	if (!v) return v;
	if (v.length <= 8) return "****";
	return `${v.slice(0, 4)}****${v.slice(-4)}`;
}
function registerSettingsTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_settings",
		description: "管理设置。action=get 获取全部设置（AI/账号/适配器开关/Cookie/提醒）；action=set_account 绑定平台账号；action=set_ai 配置 AI；action=set_adapter 设置适配器开关；action=set_cookies 设置 Cookie；action=set_reminder 设置打卡提醒。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: [
					"get",
					"set_account",
					"set_ai",
					"set_adapter",
					"set_cookies",
					"set_reminder"
				]
			},
			platform: {
				type: "string",
				enum: ["codeforces", "atcoder"]
			},
			handle: { type: "string" },
			enabled: {
				type: "boolean",
				description: "开关（set_adapter/set_reminder）"
			},
			cookie: {
				type: "string",
				description: "Cookie（set_cookies，空串清除）"
			},
			csrf: {
				type: "string",
				description: "CSRF token（set_cookies，空串清除）"
			},
			aiEnabled: {
				type: "boolean",
				description: "AI 开关（set_ai）"
			},
			baseURL: { type: "string" },
			apiKey: { type: "string" },
			model: { type: "string" },
			time: {
				type: "string",
				description: "提醒时间 HH:MM（set_reminder）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const { store } = host;
			const action = args.action;
			switch (action) {
				case "get": {
					const s = store.getSettings();
					return {
						ok: true,
						settings: {
							accounts: s.accounts,
							adapterEnabled: s.adapterEnabled,
							reminder: s.reminder,
							ai: {
								...s.ai,
								apiKey: maskSecret(s.ai.apiKey)
							},
							cookies: Object.fromEntries(Object.entries(s.cookies).map(([pf, v]) => [pf, v ? {
								cookie: maskSecret(v.cookie),
								csrf: maskSecret(v.csrf)
							} : v]))
						}
					};
				}
				case "set_account": {
					const platform = args.platform;
					const handle = typeof args.handle === "string" ? args.handle.trim() : "";
					if (!platform || !["codeforces", "atcoder"].includes(platform)) return {
						ok: false,
						error: "platform 非法"
					};
					if (!handle) return {
						ok: false,
						error: "handle 必填"
					};
					store.setAccount(platform, handle);
					return { ok: true };
				}
				case "set_ai": {
					const patch = {};
					if (typeof args.aiEnabled === "boolean") patch.enabled = args.aiEnabled;
					if (typeof args.baseURL === "string") patch.baseURL = args.baseURL;
					if (typeof args.apiKey === "string") patch.apiKey = args.apiKey;
					if (typeof args.model === "string") patch.model = args.model;
					store.updateSettings({ ai: patch });
					return {
						ok: true,
						ai: store.getSettings().ai
					};
				}
				case "set_adapter": {
					const platform = args.platform;
					if (!platform || !["codeforces", "atcoder"].includes(platform)) return {
						ok: false,
						error: "platform 非法"
					};
					store.setAdapterEnabled(platform, args.enabled === true);
					return { ok: true };
				}
				case "set_cookies": {
					const platform = args.platform;
					if (!platform || !["codeforces", "atcoder"].includes(platform)) return {
						ok: false,
						error: "platform 非法"
					};
					store.setCookie(platform, typeof args.cookie === "string" ? args.cookie : void 0, typeof args.csrf === "string" ? args.csrf : void 0);
					return { ok: true };
				}
				case "set_reminder":
					if (args.enabled !== void 0 && typeof args.enabled !== "boolean") return {
						ok: false,
						error: "enabled 需为布尔值"
					};
					if (args.time !== void 0) {
						if (typeof args.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.time)) return {
							ok: false,
							error: "time 格式需为 HH:MM"
						};
					}
					store.setReminder(typeof args.enabled === "boolean" ? args.enabled : void 0, typeof args.time === "string" ? args.time : void 0);
					return {
						ok: true,
						reminder: store.getSettings().reminder
					};
				default: return {
					ok: false,
					error: `未知 action: ${action}`
				};
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: `设置：${args.action}`
		})
	}));
}
// src/tools/problems.ts
function registerProblemTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_problems",
		description: "浏览/搜索题目库。支持 platform/difficulty/tag/q 关键词过滤。bank=1 包含题库拉取的未做题，默认只显示做过有提交记录的题。",
		parameters: {
			platform: {
				type: "string",
				enum: ["codeforces", "atcoder"]
			},
			difficulty: {
				type: "string",
				description: "难度桶：<1200 / 1200-1399 / 1400-1599 / 1600-1899 / 1900-2199 / 2200+"
			},
			tag: {
				type: "string",
				description: "筛选标签"
			},
			q: {
				type: "string",
				description: "搜索关键词（匹配标题或题号）"
			},
			bank: {
				type: "boolean",
				description: "是否包含未做题（默认 false 只显示做过的）"
			},
			limit: {
				type: "number",
				description: "返回上限（默认 300）"
			}
		},
		output: {
			schema: ANY_OUTPUT,
			render: (_a, v) => textOutput(v)
		},
		async execute(args) {
			const platform = str(args.platform);
			return {
				ok: true,
				problems: host.store.browseProblems({
					platform,
					difficulty: str(args.difficulty),
					tag: str(args.tag),
					q: str(args.q),
					bank: args.bank === true,
					limit: num(args.limit, 300, 1, 5e3)
				})
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: "题目浏览"
		})
	}));
}
// src/activation.ts
const ICPC_TOOL_NAMES = [
	"icpc_sync",
	"icpc_stats",
	"icpc_today",
	"icpc_generate_plan",
	"icpc_manage_plan",
	"icpc_review",
	"icpc_contests",
	"icpc_checkin",
	"icpc_settings",
	"icpc_problems"
];
function registerIcpcTools(host, targetCtx) {
	const disposers = [
		registerSyncTool(host, targetCtx),
		registerStatsTool(host, targetCtx),
		registerTodayTool(host, targetCtx),
		registerPlanTools(host, targetCtx),
		registerReviewTool(host, targetCtx),
		registerContestTool(host, targetCtx),
		registerCheckinTool(host, targetCtx),
		registerSettingsTool(host, targetCtx),
		registerProblemTool(host, targetCtx)
	];
	return () => {
		for (const dispose of disposers.splice(0)) dispose();
	};
}
var ActivationError = class extends Error {
	status;
	code;
	constructor(message, status, code) {
		super(message);
		this.status = status;
		this.code = code;
		this.name = "ActivationError";
	}
};
function createSessionActivator(ctx, host) {
	const active = /* @__PURE__ */ new Map();
	const offDisposed = ctx.on("agent/disposed", (...args) => {
		const agent = args[0]?.agent;
		if (!agent) return;
		const entry = active.get(agent.id);
		if (entry?.agent !== agent) return;
		entry.dispose();
		active.delete(agent.id);
	});
	return {
		activate(sessionId) {
			const id = sessionId.trim();
			if (!id) throw new ActivationError("sessionId is required", 400, "invalid-session-id");
			if (!ctx.agents) throw new ActivationError("agent service is unavailable", 503, "agents-unavailable");
			const agent = ctx.agents.get(id);
			if (!agent) throw new ActivationError(`live agent not found for session ${id}`, 409, "agent-not-found");
			const existing = active.get(id);
			if (existing?.agent === agent) return {
				sessionId: id,
				tools: ICPC_TOOL_NAMES
			};
			existing?.dispose();
			const dispose = registerIcpcTools(host, agent.ctx);
			active.set(id, {
				agent,
				dispose
			});
			return {
				sessionId: id,
				tools: ICPC_TOOL_NAMES
			};
		},
		dispose() {
			offDisposed();
			for (const entry of active.values()) entry.dispose();
			active.clear();
		}
	};
}
async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function sendJson$3(res, status, body) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
function trustedOrigin$3(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	const host = req.headers.host;
	return origin === `http://${host}` || origin === `https://${host}`;
}
function registerActivationRoute(ctx, host) {
	if (!ctx.webServer) throw new Error("webServer service is required for ICPC activation");
	const activator = createSessionActivator(ctx, host);
	ctx.effect(() => {
		const offRoute = ctx.webServer.register({
			kind: "exact",
			path: "/icpc-workbench/activate",
			async handler(req, res) {
				if (req.method !== "POST") {
					res.setHeader("allow", "POST");
					sendJson$3(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!trustedOrigin$3(req)) {
					sendJson$3(res, 403, {
						ok: false,
						error: "origin-not-allowed"
					});
					return;
				}
				if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
					sendJson$3(res, 415, {
						ok: false,
						error: "json-required"
					});
					return;
				}
				try {
					const body = await readJson(req);
					if (typeof body.sessionId !== "string") throw new ActivationError("sessionId is required", 400, "invalid-session-id");
					sendJson$3(res, 200, {
						ok: true,
						...activator.activate(body.sessionId)
					});
				} catch (error) {
					if (error instanceof ActivationError) {
						sendJson$3(res, error.status, {
							ok: false,
							error: error.code,
							message: error.message
						});
						return;
					}
					sendJson$3(res, 400, {
						ok: false,
						error: "invalid-request",
						message: String(error)
					});
				}
			}
		});
		return () => {
			offRoute();
			activator.dispose();
		};
	});
}
// src/workbench-sync.ts
const THROTTLE_MS = 18e5;
const FORCE_THROTTLE_MS = 3e5;
const BANK_BOOTSTRAP_THRESHOLD = 1e3;
const BANK_REFRESH_MS = 864e5;
function sendJson$2(res, status, body) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
function trustedOrigin$2(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	const host = req.headers.host;
	return origin === `http://${host}` || origin === `https://${host}`;
}
async function runSync(host, force = false) {
	const settings = host.store.getSettings();
	const summary = {
		ok: true,
		synced: [],
		bank: null,
		reviews: null,
		autoChecked: 0,
		throttled: false
	};
	const now = Date.now();
	const threshold = force ? FORCE_THROTTLE_MS : THROTTLE_MS;
	for (const [pf, account] of Object.entries(settings.accounts)) {
		if (!account?.handle || !account.enabled) continue;
		const last = account.lastSyncAt ? Date.parse(account.lastSyncAt) : 0;
		if (Number.isFinite(last) && now - last < threshold) {
			summary.synced.push({
				platform: pf,
				skipped: true
			});
			continue;
		}
		const result = await syncPlatform(host, pf, account.handle);
		summary.synced.push({
			platform: pf,
			skipped: false,
			imported: result.imported,
			errors: result.errors
		});
	}
	if (!summary.synced.some((s) => !s.skipped)) {
		summary.throttled = summary.synced.length > 0;
		return summary;
	}
	const bankAt = host.store.getBankSyncedAt();
	const bankStale = !bankAt || now - Date.parse(bankAt) > BANK_REFRESH_MS;
	if (host.store.countProblems("codeforces") < BANK_BOOTSTRAP_THRESHOLD || bankStale) {
		const bank = await syncBank(host, "codeforces");
		if (bank.errors.length === 0) host.store.setBankSyncedAt((/* @__PURE__ */ new Date()).toISOString());
		summary.bank = {
			platform: bank.platform,
			fetched: bank.fetched,
			inserted: bank.inserted
		};
	}
	const reviews = collectLocalReviews(host.store);
	summary.reviews = {
		added: reviews.added,
		localProblems: reviews.localProblems
	};
	const today = localDay$1();
	if (buildTodayStatus(host.store, today).done) summary.autoChecked = host.store.autoCheckPlanTasks(today);
	return summary;
}
function registerSyncRoute(ctx, host) {
	if (!ctx.webServer) return;
	let inFlight = null;
	const run = (force = false) => {
		if (!inFlight) inFlight = runSync(host, force).finally(() => {
			inFlight = null;
		});
		return inFlight;
	};
	ctx.effect(() => {
		const off = ctx.webServer.register({
			kind: "exact",
			path: "/icpc-workbench/sync",
			async handler(req, res) {
				if (req.method !== "POST") {
					res.setHeader("allow", "POST");
					sendJson$2(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!trustedOrigin$2(req)) {
					sendJson$2(res, 403, {
						ok: false,
						error: "origin-not-allowed"
					});
					return;
				}
				try {
					const force = new URL(req.url ?? "/", "http://localhost").searchParams.get("force") === "1";
					sendJson$2(res, 200, await run(force));
				} catch (e) {
					sendJson$2(res, 500, {
						ok: false,
						error: e.message
					});
				}
			}
		});
		return () => off();
	});
}
// src/workbench-contests.ts
const CACHE_TTL_MS = 6e5;
let cache = null;
async function getUpcomingContests(host) {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;
	const adapter = host.adapters["codeforces"];
	if (!adapter) return [];
	const list = await adapter.fetchContests();
	const now = Date.now();
	const items = list.filter((c) => {
		if (!c.startTimeIso) return false;
		return new Date(c.startTimeIso).getTime() + c.durationMinutes * 6e4 > now;
	}).sort((a, b) => new Date(a.startTimeIso).getTime() - new Date(b.startTimeIso).getTime()).slice(0, 6).map((c) => ({
		id: c.id,
		name: c.name,
		startTimeIso: c.startTimeIso,
		durationMinutes: c.durationMinutes,
		phase: c.phase,
		url: c.url
	}));
	cache = {
		at: now,
		items
	};
	return items;
}
function sendJson$1(res, status, body) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
function trustedOrigin$1(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	const host = req.headers.host;
	return origin === `http://${host}` || origin === `https://${host}`;
}
function registerContestsRoute(ctx, host) {
	if (!ctx.webServer) return;
	ctx.effect(() => {
		const off = ctx.webServer.register({
			kind: "exact",
			path: "/icpc-workbench/contests",
			async handler(req, res) {
				if (req.method !== "GET") {
					res.setHeader("allow", "GET");
					sendJson$1(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!trustedOrigin$1(req)) {
					sendJson$1(res, 403, {
						ok: false,
						error: "origin-not-allowed"
					});
					return;
				}
				try {
					sendJson$1(res, 200, {
						ok: true,
						contests: await getUpcomingContests(host)
					});
				} catch (e) {
					sendJson$1(res, 500, {
						ok: false,
						error: e.message
					});
				}
			}
		});
		return () => off();
	});
}
// src/workbench-plan.ts
function dayDiff(a, b) {
	return Math.round(((/* @__PURE__ */ new Date(`${b}T00:00:00Z`)).getTime() - (/* @__PURE__ */ new Date(`${a}T00:00:00Z`)).getTime()) / 864e5);
}
function buildPlanSnapshot(store, todayStr) {
	const plan = store.getActivePlan(todayStr);
	if (!plan) return {
		plan: null,
		currentWeek: null,
		weeks: [],
		today: null,
		progress: null,
		daysLeft: null
	};
	const weeks = (plan.weeks ?? []).map((w) => {
		const end = addDaysLocal(w.startDate, 6);
		const tasks = plan.tasks.filter((t) => t.taskDate >= w.startDate && t.taskDate <= end);
		const checked = tasks.filter((t) => t.checked).length;
		return {
			index: w.index,
			startDate: w.startDate,
			direction: w.direction,
			tags: w.tags,
			total: tasks.length,
			checked,
			done: tasks.length > 0 && checked === tasks.length
		};
	});
	const todayTasks = plan.tasks.filter((t) => t.taskDate === todayStr);
	const checkedAll = plan.tasks.filter((t) => t.checked).length;
	const focus = store.currentFocus(todayStr);
	return {
		plan: {
			id: plan.id,
			title: plan.title,
			goal: plan.goal,
			startDate: plan.startDate,
			endDate: plan.endDate
		},
		currentWeek: focus ? {
			index: focus.week,
			direction: focus.direction,
			tags: focus.tags
		} : null,
		weeks,
		today: {
			total: todayTasks.length,
			checked: todayTasks.filter((t) => t.checked).length
		},
		progress: {
			checked: checkedAll,
			total: plan.tasks.length
		},
		daysLeft: Math.max(0, dayDiff(todayStr, plan.endDate))
	};
}
function sendJson(res, status, body) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
function trustedOrigin(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	const host = req.headers.host;
	return origin === `http://${host}` || origin === `https://${host}`;
}
function registerPlanRoute(ctx, store) {
	if (!ctx.webServer) return;
	ctx.effect(() => {
		const off = ctx.webServer.register({
			kind: "exact",
			path: "/icpc-workbench/plan",
			handler(req, res) {
				if (req.method !== "GET") {
					res.setHeader("allow", "GET");
					sendJson(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!trustedOrigin(req)) {
					sendJson(res, 403, {
						ok: false,
						error: "origin-not-allowed"
					});
					return;
				}
				try {
					sendJson(res, 200, {
						ok: true,
						plan: buildPlanSnapshot(store, localDay$1())
					});
				} catch (e) {
					sendJson(res, 500, {
						ok: false,
						error: e.message
					});
				}
			}
		});
		return () => off();
	});
}
// src/index.ts
/**
* dsh-algo-trainer — 算法学习训练插件 for DeepSeek Harness
*
* Host 半边：按会话激活 13 个 agent tools。
* 数据层用 JSON 文件持久化（替代 SQLite），通过 Node fs 落盘到 DSH_HOME/.icpc-data。
* 适配层用 fetch 调公开 API（Codeforces + AtCoder）。
*
* 注意：本插件以「文件插件」形式通过 cordis.patch.yml 挂载（非动态 Cordis 插件），
* 因此不使用 harness.handle / host.call（那是动态插件的 Package-private RPC 通道），
* client 半边仅注册一个静态引导面板；数据读写全部走 icpc_* 工具。
*/
const name = "dsh-algo-trainer";
const inject = [
	"tools",
	"agents",
	"webServer"
];
/**
* Node 原生 fs 包装为 FsService 接口。
* 文件插件运行在 Host Node 进程中，node:fs 是唯一可靠的数据落盘通道；
* dsh 的 ctx.fs 服务接口（resolve/readText/writeText/stat）与本层不兼容，故不使用。
*/
function nodeFs() {
	return {
		async readFile(p) {
			return fs.promises.readFile(p, "utf8");
		},
		async writeFile(p, content) {
			await fs.promises.writeFile(p, content, "utf8");
		},
		async mkdir(p) {
			await fs.promises.mkdir(p, { recursive: true });
		},
		async exists(p) {
			return fs.existsSync(p);
		},
		async readdir(p) {
			return fs.promises.readdir(p);
		}
	};
}
function apply(ctx, rawConfig = {}) {
	const dataDir = resolveConfig(rawConfig).dataDir || path.join(process.env.DSH_HOME || process.env.HOME || process.env.USERPROFILE || ".", ".icpc-data");
	const store = new IcpcStore(nodeFs(), dataDir);
	const adapters = {
		codeforces: createCodeforcesAdapter(),
		atcoder: createAtcoderAdapter()
	};
	const getAiConfig = () => {
		const s = store.getSettings();
		return {
			enabled: s.ai.enabled,
			baseURL: s.ai.baseURL,
			apiKey: process.env.AI_API_KEY ?? s.ai.apiKey,
			model: s.ai.model
		};
	};
	const host = {
		store,
		adapters,
		getAiConfig
	};
	ctx.effect(() => () => {
		store.flush();
	});
	registerActivationRoute(ctx, host);
	registerOverviewRoute(ctx, store);
	registerSyncRoute(ctx, host);
	registerContestsRoute(ctx, host);
	registerPlanRoute(ctx, store);
}
export { Config, apply, inject, name };
