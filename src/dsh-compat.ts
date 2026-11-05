/**
 * DSH 兼容层：在不安装 @deepseek-ai/cordis / @deepseek-ai/dsh-tools 的环境下
 * 提供结构兼容的类型与辅助函数，使插件可独立开发和类型检查。
 *
 * 在真实 dsh 运行时中，Cordis Context 被注入 apply(ctx, config)，
 * ctx.tools.register() 接受结构兼容的工具定义。
 */

// ---------- 工具参数 schema ----------

export interface ParameterSpec {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  required?: boolean
  description?: string
  enum?: string[]
  items?: Record<string, unknown>
  properties?: Record<string, ParameterSpec>
  default?: unknown
}

// ---------- 工具执行上下文 ----------

export interface ToolExec {
  signal: AbortSignal
  agent: {
    session: {
      append: (type: string, data: unknown) => void
    }
  }
}

// ---------- 工具定义 ----------

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ParameterSpec>
  output: {
    schema: unknown
    render: (args: Record<string, unknown>, value: unknown) => Array<{ type: 'text'; text: string }>
  }
  execute: (args: Record<string, unknown>, exec: ToolExec) => Promise<unknown>
  presentCall?: (args: Record<string, unknown>) => {
    card: string
    title: string
    detail?: Record<string, unknown>
  }
  presentResult?: (args: Record<string, unknown>, value: unknown) => {
    card: string
    title: string
    detail?: Record<string, unknown>
  }
}

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
const PARAMETER_KEYWORDS = ['type', 'description', 'enum', 'items', 'properties'] as const

function sanitizeSpec(spec: ParameterSpec): Record<string, unknown> {
  const source = spec as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of PARAMETER_KEYWORDS) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  if (spec.default !== undefined) {
    const note = `（默认 ${JSON.stringify(spec.default)}）`
    out.description = typeof out.description === 'string' ? `${out.description}${note}` : note
  }
  return out
}

function compileParameters(params: Record<string, ParameterSpec>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [paramName, spec] of Object.entries(params ?? {})) {
    if (!spec || typeof spec !== 'object') {
      properties[paramName] = spec
      continue
    }
    properties[paramName] = sanitizeSpec(spec)
    if (spec.required === true) required.push(paramName)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

export function defineTool(def: ToolDefinition): ToolDefinition {
  if (!def.name || !def.description || !def.execute) {
    throw new Error('Invalid tool definition: missing required field')
  }
  return {
    ...def,
    parameters: compileParameters(def.parameters) as unknown as Record<string, ParameterSpec>,
  }
}

// ---------- Cordis Context 兼容类型 ----------

export interface FsService {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  readdir(path: string): Promise<string[]>
  /** 原子写盘用：先写临时文件再 rename 覆盖，避免写到一半进程退出留下残缺 JSON */
  rename?(from: string, to: string): Promise<void>
}

export interface ToolsService {
  register(tool: ToolDefinition): () => void
}

/** RPC bridge：host.call / handle，供 client 半边拉数据 */
export interface RpcService {
  handle(method: string, handler: (params: unknown) => Promise<unknown>): () => void
  call: (method: string, params?: unknown) => Promise<unknown>
}

export interface AgentLike {
  id: string
  ctx: Context
}

export interface AgentsService {
  get(id: string): AgentLike | undefined
}

export interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void | Promise<void>
}

export interface WebServerService {
  register(route: WebRoute): () => void
}

export interface Context {
  tools: ToolsService
  agents?: AgentsService
  webServer?: WebServerService
  fs?: FsService
  rpc?: RpcService
  effect: (fn: () => void | (() => void)) => void
  on: (event: string, handler: (...args: unknown[]) => unknown) => () => void
  emit: (event: string, ...args: unknown[]) => void
}

// ---------- 插件配置 ----------

export interface PluginConfig {
  /** 数据目录路径（存 JSON 状态文件）；留空则用 workspace 下 .icpc-data/ */
  dataDir: string
  /** 本地题目根目录（如 /Volumes/kingston/codeforces）；留空则用默认扫描根 */
  localRoot: string
  /** AI 配置（生成训练计划用） */
  ai: {
    enabled: boolean
    baseURL: string
    apiKey: string
    model: string
  }
}

/**
 * Standard Schema compatible config contract.
 * Cordis reads only `Config['~standard'].validate()`; keeping the local
 * implementation avoids a runtime dependency on schemastery in file plugins.
 */
export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: 'schemastery',
    validate(raw: unknown) {
      const input = raw && typeof raw === 'object' ? raw as Partial<PluginConfig> : {}
      return { value: resolveConfig(input) }
    },
  },
}

export function resolveConfig(raw: Partial<PluginConfig> = {}): PluginConfig {
  return {
    dataDir: raw.dataDir ?? '',
    localRoot: raw.localRoot ?? '',
    ai: {
      enabled: raw.ai?.enabled ?? false,
      baseURL: raw.ai?.baseURL ?? 'https://api.deepseek.com/v1',
      apiKey: raw.ai?.apiKey ?? '',
      model: raw.ai?.model ?? 'deepseek-chat',
    },
  }
}
