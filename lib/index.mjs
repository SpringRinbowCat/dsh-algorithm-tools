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
function pickBand(candidates, band, count, weakTags, excludeIds, rotate = 0) {
	const inBand = candidates.filter((c) => c.difficulty != null && band.min != null && band.max != null && c.difficulty >= band.min && c.difficulty <= band.max && !excludeIds.has(c.id));
	const ordered = inBand.map((c) => ({
		c,
		weak: weakOverlap(c.tags, weakTags)
	})).sort((a, b) => b.weak.length - a.weak.length || Math.abs((a.c.difficulty ?? 0) - (band.center ?? 0)) - Math.abs((b.c.difficulty ?? 0) - (band.center ?? 0)) || a.c.id - b.c.id);
	const start = ordered.length ? rotate % ordered.length : 0;
	const picked = [...ordered.slice(start), ...ordered.slice(0, start)].slice(0, count);
	return {
		pool: inBand.length,
		problems: picked.map(({ c, weak }) => ({
			id: c.id,
			platform: c.platform,
			problemKey: c.problemKey,
			title: c.title,
			difficulty: c.difficulty,
			url: c.url,
			tags: c.tags,
			weakTags: weak
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
			const candidates = store.getUnsolvedCandidates().map((p) => ({
				id: p.id,
				platform: p.platform,
				problemKey: p.problemKey,
				title: p.title,
				difficulty: p.difficulty,
				url: p.url,
				tags: p.tags
			}));
			const weakTags = computeWeakness(store.getSubmissionRows(), {
				minAttempts: 5,
				topN: 15
			}).items.filter((i) => i.gap > 0).map((i) => i.tag);
			const ranges = bandRanges(level);
			const rotate = num(args.rotate, 0, 0, 500);
			const exclude = /* @__PURE__ */ new Set();
			const bands = BAND_KEYS.map((key) => {
				const q = Number(args[key]);
				const count = Number.isInteger(q) && q >= 0 && q <= 6 ? q : DEFAULT_COUNTS[key];
				const picked = pickBand(candidates, ranges[key], count, weakTags, exclude, rotate);
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
			return {
				ok: true,
				data: {
					date: todayStr,
					level,
					bands,
					dueReviews,
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
	const unresolved = [];
	const seen = /* @__PURE__ */ new Set();
	for (const s of store.getSubmissionRows()) {
		if (dayKey(s.submittedAt) !== todayStr) continue;
		const key = `${s.platform}:${s.problemKey}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (!acKeys.has(key)) unresolved.push(s.problemKey);
	}
	if (!training.done) {
		const left = index.filter((k) => !acKeys.has(k)).map((k) => k.split(":")[1]);
		const items = [];
		if (index.length === 0) items.push("今天还没开始训练：点「今日训练」抽出今天的 3 档题");
		else items.push(`今日训练还剩 ${left.length} 题：${left.slice(0, 6).join("、")}`);
		if (pending.length > 0) items.push(`未完成任务：${pending.slice(0, 3).map((t) => t.title).join("；")}`);
		if (unresolved.length > 0) items.push(`今天试过但没 AC：${unresolved.slice(0, 3).join("、")}`);
		return {
			date: todayStr,
			ac: cell.ac,
			submissions: cell.submissions,
			tasks: {
				total: tasks.length,
				checked: tasks.length - pending.length
			},
			training,
			done: false,
			advice: {
				kind: "catchup",
				title: index.length === 0 ? "今日未开始" : `今日训练 ${completed.length}/${index.length}`,
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
		training,
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
function registerOverviewRoute(ctx, store) {
	if (!ctx.webServer) return;
	ctx.effect(() => {
		const off = ctx.webServer.register({
			kind: "exact",
			path: "/icpc-workbench/overview",
			handler(req, res) {
				if (req.method !== "GET") {
					res.setHeader("allow", "GET");
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
					const url = new URL(req.url ?? "/", "http://localhost");
					const days = Math.min(371, Math.max(7, Number(url.searchParams.get("days") ?? 84) || 84));
					const todayStr = localDay$1();
					sendJson$2(res, 200, {
						ok: true,
						today: buildTodayStatus(store, todayStr),
						streak: acStreak(store, todayStr),
						days: buildDayCells(store, days, todayStr)
					});
				} catch (e) {
					sendJson$2(res, 500, {
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
					sendJson$2(res, 200, {
						ok: true,
						stats: buildStats(store)
					});
				} catch (e) {
					sendJson$2(res, 500, {
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
		for (let d = 0; d < 7; d++) {
			const date = addDays(weekStart, d);
			if (date > addDays(startDate, days - 1)) break;
			const isReviewDay = d === 6;
			const count = isReviewDay ? 1 : 2 + (w > 0 ? 1 : 0);
			tasks.push({
				date,
				title: isReviewDay ? `W${w + 1} 复盘：${shortDirection(direction)} · 回看本周错题` : `W${w + 1} ${shortDirection(direction)} · ${count} 题（${low}–${high}）`,
				kind: isReviewDay ? "review" : "practice",
				platform: "codeforces",
				note: isReviewDay ? "把本周没做出来的题重写一遍；到期复习用 icpc_review list。" : "具体题目用 icpc_today 现选（本方向优先）；做完用 icpc_checkin 勾掉。"
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
						...t,
						id: 0
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
function registerReviewTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_review",
		description: "管理间隔复习库（1/3/7/14/30/60 天）。action=list 列出队列（due=true 只看到期）；action=scan 从本地 Codeforces 目录（默认 D:\\codeforces）自动收题，未 AC 的标注待补；action=add 手动加题；action=feedback 反馈排期（hard/ok/easy）；action=note 笔记；action=remove 移出。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: [
					"list",
					"scan",
					"add",
					"feedback",
					"note",
					"remove"
				]
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
			title: `复习：${args.action}`
		})
	}));
}
// src/templates/curriculum.ts
const lg = (key, title) => ({
	platform: "luogu",
	key,
	title,
	url: `https://www.luogu.com.cn/problem/${key}`
});
const cf = (key, title) => ({
	platform: "codeforces",
	key: key.replace("/", ""),
	title,
	url: `https://codeforces.com/problemset/problem/${key.split("/")[0]}/${key.split("/")[1]}`
});
const CURRICULUM = [
	{
		key: "basic",
		name: "基础算法",
		description: "二分、双指针、前缀和等必备基本功，几乎每道题都有它们的影子",
		templates: [
			{
				id: "basic-binary-search",
				name: "二分查找（整数域）",
				difficulty: 1,
				tags: ["二分"],
				outline: "写一个自己背得熟的整数二分（求下界/上界），明确 mid 取整方向与区间收缩的配套关系。",
				examples: [
					lg("P2249", "【深基13.例1】查找"),
					cf("279/B", "Books"),
					lg("P1102", "A-B 数对"),
					lg("P1678", "烦恼的高考志愿")
				]
			},
			{
				id: "basic-two-pointers",
				name: "双指针（滑动窗口）",
				difficulty: 2,
				tags: ["双指针", "two pointers"],
				outline: "固定右端点、收缩左端点的窗口模板，含窗口内计数维护与撤销。",
				examples: [
					cf("279/B", "Books"),
					lg("P1638", "逛画展"),
					cf("676/C", "Vasya and String"),
					lg("P1102", "A-B 数对")
				]
			},
			{
				id: "basic-prefix-sum",
				name: "前缀和与差分",
				difficulty: 1,
				tags: ["前缀和", "差分"],
				outline: "一维/二维前缀和与区间查询公式；差分完成区间加减后一遍前缀和还原。",
				examples: [
					lg("P1115", "最大子段和"),
					lg("P2367", "语文成绩"),
					lg("P1719", "最大加权矩形"),
					lg("P3406", "海底高铁")
				]
			},
			{
				id: "basic-discretization",
				name: "离散化",
				difficulty: 2,
				tags: ["离散化", "排序"],
				outline: "排序 + 去重 + lower_bound 映射三步，值域大而点稀疏时的标准前置。",
				examples: [
					lg("P1496", "火烧赤壁"),
					lg("P1955", "[NOI2015] 程序自动分析"),
					lg("P1908", "逆序对"),
					lg("P1966", "[NOIP 2013 提高组] 火柴排队")
				]
			},
			{
				id: "basic-greedy",
				name: "贪心（区间调度）",
				difficulty: 2,
				tags: ["贪心"],
				outline: "按右端点排序选不相交区间的经典贪心，附一句交换论证为什么它对。",
				examples: [
					lg("P1803", "凌乱的yyy / 线段覆盖"),
					lg("P1223", "排队接水"),
					lg("P1208", "[USACO1.3] 混合牛奶 Mixing Milk"),
					lg("P5019", "[NOIP 2018 提高组] 铺设道路"),
					cf("2245/A", "Who Watches the Watchpig?"),
					cf("2241/A", "Divide and Conquer")
				]
			},
			{
				id: "basic-binary-answer",
				name: "二分答案",
				difficulty: 2,
				tags: ["二分", "贪心"],
				outline: "「最大化最小值 / 最小化最大值」在值域上二分 + O(n) check 判定，注意值域上下界与无解时的输出约定。",
				examples: [
					lg("P1873", "[COCI 2011/2012 #5] EKO / 砍树"),
					lg("P2678", "[NOIP 2015 提高组] 跳石头"),
					lg("P2440", "木材加工"),
					lg("P1462", "通往奥格瑞玛的道路"),
					cf("1983/C", "Have Your Cake and Eat It Too"),
					cf("2028/B", "Alice's Adventures in Permuting")
				]
			},
			{
				id: "basic-doubling",
				name: "倍增",
				difficulty: 2,
				tags: ["倍增"],
				outline: "预处理 2^k 级跳跃表，把线性步数换成二进制拼装；核心是想清楚 f[k][x] 的状态定义与合并顺序。",
				examples: [
					lg("P1613", "跑路"),
					lg("P4155", "[SCOI2015] 国旗计划"),
					lg("P1084", "[NOIP 2012 提高组] 疫情控制")
				]
			},
			{
				id: "basic-divide-conquer",
				name: "分治",
				difficulty: 2,
				tags: ["分治", "递归"],
				outline: "「切一半、递归、跨中合并」三段式：棋盘覆盖式构造与平面最近点对都靠跨中线的一次线性扫描完成合并。",
				examples: [
					lg("P1228", "地毯填补问题"),
					lg("P1429", "平面最近点对（加强版）"),
					lg("P1257", "平面上的最接近点对"),
					lg("P1908", "逆序对")
				]
			}
		]
	},
	{
		key: "search",
		name: "搜索",
		description: "DFS / BFS / A* / 折半 / 随机化——状态空间问题的通用解法框架",
		templates: [
			{
				id: "search-dfs-backtrack",
				name: "DFS 与回溯",
				difficulty: 2,
				tags: [
					"DFS",
					"搜索",
					"回溯"
				],
				outline: "「做选择 → 递归 → 撤销选择」三段式框架，现场恢复完整。",
				examples: [
					lg("P1706", "全排列问题"),
					lg("P1219", "[USACO1.5] 八皇后 Checker Challenge"),
					lg("P1605", "迷宫"),
					lg("P1019", "[NOIP 2000 提高组] 单词接龙（疑似错题）")
				]
			},
			{
				id: "search-bfs-grid",
				name: "BFS 最短路模型",
				difficulty: 2,
				tags: ["BFS", "搜索"],
				outline: "网格 BFS：方向数组、越界/障碍/访问判断、入队时标记，第一次到达即最少步数。",
				examples: [
					lg("P1443", "马的遍历"),
					lg("P1135", "奇怪的电梯"),
					lg("P1032", "[NOIP 2002 提高组] 字串变换（疑似错题）"),
					lg("P2895", "[USACO08FEB] Meteor Shower S")
				]
			},
			{
				id: "search-floodfill",
				name: "连通块 Flood Fill",
				difficulty: 1,
				tags: [
					"DFS",
					"BFS",
					"连通性"
				],
				outline: "扫描全图 + 从每个未访问目标格染色整个连通块，统计块数；想清楚四连通还是八连通。",
				examples: [
					lg("P1596", "[USACO10OCT] Lake Counting S"),
					lg("P1451", "求细胞数量"),
					lg("P1141", "01迷宫")
				]
			},
			{
				id: "search-memo",
				name: "记忆化搜索",
				difficulty: 3,
				tags: [
					"DFS",
					"记忆化",
					"动态规划"
				],
				outline: "DFS 暴力 + memo 缓存的写法（引用取位前先判未算），与递推 DP 的等价关系。",
				examples: [
					lg("P1434", "[SHOI2002] 滑雪"),
					lg("P1464", "[PacNW 1999] Function"),
					lg("P1216", "[IOI 1994 / USACO1.5] 数字三角形 Number Triangles")
				]
			},
			{
				id: "search-bidirectional-bfs",
				name: "双向 BFS",
				difficulty: 3,
				tags: ["BFS", "搜索"],
				outline: "起点终点交替扩展、始终扩队列较小的一侧，相遇即最短；每层用整层 for 控制，避免跳层漏解。",
				examples: [lg("P1379", "八数码难题"), lg("P2730", "[IOI 1996 / USACO3.2] 魔板 Magic Squares")]
			},
			{
				id: "search-astar",
				name: "A* 与 IDA*",
				difficulty: 4,
				tags: ["A*", "启发式搜索"],
				outline: "按 g+h 出堆的优先队列搜索，h 必须是可采纳的下界估计才保证最优；迭代加深版以 f = g+h 限深剪枝。",
				examples: [
					lg("P2324", "[SCOI2005] 骑士精神"),
					lg("P1379", "八数码难题"),
					lg("P1074", "[NOIP 2009 提高组] 靶形数独")
				]
			},
			{
				id: "search-meet-in-middle",
				name: "折半搜索（meet in the middle）",
				difficulty: 4,
				tags: ["搜索", "折半搜索"],
				outline: "枚举减半：两半各自 2^(n/2) 张表，一半排序后另一半二分/哈希拼接答案，O(2^n) 降到 O(2^(n/2)·log)。",
				examples: [
					lg("P4799", "[CEOI 2015] 世界冰球锦标赛 (Day2)"),
					cf("888/E", "Maximum Subsequence"),
					cf("525/E", "Anya and Cubes"),
					cf("1006/F", "Xor-Paths"),
					cf("799/D", "Field expansion")
				]
			},
			{
				id: "search-annealing",
				name: "模拟退火（随机化搜索）",
				difficulty: 3,
				tags: ["随机化", "模拟退火"],
				outline: "温度从高到低，以 exp(-Δ/T) 的概率接受劣解逃离局部最优；while 卡到时限边缘多跑几轮取最优。",
				examples: [
					lg("P1337", "[JSOI2004] 平衡点 / 吊打XXX"),
					lg("P2503", "[HAOI2006] 均分数据"),
					lg("P3878", "[TJOI2010] 分金币"),
					lg("P2962", "[USACO09NOV] Lights G")
				]
			},
			{
				id: "search-dlx",
				name: "舞蹈链 DLX（精确覆盖）",
				difficulty: 5,
				tags: [
					"搜索",
					"DLX",
					"精确覆盖"
				],
				outline: "十字双向链表 O(1) 覆盖/恢复，递归回溯时选剩余元素最少的列；数独是精确覆盖，重复覆盖改用估价函数剪枝。",
				examples: [
					lg("P4929", "【模板】舞蹈链（DLX）"),
					lg("P1784", "数独"),
					lg("P1074", "[NOIP 2009 提高组] 靶形数独")
				]
			}
		]
	},
	{
		key: "ds",
		name: "数据结构",
		description: "并查集、树状数组、线段树——区间统计与动态维护的核心武器",
		templates: [
			{
				id: "ds-dsu",
				name: "并查集（路径压缩 + 按秩合并）",
				difficulty: 2,
				tags: ["并查集", "数据结构"],
				outline: "find 路径压缩 + unite 按秩合并的完整实现，能说明为什么均摊近 O(1)。",
				examples: [
					lg("P1551", "亲戚"),
					lg("P3367", "【模板】并查集"),
					lg("P1536", "村村通"),
					lg("P1111", "修复公路"),
					cf("1249/B1", "Books Exchange (easy version)"),
					cf("217/A", "Ice Skating"),
					cf("501/B", "Misha and Changing Handles")
				]
			},
			{
				id: "ds-bit",
				name: "树状数组（单点改 + 区间和）",
				difficulty: 3,
				tags: ["树状数组", "数据结构"],
				outline: "lowbit 原理 + add/query 双循环，区间和 = 两次前缀查询；想清楚下标为何从 1 起。",
				examples: [
					lg("P3374", "【模板】树状数组 1"),
					lg("P1908", "逆序对"),
					lg("P3368", "【模板】树状数组 2"),
					lg("P1966", "[NOIP 2013 提高组] 火柴排队")
				]
			},
			{
				id: "ds-segtree",
				name: "线段树（区间加 + 区间求和，懒标记）",
				difficulty: 4,
				tags: ["线段树", "数据结构"],
				outline: "pushup / pushdown / apply 骨架 + 整段命中返回；数组 4 倍空间的原因。",
				examples: [
					lg("P3373", "【模板】线段树 2"),
					lg("P3372", "【模板】线段树 1"),
					lg("P2574", "XOR 的艺术"),
					lg("P4513", "小白逛公园")
				]
			},
			{
				id: "ds-sparse-table",
				name: "ST 表（静态 RMQ）",
				difficulty: 3,
				tags: [
					"ST表",
					"倍增",
					"RMQ"
				],
				outline: "倍增预处理 2^k 区间最值 + 查询两段可重叠覆盖；为什么只能用于可重复贡献运算。",
				examples: [
					lg("P3865", "【模板】ST 表 & RMQ 问题"),
					lg("P1816", "忠诚"),
					lg("P2880", "[USACO07JAN] Balanced Lineup G"),
					lg("P2251", "质量检测")
				]
			},
			{
				id: "ds-mono-stack",
				name: "单调栈",
				difficulty: 3,
				tags: ["单调栈", "数据结构"],
				outline: "求「左侧第一个更小元素」的四向问题同构说明 + 每元素至多进出栈一次的均摊论证。",
				examples: [
					lg("P5788", "【模板】单调栈"),
					lg("P2947", "[USACO09MAR] Look Up S"),
					lg("P1908", "逆序对")
				]
			},
			{
				id: "ds-mono-deque",
				name: "单调队列",
				difficulty: 2,
				tags: ["单调队列", "队列"],
				outline: "队尾弹失去单调性、队头弹滑出窗口，队头即当前最值；队列里存下标，出队判断用下标而非值。",
				examples: [
					lg("P1886", "【模板】单调队列 / 滑动窗口"),
					lg("P1440", "求m区间内的最小值"),
					lg("P2032", "扫描"),
					lg("P1419", "寻找段落")
				]
			},
			{
				id: "ds-heap",
				name: "堆（priority_queue 与对顶堆）",
				difficulty: 2,
				tags: ["堆", "优先队列"],
				outline: "大根堆配小根堆动态维护第 k 大（对顶堆）的平衡条件；pair 入堆时的比较方向易错。",
				examples: [
					lg("P1090", "[NOIP 2004 提高组] 合并果子"),
					lg("P1801", "黑匣子"),
					lg("P1168", "中位数"),
					lg("P6033", "[NOIP 2004 提高组] 合并果子 加强版")
				]
			},
			{
				id: "ds-weighted-dsu",
				name: "带权 / 扩展域并查集",
				difficulty: 3,
				tags: ["并查集", "数据结构"],
				outline: "路径压缩时顺带递推节点到根的权值（先递归再更新）；关系类问题也可拆「真/假」扩展域建双份集合。",
				examples: [
					lg("P1196", "[NOI2002] 银河英雄传说"),
					lg("P1892", "[BalticOI 2003] 团伙 (Day 2)"),
					lg("P2024", "[NOI2001] 食物链"),
					lg("P5937", "[CEOI 1999] Parity Game"),
					cf("2033/E", "Sakurako, Kosuke, and the Permutation"),
					cf("1559/D1", "Mocha and Diana (Easy Version)")
				]
			},
			{
				id: "ds-chairman-tree",
				name: "主席树（可持久化线段树）",
				difficulty: 4,
				tags: [
					"线段树",
					"可持久化",
					"数据结构"
				],
				outline: "每次插入只新建 O(log n) 个节点、复用旧版本；静态区间第 k 小按权值域比较左右子树大小下潜。",
				examples: [
					lg("P3834", "【模板】可持久化线段树 2（静态区间第 k 小）"),
					lg("P2617", "Dynamic Rankings"),
					lg("P3168", "[CQOI2015] 任务查询系统")
				]
			},
			{
				id: "ds-fhq-treap",
				name: "平衡树（FHQ Treap）",
				difficulty: 4,
				tags: ["平衡树", "数据结构"],
				outline: "按权值分裂 + 按大小分裂，merge/split 两个函数撑起全部操作；随机键维持期望平衡，无需旋转。",
				examples: [
					lg("P3369", "【模板】普通平衡树"),
					lg("P3391", "【模板】文艺平衡树"),
					lg("P2042", "[NOI2005] 维护数列")
				]
			},
			{
				id: "ds-sqrt-decomposition",
				name: "分块",
				difficulty: 4,
				tags: ["分块", "数据结构"],
				outline: "整块打懒标记、散块暴力扫的维护框架，块长取 √n 附近平衡两类代价；「优雅的暴力」是万能保底。",
				examples: [
					lg("P2801", "教主的魔法"),
					lg("P3203", "[HNOI2010] 弹飞绵羊"),
					lg("P4168", "[Violet] 蒲公英")
				]
			},
			{
				id: "ds-mo-algorithm",
				name: "莫队（普通 + 带修）",
				difficulty: 4,
				tags: ["莫队", "离线"],
				outline: "按（左端点块, 右端点奇偶）排序后双指针暴力增删；带修加时间维变三维排序，注意奇偶优化与增删次序。",
				examples: [
					lg("P2709", "【模板】莫队 / 小 B 的询问"),
					lg("P1903", "【模板】带修莫队 / [国家集训队] 数颜色 / 维护队列"),
					lg("P1494", "[国家集训队] 小 Z 的袜子")
				]
			},
			{
				id: "ds-kd-tree",
				name: "K-D 树",
				difficulty: 5,
				tags: [
					"数据结构",
					"KD树",
					"计算几何"
				],
				outline: "交替按维度切分建树，矩形到目标点的最小/最大距离做剪枝查最近/最远点对；插入过深时按替罪羊思路重构子树。",
				examples: [lg("P4169", "[Violet] 天使玩偶/SJY摆棋子"), lg("P4357", "[CQOI2016] K 远点对")]
			},
			{
				id: "ds-tree-in-tree",
				name: "树套树",
				difficulty: 5,
				tags: [
					"数据结构",
					"树套树",
					"平衡树"
				],
				outline: "外层线段树按位置、内层平衡树/权值线段树按值域，查询 = O(log n) 个内层结构的拼合；单点版常见，带区间改要在内层打标记。",
				examples: [lg("P3380", "【模板】树套树"), lg("P3332", "[ZJOI2013] K 大数查询")]
			},
			{
				id: "ds-partition-tree",
				name: "划分树",
				difficulty: 5,
				tags: ["数据结构", "划分树"],
				outline: "按排序中位数逐层左右分层，记「进入左子树的前缀个数」即可 O(1) 下溯，静态区间第 k 小不用在线插入；空间 O(n log n) 比主席树省，已被其取代但值得会。",
				examples: []
			}
		]
	},
	{
		key: "tree",
		name: "树论",
		description: "直径、重心、LCA、树剖、点分治——把树上问题变成序列与子树问题的专属工具",
		templates: [
			{
				id: "tree-diameter",
				name: "树的直径",
				difficulty: 3,
				tags: ["树上算法", "树的直径"],
				outline: "两次 DFS 或树形 DP（最长下行链 + 次长下行链拼过点路径）皆可，负权边只能用 DP 法；「直径中点」常是结论题入口。",
				examples: [lg("P3304", "[SDOI2013] 直径"), lg("P1099", "[NOIP 2007 提高组] 树网的核")]
			},
			{
				id: "tree-centroid",
				name: "树的重心",
				difficulty: 3,
				tags: ["树上算法", "树的重心"],
				outline: "一次 DFS 求 max(最大子树, n-子树) 最小的点；重心性质（最大子树 ≤ n/2、换根时 O(1) 转移距离和）要能现场推导。",
				examples: [
					lg("P1364", "医院设置"),
					lg("P1395", "会议"),
					lg("P5536", "【XR-3】核心城市"),
					lg("P2986", "[USACO10MAR] Great Cow Gathering G")
				]
			},
			{
				id: "tree-lca",
				name: "最近公共祖先（倍增）",
				difficulty: 3,
				tags: [
					"LCA",
					"倍增",
					"树上算法"
				],
				outline: "深度对齐后二进制上跳的倍增写法；配合树上差分可把路径统计降到 O(1) 标记 + O(n) 还原。",
				examples: [
					lg("P3379", "【模板】最近公共祖先（LCA）"),
					lg("P1967", "[NOIP 2013 提高组] 货车运输"),
					lg("P3128", "[USACO15DEC] Max Flow P")
				]
			},
			{
				id: "tree-dfs-order",
				name: "DFS 序与子树统计",
				difficulty: 3,
				tags: [
					"DFS序",
					"树状数组",
					"树上算法"
				],
				outline: "进出栈时间戳把子树映射成连续区间（tin/tout），子树修改查询即区间操作，接 BIT/线段树；换根的 delta 推导。",
				examples: [
					lg("P3178", "[HAOI2015] 树上操作"),
					lg("P2146", "[NOI2015] 软件包管理器"),
					lg("P3258", "[JLOI2014] 松鼠的新家")
				]
			},
			{
				id: "tree-hld",
				name: "树链剖分（重链剖分）",
				difficulty: 4,
				tags: [
					"树上算法",
					"树链剖分",
					"线段树"
				],
				outline: "重儿子优先分配 dfn 保证重链连续，任意路径拆成 O(log n) 段连续区间交给线段树；两次 DFS 维护 fa/son/top/dfn。",
				examples: [
					lg("P3384", "【模板】重链剖分 / 树链剖分"),
					lg("P2590", "[ZJOI2008] 树的统计"),
					lg("P2680", "[NOIP 2015 提高组] 运输计划")
				]
			},
			{
				id: "tree-centroid-decomp",
				name: "点分治",
				difficulty: 5,
				tags: [
					"树上算法",
					"点分治",
					"分治"
				],
				outline: "每层选重心为根统计跨根路径再删根递归，共 O(log n) 层；容斥减去同子树路径防重复计数。",
				examples: [
					lg("P3806", "【模板】点分治"),
					lg("P4178", "Tree"),
					lg("P2634", "[国家集训队] 聪聪可可")
				]
			},
			{
				id: "tree-pseudo",
				name: "基环树（环套树）",
				difficulty: 4,
				tags: ["树上算法", "基环树"],
				outline: "找环、断环成「环 + 两棵树」分别处理后合并结果；n 条边的连通图先判定是不是基环树。",
				examples: [
					lg("P5022", "[NOIP 2018 提高组] 旅行"),
					lg("P2607", "[ZJOI2008] 骑士"),
					lg("P4381", "[IOI 2008] Island")
				]
			},
			{
				id: "tree-virtual",
				name: "虚树",
				difficulty: 5,
				tags: [
					"树上算法",
					"虚树",
					"LCA"
				],
				outline: "只保留关键点与其 LCA 的压缩树：关键点按 dfs 序排序、栈维护右链，相邻两点 LCA 判插入；原树 DP 搬到 O(k) 规模上跑。",
				examples: [lg("P2495", "【模板】虚树 / [SDOI2011] 消耗战"), lg("P4103", "[HEOI2014] 大工程")]
			},
			{
				id: "tree-lct",
				name: "Link-Cut-Tree（动态树）",
				difficulty: 5,
				tags: [
					"树上算法",
					"LCT",
					"splay"
				],
				outline: "splay 维护偏好路径 + access 打通根到当前点的实链，makeroot 翻转、link/cut 换父是三个基本件；动态连边删边下的路径/子树信息靠它。",
				examples: [lg("P3690", "【模板】动态树（LCT）"), lg("P2147", "[SDOI2008] 洞穴勘测")]
			},
			{
				id: "tree-cactus",
				name: "仙人掌（圆方树）",
				difficulty: 5,
				tags: [
					"树上算法",
					"仙人掌",
					"圆方树"
				],
				outline: "每条边至多属一个环的结构：Tarjan 建圆方树，环变方点；DP 遇到环先拆环成链（断一端枚举或两次 DP）再合并。",
				examples: [lg("P4244", "[SHOI2008] 仙人掌图 II"), lg("P5236", "【模板】静态仙人掌")]
			}
		]
	},
	{
		key: "dp",
		name: "动态规划",
		description: "背包、区间、树形、状压——把大问题拆成无后效性的子问题",
		templates: [
			{
				id: "dp-knapsack",
				name: "背包 DP（01 / 完全）",
				difficulty: 3,
				tags: ["动态规划", "背包"],
				outline: "一维滚动数组：01 倒序、完全正序的原因；「恰好装满」与「不超过容量」的初始化差异。",
				examples: [
					lg("P1048", "[NOIP 2005 普及组] 采药"),
					lg("P1616", "疯狂的采药"),
					lg("P1064", "[NOIP 2006 提高组] 金明的预算方案"),
					lg("P1164", "小 A 点菜")
				]
			},
			{
				id: "dp-lis",
				name: "最长上升子序列（贪心 + 二分）",
				difficulty: 3,
				tags: [
					"动态规划",
					"二分",
					"LIS"
				],
				outline: "tail 数组的含义（每长度最优末尾）+ lower/upper_bound 对应严格升与不降。",
				examples: [
					lg("B3637", "最长上升子序列"),
					lg("P1020", "[NOIP 1999 提高组] 导弹拦截"),
					lg("P2782", "友好城市"),
					lg("P1439", "两个排列的最长公共子序列")
				]
			},
			{
				id: "dp-interval",
				name: "区间 DP",
				difficulty: 3,
				tags: ["动态规划", "区间DP"],
				outline: "按长度枚举 + 分割点转移的骨架（石子合并），环状断环为链的处理。",
				examples: [
					lg("P1880", "[NOI1995] 石子合并"),
					lg("P1063", "[NOIP 2006 提高组] 能量项链"),
					lg("P1220", "关路灯")
				]
			},
			{
				id: "dp-tree",
				name: "树形 DP",
				difficulty: 4,
				tags: [
					"动态规划",
					"树形DP",
					"DFS"
				],
				outline: "子树为状态域的后序合并（选/不选当前点 0/1 维），DFS 记 fa 防回走。",
				examples: [
					lg("P1352", "没有上司的舞会"),
					lg("P2014", "[CTSC1997] 选课"),
					lg("P2015", "二叉苹果树"),
					lg("P3177", "[HAOI2015] 树上染色"),
					cf("161/D", "Distance in Tree"),
					cf("1975/D", "Paint the Tree")
				]
			},
			{
				id: "dp-bitmask",
				name: "状压 DP",
				difficulty: 4,
				tags: [
					"动态规划",
					"状态压缩",
					"位运算"
				],
				outline: "行状态压整数 + 相邻行转移合法性（纵/斜冲突位运算判断），滚动数组降维。",
				examples: [
					lg("P1896", "[SCOI2005] 互不侵犯"),
					lg("P2704", "[NOI2001] 炮兵阵地"),
					lg("P1879", "[USACO06NOV] Corn Fields G")
				]
			},
			{
				id: "dp-digit",
				name: "数位 DP",
				difficulty: 4,
				tags: ["动态规划", "数位DP"],
				outline: "逐位枚举 + limit/前导零状态记忆化，答案 = solve(r) - solve(l-1)；状态只记「贴不贴上界」往往就够。",
				examples: [
					lg("P2602", "[ZJOI2010] 数字计数"),
					lg("P4127", "[AHOI2009] 同类分布"),
					cf("1036/C", "Classy Numbers")
				]
			},
			{
				id: "dp-probability",
				name: "期望 DP",
				difficulty: 4,
				tags: ["动态规划", "概率期望"],
				outline: "概率正推、期望逆推（f[u] = Σ p·f[后继] + 边代价）；「期望的线性性」拆开各贡献独立算，是卡住时的突破口。",
				examples: [
					lg("P4316", "绿豆蛙的归宿"),
					lg("P1654", "OSU!"),
					lg("P1365", "WJMZBMR打osu! / Easy")
				]
			},
			{
				id: "dp-mono-queue-opt",
				name: "单调队列优化 DP",
				difficulty: 4,
				tags: ["动态规划", "单调队列"],
				outline: "转移形如 f[i] = max(f[j] + w(i) - w(j)) 且 j 落在定长窗口内时，滑动窗口维护决策点均摊 O(1)。",
				examples: [
					lg("P1725", "琪露诺"),
					lg("P2627", "[USACO11OPEN] Mowing the Lawn G"),
					lg("P3957", "[NOIP 2017 普及组] 跳房子")
				]
			},
			{
				id: "dp-slope-opt",
				name: "斜率优化（凸壳转移）",
				difficulty: 5,
				tags: [
					"动态规划",
					"斜率优化",
					"凸壳"
				],
				outline: "把含 i²/j² 的转移整理成斜截式，决策点构成下凸壳：斜率单调弹队首 O(1)，否则二分凸壳 O(log)。",
				examples: [
					lg("P3195", "[HNOI2008] 玩具装箱"),
					lg("P3648", "[APIO2014] 序列分割"),
					lg("P2120", "[ZJOI2007] 仓库建设"),
					lg("P4027", "[NOI2007] 货币兑换")
				]
			},
			{
				id: "dp-steiner",
				name: "最小斯坦纳树",
				difficulty: 5,
				tags: [
					"动态规划",
					"状压DP",
					"最短路"
				],
				outline: "f[u][S] 连通关键点集 S 的最小代价：子集枚举「合并两半」与最短路松弛「同集转移」交替直到收敛。",
				examples: [lg("P6192", "【模板】最小斯坦纳树"), lg("P4294", "[WC2008] 游览计划")]
			},
			{
				id: "dp-plug",
				name: "插头 DP（轮廓线状压）",
				difficulty: 5,
				tags: [
					"动态规划",
					"状压DP",
					"插头DP"
				],
				outline: "逐格转移维护轮廓线上插头的连通性（最小表示法编码），分新建/延续/合并三类讨论；哈希表存状态防膨胀。",
				examples: [lg("P5056", "【模板】插头 DP"), lg("P5074", "Eat the Trees")]
			}
		]
	},
	{
		key: "graph",
		name: "图论",
		description: "最短路、生成树、连通性、网络流——竞赛图论全图谱",
		templates: [
			{
				id: "graph-dijkstra",
				name: "堆优化 Dijkstra",
				difficulty: 3,
				tags: [
					"图论",
					"最短路",
					"堆"
				],
				outline: "小根堆 + done 惰性删除的写法；为什么负权边会使其出错。",
				examples: [
					lg("P4779", "【模板】单源最短路径（标准版）"),
					cf("20/C", "Dijkstra?"),
					lg("P1629", "邮递员送信"),
					cf("1547/E", "Air Conditioners"),
					cf("35/C", "Fire Again")
				]
			},
			{
				id: "graph-spfa",
				name: "SPFA（判负环）",
				difficulty: 3,
				tags: ["图论", "最短路"],
				outline: "队列松弛框架 + 「入队次数 ≥ n 判负环」；何时会被卡到 O(nm)。",
				examples: [
					lg("P3385", "【模板】负环"),
					lg("P1938", "[USACO09NOV] Job Hunt S"),
					lg("P2850", "[USACO06DEC] Wormholes G")
				]
			},
			{
				id: "graph-kruskal",
				name: "Kruskal 最小生成树",
				difficulty: 3,
				tags: [
					"图论",
					"最小生成树",
					"并查集"
				],
				outline: "边排序 + 并查集判环 + 选满 n-1 条；不连通时的判定输出。",
				examples: [
					lg("P3366", "【模板】最小生成树"),
					lg("P1991", "无线通讯网"),
					lg("P2820", "局域网"),
					lg("P1111", "修复公路")
				]
			},
			{
				id: "graph-topo",
				name: "拓扑排序（Kahn）",
				difficulty: 2,
				tags: [
					"图论",
					"拓扑排序",
					"DAG"
				],
				outline: "入度数组反复摘 0 入点，输出数量 < n 即有环；字典序最小用小根堆。",
				examples: [
					lg("B3644", "【模板】拓扑排序 / 家谱树"),
					lg("P4017", "最大食物链计数"),
					lg("P1113", "[USACO02FEB] 杂务"),
					cf("1851/E", "Nastya and Potions")
				]
			},
			{
				id: "graph-hungarian",
				name: "匈牙利算法（二分图最大匹配）",
				difficulty: 4,
				tags: [
					"图论",
					"二分图",
					"匹配"
				],
				outline: "增广路递归腾位写法 + vis 每轮清空；matchR 下标方向（右 → 左）。",
				examples: [
					lg("P3386", "【模板】二分图最大匹配"),
					lg("P2756", "飞行员配对方案问题"),
					lg("P2055", "[ZJOI2009] 假期的宿舍"),
					lg("P1640", "[SCOI2010] 连续攻击游戏"),
					cf("1525/D", "Armchairs"),
					cf("1437/C", "Chef Monocarp")
				]
			},
			{
				id: "graph-floyd",
				name: "Floyd（多源最短路 / 传递闭包）",
				difficulty: 2,
				tags: ["图论", "最短路"],
				outline: "dp[k][i][j] = 只经前 k 个中转点的最短路，k 必须在最外层；按「中转点开放时间」排序可处理动态加点。",
				examples: [
					lg("P1119", "灾后重建"),
					lg("P1522", "[USACO2.4] 牛的旅行 Cow Tours"),
					lg("P2910", "[USACO08OPEN] Clear And Present Danger S"),
					cf("601/A", "The Two Routes"),
					cf("954/D", "Fight Against Traffic")
				]
			},
			{
				id: "graph-euler",
				name: "欧拉路（Euler Path）",
				difficulty: 3,
				tags: ["图论", "欧拉路"],
				outline: "先按度数判存在性（无向图奇度点 0/2 个，有向图出入度平衡或差 1），Hierholzer 算法用栈倒序输出路径。",
				examples: [
					lg("P7771", "【模板】欧拉路径"),
					lg("P2731", "[USACO3.3] 骑马修栅栏 Riding the Fences"),
					lg("P1341", "无序字母对")
				]
			},
			{
				id: "graph-diff-constraint",
				name: "差分约束",
				difficulty: 3,
				tags: [
					"图论",
					"最短路",
					"差分约束"
				],
				outline: "不等式统一成 x_i ≤ x_j + w 后建边跑最短路，超级源点保证连通；求最大解跑最长路、等式拆成两条。",
				examples: [
					lg("P5960", "【模板】差分约束"),
					lg("P1250", "种树"),
					lg("P1993", "小 K 的农场")
				]
			},
			{
				id: "graph-tarjan-scc",
				name: "Tarjan 缩点（强连通分量）",
				difficulty: 4,
				tags: [
					"图论",
					"Tarjan",
					"DAG"
				],
				outline: "dfn/low 回溯收分量（栈内即当前 SCC），缩点后成 DAG；通常接拓扑 DP 求最长链、可达性或点权并。",
				examples: [
					lg("P3387", "【模板】缩点 / 强连通分量"),
					lg("P2341", "[USACO03FALL / HAOI2006] 受欢迎的牛 G"),
					lg("P2812", "校园网络 / [IOI 1996 / USACO5.3] 校园网 Network of Schools 加强版")
				]
			},
			{
				id: "graph-cut",
				name: "割点与桥（无向图双连通）",
				difficulty: 4,
				tags: [
					"图论",
					"Tarjan",
					"双连通"
				],
				outline: "low 只用「子树 + 反向边」更新（不用父边）；割点 root 特判儿子数，边双/点双缩点后建分量树。",
				examples: [
					lg("P3388", "【模板】割点（割顶）"),
					lg("P2860", "[USACO06JAN] Redundant Paths G"),
					lg("P4320", "道路相遇")
				]
			},
			{
				id: "graph-2sat",
				name: "2-SAT",
				difficulty: 4,
				tags: ["图论", "2-SAT"],
				outline: "「选 a 则必选 b」建单向边，Tarjan 求 SCC 后取分量编号（逆拓扑）当真值；x 与 ¬x 同分量即无解。",
				examples: [
					lg("P4782", "【模板】2-SAT"),
					lg("P4171", "[JSOI2010] 满汉全席"),
					cf("776/D", "The Door Problem"),
					cf("468/B", "Two Sets"),
					cf("1715/D", "2+ doors")
				]
			},
			{
				id: "graph-dinic",
				name: "Dinic 最大流",
				difficulty: 4,
				tags: ["图论", "网络流"],
				outline: "BFS 分层 + DFS 沿层增广 + 当前弧优化，O(n²m)；反向边流量做抵消是整个算法的精髓，链式前向星异或配对。",
				examples: [
					lg("P3376", "【模板】网络最大流"),
					lg("P2764", "最小路径覆盖问题"),
					lg("P2762", "太空飞行计划问题"),
					lg("P1345", "[USACO5.4] 奶牛的电信 Telecowmunication"),
					cf("1214/D", "Treasure Island"),
					cf("965/D", "Single-use Stones")
				]
			},
			{
				id: "graph-mcmf",
				name: "最小费用最大流（SSP）",
				difficulty: 4,
				tags: [
					"图论",
					"网络流",
					"费用流"
				],
				outline: "每次在残余图上 SPFA 找费用最短增广路，增广到满流为止；反向边费用取负保证可撤销。",
				examples: [
					lg("P3381", "【模板】最小费用最大流"),
					lg("P1251", "餐巾计划问题"),
					lg("P4016", "负载平衡问题"),
					lg("P4013", "数字梯形问题"),
					cf("653/D", "Delivery Bears")
				]
			},
			{
				id: "graph-second-mst",
				name: "严格次小生成树",
				difficulty: 4,
				tags: [
					"图论",
					"最小生成树",
					"LCA"
				],
				outline: "枚举非树边 (u,v,w)，替换树上 u→v 路径中严格小于 w 的最大边权；倍增维护路径前两大值。",
				examples: [lg("P4180", "[BJWC2010] 严格次小生成树"), cf("609/E", "Minimum spanning tree for each edge")]
			},
			{
				id: "graph-kth-path",
				name: "k 短路",
				difficulty: 5,
				tags: [
					"图论",
					"最短路",
					"A*"
				],
				outline: "反图跑终点最短路作为 h，正向堆按 g+h 弹出，第 k 次到达终点即 k 短路；限制弹出次数防内存爆炸。",
				examples: [lg("P2483", "【模板】k 短路 / [SDOI2010] 魔法猪学院")]
			},
			{
				id: "graph-matrix-tree",
				name: "生成树计数（Matrix-Tree 定理）",
				difficulty: 5,
				tags: [
					"图论",
					"线性代数",
					"行列式"
				],
				outline: "Kirchhoff 矩阵（度数 - 邻接）去掉任意一行一列，其行列式 = 生成树个数；模质数域用高斯消元，非质模换辗转相除消元。",
				examples: [
					lg("P4111", "[HEOI2015] 小 Z 的房间"),
					lg("P3317", "[SDOI2014] 重建"),
					lg("P4336", "[SHOI2016] 黑暗前的幻想乡")
				]
			},
			{
				id: "graph-chu-liu",
				name: "朱刘算法（最小树形图）",
				difficulty: 5,
				tags: ["图论", "生成树"],
				outline: "每轮给除根外每个点选最小入边，出现环则整体缩点、入边权减去环内被替换边权后重跑；先判根可达所有点。",
				examples: [lg("P4716", "【模板】最小树形图")]
			},
			{
				id: "graph-planar",
				name: "平面图判定与对偶图",
				difficulty: 5,
				tags: [
					"图论",
					"平面图",
					"2-SAT"
				],
				outline: "判定走「找哈密顿回路 + 圈内圈外边建 2-SAT 染色」的经典路线；对偶图把平面图最短路 ↔ 对偶图最小割互相转化。",
				examples: [lg("P3209", "[HNOI2010] 平面图判定")]
			},
			{
				id: "graph-chordal",
				name: "区间图与弦图",
				difficulty: 5,
				tags: [
					"图论",
					"弦图",
					"完美消元"
				],
				outline: "MCS 最大势搜索求完美消元序列判弦图，色数 = 最大团数、独立数 = 最小覆盖；区间图按右端点贪心即可直接建模。",
				examples: []
			}
		]
	},
	{
		key: "math",
		name: "数学",
		description: "筛法、逆元、组合数、插值——数论与代数工具箱",
		templates: [
			{
				id: "math-quick-pow",
				name: "快速幂（与龟速乘）",
				difficulty: 1,
				tags: [
					"数学",
					"快速幂",
					"取模"
				],
				outline: "指数二进制分解循环写法；中间乘法溢出时的 __int128 / 龟速乘。",
				examples: [
					lg("P1226", "【模板】快速幂"),
					lg("P1962", "斐波那契数列"),
					lg("P1593", "因子和")
				]
			},
			{
				id: "math-sieve",
				name: "线性筛（素数 + 欧拉函数）",
				difficulty: 3,
				tags: [
					"数学",
					"筛法",
					"欧拉函数"
				],
				outline: "合数只被最小质因子筛掉一次的循环结构 + 欧拉函数两分支递推。",
				examples: [
					lg("P3383", "【模板】线性筛素数"),
					lg("P2158", "[SDOI2008] 仪仗队"),
					lg("P1865", "A % B Problem"),
					lg("P2568", "GCD")
				]
			},
			{
				id: "math-exgcd",
				name: "exgcd 与逆元",
				difficulty: 3,
				tags: [
					"数学",
					"数论",
					"逆元"
				],
				outline: "递归回溯求 ax+by=gcd 的系数（x/y 交换传参），逆元结果统一 (x % p + p) % p。",
				examples: [
					lg("P1082", "[NOIP 2012 提高组] 同余方程"),
					lg("P3811", "【模板】模意义下的乘法逆元"),
					lg("P1516", "青蛙的约会"),
					lg("P2613", "【模板】有理数取余")
				]
			},
			{
				id: "math-comb",
				name: "组合数预处理（阶乘 + 逆元）",
				difficulty: 3,
				tags: ["数学", "组合计数"],
				outline: "阶乘 + 阶乘逆元线性预处理，C(a,b) O(1) 查询；适用前提模数为质数。",
				examples: [
					lg("P2822", "[NOIP 2016 提高组] 组合数问题"),
					lg("P4071", "[SDOI2016] 排列计数"),
					lg("P1313", "[NOIP 2011 提高组] 计算系数")
				]
			},
			{
				id: "math-matrix-pow",
				name: "矩阵快速幂",
				difficulty: 4,
				tags: [
					"数学",
					"矩阵",
					"快速幂"
				],
				outline: "矩阵乘法（k 外层 + 稀疏剪枝）与单位阵初始化的快速幂；线性递推转矩阵的思想。",
				examples: [
					lg("P3390", "【模板】矩阵快速幂"),
					lg("P1962", "斐波那契数列"),
					lg("P1939", "矩阵加速（数列）"),
					lg("P3193", "[HNOI2008] GT考试"),
					cf("691/E", "Xor-sequences"),
					cf("222/E", "Decoding Genome")
				]
			},
			{
				id: "math-game-theory",
				name: "博弈论基础",
				difficulty: 3,
				tags: ["博弈论", "数学"],
				outline: "Nim：各堆异或和非零先手必胜；巴什：n % (m+1) != 0 先手必胜；威佐夫：d = (b-a)·(√5+1)/2 与 min(a,b) 比较；SG：SG(x)=mex{后继SG}，多子游戏取异或和。",
				examples: [
					lg("P2197", "【模板】Nim 游戏"),
					lg("P2252", "【模板】威佐夫博弈 / [SHOI2002] 取石子游戏"),
					lg("P1247", "取火柴游戏"),
					lg("P1290", "欧几里德的游戏"),
					cf("276/B", "Little Girl and Game"),
					cf("2239/A", "Nim Game Is XOR Game")
				]
			},
			{
				id: "math-euler-theorem",
				name: "欧拉定理与降幂",
				difficulty: 3,
				tags: [
					"数学",
					"欧拉函数",
					"取模"
				],
				outline: "a^b ≡ a^(b mod φ(p))（mod p，gcd(a,p)=1）；扩展欧拉定理对 b ≥ φ(p) 分层处理，配合快速幂实现指数降幂。",
				examples: [lg("P5091", "【模板】扩展欧拉定理"), lg("P4139", "上帝与集合的正确用法")]
			},
			{
				id: "math-lucas",
				name: "卢卡斯定理",
				difficulty: 3,
				tags: ["数学", "组合计数"],
				outline: "模小质数 p 时 C(n,m) 按 p 进制逐位相乘，组合数只需预处理到 p-1；不互质模数走 exLucas 拆质因数。",
				examples: [
					lg("P3807", "【模板】卢卡斯定理 / Lucas 定理"),
					lg("P4345", "[SHOI2015] 超能粒子炮·改"),
					lg("P2480", "[SDOI2010] 古代猪文")
				]
			},
			{
				id: "math-crt",
				name: "中国剩余定理（CRT / EXCRT）",
				difficulty: 4,
				tags: ["数学", "同余方程"],
				outline: "互质模数直接合并余数；不互质用 EXCRT 两两合并同余方程，exgcd 解 ax ≡ c (mod m) 时注意无解判定与最小非负解。",
				examples: [
					lg("P1495", "【模板】中国剩余定理（CRT）/ 曹冲养猪"),
					lg("P4777", "【模板】扩展中国剩余定理（EXCRT）"),
					lg("P4774", "[NOI2018] 屠龙勇士"),
					cf("919/E", "Congruence Equation"),
					cf("1500/B", "Two chandeliers")
				]
			},
			{
				id: "math-gauss",
				name: "高斯消元",
				difficulty: 3,
				tags: ["数学", "线性代数"],
				outline: "列主元消元 + 回代解线性方程组；用 eps 判无解/无穷解，01 异或方程组按 bit 消元且行数 = 状态维数。",
				examples: [
					lg("P3389", "【模板】高斯消元法"),
					lg("P2455", "[SDOI2006] 线性方程组"),
					lg("P2447", "[SDOI2010] 外星千足虫")
				]
			},
			{
				id: "math-linear-basis",
				name: "线性基",
				difficulty: 4,
				tags: [
					"数学",
					"位运算",
					"线性基"
				],
				outline: "按最高位插入消元维护一组异或基，支持查最大异或值/第 k 小/判可达；两个基的合并就是逐个插入，O(log²)。",
				examples: [
					lg("P3812", "【模板】线性基"),
					cf("1100/F", "Ivan and Burgers"),
					lg("P4151", "[WC2011] 最大 XOR 和路径")
				]
			},
			{
				id: "math-lagrange",
				name: "拉格朗日插值",
				difficulty: 4,
				tags: ["数学", "多项式"],
				outline: "n+1 个点唯一确定 n 次多项式；横坐标连续（1..k+1）时用前缀/后缀积把求单点值降到 O(n)。",
				examples: [lg("P4781", "【模板】拉格朗日插值"), cf("622/F", "The Sum of the k-th Powers")]
			},
			{
				id: "math-mobius",
				name: "莫比乌斯反演",
				difficulty: 5,
				tags: [
					"数学",
					"莫比乌斯反演",
					"数论分块"
				],
				outline: "F = f * 1 时 f(n) = Σ μ(d)·F(n/d)；套路是交换枚举顺序把「统计 gcd 为定值」转成「整除值域分段」，配合数论分块。",
				examples: [
					lg("P2522", "[HAOI2011] Problem b"),
					lg("P3455", "[POI 2007] ZAP-Queries"),
					lg("P2257", "YY的GCD")
				]
			},
			{
				id: "math-fft",
				name: "FFT / NTT",
				difficulty: 5,
				tags: [
					"数学",
					"FFT",
					"多项式"
				],
				outline: "分治蝶形在系数/点值表示间 O(n log n) 互化；NTT 用原根替代单位根避免精度问题，注意长度补到 2 的幂。",
				examples: [
					lg("P3803", "【模板】多项式乘法（FFT）"),
					lg("P3723", "[AHOI2017/HNOI2017] 礼物"),
					lg("P4238", "【模板】多项式乘法逆"),
					cf("993/E", "Nikita and Order Statistics"),
					cf("1342/E", "Placing Rooks")
				]
			},
			{
				id: "math-bsgs",
				name: "BSGS（大步小步）",
				difficulty: 4,
				tags: [
					"数学",
					"同余方程",
					"BSGS"
				],
				outline: "分块 a^⌈√p⌉ 哈希查表解 a^x ≡ b (mod p)，O(√p)；a 与 p 不互质时先 exBSGS 逐步归一 gcd 再转互质情形。",
				examples: [
					lg("P3846", "【模板】BSGS / [TJOI2007] 可爱的质数"),
					lg("P4195", "【模板】扩展 BSGS / exBSGS"),
					lg("P4884", "多少个 1？")
				]
			},
			{
				id: "math-polya",
				name: "Pólya 定理与置换群",
				difficulty: 5,
				tags: [
					"数学",
					"置换群",
					"组合计数"
				],
				outline: "在置换群下计不等价染色数：等价类数 = 各置换不动点数的平均，不动点数由循环节个数决定（c^轮数）。",
				examples: [lg("P4980", "【模板】Pólya 定理"), lg("P1446", "[HNOI2008] Cards")]
			},
			{
				id: "math-simpson",
				name: "自适应辛普森积分",
				difficulty: 5,
				tags: ["数学", "数值积分"],
				outline: "二次插值近似定积分，中点二分递归、|左右和 - 整段| 足够小才接受；先确认被积函数可计算再谈精度。",
				examples: [lg("P4525", "【模板】自适应辛普森法 1"), lg("P4526", "【模板】自适应辛普森法 2")]
			},
			{
				id: "math-simplex",
				name: "单纯形（线性规划）",
				difficulty: 5,
				tags: [
					"数学",
					"线性规划",
					"单纯形"
				],
				outline: "标准型上选入基/出基变量转轴迭代，pivot 选取防死循环；对偶转化（不等式组 ↔ 变量上下界）常比直接建模好写。",
				examples: [lg("P3980", "[NOI2008] 志愿者招募")]
			}
		]
	},
	{
		key: "string",
		name: "字符串",
		description: "KMP、哈希、Trie——文本处理三件套加回文/匹配进阶",
		templates: [
			{
				id: "str-kmp",
				name: "KMP",
				difficulty: 3,
				tags: ["字符串", "KMP"],
				outline: "nxt 数组构建 + 主串匹配双循环；可重叠计数时失配后 j = nxt[j-1]。",
				examples: [
					lg("P3375", "【模板】KMP"),
					lg("P4391", "[BalticOI 2009] Radio Transmission 无线传输"),
					lg("P3435", "[POI 2006] OKR-Periods of Words")
				]
			},
			{
				id: "str-hash",
				name: "字符串哈希",
				difficulty: 2,
				tags: ["字符串", "哈希"],
				outline: "前缀哈希 + 幂次数组的 O(1) 子串截取公式；自然溢出 vs 双哈希的取舍。",
				examples: [
					lg("P3370", "【模板】字符串哈希"),
					cf("1200/E", "Compress Words"),
					lg("P4391", "[BalticOI 2009] Radio Transmission 无线传输"),
					cf("1849/C", "Binary String Copying"),
					cf("1536/C", "Diluc and Kaeya")
				]
			},
			{
				id: "str-trie",
				name: "Trie（字典树）",
				difficulty: 2,
				tags: ["字符串", "Trie"],
				outline: "静态数组儿子表 + 插入/查询框架；空间按 26 × 总字符数估算。",
				examples: [lg("P2580", "于是他错误的点名开始了"), lg("P1481", "魔族密码")]
			},
			{
				id: "str-manacher",
				name: "Manacher（最长回文）",
				difficulty: 4,
				tags: ["字符串", "回文"],
				outline: "插 # 统一奇偶 + 镜像继承半径 + 右边界外暴力扩展；原串/新串下标换算。",
				examples: [
					lg("P3805", "【模板】Manacher"),
					lg("P4555", "[国家集训队] 最长双回文串"),
					lg("P1659", "[国家集训队] 拉拉队排练"),
					lg("P4287", "[SHOI2011] 双倍回文")
				]
			},
			{
				id: "str-z-function",
				name: "Z 函数（扩展 KMP）",
				difficulty: 4,
				tags: ["字符串"],
				outline: "维护最右匹配段 [l,r] + z[i-l] 继承；拼接分隔符求模式匹配。",
				examples: [lg("P5410", "【模板】扩展 KMP / exKMP（Z 函数）"), cf("1200/E", "Compress Words")]
			},
			{
				id: "str-ac-automaton",
				name: "AC 自动机",
				difficulty: 4,
				tags: [
					"字符串",
					"AC自动机",
					"Trie"
				],
				outline: "Trie 上 BFS 建 fail 指针（指向最长真后缀），匹配时沿 fail 跳跃统计；本质是多模式串版 KMP。",
				examples: [
					lg("P3808", "AC 自动机（简单版）"),
					lg("P3796", "AC 自动机（简单版 II）"),
					lg("P5357", "【模板】AC 自动机"),
					lg("P2444", "[POI 2000 R1] 病毒"),
					cf("633/C", "Spy Syndrome 2"),
					cf("514/C", "Watto and Mechanism")
				]
			},
			{
				id: "str-suffix-array",
				name: "后缀数组（倍增构造）",
				difficulty: 4,
				tags: ["字符串", "后缀数组"],
				outline: "倍增 + 基数排序双关键字 O(n log n)；height[i] 为相邻排名后缀的 LCP，h[i] ≥ h[i-1]-1 保证均摊线性。",
				examples: [
					lg("P3809", "【模板】后缀排序"),
					lg("P2408", "不同子串个数"),
					lg("P2870", "[USACO07DEC] Best Cow Line G"),
					cf("432/D", "Prefixes and Suffixes")
				]
			},
			{
				id: "str-sam",
				name: "后缀自动机（SAM）",
				difficulty: 5,
				tags: ["字符串", "后缀自动机"],
				outline: "增量构造维护 len/link（endpos 等价类），子串个数 = Σ(len(v)-len(link(v)))；parent 树上 DP 是绝大多数题的后续。",
				examples: [
					lg("P3804", "【模板】后缀自动机（SAM）"),
					lg("P4070", "[SDOI2016] 生成魔咒"),
					lg("P3975", "[TJOI2015] 弦论"),
					cf("427/D", "Match & Catch")
				]
			},
			{
				id: "str-minimal-rotation",
				name: "最小表示法",
				difficulty: 3,
				tags: ["字符串", "最小表示法"],
				outline: "双指针比较循环同构串，失配时按结果 i += k+1 跳过整段，均摊线性求最小循环起点。",
				examples: [lg("P1368", "工艺")]
			},
			{
				id: "str-01trie",
				name: "01-Trie（异或极值）",
				difficulty: 3,
				tags: [
					"Trie",
					"位运算",
					"字符串"
				],
				outline: "数值按二进制高位到低位建 Trie，异或最大值在树上贪心走相反分支；配合前缀异或可查任意区间极值。",
				examples: [
					lg("P4551", "最长异或路径"),
					cf("706/D", "Vasiliy's Multiset"),
					lg("P4735", "最大异或和")
				]
			},
			{
				id: "str-pam",
				name: "回文自动机（PAM）",
				difficulty: 5,
				tags: [
					"字符串",
					"回文",
					"回文自动机"
				],
				outline: "每加一个字符至多新增一个本质不同回文节点，fail 指向最长回文后缀；以节点回文长度/出现次数为状态做统计。",
				examples: [
					lg("P5496", "【模板】回文树 / 回文自动机（PAM）"),
					lg("P3649", "[APIO2014] 回文串"),
					lg("P4287", "[SHOI2011] 双倍回文")
				]
			}
		]
	},
	{
		key: "geo",
		name: "计算几何",
		description: "叉积定向、凸包、半平面交——几何题的常用工具箱",
		templates: [
			{
				id: "geo-cross",
				name: "点积 / 叉积与方向判定",
				difficulty: 2,
				tags: ["计算几何"],
				outline: "叉积符号 = 旋转方向的原语地位；全程整型避免精度问题的坐标约定。",
				examples: [lg("P1183", "多边形的面积"), lg("P2742", "【模板】二维凸包 / [USACO5.1] 圈奶牛Fencing the Cows")]
			},
			{
				id: "geo-convex-hull",
				name: "凸包（Andrew 单调链）",
				difficulty: 3,
				tags: ["计算几何", "凸包"],
				outline: "排序去重 + 下链/上链两遍扫（叉积 ≤0 弹栈）；共线点保留与否的选择。",
				examples: [lg("P2742", "【模板】二维凸包 / [USACO5.1] 圈奶牛Fencing the Cows"), cf("166/B", "Polygons")]
			},
			{
				id: "geo-point-in-polygon",
				name: "点在多边形内（射线法）",
				difficulty: 3,
				tags: ["计算几何"],
				outline: "奇偶穿越法 + 半开区间约定处理顶点穿越；点在边上的单独判定。",
				examples: []
			},
			{
				id: "geo-rotating-calipers",
				name: "旋转卡壳（最远点对）",
				difficulty: 3,
				tags: ["计算几何", "凸包"],
				outline: "在凸包上维护对踵点双指针：固定一条边移动第三点，叉积单峰所以均摊线性；先求凸包是前提。",
				examples: [lg("P1452", "[USACO03FALL] Beauty Contest G")]
			},
			{
				id: "geo-pick",
				name: "Pick 定理与格点计数",
				difficulty: 2,
				tags: ["计算几何", "数学"],
				outline: "S = a + b/2 - 1（a 内部格点、b 边上格点），边上格点数 = gcd(|dx|, |dy|)；三角形容斥算多边形。",
				examples: [lg("P2735", "[USACO3.4] 网 Electric Fences"), lg("P1183", "多边形的面积")]
			},
			{
				id: "geo-scanline",
				name: "扫描线（矩形面积并）",
				difficulty: 4,
				tags: [
					"计算几何",
					"线段树",
					"扫描线"
				],
				outline: "按 y 排序上下边事件，线段树维护 x 轴覆盖长度；只算不散播的「覆盖长度」无需 pushdown。",
				examples: [
					lg("P5490", "【模板】扫描线 & 矩形面积并"),
					lg("P1856", "[IOI 1998 / USACO5.5] 矩形周长 Picture"),
					lg("P1904", "天际线")
				]
			},
			{
				id: "geo-half-plane",
				name: "半平面交",
				difficulty: 4,
				tags: ["计算几何", "半平面交"],
				outline: "按极角排序后双端队列维护有效半平面（叉积判淘汰）；平行同向取更紧的一条、反向则无交。",
				examples: [lg("P4196", "【模板】半平面交 / [CQOI2006] 凸多边形"), lg("P2600", "[ZJOI2008] 瞭望塔")]
			}
		]
	},
	{
		key: "misc",
		name: "STL 与杂项",
		description: "STL 容器、位运算、高精度与离线分治——赛场上随取随用的通用工具",
		templates: [
			{
				id: "misc-stl",
				name: "STL 容器速用（map / set / priority_queue / deque）",
				difficulty: 1,
				tags: ["STL"],
				outline: "map/set 的 lower_bound/erase 迭代器陷阱、multiset 只删一个的正确写法、deque 两端 O(1) 的适用边界。",
				examples: [
					lg("P1449", "后缀表达式"),
					lg("P1177", "【模板】排序"),
					lg("P1059", "[NOIP 2006 普及组] 明明的随机数"),
					lg("P1093", "[NOIP 2007 普及组] 奖学金")
				]
			},
			{
				id: "misc-bitwise",
				name: "位运算技巧",
				difficulty: 1,
				tags: ["位运算"],
				outline: "lowbit、popcount、枚举子集 s = (s-1) & S 的循环写法；「按位拆贡献」独立统计每一位是通用思考方式。",
				examples: [
					lg("P2114", "[NOI2014] 起床困难综合症"),
					lg("P1469", "找筷子"),
					lg("P5657", "[CSP-S 2019] 格雷码"),
					cf("1514/B", "AND 0, Sum Big"),
					cf("1420/B", "Rock and Lever")
				]
			},
			{
				id: "misc-bignum",
				name: "高精度",
				difficulty: 2,
				tags: ["高精度"],
				outline: "vector 按位存十进制（或压 9 位省内存）实现加减乘除：进借位方向、除法的高位试商与商前导零。",
				examples: [
					lg("P1601", "高精度加法"),
					lg("P1303", "A*B Problem"),
					lg("P2142", "高精度减法"),
					lg("P1009", "[NOIP 1998 普及组] 阶乘之和")
				]
			},
			{
				id: "misc-bitset",
				name: "bitset 压位优化",
				difficulty: 4,
				tags: ["bitset", "位运算"],
				outline: "把布尔转移并行化，可达性/背包计数等 O(n²) 过程整体除以 64；左移位数超类型宽度是未定义行为，需分段。",
				examples: [lg("P4141", "消失之物"), lg("P3674", "小清新人渣的本愿")]
			},
			{
				id: "misc-cdq-whole",
				name: "CDQ 分治与整体二分",
				difficulty: 5,
				tags: [
					"分治",
					"离线",
					"CDQ分治"
				],
				outline: "CDQ：左半的修改贡献给右半的查询，三维偏序逐维消去；整体二分：操作序列与值域同时二分，离线求第 k 大类问题。",
				examples: [lg("P3810", "【模板】三维偏序 / 陌上花开"), lg("P3527", "[POI 2011] MET-Meteors")]
			},
			{
				id: "misc-table-cast",
				name: "打表与卡常",
				difficulty: 2,
				tags: [
					"打表",
					"卡常",
					"技巧"
				],
				outline: "打表：本地暴力 + 脚本生成答案数组直接查表（分段打表控制代码长度）；卡常：快读、减少取模、循环展开、内存连续访问。",
				examples: []
			}
		]
	}
];
const TEMPLATE_TOTAL$1 = CURRICULUM.reduce((n, c) => n + c.templates.length, 0);
// src/templates/progress.ts
/** 模板进度管理（移植自原 icpc-workbench 的 progress.ts） */
const TEMPLATE_STATUSES = [
	"todo",
	"learning",
	"mastered"
];
function isTemplateId(id) {
	return CURRICULUM.some((c) => c.templates.some((t) => t.id === id));
}
/** 下一课推荐：优先「学习中」的，否则第一个「未学」的 */
function nextTemplate(progress) {
	let firstTodo;
	for (const cat of CURRICULUM) for (const t of cat.templates) {
		const s = progress.get(t.id)?.status ?? "todo";
		if (s === "learning") return t;
		if (s === "todo" && !firstTodo) firstTodo = t;
	}
	return firstTodo;
}
CURRICULUM.reduce((n, c) => n + c.templates.length, 0);
// src/tools/templates.ts
const customId = (dbId) => `c-${dbId}`;
/** 已接入同步适配器的平台（洛谷/牛客未接入，模板库中仍保留其例题数据但不参与同步） */
const SUPPORTED_PLATFORMS = ["codeforces", "atcoder"];
function registerTemplateTool(host, ctx) {
	return ctx.tools.register(defineTool({
		name: "icpc_templates",
		description: "管理 114 课算法模板库。action=browse 浏览大纲（含进度/自建模板/例题状态/下一课推荐）；action=next 推荐下一课；action=set_status 设置学习状态；action=set_note 更新笔记；action=set_content 填充模板内容（code/idea/complexity/url）；action=create_custom / update_custom / delete_custom 管理自建模板；action=collect_example 例题一键入库；action=sync_examples 同步模板例题 AC 状态。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: [
					"browse",
					"next",
					"set_status",
					"set_note",
					"set_content",
					"create_custom",
					"update_custom",
					"delete_custom",
					"collect_example",
					"sync_examples"
				]
			},
			templateId: {
				type: "string",
				description: "模板 ID（set_status/set_note/set_content/sync_examples）"
			},
			status: {
				type: "string",
				enum: [
					"todo",
					"learning",
					"mastered"
				]
			},
			note: {
				type: "string",
				description: "笔记（set_note）"
			},
			code: {
				type: "string",
				description: "模板代码（set_content/create_custom/update_custom）"
			},
			idea: {
				type: "string",
				description: "思路"
			},
			complexity: {
				type: "string",
				description: "复杂度分析"
			},
			url: {
				type: "string",
				description: "参考链接"
			},
			customId: {
				type: "number",
				description: "自建模板 ID（update_custom/delete_custom）"
			},
			categoryKey: {
				type: "string",
				description: "课程分类 key（create_custom）"
			},
			name: {
				type: "string",
				description: "模板名称（create_custom/update_custom）"
			},
			difficulty: {
				type: "number",
				description: "难度 1-5（create_custom/update_custom）"
			},
			tags: {
				type: "array",
				items: { type: "string" }
			},
			platform: {
				type: "string",
				enum: ["codeforces", "atcoder"],
				description: "例题平台（collect_example）"
			},
			key: {
				type: "string",
				description: "例题标识（collect_example）"
			},
			title: {
				type: "string",
				description: "例题标题（collect_example）"
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
				case "browse": {
					const progress = store.getAllProgress();
					const custom = store.listCustomTemplates();
					const examplePairs = [];
					for (const cat of CURRICULUM) for (const t of cat.templates) for (const ex of t.examples) examplePairs.push({
						platform: ex.platform,
						key: ex.key
					});
					const exampleStatus = store.loadExampleStatus(examplePairs);
					const customByCategory = /* @__PURE__ */ new Map();
					for (const row of custom) {
						const list = customByCategory.get(row.categoryKey) ?? [];
						list.push(row);
						customByCategory.set(row.categoryKey, list);
					}
					let mastered = 0;
					let learning = 0;
					for (const entry of progress.values()) if (entry.status === "mastered") mastered++;
					else if (entry.status === "learning") learning++;
					const next = nextTemplate(progress);
					return {
						ok: true,
						data: {
							total: TEMPLATE_TOTAL$1,
							mastered,
							learning,
							customCount: custom.length,
							next: next ? {
								id: next.id,
								name: next.name,
								difficulty: next.difficulty
							} : null,
							categories: CURRICULUM.map((cat) => ({
								key: cat.key,
								name: cat.name,
								description: cat.description,
								templates: [...cat.templates.map((t) => ({
									custom: false,
									...t,
									examples: t.examples.map((ex) => {
										const supported = SUPPORTED_PLATFORMS.includes(ex.platform);
										return {
											...ex,
											supported,
											...supported ? exampleStatus.get(`${ex.platform}:${ex.key}`) ?? {
												inBank: false,
												ac: false
											} : {
												inBank: false,
												ac: false
											}
										};
									}),
									status: progress.get(t.id)?.status ?? "todo",
									note: progress.get(t.id)?.note ?? null,
									content: progress.get(t.id)?.code != null ? {
										code: progress.get(t.id)?.code,
										idea: progress.get(t.id)?.idea,
										complexity: progress.get(t.id)?.complexity,
										url: progress.get(t.id)?.url
									} : null
								})), ...(customByCategory.get(cat.key) ?? []).map((row) => ({
									custom: true,
									id: customId(row.id),
									name: row.name,
									difficulty: Math.min(5, Math.max(1, row.difficulty)),
									tags: row.tags,
									code: row.code,
									idea: row.idea ?? "",
									complexity: row.complexity ?? "",
									outline: "",
									examples: [],
									status: progress.get(customId(row.id))?.status ?? "todo",
									note: progress.get(customId(row.id))?.note ?? null,
									content: null
								}))]
							}))
						}
					};
				}
				case "next": {
					const next = nextTemplate(store.getAllProgress());
					if (!next) return {
						ok: true,
						next: null
					};
					const cat = CURRICULUM.find((c) => c.templates.some((t) => t.id === next.id));
					return {
						ok: true,
						next: {
							id: next.id,
							name: next.name,
							category: cat?.name ?? "",
							difficulty: next.difficulty
						}
					};
				}
				case "set_status": {
					const id = args.templateId;
					const status = args.status;
					if (!TEMPLATE_STATUSES.includes(status)) return {
						ok: false,
						error: "status 需为 'todo' | 'learning' | 'mastered'"
					};
					if (!isTemplateId(id)) return {
						ok: false,
						error: `课程中不存在模板 ${id}`
					};
					store.setTemplateProgress(id, {
						status,
						masteredAt: status === "mastered" ? (/* @__PURE__ */ new Date()).toISOString() : null
					});
					return { ok: true };
				}
				case "set_note": {
					const id = args.templateId;
					const note = args.note;
					if (typeof note !== "string") return {
						ok: false,
						error: "note 需为字符串"
					};
					if (!isTemplateId(id)) return {
						ok: false,
						error: `课程中不存在模板 ${id}`
					};
					store.setTemplateProgress(id, { note: note.trim() === "" ? null : note });
					return { ok: true };
				}
				case "set_content": {
					const id = args.templateId;
					if (!isTemplateId(id)) return {
						ok: false,
						error: `课程中不存在模板 ${id}`
					};
					const code = typeof args.code === "string" ? args.code : "";
					if (code.length > 2e4) return {
						ok: false,
						error: "code 过长"
					};
					store.setTemplateProgress(id, {
						code: code || null,
						idea: typeof args.idea === "string" ? args.idea.slice(0, 5e3) || null : null,
						complexity: typeof args.complexity === "string" ? args.complexity.slice(0, 200) || null : null,
						url: typeof args.url === "string" && args.url.trim() ? args.url.trim().slice(0, 500) : null
					});
					return {
						ok: true,
						hasContent: code.trim() !== "" || typeof args.idea === "string" && args.idea.trim() !== ""
					};
				}
				case "create_custom": {
					const v = validateCustomBody(args);
					if ("error" in v) return {
						ok: false,
						error: v.error
					};
					const record = store.createCustomTemplate({
						categoryKey: v.categoryKey,
						name: v.name,
						difficulty: v.difficulty,
						tags: v.tags,
						code: v.code,
						idea: v.idea || null,
						complexity: v.complexity || null,
						url: v.url
					});
					return {
						ok: true,
						id: customId(record.id)
					};
				}
				case "update_custom": {
					const dbId = Number(args.customId);
					if (!Number.isInteger(dbId)) return {
						ok: false,
						error: "customId 必填"
					};
					if (!store.getCustomTemplate(dbId)) return {
						ok: false,
						error: "自建模板不存在"
					};
					const v = validateCustomBody(args);
					if ("error" in v) return {
						ok: false,
						error: v.error
					};
					store.updateCustomTemplate(dbId, {
						categoryKey: v.categoryKey,
						name: v.name,
						difficulty: v.difficulty,
						tags: v.tags,
						code: v.code,
						idea: v.idea || null,
						complexity: v.complexity || null,
						url: v.url
					});
					return { ok: true };
				}
				case "delete_custom": {
					const dbId = Number(args.customId);
					if (!Number.isInteger(dbId)) return {
						ok: false,
						error: "customId 必填"
					};
					if (!store.deleteCustomTemplate(dbId)) return {
						ok: false,
						error: "自建模板不存在"
					};
					return { ok: true };
				}
				case "collect_example": {
					const platform = args.platform;
					const key = typeof args.key === "string" ? args.key.trim() : "";
					if (!platform || !["codeforces", "atcoder"].includes(platform)) return {
						ok: false,
						error: "platform 非法"
					};
					if (!key) return {
						ok: false,
						error: "key 必填"
					};
					const title = typeof args.title === "string" && args.title ? args.title : key;
					store.upsertBankProblems([{
						platform,
						problemKey: key,
						title,
						difficulty: null,
						url: typeof args.url === "string" && args.url ? args.url : null,
						tags: Array.isArray(args.tags) ? args.tags.map(String).filter(Boolean) : []
					}]);
					return { ok: true };
				}
				case "sync_examples": {
					const templateId = args.templateId;
					if (!templateId) return {
						ok: false,
						error: "templateId 必填"
					};
					const item = CURRICULUM.flatMap((cat) => cat.templates).find((t) => t.id === templateId);
					if (!item || item.examples.length === 0) return {
						ok: false,
						error: `模板 ${templateId} 不存在或没有例题`
					};
					const results = [];
					for (const platform of new Set(item.examples.map((ex) => ex.platform))) {
						if (!SUPPORTED_PLATFORMS.includes(platform)) {
							results.push({
								platform,
								handle: null,
								imported: 0,
								skipped: 0,
								errors: [`平台 ${platform} 未接入同步（仅支持 CF/AtCoder）`]
							});
							continue;
						}
						const account = store.getAccount(platform);
						if (!account?.handle) {
							results.push({
								platform,
								handle: null,
								imported: 0,
								skipped: 0,
								errors: [`未绑定 ${platform} 账号`]
							});
							continue;
						}
						const r = await syncPlatform(host, platform, account.handle);
						results.push({
							...r,
							handle: account.handle
						});
					}
					return {
						ok: true,
						results
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
			title: `模板：${args.action}`
		})
	}));
}
function validateCustomBody(body) {
	const name = typeof body.name === "string" ? body.name.trim() : "";
	if (!name || name.length > 100) return { error: "name 必填且不超过 100 字" };
	const categoryKey = body.categoryKey;
	if (typeof categoryKey !== "string" || !CURRICULUM.some((c) => c.key === categoryKey)) return { error: "categoryKey 需为课程分类之一" };
	const difficulty = Number(body.difficulty);
	if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return { error: "difficulty 需为 1-5 整数" };
	const tags = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 12) : [];
	const code = typeof body.code === "string" ? body.code : "";
	if (code.length > 2e4) return { error: "code 过长" };
	return {
		name,
		categoryKey,
		difficulty,
		tags,
		code,
		idea: typeof body.idea === "string" ? body.idea.slice(0, 5e3) : "",
		complexity: typeof body.complexity === "string" ? body.complexity.slice(0, 200) : "",
		url: typeof body.url === "string" && body.url.trim() !== "" ? body.url.trim() : null
	};
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
	"icpc_templates",
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
		registerTemplateTool(host, targetCtx),
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
				if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
					sendJson$1(res, 415, {
						ok: false,
						error: "json-required"
					});
					return;
				}
				try {
					const body = await readJson(req);
					if (typeof body.sessionId !== "string") throw new ActivationError("sessionId is required", 400, "invalid-session-id");
					sendJson$1(res, 200, {
						ok: true,
						...activator.activate(body.sessionId)
					});
				} catch (error) {
					if (error instanceof ActivationError) {
						sendJson$1(res, error.status, {
							ok: false,
							error: error.code,
							message: error.message
						});
						return;
					}
					sendJson$1(res, 400, {
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
const BANK_BOOTSTRAP_THRESHOLD = 1e3;
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
async function runSync(host) {
	const settings = host.store.getSettings();
	const summary = {
		ok: true,
		synced: [],
		bank: null,
		reviews: null,
		throttled: false
	};
	const now = Date.now();
	for (const [pf, account] of Object.entries(settings.accounts)) {
		if (!account?.handle || !account.enabled) continue;
		const last = account.lastSyncAt ? Date.parse(account.lastSyncAt) : 0;
		if (Number.isFinite(last) && now - last < THROTTLE_MS) {
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
	if (host.store.countProblems("codeforces") < BANK_BOOTSTRAP_THRESHOLD) {
		const bank = await syncBank(host, "codeforces");
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
	return summary;
}
function registerSyncRoute(ctx, host) {
	if (!ctx.webServer) return;
	let inFlight = null;
	const run = () => {
		if (!inFlight) inFlight = runSync(host).finally(() => {
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
					sendJson(res, 200, await run());
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
}
export { Config, apply, inject, name };
