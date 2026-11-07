/**
 * dsh-team-workbench / 智能体团队（宿主端，由 dsh-team-workbench 组合）
 *
 * 一条 DSH 会话里的一支具名智能体团队：
 *   · 智能体增删改查：新建 / 读取 / 编辑 / 删除 / 排序 / 批量增删 / 设定团队数量 / 复制。
 *   · 模型增删改查：每个智能体持有**一组模型路由**（provider / model / reasoningEffort /
 *     别名 / 启用），可逐条新增、编辑、删除、启用停用、切换当前使用、调整顺序。
 *   · 派发时按「当前路由 → 其余已启用路由」的顺序依次尝试，失败自动回退到下一个模型，
 *     并把每条路由的尝试结果一起返回。
 *   · 配置持久化在 $DSH_HOME/agent-team-studio/team.json，每次请求都从磁盘重新读取。
 *   · 通过 ctx.connection.fetch 暴露同源路由，供侧边栏界面读写。
 *   · 通过 ctx.tools.register 注册三个工具：agent_team_roster / agent_team_dispatch /
 *     agent_team_task（强制审查流水线：产出 → 审核 → 复核）。
 *
 * 本模块只依赖 Node 内置模块，不需要工作区里的 node_modules。
 *
 * @module dsh-team-workbench/dsh/team
 */

import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readBalances, writeKey } from './balance.js'
import {
  colorOfName,
  decodeImageDataUrl,
  listPresets,
  loadPreset,
  loadRoleBody,
  loadRoleIndex,
  addAvatarToLibrary,
  loadAvatarLibrary,
  readAvatar,
  removeAvatarFromLibrary,
  saveAvatar,
  searchRoles
} from './library.js'

/** Cordis 插件名。 */
export const TEAM_NAME = 'dsh-team-workbench/team'

/** 依赖的服务：路由通道 + 工具注册表。 */
export const inject = ['connection', 'tools']

/**
 * 关键词触发：用户消息里出现关键词时，强制主智能体先把请求派发给团队。
 *
 * 实现说明（重要）：注册的是**宿主侧的强制提示规则**，不是硬拦截。
 * DSH 在 agent/pre-step 的 decision 上确实能追加消息，但构造一条规范化消息需要
 * @deepseek-ai/dsh-llm 的 createUserMessage（带 brand id 与冻结语义），插件包解析不到；
 * 手工拼一条非规范消息塞进模型请求，风险是会破坏会话状态。
 * 因此改为「宿主注册规则」：触发条件由宿主判定并写入系统提示，模型必定收到强制指令，
 * 由它调用 agent_team_roster / agent_team_dispatch 完成派发。
 */
const TRIGGER_DEFAULTS = { enabled: true, keywords: ['项目'], member: '' }

/** 宿主端功能版本，GET /state 会返回、界面页脚也会显示。
 *  必须与 package.json 的 version 一致：改包版本时这里一起改。
 *  （移植初期这里是旧插件的 '2.0.0'，而包版本是 1.0.0，界面会显示成 2.0.0，
 *   看起来像装了另一个包——smoke-client.mjs 现在有断言把两者钉在一起。） */
// 必须与 package.json 的 version 一致；scripts/smoke-client.mjs 会断言这一点，
// 改了版本号忘改这里会直接冒烟失败（1.0.0 时就踩过一次）。
const PLUGIN_VERSION = '2.86.3'

/** 路由前缀。 */
export const ROUTE_BASE = '/api/team-workbench'
const STATE_ROUTE = ROUTE_BASE + '/state'
const MEMBERS_ROUTE = ROUTE_BASE + '/members'
const PROBE_ROUTE = ROUTE_BASE + '/probe'
const DISPATCH_ROUTE = ROUTE_BASE + '/dispatch'
const GROUPS_ROUTE = ROUTE_BASE + '/groups'
const ROLES_ROUTE = ROUTE_BASE + '/roles'
const ROLE_BODY_ROUTE = ROUTE_BASE + '/roles/body'
const PRESET_ROUTE = ROUTE_BASE + '/preset'
const AVATAR_ROUTE = ROUTE_BASE + '/avatar'
const AVATAR_LIBRARY_ROUTE = ROUTE_BASE + '/avatar-library'
const USAGE_ROUTE = ROUTE_BASE + '/usage'
const BALANCE_ROUTE = ROUTE_BASE + '/balance'
const PLATFORMS_ROUTE = ROUTE_BASE + '/platforms'
const BALANCE_KEY_ROUTE = ROUTE_BASE + '/balance/key'

/** 推理强度选项（与 dsh-llm 的 ReasoningEffortId 对齐）。 */
const EFFORT_OPTIONS = ['minimal', 'low', 'medium', 'high', 'max']

/** 规模上限。 */
const MAX_MEMBERS = 64
const MAX_ROUTES = 8

/** 配置文档版本（v3：分组 + 头像 + 角色库引用）。 */
const STORE_VERSION = 3

/** 解析 harness 主目录：优先 DSH_HOME，其次 ~/.dsh。 */
export function harnessHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** 团队配置文件的绝对路径。 */
function storePath() {
  return join(harnessHome(), 'agent-team-studio', 'team.json')
}

/** 派发用量日志（本机统计，不是服务商余额）。 */
function usagePath() {
  return join(harnessHome(), 'agent-team-studio', 'usage.json')
}

/** 追加一条派发记录；最多保留 800 条，写失败不影响派发。 */
export async function recordUsage(entry) {
  try {
    let list = []
    try {
      const raw = await readFile(usagePath(), 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) list = parsed
    } catch { /* 首次写入 */ }
    list.push(entry)
    if (list.length > 800) list = list.slice(list.length - 800)
    await mkdir(dirname(usagePath()), { recursive: true })
    await writeFile(usagePath(), JSON.stringify(list))
  } catch { /* 统计失败不阻断 */ }
}

/** 读取全部派发记录。 */
export async function readUsage() {
  try {
    const parsed = JSON.parse(await readFile(usagePath(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}


/** 生成短小、稳定、可读的 id。 */
export function makeId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** 收敛成去空白字符串。 */
export function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 规范化一条模型路由。 */
function normalizeRoute(raw, index) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    id: text(source.id) || makeId('r'),
    label: text(source.label) || '模型 ' + String(index + 1),
    provider: text(source.provider),
    model: text(source.model),
    reasoningEffort: text(source.reasoningEffort),
    enabled: source.enabled === false ? false : true
  }
}

/** 规范化一个分组。 */
function normalizeGroup(raw, index) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    id: text(source.id) || makeId('g'),
    name: text(source.name) || '分组 ' + String(index + 1),
    color: /^#[0-9a-fA-F]{6}$/.test(text(source.color)) ? text(source.color).toLowerCase() : '',
    order: Number.isFinite(source.order) ? Number(source.order) : index,
    collapsed: source.collapsed === true
  }
}

/** 规范化头像：emoji（默认，前端生成色底）或已上传图片。 */
function normalizeAvatar(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const kind = source.kind === 'image' ? 'image' : 'emoji'
  return { kind, imageId: kind === 'image' ? text(source.imageId) : '' }
}

/** 规范化角色库引用；空 id 表示没有引用。 */
function normalizeRoleRef(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const id = text(source.id)
  return id.length === 0
    ? { library: '', id: '', version: '' }
    : { library: text(source.library) || 'agency-agents-zh', id, version: text(source.version) }
}

/** 部门子智能体：一个角色 + 自己的模型路由（不单独出现在团队成员列表里）。 */
function normalizeSubAgent(raw, index) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    id: text(source.id) || makeId('s'),
    name: text(source.name) || '子智能体 ' + String(index + 1),
    role: text(source.role) || '通用助手',
    emoji: text(source.emoji) || '🤖',
    provider: text(source.provider),
    model: text(source.model),
    reasoningEffort: text(source.reasoningEffort),
    roleRef: normalizeRoleRef(source.roleRef)
  }
}

/** 部门：一个成员代表整个部门，内部是若干子智能体。 */
function normalizeDepartment(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const subs = Array.isArray(raw.subAgents) ? raw.subAgents.slice(0, 64).map(normalizeSubAgent) : []
  if (subs.length === 0) return null
  return { name: text(raw.name), subAgents: subs }
}

/** 规范化一个成员；兼容 v1 的单模型字段（provider/model/reasoningEffort）。 */
function normalizeMember(raw, index) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const incoming = Array.isArray(source.routes) ? source.routes.slice(0, MAX_ROUTES) : []
  const routes = incoming.map(normalizeRoute)
  if (routes.length === 0) {
    const legacyProvider = text(source.provider)
    const legacyModel = text(source.model)
    if (legacyProvider.length > 0 || legacyModel.length > 0) {
      routes.push(normalizeRoute({
        label: '默认模型',
        provider: legacyProvider,
        model: legacyModel,
        reasoningEffort: text(source.reasoningEffort)
      }, 0))
    }
  }
  const activeRouteId = routes.some((route) => route.id === text(source.activeRouteId))
    ? text(source.activeRouteId)
    : routes.length > 0 ? routes[0].id : ''
  return {
    id: text(source.id) || makeId('m'),
    name: text(source.name) || '智能体 ' + String(index + 1),
    role: text(source.role) || '通用助手',
    emoji: text(source.emoji) || '🤖',
    // 卡片配色：空串 = 自动（客户端按 id 稳定分配），否则 #rrggbb。
    color: /^#[0-9a-fA-F]{6}$/.test(text(source.color)) ? text(source.color).toLowerCase() : '',
    // 分组 id；空串落「未分组」。
    groupId: text(source.groupId),
    // 头像：默认 emoji + 配色底，可选上传图片（imageId 指向本机头像文件）。
    avatar: normalizeAvatar(source.avatar),
    // 角色库引用：从 agency-agents-zh 导入的角色，派发时按 id 取正文当 persona。
    roleRef: normalizeRoleRef(source.roleRef),
    instructions: typeof source.instructions === 'string' ? source.instructions : '',
    enabled: source.enabled === false ? false : true,
    createdAt: text(source.createdAt) || new Date().toISOString(),
    routes,
    activeRouteId,
    // 部门成员：department 非空时，这个成员是一整个部门，subAgents 是它内部的子智能体。
    department: normalizeDepartment(source.department),
    // 从本机 agent 平台接入的成员，记下来源，避免重复导入。
    sourcePlatform: text(source.sourcePlatform)
  }
}

/** 空团队。 */
function emptyStore() {
  return { version: STORE_VERSION, updatedAt: '', preset: '', chiefId: '', groups: [], members: [] }
}

/** 总管解析：有效则沿用，否则回退到第一位启用成员（没有成员时为空串）。 */
function resolveChiefId(members, current) {
  const fromStore = text(current)
  if (members.some((member) => member.id === fromStore)) return fromStore
  const first = members.find((member) => member.enabled !== false) || members[0]
  return first === undefined ? '' : first.id
}

/** 读取团队配置；缺失或损坏时返回空团队。 */
export async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(storePath(), 'utf8'))
    const groups = Array.isArray(parsed?.groups) ? parsed.groups.map(normalizeGroup) : []
    const known = new Set(groups.map((group) => group.id))
    const members = Array.isArray(parsed?.members) ? parsed.members.map(normalizeMember) : []
    for (const member of members) {
      if (member.groupId.length > 0 && !known.has(member.groupId)) member.groupId = ''
    }
    const chiefId = text(parsed?.chiefId)
    return {
      version: STORE_VERSION,
      updatedAt: text(parsed?.updatedAt),
      preset: text(parsed?.preset),
      // 总管：团队里唯一的协调者，总管台的管理员。没有有效总管时默认第一位启用成员，
      // 这样总管台永远有 👑，也不会出现「群聊里没有有效成员」。
      chiefId: resolveChiefId(members, chiefId),
      groups,
      members
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[team-workbench] 读取团队配置失败：' + String(error))
    return emptyStore()
  }
}

/** 原子写回；从旧版本升级时先留一份备份。 */
export async function saveStore(store) {
  const target = storePath()
  await mkdir(dirname(target), { recursive: true })
  try {
    const previous = JSON.parse(await readFile(target, 'utf8'))
    const version = Number(previous?.version) || 1
    if (version < STORE_VERSION) await copyFile(target, target + '.bak-v' + String(version))
  } catch { /* 没有旧文件：无需备份 */ }
  const payload = JSON.stringify({
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    preset: store.preset,
    chiefId: store.chiefId || '',
    groups: store.groups,
    members: store.members
  }, null, 2)
  const temp = target + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(temp, payload, 'utf8')
  await rename(temp, target)
}

/** 在已占用的名字集合中生成不冲突的名字。 */
function uniqueName(base, taken) {
  const stem = text(base) || '智能体'
  if (!taken.has(stem)) return stem
  let n = 2
  while (taken.has(stem + ' ' + String(n))) n += 1
  return stem + ' ' + String(n)
}

/** 收集 provider / model 目录。 */
async function collectCatalog(ctx) {
  const llm = ctx.get('llm')
  if (llm === undefined || llm === null) return { providers: [], error: 'llm 服务不可用' }
  let providers = []
  try {
    providers = llm.listProviders()
  } catch (error) {
    return { providers: [], error: '无法枚举 provider：' + String(error) }
  }
  const rows = []
  for (const provider of providers) {
    const id = text(provider?.provider ?? provider?.id)
    if (id.length === 0) continue
    const displayName = text(provider?.displayName) || id
    try {
      const discovered = await llm.listModels(id)
      rows.push({
        id,
        displayName,
        models: discovered
          .map((entry) => ({ id: text(entry?.id), name: text(entry?.name) || text(entry?.id) }))
          .filter((entry) => entry.id.length > 0)
      })
    } catch (error) {
      rows.push({ id, displayName, models: [], error: '模型目录读取失败：' + String(error) })
    }
  }
  return { providers: rows }
}

/** 解析宿主当前默认模型路由。 */
function resolveDefaults(ctx) {
  const candidates = []
  const service = ctx.get('agentDefaultModel')
  if (service !== undefined && service !== null) {
    try {
      const selected = typeof service.currentSelection === 'function' ? service.currentSelection() : undefined
      if (selected !== undefined && selected !== null) candidates.push(selected)
    } catch { /* 默认模型服务不可用不影响其它初值 */ }
  }
  const fallback = ctx.get('defaultModel')
  if (fallback !== null && typeof fallback === 'object') candidates.push(fallback)
  for (const candidate of candidates) {
    const provider = text(candidate.provider)
    const model = text(candidate.model)
    if (provider.length > 0 && model.length > 0) {
      return { provider, model, reasoningEffort: text(candidate.reasoningEffort) }
    }
  }
  return { provider: '', model: '', reasoningEffort: '' }
}

/** JSON 响应。 */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

/** 读取 JSON 请求体。 */
export async function readJson(request) {
  try {
    const value = await request.json()
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** 抽取子智能体运行结果里的文本。 */
function outputText(result) {
  const blocks = Array.isArray(result?.output) ? result.output : []
  return blocks
    .filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
}

/** 选择可用的子智能体 provider 名：优先 spawn。 */
function resolveProviderName(ctx) {
  const subagents = ctx.get('subagents')
  if (subagents === undefined || subagents === null) return undefined
  let names = []
  try {
    names = subagents.list()
  } catch {
    return undefined
  }
  if (names.includes('spawn')) return 'spawn'
  return names.length > 0 ? names[0] : undefined
}

/** 路由的展示名。 */
function routeLabel(route) {
  if (route === null || route === undefined) return '（继承主智能体）'
  return route.provider.length > 0 && route.model.length > 0
    ? route.provider + '/' + route.model
    : '（继承主智能体）'
}

/** 按「当前路由 → 其余已启用路由」的顺序列出候选。 */
function candidateRoutes(member) {
  const enabled = member.routes.filter((route) => route.enabled)
  if (enabled.length === 0) return []
  const active = enabled.find((route) => route.id === member.activeRouteId)
  if (active === undefined) return enabled
  return [active, ...enabled.filter((route) => route.id !== active.id)]
}

/**
 * 校验一条模型路由：解析适配器与模型元数据，但不发送真实请求。
 * @param ctx - 宿主上下文。
 * @param route - 待校验的路由。
 * @returns 结构化探测结果。
 */
async function probeRoute(ctx, route) {
  const base = { provider: route.provider, model: route.model }
  const llm = ctx.get('llm')
  if (llm === undefined || llm === null) return { ok: false, ...base, error: 'llm 服务不可用' }
  if (route.provider.length === 0 || route.model.length === 0) {
    return { ok: false, ...base, error: '该路由未填写 provider/model，将继承主智能体' }
  }
  const config = { provider: route.provider, model: route.model }
  if (route.reasoningEffort.length > 0) config.reasoningEffort = route.reasoningEffort
  try {
    const info = await llm.resolveModelInfo(route.provider, route.model)
    const prepared = await llm.prepareCall(config)
    let context = ''
    try { context = info.context === undefined ? '' : JSON.stringify(info.context).slice(0, 300) } catch { context = '' }
    const efforts = info.reasoning !== undefined && Array.isArray(info.reasoning.efforts)
      ? info.reasoning.efforts.map((e) => text(e?.id)).filter((id) => id.length > 0)
      : []
    return {
      ok: true,
      ...base,
      inputModalities: Array.isArray(info.inputModalities) ? info.inputModalities.map(text) : [],
      reasoningEfforts: efforts,
      resolvedReasoningEffort: text(prepared?.config?.reasoningEffort),
      context
    }
  } catch (error) {
    return {
      ok: false,
      ...base,
      error: String(error !== null && typeof error === 'object' && 'message' in error ? error.message : error),
      code: text(error?.code)
    }
  }
}

/** 在一条路由上尝试一次委派。 */
/**
 * 兼容两代宿主 subagents API：
 *   · 旧宿主：subagents.start(providerName, request)（插件 2026-10-11 写的时候的 API）
 *   · 新宿主：@deepseek-ai/dsh-subagent 0.2.x 只有 startActivation({provider, request, signal})，
 *     服务上 `list()` 仍在、`start` 已不存在 ⇒ 旧插件调用时抛
 *     TypeError: subagents.start is not a function（2026-10-30 实测，派发三个成员全失败）。
 *   统一收口在这里，避免以后再次随宿主升级静默失效。
 */
// 运行中插话（steer）：宿主 Agent 暴露 steer({content, source})。
// 派发时记下当前子 agent 与它所属的会话 key，用户中途再发消息就地插进去。
const STEER = { key: '', agent: null }
export function setSteerTarget(key) {
  STEER.key = key
  STEER.agent = null
}
export async function steerActive(key, message) {
  if (STEER.key !== key || STEER.agent === null || STEER.agent === undefined) return false
  try {
    STEER.agent.steer({ content: [{ type: 'text', text: message }], source: { kind: 'user' } })
    return true
  } catch {
    return false
  }
}
export function clearSteerTarget(key) {
  if (STEER.key === key) STEER.agent = null
}

async function startChild(subagents, providerName, request) {
  if (typeof subagents.start === 'function') return subagents.start(providerName, request)
  if (typeof subagents.startActivation !== 'function') {
    throw new Error('宿主 subagents 服务既无 start 也无 startActivation，无法派发')
  }
  const { signal, childId, ...rest } = request
  return subagents.startActivation({
    provider: providerName,
    // caller：结果只回到调用方，不再把子智能体卡片/回报投递到用户主会话。
    delivery: 'caller',
    ...(typeof childId === 'string' && childId.length > 0 ? { childId } : {}),
    request: rest,
    signal: signal !== undefined && signal !== null ? signal : new AbortController().signal,
    label: rest.label
  })
}

async function runOnRoute(ctx, parent, member, route, task, signal) {
  const subagents = ctx.get('subagents')
  const providerName = resolveProviderName(ctx)
  const personaParts = ['你是智能体团队中的成员「' + member.name + '」，职责：' + member.role + '。']
  if (member.instructions.trim().length > 0) personaParts.push(member.instructions.trim())
  const persona = personaParts.join('\n\n')
  // persona 字段是宿主的系统提示；个别 provider/路由（实测 claude 系）不消费它，
  // 子智能体就自称「通用编码智能体」。所以同一份身份也写进 prompt 开头，双通道保证生效。
  const roleHeader = '【角色】你是团队中的「' + member.name + '」，职责：' + member.role + '。' +
    (member.instructions.trim().length > 0 ? '\n【角色说明】' + member.instructions.trim() : '') +
    '\n【输出要求】直接给出结论与依据，不要写代码；若确实需要调用 run_code，请使用 ES module 语法（import / await），不要用 require。'
  const request = {
    label: member.name + ' · ' + routeLabel(route),
    prompt: [{ type: 'text', text: roleHeader + '\n\n【任务】\n' + task }],
    parent,
    persona
  }
  if (route !== null && route.provider.length > 0 && route.model.length > 0) {
    const agentOptions = { provider: route.provider, model: route.model }
    if (route.reasoningEffort.length > 0) agentOptions.reasoningEffort = route.reasoningEffort
    request.agentOptions = agentOptions
  }

  // 已知限制（实测，勿再用 toolFilter 尝试绕过）：
  // 派发出去的子智能体在 PTC 模式下运行，**模型只能看到 run_code 一个工具**
  // （诊断日志实证：[jev-ai] tools=1 callable=0 names=run_code）。
  // run_code 需要 code 参数，而 Jev 给不出参数值 → Jev 的工具选择模式在子智能体里永远不会触发。
  //
  // 试过 toolFilter:{allow:[...]} 想给它加几个无参工具，**无效**：
  // toolFilter 只能收窄（restrict），不能把不在子目录中的工具加进去。
  // 结论：Jev 成员只能当「判断层」（回校准概率），当不了「执行层」。
  // 持久会话（对齐 dsh-superagent 的 per-worker session）：同一成员复用同一个 childId，
  // 宿主的本地子级支持后续消息与冷恢复，既保留上下文，也能吃到前缀缓存。
  // 持久会话：首轮用固定 childId；但宿主在子会话仍登记时会拒绝 "already exists"，
  // 这时退回一次性 childId（上下文仍由提示词里的历史窗口保证）。
  // 不传 childId：宿主对「本地子级」的默认投递是 parent，
  // 结果会出现在父会话（用户主聊天），而团队面板的 HTTP 调用一直等到超时。
  // 走外部子级（无 childId）才会把结果返回给调用方。
  // 宿主偶尔不返回 activation（spawn 卡住）：给它 15 秒，超时就走失败回退，
  // 不能让团队面板无限等。
  const run = await Promise.race([
    startChild(subagents, providerName, { ...request, signal }),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('subagent activation timeout')), 15000))
  ])
  // 拿到子 agent 句柄后登记，供 steerActive 中途插话。
  try {
    const agents = ctx.get('agents')
    const childId = typeof run.id === 'string' ? run.id : ''
    const child = childId.length > 0 && agents !== undefined && agents !== null && typeof agents.get === 'function'
      ? agents.get(childId)
      : (run.agent ?? null)
    if (child !== null && child !== undefined) STEER.agent = child
  } catch { /* 拿不到句柄就退回排队 */ }
  let settled
  try {
    // 同样的保护：某些 provider 卡住时 run.result 永不 resolve。
    settled = await Promise.race([
      run.result,
      new Promise((resolve) => setTimeout(() => resolve({ stopReason: 'timeout', diagnostic: '模型调用超过 50 秒未返回' }), 50000))
    ])
  } finally {
    try { await run.dispose() } catch { /* 清理失败不影响已收集的结果 */ }
  }
  const stopReason = text(settled?.stopReason) || 'unknown'
  let detail = ''
  const diagnostic = settled?.diagnostic
  if (typeof diagnostic === 'string') detail = diagnostic
  else if (diagnostic !== undefined && diagnostic !== null) detail = JSON.stringify(diagnostic)
  return {
    childSessionId: typeof run.id === 'string' ? run.id : (typeof run.childId === 'string' ? run.childId : ''),
    stopReason,
    output: outputText(settled),
    detail
  }
}

/** 成员没有内联 instructions 时，按 roleRef 从角色库取正文。 */
async function withRoleInstructions(member) {
  if (member.instructions.trim().length > 0 || member.roleRef.id.length === 0) return member
  try {
    const body = await loadRoleBody(member.roleRef.id)
    if (body.trim().length === 0) return member
    // 角色正文常有上万字，整段注入会让首 token 慢很多；截到 1500 字保留风格与边界即可。
    return { ...member, instructions: body.trim().slice(0, 1500) }
  } catch {
    return member
  }
}

// 持久 Agent 复用：成员第一次派发时创建一个常驻 Agent，之后用 followup 追加，
// 省掉每次 startActivation 的会话装配（实测约 3.3s）。任何异常都退回一次性激活。
const REUSE_AGENTS = new Map()

function lastAssistantText(agent, since) {
  try {
    const messages = agent.session.deriveMessages()
    const fresh = messages.slice(typeof since === 'number' ? since : 0)
    const parts = []
    for (const message of fresh) {
      if (message.role !== 'assistant') continue
      for (const block of message.content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
    }
    return parts.join('\n').trim()
  } catch {
    return ''
  }
}

async function runPersistentAgent(ctx, member, route, prompt, timeoutMs) {
  const agents = ctx.get('agents')
  if (agents === undefined || agents === null || typeof agents.create !== 'function') return undefined
  const provider = route !== null ? route.provider : ''
  const model = route !== null ? route.model : ''
  const key = member.id
  let entry = REUSE_AGENTS.get(key)
  if (entry !== undefined && (entry.provider !== provider || entry.model !== model)) {
    try { await entry.handle.dispose() } catch { /* 已释放 */ }
    REUSE_AGENTS.delete(key)
    entry = undefined
  }
  if (entry === undefined) {
    const agentOptions = provider.length > 0 && model.length > 0 ? { provider, model } : undefined
    const handle = await agents.create({
      sessionId: 'team-' + key + '-' + Date.now().toString(36),
      ...(agentOptions !== undefined ? { agentOptions } : {}),
      meta: { cwd: process.cwd() }
    })
    entry = { handle, provider, model }
    REUSE_AGENTS.set(key, entry)
  }
  const agent = entry.handle?.agent
  if (agent === undefined || agent === null) return undefined
  let since = 0
  try { since = agent.session.deriveMessages().length } catch { since = 0 }
  agent.followup({ content: [{ type: 'text', text: prompt }], source: { kind: 'team-workbench' } })
  await Promise.race([
    agent.whenIdle(),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('persistent agent idle timeout')), Number(timeoutMs) || 90000))
  ])
  const output = lastAssistantText(agent, since)
  return { output, stopReason: output.length > 0 ? 'completed' : 'error', provider, model, childSessionId: '', detail: '' }
}

/** 把失败原因归到可统计的类别，便于按 provider/模型分桶。 */
export function classifyError(value) {
  const text = String(value || '').toLowerCase()
  if (text.includes('already exists')) return 'control_plane'
  if (text.includes('abort') || text.includes('timeout') || text.includes('timed out') || text.includes('econnreset')) return 'transport'
  if (text.includes('401') || text.includes('403') || text.includes('unauthorized') || text.includes('invalid api key')) return 'auth'
  if (text.includes('429') || text.includes('quota') || text.includes('insufficient')) return 'quota'
  if (text.includes('model not found') || text.includes('not allowed') || text.includes('no llm providers')) return 'config'
  return 'unknown'
}

/** 兜底路由：跨服务商，避免同一家整体故障时兜底也跟着失效。 */
function fallbackRoutesFor(primaryProvider) {
  const primary = text(primaryProvider)
  const pool = primary === 'deepseek-official'
    ? [
        { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' },
        { provider: 'glm', model: 'glm-5.3' },
        { provider: 'deepseek-official', model: 'deepseek-flash' }
      ]
    : [
        { provider: 'deepseek-official', model: 'deepseek-flash' },
        { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
      ]
  return pool
}

/** 部门里的一个子智能体 → 可直接派发的临时成员（带自己的模型路由）。 */
function subAgentMember(departmentName, sub) {
  return {
    id: sub.id,
    name: sub.name,
    role: sub.role,
    emoji: sub.emoji,
    color: '',
    groupId: '',
    avatar: { kind: 'emoji', imageId: '' },
    roleRef: sub.roleRef,
    instructions: '',
    enabled: true,
    createdAt: new Date().toISOString(),
    activeRouteId: 'sub-route',
    routes: (function () {
      const list = []
      if (sub.provider.length > 0 && sub.model.length > 0) {
        list.push({ id: 'sub-route', label: '自动分配', provider: sub.provider, model: sub.model, reasoningEffort: sub.reasoningEffort, enabled: true })
      }
      // 子智能体也要有兜底：主路由失败时依次尝试 deepseek 两条已验证线路，
      // 避免「某个 provider 上游抖动 → 整个部门这一棒失败」。
      for (const fallback of fallbackRoutesFor(sub.provider)) {
        if (list.some((route) => route.provider === fallback.provider && route.model === fallback.model)) continue
        list.push({ id: 'sub-fb-' + fallback.provider + '-' + fallback.model, label: '回退 · ' + fallback.model, provider: fallback.provider, model: fallback.model, reasoningEffort: '', enabled: true })
      }
      return list
    })()
  }
}

/** 解析部门主管给出的选人结果；解析失败返回空数组。 */
function parsePicks(raw, subs) {
  const cleaned = String(raw || '').replace(/```(?:json)?/giu, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed = null
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)) } catch { return [] }
  const list = Array.isArray(parsed?.picks) ? parsed.picks : []
  const picks = []
  for (const entry of list.slice(0, 4)) {
    const key = text(entry?.id) || text(entry?.name)
    const sub = subs.find((item) => item.id === key) || subs.find((item) => item.name === key)
    if (sub === undefined) continue
    picks.push({ sub, task: text(entry?.task) || '' })
  }
  return picks
}

/** 兜底选人：按任务与子智能体名字/职责的字面重合度挑前两个。 */
function keywordPicks(task, subs) {
  const needle = String(task || '')
  const scored = subs.map((sub) => {
    let score = 0
    if (sub.name.length > 0 && needle.includes(sub.name)) score += 6
    for (const ch of new Set(sub.name)) if (needle.includes(ch)) score += 1
    if (sub.role.length > 0) for (const ch of new Set(sub.role)) if (needle.includes(ch)) score += 0.5
    return { sub, score }
  }).sort((a, b) => b.score - a.score)
  return scored.slice(0, 2).map((entry) => ({ sub: entry.sub, task: '' }))
}

/**
 * 部门成员：先由「部门主管」挑 1–4 个子智能体并分任务，再并行执行，最后由主管汇总。
 */
export async function runDepartmentMember(ctx, parent, member, task, signal) {
  const department = member.department
  const subs = department.subAgents
  const roster = subs.map((sub, index) => String(index + 1) + '. ' + sub.name + '｜' + sub.role).join('\n')
  const planPrompt = [
    '你是「' + department.name + '」的部门主管。团队里只有下面这些子智能体：',
    roster,
    '',
    '用户任务：',
    task,
    '',
    '请挑 1–4 个最合适的子智能体来执行，并给每个人一句具体分工。',
    '只输出 JSON，不要解释：{"picks":[{"name":"子智能体名字","task":"它要做什么"}]}'
  ].join('\n')

  // 短问题（打招呼、单句确认）由主管直接回答：走完整「选人→并行→汇总」要 3 次模型往返，
  // 对这类输入纯属浪费，通常会把 5 秒拖成 30 秒。
  const plainTask = task.trim()
  if (plainTask.length > 0 && plainTask.length <= 40 && !plainTask.includes('\n')) {
    const direct = await dispatchToMember(ctx, parent, member, task, signal)
    const answer = text(direct.output)
    return { text: answer, output: answer, stopReason: direct.stopReason, detail: direct.detail, provider: direct.provider, model: direct.model, attempts: direct.attempts ?? [], picks: [] }
  }

  let picks = []
  // 子智能体不超过 4 个时直接按关键词选人，省掉一次主管排期调用（通常 4–30 秒）。
  if (subs.length > 4) {
    try {
      const plan = await dispatchToMember(ctx, parent, member, planPrompt, signal)
      picks = parsePicks(plan.output, subs)
    } catch { /* 主管挑人失败就用字面匹配兜底 */ }
  }
  if (picks.length === 0) picks = keywordPicks(task, subs)

  const outcomes = await Promise.all(picks.map(async (pick) => {
    const sub = subAgentMember(department.name, pick.sub)
    const target = await withRoleInstructions(sub)
    const prompt = [
      '你是「' + department.name + '」部门里的「' + sub.name + '」。',
      '职责：' + sub.role,
      pick.task.length > 0 ? '本次分工：' + pick.task : '',
      '',
      '用户任务：',
      task,
      '',
      '只给结论、依据和风险，不要寒暄，也不要重复任务原文。',
      '不需要写代码；若必须调用 run_code，请用 ES module 语法（import / await），不要用 require。'
    ].filter((line) => line.length > 0).join('\n')
    try {
      const result = await dispatchToMember(ctx, parent, target, prompt, signal)
      return { name: sub.name, text: text(result.output), ok: result.stopReason === 'completed', attempts: result.attempts ?? [] }
    } catch (error) {
      return { name: sub.name, text: '', ok: false, error: String(error) }
    }
  }))

  const usable = outcomes.filter((entry) => entry.text.trim().length > 0)
  if (usable.length === 0) {
    const reasons = outcomes.slice(0, 3).map((entry) => entry.name + '：' + text(entry.error ?? '无输出').slice(0, 80)).join('；')
    const message = '部门里没有子智能体跑通（' + String(outcomes.length) + ' 个全部失败）。' + (reasons.length > 0 ? ' 原因：' + reasons : ' 请检查它们的模型配置。')
    return { text: message, output: message, stopReason: 'completed', detail: '', provider: '', model: '', attempts: [], picks }
  }
  // 只选中 1 个子智能体时，它的结论本身就是答案，再让主管汇总只是多一次往返。
  if (usable.length === 1) {
    const only = usable[0]
    return { text: only.text, output: only.text, stopReason: 'completed', detail: '', provider: '', model: '', attempts: only.attempts ?? [], picks }
  }
  const digest = usable.map((entry) => '【' + entry.name + '】\n' + entry.text).join('\n\n')
  const synthPrompt = [
    '你是「' + department.name + '」的部门主管，下面是你手下子智能体的结论：',
    digest,
    '',
    '用户任务：',
    task,
    '',
    '请综合成一段最终答复：先给结论，再给关键依据/风险；不要罗列“某某说”，也不要暴露内部流程。'
  ].join('\n')
  const synth = await dispatchToMember(ctx, parent, member, synthPrompt, signal)
  const finalText = text(synth.output)
  // 汇总失败/串味时，主管可能把内部「派活 JSON」当答复吐出来；这种绝不直接展示给用户。
  const looksLikePlan = /"picks"\s*:/.test(finalText) && finalText.trim().slice(0, 1) === '{'
  const answer = looksLikePlan ? digest : finalText
  // 同时给 text 与 output：部门派发既被聊天用（读 text），也被 agent_team_task 用（读 output）。
  return { text: answer, output: answer, stopReason: synth.stopReason, detail: synth.detail, provider: synth.provider, model: synth.model, attempts: synth.attempts ?? [], picks }
}

/** 统一入口：部门成员走「主管 → 子智能体 → 汇总」，普通成员直接派发。 */
export async function runAnyMember(ctx, parent, member, task, signal) {
  if (member.department !== null && member.department !== undefined && member.department.subAgents.length > 0) {
    return runDepartmentMember(ctx, parent, member, task, signal)
  }
  return dispatchToMember(ctx, parent, member, task, signal)
}

/**
 * 在成员绑定的模型上运行一次委派，失败自动回退到下一条已启用路由。
 * @returns 最终结果 + 每条路由的尝试记录。
 */
export async function dispatchToMember(ctx, parent, rawMember, task, signal) {
  // 从角色库导入的成员可能只存了 roleRef（正文不落 team.json），派发前补上。
  const member = await withRoleInstructions(rawMember)
  const subagents = ctx.get('subagents')
  if (subagents === undefined || subagents === null) throw new Error('subagents 服务不可用，无法派发任务')
  if (resolveProviderName(ctx) === undefined) throw new Error('没有已注册的子智能体 provider')

  const candidates = candidateRoutes(member)
  const attempts = []

  if (candidates.length === 0) {
    const started = Date.now()
    try {
      const result = await runOnRoute(ctx, parent, member, null, task, signal)
      attempts.push({ route: '（继承主智能体）', ok: result.stopReason === 'completed', stopReason: result.stopReason })
      await recordUsage({ at: new Date().toISOString(), memberId: member.id, provider: '', model: '', ok: result.stopReason === 'completed', ms: Date.now() - started })
      return { ...result, provider: '', model: '', attempts }
    } catch (error) {
      attempts.push({ route: '（继承主智能体）', ok: false, stopReason: 'error' })
      return { childSessionId: '', stopReason: 'error', output: '', detail: String(error), provider: '', model: '', attempts }
    }
  }

  let last = null
  for (const route of candidates) {
    const started = Date.now()
    // 单条路由 45 秒还没出结果就换下一条（慢模型不该把整轮拖到分钟级）。
    // 健康路由 P50 约 3–5 秒；20 秒还没结果就换下一条，避免一条慢路由把整轮拖到 45 秒。
    const bounds = signal !== undefined && signal !== null ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
    let result
    try {
      // 优先复用常驻 Agent（省掉 ~3s 会话装配）；拿不到句柄或失败就退回一次性激活。
      const personaPrompt = '【角色】你是团队中的「' + member.name + '」，职责：' + member.role + '。' +
        (member.instructions.trim().length > 0 ? '\n【角色说明】' + member.instructions.trim() : '') +
        '\n\n【任务】\n' + task
      // 常驻 Agent 默认关闭：实测当 followup 不被驱动时 whenIdle 会等到超时，
      // 每次派发白等 60s。设 TW_REUSE_AGENTS=1 才启用（用于后续验证）。
      const reuseEnabled = process.env.TW_REUSE_AGENTS === '1'
      const reused = reuseEnabled ? await runPersistentAgent(ctx, member, route, personaPrompt, 15000) : undefined
      result = reused !== undefined && reused.output.length > 0
        ? reused
        : await runOnRoute(ctx, parent, member, route, task, bounds)
    } catch {
      try {
        result = await runOnRoute(ctx, parent, member, route, task, bounds)
      } catch (error) {
        result = { childSessionId: '', stopReason: 'error', output: '', detail: String(error) }
      }
    }
    const ok = result.stopReason === 'completed' && result.output.length > 0
    attempts.push({
      route: routeLabel(route),
      label: route.label,
      routeId: route.id,
      ok,
      stopReason: result.stopReason,
      attemptIndex: attempts.length + 1,
      attemptTotal: candidates.length,
      routeSource: attempts.length === 0 ? 'primary' : 'fallback',
      errorClass: ok ? '' : classifyError(result.detail ?? result.stopReason),
      ms: Date.now() - started,
      // 带上失败原因：一次派发可能试多条路由，只有「全部失败」时才有汇总诊断，
      // 失败但后来回退成功的那些尝试以前不带原因，排查时只能靠猜。
      detail: ok ? '' : String(result.detail ?? '').slice(0, 400)
    })
    last = { ...result, provider: route.provider, model: route.model }
    await recordUsage({
      at: new Date().toISOString(), memberId: member.id, routeId: route.id,
      provider: route.provider, model: route.model, ok, ms: Date.now() - started,
      attemptIndex: attempts.length, attemptTotal: candidates.length,
      errorClass: ok ? '' : classifyError(result.detail ?? result.stopReason)
    })
    // 成功、或已拿到正文（例如被截断）都不再回退
    if (ok || result.stopReason === 'completed') return { ...last, attempts }
  }

  const failing = candidates[candidates.length - 1]
  let detail = last?.detail ?? ''
  try {
    const verdict = await probeRoute(ctx, failing)
    const upstream = classifyError(detail || '')
    const summary = verdict.ok
      ? '上游模型调用失败（类别：' + upstream + '；路由 ' + routeLabel(failing) + ' 本身可达）。可稍后重试，或换路由。'
      : '路由不可达：' + (verdict.error || '未知原因') + (verdict.code ? '（' + verdict.code + '）' : '')
    detail = detail.length > 0 ? summary + ' 原始诊断：' + detail : summary
  } catch { /* 探测失败不影响原始诊断 */ }
  const base = last ?? { childSessionId: '', stopReason: 'error', output: '', provider: '', model: '' }
  // 失败时也要有可读正文：否则聊天气泡会是一条空白消息。
  const baseOutput = text(base.output)
  if (baseOutput.length === 0) {
    base.output = '（模型调用失败）' + (detail.length > 0 ? detail.slice(0, 300) : '上游没有返回内容，请稍后重试。')
  }
  return { ...base, detail, attempts }
}

/** 一行名册摘要。 */
function memberLine(member, index) {
  const routes = member.routes.length > 0
    ? member.routes
        .map((route) => routeLabel(route) + (route.id === member.activeRouteId ? '◀当前' : '') + (route.enabled ? '' : '(停用)'))
        .join(' / ')
    : '（未配置模型，继承主智能体）'
  return String(index + 1) + '. ' + member.emoji + ' ' + member.name + ' — ' + member.role + ' → ' + routes + (member.enabled ? '' : '（成员已停用）')
}

/** 模型路由的 JSON Schema 片段。 */
const ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'provider', 'model', 'reasoningEffort', 'enabled'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string', description: '该路由的可读别名，例如「主力」「备用」。' },
    provider: { type: 'string' },
    model: { type: 'string' },
    reasoningEffort: { type: 'string' },
    enabled: { type: 'boolean', description: '停用的路由不参与派发与回退。' }
  }
}

/** 头像的 JSON Schema 片段。 */
const AVATAR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'imageId'],
  properties: {
    kind: { type: 'string', description: 'emoji（默认，前端按配色生成底色）或 image（本机已上传头像）。' },
    imageId: { type: 'string', description: '图片头像的本机文件 id；emoji 头像为空串。' }
  }
}

/** 角色库引用的 JSON Schema 片段。 */
const ROLE_REF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['library', 'id', 'version'],
  properties: {
    library: { type: 'string', description: '角色库标识；空串表示没有引用。' },
    id: { type: 'string', description: 'agency-agents-zh 的角色 id，例如 engineering/engineering-frontend-developer。' },
    version: { type: 'string' }
  }
}

/** 分组的 JSON Schema 片段。 */
const GROUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'color', 'order', 'collapsed'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    color: { type: 'string', description: '#rrggbb；空串表示自动配色。' },
    order: { type: 'integer' },
    collapsed: { type: 'boolean' }
  }
}

/** 成员的 JSON Schema 片段。 */
const MEMBER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'role', 'emoji', 'color', 'groupId', 'avatar', 'roleRef', 'instructions', 'enabled', 'createdAt', 'activeRouteId', 'routes'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    emoji: { type: 'string' },
    // 卡片配色。必须声明：schema 是 additionalProperties:false，
    // 漏了它会让 agent_team_roster 整个工具因校验失败而不可用。
    color: { type: 'string', description: '卡片配色 #rrggbb；空串表示自动配色。' },
    groupId: { type: 'string', description: '所属分组 id；空串表示未分组。' },
    avatar: AVATAR_SCHEMA,
    roleRef: ROLE_REF_SCHEMA,
    instructions: { type: 'string' },
    enabled: { type: 'boolean' },
    createdAt: { type: 'string' },
    activeRouteId: { type: 'string', description: '当前使用的模型路由 id；空串表示继承主智能体。' },
    routes: { type: 'array', description: '该智能体的模型路由列表。', items: ROUTE_SCHEMA },
    // 从本机 agent 平台接入的成员会带来源标记；schema 是 additionalProperties:false，
    // 漏声明同样是「整个名册校验失败」级别的故障。
    sourcePlatform: { type: 'string', description: '本机 agent 平台来源（如 claude-code / codex）；空串表示不是自动接入的。' },
    // 部门成员会带这个字段（普通成员为 null）。schema 是 additionalProperties:false，
    // 漏声明会让 agent_team_roster 整体校验失败、名册读不出来。
    // 宿主 schema 校验只接受单一 type 字符串（不支持 type 数组 / null），
    // 所以普通成员直接不返回这个字段，部门成员的 subAgents 也用宽松 object 描述。
    department: {
      type: 'object',
      description: '部门成员才有：包含部门名与子智能体列表；普通成员不返回该字段。',
      additionalProperties: true,
      properties: {
        name: { type: 'string' },
        subAgents: {
          type: 'array',
          items: { type: 'object', additionalProperties: true }
        }
      }
    }
  }
}

/** 把部门子智能体包装成一次可派发的虚拟成员（让它能被 agent_team_dispatch 直接点名）。 */
export function subAgentAsMember(owner, sub, index) {
  const route = sub.provider.length > 0 && sub.model.length > 0
    ? [{ id: 'sub-route-' + String(index), label: '子智能体路由', provider: sub.provider, model: sub.model, reasoningEffort: sub.reasoningEffort, enabled: true }]
    : []
  return {
    id: sub.id,
    name: sub.name,
    role: sub.role.length > 0 ? sub.role : ('部门「' + owner.name + '」的子智能体'),
    emoji: sub.emoji,
    color: owner.color,
    groupId: owner.groupId,
    avatar: { kind: 'emoji', imageId: '' },
    roleRef: sub.roleRef,
    instructions: '',
    enabled: owner.enabled,
    createdAt: owner.createdAt,
    activeRouteId: route.length > 0 ? route[0].id : '',
    routes: route
  }
}

/** 按名字找成员：先找普通成员，再找部门子智能体（返回虚拟成员 + 所属部门）。 */
function findDispatchable(store, name) {
  const direct = store.members.find((entry) => entry.name === name)
  if (direct !== undefined) return { member: direct, owner: null }
  for (const owner of store.members) {
    if (owner.department === null || owner.department === undefined) continue
    const index = owner.department.subAgents.findIndex((sub) => sub.name === name)
    if (index >= 0) return { member: subAgentAsMember(owner, owner.department.subAgents[index], index), owner }
  }
  return null
}


/** 注册三个模型可见工具：名册、派发、强制审查流水线。 */
function registerTools(ctx) {
  const roster = {
    name: 'agent_team_roster',
    description: '查看智能体团队名册：每个成员的名字、职责、模型路由列表、以及当前使用的路由。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['count', 'members', 'groups', 'pluginVersion'],
        properties: {
          count: { type: 'integer', description: '当前团队成员数。' },
          pluginVersion: { type: 'string' },
          chiefId: { type: 'string', description: '总管成员 id；空串表示还没指定总管。' },
          groups: { type: 'array', description: '团队分组（顺序即展示顺序）。', items: GROUP_SCHEMA },
          members: { type: 'array', items: MEMBER_SCHEMA }
        }
      },
      render: (_args, value) => [{
        type: 'text',
        text: '智能体团队共 ' + String(value.count) + ' 名成员：\n' +
          value.members.map((m, i) => (m.id === value.chiefId ? '★ ' : '') + memberLine(m, i)).join('\n')
      }]
    },
    async execute() {
      const store = await loadStore()
      // 默认总管落到磁盘，保证「总管台默认有一个主管」是持久状态而不是每次临时推断。
      if (store.members.length > 0 && store.chiefId.length > 0) {
        const raw = await readFile(storePath(), 'utf8').then((text) => JSON.parse(text)).catch(() => null)
        if (raw !== null && text(raw.chiefId) !== store.chiefId) {
          store.updatedAt = new Date().toISOString()
          await saveStore(store)
        }
      }
      const members = store.members.map((member) => {
        const copy = Object.assign({}, member)
        if (copy.department === null || copy.department === undefined) {
          delete copy.department
          return copy
        }
        // 子智能体也给出 routes：很多调用方按 routes 判断"有没有配模型"，
        // 只给 provider/model 会被误读成"未配置"。
        copy.department = {
          name: copy.department.name,
          subAgents: copy.department.subAgents.map((sub) => Object.assign({}, sub, {
            // 与派发时一致：主路由 + 两条 deepseek 兜底，避免调用方误判「无 fallback」。
            routes: (function () {
              const list = []
              if (sub.provider.length > 0 && sub.model.length > 0) {
                list.push({ id: 'sub-route', label: '自动分配', provider: sub.provider, model: sub.model, reasoningEffort: sub.reasoningEffort, enabled: true })
              }
              for (const fallback of fallbackRoutesFor(sub.provider)) {
                if (list.some((route) => route.provider === fallback.provider && route.model === fallback.model)) continue
                list.push({ id: 'sub-fb-' + fallback.provider + '-' + fallback.model, label: '回退 · ' + fallback.model, provider: fallback.provider, model: fallback.model, reasoningEffort: '', enabled: true })
              }
              return list
            })()
          }))
        }
        return copy
      })
      return { count: store.members.length, pluginVersion: PLUGIN_VERSION, chiefId: store.chiefId || '', groups: store.groups, members }
    }
  }

  const dispatch = {
    name: 'agent_team_dispatch',
    description: '把任务派发给名册中的某个智能体，按该智能体的模型路由列表依次尝试（当前路由优先，失败自动回退），并在实际生效的模型上执行。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'task'],
      properties: {
        name: { type: 'string', description: '团队成员名字，必须出现在 agent_team_roster 中。' },
        task: { type: 'string', description: '交给该成员完成的完整任务说明。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'provider', 'model', 'stopReason', 'output', 'detail', 'attempts'],
        properties: {
          name: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          stopReason: { type: 'string' },
          output: { type: 'string' },
          detail: { type: 'string', description: '失败时的诊断信息；成功时为空串。' },
          attempts: {
            type: 'array',
            description: '依次尝试过的路由及其结果。',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['route', 'ok', 'stopReason', 'detail'],
              properties: {
                route: { type: 'string' },
                ok: { type: 'boolean' },
                stopReason: { type: 'string' },
                detail: { type: 'string', description: '该次尝试失败的原因；成功时为空串。' }
              }
            }
          }
        }
      },
      render: (_args, value) => {
        const trail = value.attempts.length > 1
          ? '\n尝试轨迹：' + value.attempts.map((a) => a.route + (a.ok ? ' ✓' : ' ✗')).join(' → ')
          : ''
        const where = value.provider.length > 0 ? value.provider + '/' + value.model : '继承主智能体'
        return [{
          type: 'text',
          text: value.stopReason === 'error'
            ? '「' + value.name + '」运行失败（最后尝试 ' + where + '）：\n\n' + (value.output || value.detail || '（无诊断信息）') + trail
            : '「' + value.name + '」在 ' + where + ' 上完成（' + value.stopReason + '）：\n\n' + value.output + trail
        }]
      }
    },
    async execute(args, exec) {
      const parent = exec?.agent
      if (parent === undefined || parent === null) throw new Error('agent_team_dispatch 需要一个调用方会话（exec.agent 为空）')
      const requested = text(args?.name)
      const task = text(args?.task)
      if (requested.length === 0) throw new Error('必须提供团队成员名字')
      if (task.length === 0) throw new Error('必须提供任务说明')
      const store = await loadStore()
      const found = findDispatchable(store, requested)
      if (found === null) {
        const known = store.members.map((entry) => entry.name).join('、')
        const subs = store.members.flatMap((entry) => (entry.department === null || entry.department === undefined) ? [] : entry.department.subAgents.map((sub) => sub.name))
        const subText = subs.length > 0 ? '；部门子智能体：' + subs.join('、') : ''
        throw new Error('名册中没有名为「' + requested + '」的成员。现有成员：' + (known.length > 0 ? known : '（空）') + subText)
      }
      const member = found.member
      if (!member.enabled) throw new Error('成员「' + requested + '」已停用，请先在侧边栏启用')
      const result = await runAnyMember(ctx, parent, member, task, exec?.signal)
      return {
        name: member.name,
        provider: result.provider,
        model: result.model,
        stopReason: result.stopReason,
        output: result.output,
        detail: result.detail,
        attempts: (result.attempts ?? []).map((a) => ({ route: a.route, ok: a.ok, stopReason: a.stopReason, detail: a.detail ?? '' }))
      }
    }
  }

  //#region 强制审查流水线：产出 → 审核员审 → 复核员过审
  /**
   * 为什么做成一个工具而不是靠约定：约定会被忘掉，工具不会。
   * 调用方只要用 agent_team_task，三级就必须全部走完，拿不到「已跳过审核」的结果。
   */
  const GATE_AUDITOR = '审核员'
  const GATE_REVIEWER = '复核员'

  /**
   * 从结论里解析「通过 / 不通过」。
   * 先查否定再查肯定：中文里"未通过""不通过"都含"通过"二字，顺序反了会把驳回判成通过。
   * 返回 true / false / null（未表态）。
   */
  function parseVerdict(output, positiveRe, negativeRe) {
    const t = String(output ?? '')
    if (negativeRe.test(t)) return false
    if (positiveRe.test(t)) return true
    return null
  }

  /** 把多行产出截断到安全长度，避免审核提示词过长。 */
  function clip(text, max) {
    const s = String(text ?? '')
    return s.length <= max ? s : s.slice(0, max) + '\n…（已截断，共 ' + String(s.length) + ' 字）'
  }

  const AUDIT_RULES = [
    '审核要求：',
    '1. 逐条核对事实与证据：有没有编造、张冠李戴、引用与结论不符的地方？',
    '2. 指出具体问题：哪一句、错在哪、应改成什么。不要只说“建议完善”。',
    '3. 如果确实没有问题，就明确说通过，不要为了显得严格而挑无关紧要的毛病。',
    '4. **你的第一行必须是下面两者之一**（会被机器读取用于判定，必须逐字一致）：',
    '   审核结论：通过',
    '   审核结论：需修改'
  ].join('\n')

  const REVIEW_RULES = [
    '复核要求：',
    '1. 复核「审核员」的审核本身是否到位：有没有漏掉的问题？有没有误判（把对的判成错、或把错的放过）？',
    '2. 产出是否达到可交付标准？依据是什么？',
    '3. 若你认为审核员判断有误，明确指出并给出你的依据。',
    '4. **你的第一行必须是下面两者之一**（会被机器读取用于判定，必须逐字一致）：',
    '   复核结论：过审',
    '   复核结论：驳回'
  ].join('\n')

  function auditPrompt(task, produced, producerLabel) {
    return [
      '你是这条交付流水线的**第二关：审核**。第一关的产出方是「' + producerLabel + '」。',
      '',
      '【任务】',
      clip(task, 4000),
      '',
      '【待审产出】',
      clip(produced, 12000),
      '',
      AUDIT_RULES
    ].join('\n')
  }

  function reviewPrompt(task, produced, auditOutput) {
    return [
      '你是这条交付流水线的**第三关也是最后一关：复核**。你要复核「审核员」的审核是否到位，并给出最终裁定。',
      '',
      '【任务】',
      clip(task, 3000),
      '',
      '【最终产出】',
      clip(produced, 10000),
      '',
      '【审核员的审核意见】',
      clip(auditOutput, 6000),
      '',
      REVIEW_RULES
    ].join('\n')
  }

  const gate = {
    name: 'agent_team_task',
    description: '【强制审查流水线】先由执行方产出，再交「审核员」审核，最后由「复核员」复核过审——三级全部走完才算交付。任何需要交付的任务都应走这个工具，而不是直接 agent_team_dispatch。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['task'],
      properties: {
        task: { type: 'string', description: '任务说明：要做什么，以及审核时按什么标准判断。' },
        producer: { type: 'string', description: '执行成员名（须在名册中）。与 draft 二选一。' },
        draft: { type: 'string', description: '直接提交待审内容（例如调用方自己的产出）。与 producer 二选一。' },
        revise: { type: 'boolean', description: '审核未通过时，是否让执行方自动修订。默认 true（仅在有 producer 时有效）。' },
        maxRounds: { type: 'integer', description: '自动修订的最大轮数，0-5，默认 2。每轮都是额外的模型调用。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'producer', 'auditVerdict', 'reviewVerdict', 'rounds', 'auditFeedback', 'reviewFeedback', 'resubmitHint', 'finalOutput', 'chain', 'summary'],
        properties: {
          status: { type: 'string', description: 'passed（复核过审）/ rejected（复核驳回）/ unclear（复核未表态）/ error。' },
          producer: { type: 'string', description: '执行方名称。' },
          auditVerdict: { type: 'string', description: '审核结论：通过 / 需修改 / 未表态。' },
          reviewVerdict: { type: 'string', description: '复核结论：过审 / 驳回 / 未表态。' },
          rounds: { type: 'integer', description: '实际用掉的自动修订轮数。' },
          auditFeedback: { type: 'string', description: '最后一次审核意见全文，可直接用于重投。' },
          reviewFeedback: { type: 'string', description: '复核意见全文。' },
          resubmitHint: { type: 'string', description: '未放行时的重投建议；已过审时为空串。' },
          finalOutput: { type: 'string', description: '最终产出正文。' },
          chain: { type: 'string', description: '三级结论的 JSON 文本。' },
          summary: { type: 'string', description: '人类可读的流水线摘要。' }
        }
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }]
    },
    async execute(args, exec) {
      const parent = exec?.agent
      if (parent === undefined || parent === null) throw new Error('agent_team_task 需要一个调用方会话（exec.agent 为空）')
      const task = text(args?.task)
      if (task.length === 0) throw new Error('必须提供任务说明 task')
      const producerName = text(args?.producer)
      const draft = typeof args?.draft === 'string' ? args.draft : ''
      const hasProducer = producerName.length > 0
      const hasDraft = draft.trim().length > 0
      if (hasProducer === hasDraft) throw new Error('producer 与 draft 必须且只能提供一个')

      const store = await loadStore()
      const byName = (n) => {
        const found = findDispatchable(store, n)
        return found === null ? undefined : found.member
      }
      // 先按固定名字找；找不到再按职责关键词兜底，这样「项目部」预设
      // （质量审核员 / 交付复核员）不必为了关卡改名。
      const byRole = (pattern) => store.members.find((entry) => entry.enabled && (pattern.test(entry.role) || pattern.test(entry.name)))

      const chain = []
      let produced = draft
      let producerLabel = '（调用方提交）'

      // —— 第一关：产出 ——
      if (hasProducer) {
        const member = byName(producerName)
        if (member === undefined) throw new Error('名册中没有名为「' + producerName + '」的成员')
        if (!member.enabled) throw new Error('成员「' + producerName + '」已停用，请先启用')
        const first = await runAnyMember(ctx, parent, member, task, exec?.signal)
        produced = first.output
        producerLabel = member.name
        chain.push({ stage: '产出', who: member.name, model: first.provider + '/' + first.model, verdict: first.stopReason === 'completed' ? '完成' : first.stopReason, note: '' })
        if (first.stopReason !== 'completed' || produced.trim().length === 0) {
          const summary = [
            '【交付流水线】第一关就失败了，未进入审核。',
            '执行方：' + member.name + '（' + first.provider + '/' + first.model + '）',
            'stopReason：' + first.stopReason,
            first.detail.length > 0 ? '诊断：' + first.detail : ''
          ].filter((l) => l.length > 0).join('\n')
          // 注意：这里必须补齐 output.schema 的 required 全部字段（rounds/auditFeedback/
          // reviewFeedback/resubmitHint）。早期移植版本漏了这四个，第一关失败时返回的对象
          // 不符合本工具自己声明的输出契约。smoke-server.mjs 里有针对该分支的回归。
          return {
            status: 'error',
            producer: member.name,
            auditVerdict: '未执行',
            reviewVerdict: '未执行',
            rounds: 0,
            auditFeedback: '',
            reviewFeedback: '',
            resubmitHint: '第一关（产出）就失败，未进入审核。请检查该成员的路由是否可用，或改用 draft 直接提交内容。',
            finalOutput: produced,
            chain: JSON.stringify(chain),
            summary
          }
        }
      } else {
        chain.push({ stage: '产出', who: '（调用方提交）', model: '', verdict: '完成', note: '' })
      }

      // 审核/复核成员在产出之后才解析：第一关就失败时不该因为“缺审核员”再报一次错。
      const auditor = byName(GATE_AUDITOR) ?? byRole(/审核/)
      const reviewer = byName(GATE_REVIEWER) ?? byRole(/复核/)
      if (auditor === undefined || reviewer === undefined) {
        const missing = auditor === undefined ? '审核' : '复核'
        return {
          status: 'error',
          producer: producerLabel,
          auditVerdict: '未执行',
          reviewVerdict: '未执行',
          rounds: 0,
          auditFeedback: '',
          reviewFeedback: '',
          resubmitHint: '名册缺少' + missing + '成员，流水线无法继续。请先新建一位职责含「' + missing + '」的成员。',
          finalOutput: produced,
          chain: JSON.stringify(chain),
          summary: '【交付流水线】缺少' + missing + '成员，未执行。'
        }
      }

      // —— 第二关：审核 ——
      let audit = await dispatchToMember(ctx, parent, auditor, auditPrompt(task, produced, producerLabel), exec?.signal)
      let auditPass = parseVerdict(audit.output, /审核结论[:：]\s*通过/, /审核结论[:：]\s*(?:需修改|不通过)/)
      const auditLabel = (p) => (p === true ? '通过' : p === false ? '需修改' : '未表态')
      chain.push({ stage: '审核', who: auditor.name, model: audit.provider + '/' + audit.model, verdict: auditLabel(auditPass), note: '' })

      // —— 审核不通过时自动修订（轮数可配） ——
      // 默认 2 轮而不是 1：实测出现过「改了一轮仍差一点」的情况，一轮就驳回太早。
      // 也不是无限：每轮都是真实的模型调用（花钱 + 耗时）。
      const allowRevise = args?.revise !== false
      const maxRounds = Number.isSafeInteger(args?.maxRounds) && args.maxRounds >= 0 && args.maxRounds <= 5 ? args.maxRounds : 2
      let rounds = 0
      let revised = false
      while (auditPass !== true && allowRevise && hasProducer && rounds < maxRounds) {
        const member = byName(producerName)
        const fixTask = task +
          '\n\n【审核员提出的问题，请逐条修订后重新提交完整产出】\n' +
          clip(audit.output, 6000) +
          '\n\n注意：只改被指出的问题，其余**已核实正确的部分原样保留**，不要重写整篇。'
        const next = await dispatchToMember(ctx, parent, member, fixTask, exec?.signal)
        if (next.stopReason !== 'completed' || next.output.trim().length === 0) {
          chain.push({ stage: '修订第 ' + String(rounds + 1) + ' 轮', who: member.name, model: next.provider + '/' + next.model, verdict: '修订失败', note: String(next.detail ?? '').slice(0, 200) })
          break
        }
        rounds += 1
        produced = next.output
        revised = true
        chain.push({ stage: '修订第 ' + String(rounds) + ' 轮', who: member.name, model: next.provider + '/' + next.model, verdict: '已修订', note: '' })
        audit = await dispatchToMember(ctx, parent, auditor, auditPrompt(task, produced, producerLabel), exec?.signal)
        auditPass = parseVerdict(audit.output, /审核结论[:：]\s*通过/, /审核结论[:：]\s*(?:需修改|不通过)/)
        chain.push({ stage: '复审第 ' + String(rounds) + ' 轮', who: auditor.name, model: audit.provider + '/' + audit.model, verdict: auditLabel(auditPass), note: '' })
      }

      // —— 第三关：复核 ——
      const review = await dispatchToMember(ctx, parent, reviewer, reviewPrompt(task, produced, audit.output), exec?.signal)
      const reviewPass = parseVerdict(review.output, /复核结论[:：]\s*过审/, /复核结论[:：]\s*驳回/)
      const reviewLabel = (p) => (p === true ? '过审' : p === false ? '驳回' : '未表态')
      // 复核是最后一关，可以和审核不一致。**两个方向都要显式标出**，不能悄悄放行也不能悄悄驳回：
      //   · 审核判需修改、复核仍放行 -> 要么复核发现审核误判，要么复核把关不严；
      //   · 审核判通过、复核却驳回   -> 复核比审核更严（实测出现过：审核漏了字数上限，复核数出来了）。
      // 后者还有个副作用：既然审核通过了就不会触发修订，maxRounds 一轮都用不上——这条也要说清楚。
      const overridden = auditPass === false && reviewPass === true
      const stricter = auditPass === true && reviewPass === false
      const mismatch = overridden
        ? '推翻审核：审核判需修改，复核仍放行'
        : stricter ? '复核比审核严：审核判通过，复核驳回' : ''
      chain.push({
        stage: '复核',
        who: reviewer.name,
        model: review.provider + '/' + review.model,
        verdict: reviewLabel(reviewPass),
        note: mismatch
      })

      const status = reviewPass === true ? 'passed' : reviewPass === false ? 'rejected' : 'unclear'

      // 被驳回时，把「可直接重投的材料」一并交回调用方：
      // 这样调用方能带着审核意见重投（保留已核实正确的部分），而不是从零再来一遍。
      const resubmitHint = status === 'passed' ? '' : [
        '未放行。重投方式三选一：',
        '  A（推荐）把「最终产出」作为 draft 传回，并在 task 里附上上面的审核意见 ——',
        '     可保留已核实正确的部分，只改被指出的问题，最省成本。',
        '  B 保持 producer 再调一次（执行方会重新产出，但看不到这次的审核意见，可能重复犯错）。',
        '  C 换一个更强的 producer 重投。',
        '',
        '本次已用完 ' + String(rounds) + ' 轮自动修订（maxRounds=' + String(maxRounds) + '）。' +
          (stricter && rounds === 0
            ? '注意：审核通过了，所以没有触发修订；驳回来自复核，maxRounds 没被用上。复核意见同样可直接用来重投。'
            : '若需要更多轮，调大 maxRounds（上限 5）。')
      ].join('\n')

      const lines = [
        '【交付流水线】最终状态：' + (status === 'passed' ? '✅ 复核过审' : status === 'rejected' ? '❌ 复核驳回' : '⚠️ 复核未表态') + (mismatch.length > 0 ? '  ⚠️ ' + mismatch : ''),
        '  第一关 产出：' + producerLabel + (rounds > 0 ? '（自动修订 ' + String(rounds) + ' 轮）' : ''),
        '  第二关 审核：' + auditLabel(auditPass),
        '  第三关 复核：' + reviewLabel(reviewPass),
        '',
        '—— 审核意见 ——',
        clip(audit.output, 4000),
        '',
        '—— 复核意见 ——',
        clip(review.output, 4000),
      ].concat(resubmitHint.length > 0 ? ['', '—— 下一步（未放行）——', resubmitHint] : []).concat([
        '',
        '—— 最终产出 ——',
        clip(produced, 6000)
      ]).join('\n')

      return {
        status,
        producer: producerLabel,
        auditVerdict: auditLabel(auditPass),
        reviewVerdict: reviewLabel(reviewPass),
        rounds,
        auditFeedback: clip(audit.output, 8000),
        reviewFeedback: clip(review.output, 8000),
        resubmitHint,
        finalOutput: produced,
        chain: JSON.stringify(chain, null, 1),
        summary: lines
      }
    }
  }
  //#endregion

  const roleSearch = {
    name: 'agent_team_roles',
    description: '角色库检索：按关键词查 agency-agents-zh 的 300+ 个预设角色（名称、部门、职责、表情）。只读，用来挑选要加入团队的角色。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: '关键词，例如「前端」「测试」「增长」；空串返回前几条。' },
        limit: { type: 'integer', description: '返回条数 1-50，默认 12。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['total', 'roles'],
        properties: {
          total: { type: 'integer' },
          roles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name', 'category', 'emoji', 'description'],
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                category: { type: 'string' },
                emoji: { type: 'string' },
                description: { type: 'string' }
              }
            }
          }
        }
      },
      render: (_args, value) => [{
        type: 'text',
        text: '角色库匹配 ' + String(value.total) + ' 个：\n' +
          value.roles.map((role) => role.emoji + ' ' + role.name + '（' + role.category + '）— ' + role.description).join('\n')
      }]
    },
    async execute(args) {
      const limit = Number.isSafeInteger(args?.limit) ? Math.min(50, Math.max(1, args.limit)) : 12
      const result = await searchRoles(text(args?.query), '', 0, limit)
      return {
        total: result.total,
        roles: result.roles.map((role) => ({
          id: role.id,
          name: role.name,
          category: role.categoryName,
          emoji: role.emoji,
          description: role.description
        }))
      }
    }
  }

  return [ctx.tools.register(roster), ctx.tools.register(dispatch), ctx.tools.register(gate), ctx.tools.register(roleSearch)]
}

/** 批量创建辅助：按模板追加 N 名成员。 */
function appendMembers(store, count, template) {
  const taken = new Set(store.members.map((m) => m.name))
  for (let i = 0; i < count; i += 1) {
    const name = uniqueName(text(template.namePrefix) || '智能体', taken)
    taken.add(name)
    store.members.push(normalizeMember({
      name,
      role: text(template.role) || '通用助手',
      emoji: text(template.emoji) || '🤖',
      instructions: typeof template.instructions === 'string' ? template.instructions : '',
      routes: Array.isArray(template.routes) ? template.routes : undefined,
      provider: text(template.provider),
      model: text(template.model),
      reasoningEffort: text(template.reasoningEffort)
    }, store.members.length))
  }
}

/** 取出请求体里的模板对象。 */
function templateOf(body) {
  return body.template !== null && typeof body.template === 'object' && !Array.isArray(body.template) ? body.template : {}
}

/** 分组的增删改。 */
function applyGroupAction(store, body) {
  const action = text(body.action)
  if (action === 'group-upsert') {
    const incoming = body.group !== null && typeof body.group === 'object' ? body.group : {}
    const id = text(incoming.id)
    const index = id.length > 0 ? store.groups.findIndex((group) => group.id === id) : -1
    if (index >= 0) {
      store.groups[index] = normalizeGroup({ ...store.groups[index], ...incoming, id: store.groups[index].id }, index)
    } else {
      if (store.groups.length >= 24) return '分组最多 24 个'
      store.groups.push(normalizeGroup({ ...incoming, order: store.groups.length }, store.groups.length))
    }
    return null
  }
  if (action === 'group-delete') {
    const id = text(body.id)
    store.groups = store.groups.filter((group) => group.id !== id)
    for (const member of store.members) if (member.groupId === id) member.groupId = ''
    return null
  }
  if (action === 'group-reorder') {
    const ids = Array.isArray(body.ids) ? body.ids.map(text) : []
    const byId = new Map(store.groups.map((group) => [group.id, group]))
    const next = []
    for (const id of ids) {
      const found = byId.get(id)
      if (found === undefined) return '排序列表包含未知分组 id'
      next.push(found)
      byId.delete(id)
    }
    for (const group of byId.values()) next.push(group)
    store.groups = next.map((group, index) => ({ ...group, order: index }))
    return null
  }
  return '未知分组 action：' + action
}

/** 角色库概要：面板首屏只需要数量与分类，不拉 300+ 条索引。 */
async function roleLibrarySummary() {
  const index = await loadRoleIndex()
  return { version: index.version, upstream: index.upstream, total: index.roles.length, categories: index.categories }
}

/** 从角色库导入成员：只写 roleRef，正文在派发时按需读取，避免 team.json 膨胀。 */
async function importRoles(store, ids, groupId, models, options) {
  const index = await loadRoleIndex()
  const byId = new Map(index.roles.map((role) => [role.id, role]))
  const taken = new Set(store.members.map((member) => member.name))
  const pool = (Array.isArray(models) ? models : [])
    .map((entry) => ({ provider: text(entry?.provider), model: text(entry?.model) }))
    .filter((entry) => entry.provider.length > 0 && entry.model.length > 0)
  const created = []
  const asDepartment = options !== null && typeof options === 'object' && options.asDepartment === true
  if (asDepartment) {
    const roles = (Array.isArray(ids) ? ids.map(text) : []).map((id) => byId.get(id)).filter((role) => role !== undefined)
    if (roles.length === 0) return created
    if (store.members.length >= MAX_MEMBERS) return created
    const departmentName = text(options?.name) || roles[0].categoryName || '部门'
    const name = uniqueName(departmentName, taken)
    const subAgents = roles.map((role, index) => {
      const pick = pool.length > 0 ? pool[index % pool.length] : null
      return {
        name: role.name,
        role: role.description.length > 0 ? role.description.slice(0, 48) : role.categoryName,
        emoji: role.emoji,
        provider: pick === null ? '' : pick.provider,
        model: pick === null ? '' : pick.model,
        roleRef: { library: 'agency-agents-zh', id: role.id, version: index.version }
      }
    })
    const lead = pool[0]
    const member = normalizeMember({
      name,
      role: '部门智能体 · ' + String(roles.length) + ' 个子智能体',
      emoji: '🏢',
      groupId: text(groupId),
      department: { name, subAgents },
      routes: lead === undefined ? [] : [{ label: '部门主管', provider: lead.provider, model: lead.model, reasoningEffort: '' }]
    }, store.members.length)
    store.members.push(member)
    created.push(member)
    return created
  }
  for (const id of Array.isArray(ids) ? ids.map(text) : []) {
    const role = byId.get(id)
    if (role === undefined) continue
    if (store.members.length >= MAX_MEMBERS) break
    const name = uniqueName(role.name, taken)
    taken.add(name)
    const pick = pool.length > 0 ? pool[created.length % pool.length] : null
    const member = normalizeMember({
      name,
      role: role.description.length > 0 ? role.description.slice(0, 48) : role.categoryName,
      emoji: role.emoji,
      color: colorOfName(role.color),
      groupId: text(groupId),
      roleRef: { library: 'agency-agents-zh', id: role.id, version: index.version },
      routes: pick === null ? [] : [{ label: '自动分配', provider: pick.provider, model: pick.model, reasoningEffort: '' }]
    }, store.members.length)
    store.members.push(member)
    created.push(member)
  }
  return created
}

/** 应用预设团队；replace 会先清空当前团队与分组。 */
async function applyPresetToStore(store, preset, mode) {
  const replace = mode === 'replace'
  if (replace) {
    store.members = []
    store.groups = []
  }
  const groupNameById = new Map((preset.groups || []).map((group) => [group.id, group.name]))
  for (const group of Array.isArray(preset.groups) ? preset.groups : []) {
    if (store.groups.some((existing) => existing.name === group.name)) continue
    store.groups.push(normalizeGroup({ name: group.name, color: group.color, order: store.groups.length }, store.groups.length))
  }
  const groupIdByName = new Map(store.groups.map((group) => [group.name, group.id]))
  const taken = new Set(store.members.map((member) => member.name))
  let added = 0
  for (const entry of Array.isArray(preset.members) ? preset.members : []) {
    if (store.members.length >= MAX_MEMBERS) break
    if (store.members.some((existing) => existing.name === entry.name)) continue
    const groupName = groupNameById.get(entry.groupId) || ''
    const member = normalizeMember({
      name: uniqueName(entry.name, taken),
      role: entry.role,
      emoji: entry.emoji,
      color: entry.color,
      groupId: groupIdByName.get(groupName) || '',
      roleRef: entry.roleRef
    }, store.members.length)
    taken.add(member.name)
    store.members.push(member)
    added += 1
  }
  store.preset = text(preset.id)
  return added
}

/** 作用于单个成员模型路由列表的动作集。 */
const ROUTE_ACTIONS = ['route-upsert', 'route-delete', 'route-activate', 'route-reorder']

/** 在 store 上应用一个成员动作；返回错误字符串或 null。 */
async function applyMemberAction(store, body, ctx) {
  const action = text(body.action) || 'upsert'
  if (action.startsWith('group-')) return applyGroupAction(store, body)
  const findIndex = (id) => store.members.findIndex((m) => m.id === text(id))

  if (action === 'upsert') {
    const incoming = body.member
    if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) return '缺少 member 对象'
    const id = text(incoming.id)
    const index = id.length > 0 ? findIndex(id) : -1
    if (index >= 0) {
      // 合并时保留既有模型路由，除非请求显式带了 routes
      store.members[index] = normalizeMember({ ...store.members[index], ...incoming, id: store.members[index].id }, index)
    } else {
      if (store.members.length >= MAX_MEMBERS) return '团队最多 ' + String(MAX_MEMBERS) + ' 名成员'
      store.members.push(normalizeMember(incoming, store.members.length))
    }
    return null
  }

  if (action === 'chief-create') {
    if (store.members.length >= MAX_MEMBERS) return '团队最多 ' + String(MAX_MEMBERS) + ' 名成员'
    const taken = new Set(store.members.map((m) => m.name))
    const member = normalizeMember({
      name: uniqueName('总管', taken),
      role: '团队总管：拆解目标、分派任务、汇总交付',
      emoji: '🧭',
      color: '#4d6bfe'
    }, store.members.length)
    store.members.push(member)
    store.chiefId = member.id
    return null
  }

  if (action === 'chief') {
    const id = text(body.id)
    if (id.length === 0) return '缺少要设为总管的成员 id'
    if (!store.members.some((m) => m.id === id)) return '找不到该成员'
    store.chiefId = id
    return null
  }

  if (action === 'chief-clear') {
    store.chiefId = ''
    return null
  }

  if (action === 'delete') {
    const id = text(body.id)
    if (id.length > 0 && id === resolveChiefId(store.members, store.chiefId)) {
      return '总管台的管理员（总管）不能删除；请先把别的成员设为总管（★），再删除它。'
    }
    const before = store.members.length
    store.members = store.members.filter((m) => m.id !== id)
    if (store.chiefId === id) store.chiefId = ''
    return store.members.length === before ? '找不到该成员' : null
  }

  // 部门子智能体的批量增删改：客户端把整份 subs 数组发上来，服务端统一 normalize 后替换。
  if (action === 'subs-set') {
    const deptId = text(body.deptId)
    const dept = store.members.find((m) => m.id === deptId && m.department !== null)
    if (dept === undefined) return '找不到部门智能体'
    const rows = Array.isArray(body.subs) ? body.subs : []
    const deptNames = new Set(store.members.filter((m) => m.department !== null).map((m) => m.name))
    const subs = rows.map((row) => normalizeSubAgent(row, 0))
      .filter((sub) => sub.name.length > 0 && sub.name !== dept.name && !(deptNames.has(sub.name) && sub.name !== dept.name))
    if (subs.length === 0) return '部门至少保留 1 个子智能体'
    dept.department = { name: dept.department.name, subAgents: subs }
    dept.role = '部门智能体 · ' + String(subs.length) + ' 个子智能体'
    return null
  }

  // 拖拽：把一个成员变成某个部门的子智能体（成员本身被合并掉，聊天记录保留在会话里）。
  if (action === 'dept-add-sub') {
    const deptId = text(body.deptId)
    const memberId = text(body.memberId)
    const dept = store.members.find((m) => m.id === deptId && m.department !== null)
    const member = store.members.find((m) => m.id === memberId)
    if (dept === undefined) return '找不到部门智能体'
    if (member === undefined) return '找不到要加入的成员'
    if (dept.id === member.id) return '不能把部门加进它自己'
    if (dept.department.subAgents.some((sub) => sub.name === member.name)) return '该成员已在部门里'
    // 部门不能再嵌套部门：把它的子智能体平铺进来，然后删掉这层壳，避免自引用/递归。
    if (member.department !== null && member.department !== undefined) {
      for (const sub of member.department.subAgents) {
        if (sub.name === dept.name || dept.department.subAgents.some((item) => item.name === sub.name)) continue
        dept.department.subAgents.push(Object.assign({}, sub, { id: makeId('sub') }))
      }
      dept.role = '部门智能体 · ' + String(dept.department.subAgents.length) + ' 个子智能体'
      store.members = store.members.filter((m) => m.id !== memberId)
      if (store.chiefId === memberId) store.chiefId = ''
      return null
    }
    const route = (member.routes || [])[0]
    dept.department.subAgents.push({
      id: makeId('sub'),
      name: member.name,
      role: member.role,
      emoji: member.emoji,
      provider: route !== undefined ? route.provider : '',
      model: route !== undefined ? route.model : '',
      reasoningEffort: route !== undefined ? route.reasoningEffort : '',
      roleRef: member.roleRef
    })
    store.members = store.members.filter((m) => m.id !== memberId)
    if (store.chiefId === memberId) store.chiefId = ''
    return null
  }

  // 拖拽：多个成员合成一个新部门（部门 = 一个智能体，成员变成子智能体）。
  if (action === 'dept-create') {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(text).filter((id) => id.length > 0)
    if (ids.length < 2) return '至少需要 2 个成员才能组成部门'
    const picked = store.members.filter((m) => ids.includes(m.id) && (m.department === null || m.department === undefined))
    if (picked.length < 2) return '至少需要 2 个普通成员；部门智能体不能再次组队（请把它拆开或直接拖进目标部门）'
    const subs = picked.map((member) => {
      const route = (member.routes || [])[0]
      return {
        id: makeId('sub'),
        name: member.name,
        role: member.role,
        emoji: member.emoji,
        provider: route !== undefined ? route.provider : '',
        model: route !== undefined ? route.model : '',
        reasoningEffort: route !== undefined ? route.reasoningEffort : '',
        roleRef: member.roleRef
      }
    })
    const name = text(body.name).length > 0 ? text(body.name) : '新部门'
    const lead = subs[0]
    const dept = normalizeMember({
      id: makeId('member'),
      name,
      role: '部门智能体 · ' + String(subs.length) + ' 个子智能体',
      emoji: '🏢',
      color: '',
      groupId: picked[0].groupId,
      instructions: '',
      enabled: true,
      routes: [{ id: makeId('route'), label: '部门主管', provider: lead.provider, model: lead.model, reasoningEffort: lead.reasoningEffort, enabled: true }],
      department: { name, subAgents: subs }
    })
    dept.activeRouteId = dept.routes[0].id
    store.members = store.members.filter((m) => !ids.includes(m.id))
    if (ids.includes(store.chiefId)) store.chiefId = ''
    store.members.push(dept)
    return null
  }

  // 清理失效模型：宿主目录里已经不存在（provider/model 失配）的路由直接删，子智能体模型置空。
  if (action === 'models-clean') {
    const llm = ctx.get('llm')
    if (llm === undefined || llm === null) return 'llm 服务不可用'
    const known = new Set()
    let providers = []
    try { providers = llm.listProviders() } catch { return '无法枚举 provider' }
    for (const provider of providers) {
      const id = text(provider?.provider ?? provider?.id)
      if (id.length === 0) continue
      try {
        for (const model of await llm.listModels(id)) {
          const modelId = text(model?.id)
          if (modelId.length > 0) known.add(id + '/' + modelId)
        }
      } catch { /* 跳过 */ }
    }
    if (known.size === 0) return '目录为空，未做清理'
    let removedRoutes = 0
    let clearedSubs = 0
    for (const member of store.members) {
      const before = (member.routes || []).length
      member.routes = (member.routes || []).filter((route) => known.has(route.provider + '/' + route.model))
      removedRoutes += before - member.routes.length
      if (member.department !== null && member.department !== undefined) {
        member.department = {
          name: member.department.name,
          subAgents: member.department.subAgents.map((sub) => {
            if (sub.provider.length === 0 || sub.model.length === 0) return sub
            if (known.has(sub.provider + '/' + sub.model)) return sub
            clearedSubs += 1
            return Object.assign({}, sub, { provider: '', model: '' })
          })
        }
      }
    }
    store.updatedAt = new Date().toISOString()
    return null
  }

  // 自动分配模型：把宿主目录里可解析的模型轮流分给部门子智能体（可选真实推理过滤）。
  if (action === 'models-auto') {
    const llm = ctx.get('llm')
    if (llm === undefined || llm === null) return 'llm 服务不可用，无法自动分配'
    let providers = []
    try { providers = llm.listProviders() } catch { return '无法枚举 provider' }
    const candidates = []
    for (const provider of providers) {
      const id = text(provider?.provider ?? provider?.id)
      if (id.length === 0) continue
      // 决策类 provider（Jev）返回概率/分数，不产出对话正文，不能分给团队子智能体。
      if (id === 'jev-ai') continue
      try {
        const models = await llm.listModels(id)
        for (const model of models) {
          const modelId = text(model?.id)
          if (modelId.length > 0 && candidates.length < 40) candidates.push({ provider: id, model: modelId })
        }
      } catch { /* 单个 provider 失败不影响其它 */ }
    }
    if (candidates.length === 0) return '目录里没有可用模型'
    // 按 provider 分组后轮转取用：优先保证「模型多样性」（同一家只先取一个），
    // 第一轮凑不满再用第二、第三个模型补齐。
    const byProvider = new Map()
    for (const candidate of candidates) {
      if (!byProvider.has(candidate.provider)) byProvider.set(candidate.provider, [])
      byProvider.get(candidate.provider).push(candidate)
    }
    const ordered = []
    let round = 0
    while (ordered.length < candidates.length && round < 40) {
      let added = false
      for (const list of byProvider.values()) {
        if (list[round] !== undefined) { ordered.push(list[round]); added = true }
      }
      if (!added) break
      round += 1
    }
    const usable = []
    for (const candidate of ordered) {
      try {
        const info = await llm.resolveModelInfo(candidate.provider, candidate.model)
        const modalities = Array.isArray(info.inputModalities) ? info.inputModalities.map(text) : []
        if (modalities.length > 0 && !modalities.includes('text')) continue
        await llm.prepareCall({ provider: candidate.provider, model: candidate.model })
        usable.push(candidate)
        if (usable.length >= 6) break
      } catch { /* 跳过不可解析的模型 */ }
    }
    if (usable.length === 0) return '没有可解析的模型'
    const targetId = text(body.memberId)
    let assigned = 0
    for (const member of store.members) {
      if (targetId.length > 0 && member.id !== targetId) continue
      if (member.department === null || member.department === undefined || member.department.subAgents.length === 0) continue
      const subs = member.department.subAgents.map((sub, index) => Object.assign({}, sub, {
        provider: usable[index % usable.length].provider,
        model: usable[index % usable.length].model
      }))
      const lead = usable[0]
      member.department = { name: member.department.name, subAgents: subs }
      member.routes = [{ id: 'lead-' + member.id.slice(-6), label: '部门主管', provider: lead.provider, model: lead.model, reasoningEffort: '', enabled: true }]
      member.activeRouteId = member.routes[0].id
      assigned += 1
    }
    if (assigned === 0) return '没有需要分配的部门'
    return null
  }

  if (action === 'delete-many') {
    const ids = Array.isArray(body.ids) ? body.ids.map(text).filter((id) => id.length > 0) : []
    if (ids.length === 0) return '缺少要删除的 ids'
    const chiefId = resolveChiefId(store.members, store.chiefId)
    if (chiefId.length > 0 && ids.includes(chiefId)) {
      return '选中的成员里有总管台的管理员（总管），不能删除；请先取消勾选它。'
    }
    const drop = new Set(ids)
    const before = store.members.length
    store.members = store.members.filter((m) => !drop.has(m.id))
    if (drop.has(store.chiefId)) store.chiefId = ''
    return before === store.members.length ? '没有成员被删除（id 不存在）' : null
  }

  if (action === 'reorder') {
    const ids = Array.isArray(body.ids) ? body.ids.map(text) : []
    if (ids.length !== store.members.length) return '排序列表与成员数量不一致'
    const byId = new Map(store.members.map((m) => [m.id, m]))
    const next = []
    for (const id of ids) {
      const found = byId.get(id)
      if (found === undefined) return '排序列表包含未知成员 id'
      next.push(found)
      byId.delete(id)
    }
    if (byId.size > 0) return '排序列表缺少成员'
    store.members = next
    return null
  }

  // 数量「增」：一次创建 N 名成员
  if (action === 'batch-create') {
    const requested = Number(body.count)
    if (!Number.isSafeInteger(requested) || requested < 1) return 'count 必须是 ≥1 的整数'
    const room = MAX_MEMBERS - store.members.length
    if (room <= 0) return '已达到团队上限 ' + String(MAX_MEMBERS) + ' 名'
    const count = Math.min(requested, room)
    appendMembers(store, count, templateOf(body))
    return count < requested ? null : null
  }

  // 数量「改」：把团队恰好调整到 N 名
  if (action === 'set-count') {
    const count = Number(body.count)
    if (!Number.isSafeInteger(count) || count < 0) return 'count 必须是 ≥0 的整数'
    if (count > MAX_MEMBERS) return '团队最多 ' + String(MAX_MEMBERS) + ' 名成员'
    if (count < store.members.length) store.members = store.members.slice(0, count)
    else if (count > store.members.length) appendMembers(store, count - store.members.length, templateOf(body))
    return null
  }

  // 复制一个成员（连同它的模型路由）
  if (action === 'duplicate') {
    const index = findIndex(body.id)
    if (index < 0) return '找不到该成员'
    if (store.members.length >= MAX_MEMBERS) return '团队最多 ' + String(MAX_MEMBERS) + ' 名成员'
    const source = store.members[index]
    const taken = new Set(store.members.map((m) => m.name))
    const copy = normalizeMember({
      ...source,
      id: '',
      name: uniqueName(source.name, taken),
      createdAt: '',
      routes: source.routes.map((route) => ({ ...route, id: '' })),
      activeRouteId: ''
    }, store.members.length)
    const activeIndex = source.routes.findIndex((route) => route.id === source.activeRouteId)
    const copyRoutes = copy.routes
    copy.activeRouteId = activeIndex >= 0 && copyRoutes[activeIndex] !== undefined ? copyRoutes[activeIndex].id : copy.activeRouteId
    store.members.splice(index + 1, 0, copy)
    return null
  }

  // 以下动作都作用于某个成员的模型路由列表
  if (ROUTE_ACTIONS.indexOf(action) < 0) return '未知 action：' + action
  const memberIndex = findIndex(body.memberId)
  if (memberIndex < 0) return '找不到该成员'
  const member = store.members[memberIndex]

  if (action === 'route-upsert') {
    const incoming = body.route
    if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) return '缺少 route 对象'
    const routeId = text(incoming.id)
    const routeIndex = routeId.length > 0 ? member.routes.findIndex((r) => r.id === routeId) : -1
    if (routeIndex >= 0) {
      member.routes[routeIndex] = normalizeRoute({ ...member.routes[routeIndex], ...incoming, id: member.routes[routeIndex].id }, routeIndex)
    } else {
      if (member.routes.length >= MAX_ROUTES) return '单个智能体最多 ' + String(MAX_ROUTES) + ' 条模型路由'
      member.routes.push(normalizeRoute(incoming, member.routes.length))
      if (member.activeRouteId.length === 0) member.activeRouteId = member.routes[member.routes.length - 1].id
    }
    return null
  }

  if (action === 'route-delete') {
    const routeId = text(body.routeId)
    const before = member.routes.length
    member.routes = member.routes.filter((r) => r.id !== routeId)
    if (member.routes.length === before) return '找不到该模型路由'
    if (member.activeRouteId === routeId) member.activeRouteId = member.routes.length > 0 ? member.routes[0].id : ''
    return null
  }

  if (action === 'route-activate') {
    const routeId = text(body.routeId)
    if (routeId.length > 0 && !member.routes.some((r) => r.id === routeId)) return '找不到该模型路由'
    member.activeRouteId = routeId
    return null
  }

  if (action === 'route-reorder') {
    const ids = Array.isArray(body.ids) ? body.ids.map(text) : []
    if (ids.length !== member.routes.length) return '排序列表与路由数量不一致'
    const byId = new Map(member.routes.map((r) => [r.id, r]))
    const next = []
    for (const id of ids) {
      const found = byId.get(id)
      if (found === undefined) return '排序列表包含未知路由 id'
      next.push(found)
      byId.delete(id)
    }
    if (byId.size > 0) return '排序列表缺少路由'
    member.routes = next
    return null
  }

  return '未知 action：' + action
}

/** 进程内所有权标记：热重载时新实例接管旧实例，避免重复注册把整棵插件树打挂。 */
const OWNER_KEY = Symbol.for('dsh-team-workbench.team.owner')

/**
 * 插件主体。
 * @param config - 可选配置；bundle patch 的 config 段会传进来。
 *   例如：triggers: { enabled: true, keywords: ['项目'], member: '分析师' }
 */
export function apply(ctx, config) {
  // 热重载期间新旧实例会短暂并存（profile reconcile / HMR 都会触发）。新实例先释放
  // 前任持有的路由与工具，再登记自己；否则第二份注册会撞上
  // "exact Fetch route ... is already registered"，新 fiber 失败、旧 fiber 随即被
  // dispose，最终两边都不剩——插件在运行期凭空消失。全新启动时没有前任，等于无操作。
  const previous = globalThis[OWNER_KEY]
  if (previous !== undefined && previous !== null) {
    try {
      previous.release()
    } catch (error) {
      console.warn('[team-workbench] 释放上一实例失败：' + String(error))
    }
  }
  const disposers = []
  const handle = {
    release() {
      // 常驻 Agent 也要一起释放，否则热重载后会留下孤儿会话。
      for (const entry of REUSE_AGENTS.values()) {
        try { entry.handle?.dispose?.() } catch { /* 已释放 */ }
      }
      REUSE_AGENTS.clear()
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        try {
          dispose()
        } catch {
          /* 已经释放过 */
        }
      }
      if (globalThis[OWNER_KEY] === handle) delete globalThis[OWNER_KEY]
    }
  }
  globalThis[OWNER_KEY] = handle
  ctx.effect(() => handle.release, 'agent-team-studio: release routes and tools')

  /** 登记一个可释放的注册，供接管时精确释放。 */
  const own = (disposer) => {
    disposers.push(disposer)
    return disposer
  }

  const snapshot = async () => {
    const store = await loadStore()
    const catalog = await collectCatalog(ctx)
    // 成员所属部门：部门成员用 department.name；从角色库导入的按角色分类补一个展示名。
    let roleCats = new Map()
    let roleCatsByName = new Map()
    try {
      const index = await loadRoleIndex()
      roleCats = new Map(index.roles.map((role) => [role.id, role.categoryName]))
      // 早期导入的成员没有 roleRef，只能按名字回查角色库（去掉重名后缀的数字）。
      const norm = (value) => String(value || '').replace(/\s*\d+$/u, '').trim()
      roleCatsByName = new Map(index.roles.map((role) => [norm(role.name), role.categoryName]))
    } catch { /* 角色库缺失不影响快照 */ }
    const nameCategory = (name) => roleCatsByName.get(String(name || '').replace(/\s*\d+$/u, '').trim()) || ''
    const withDepartment = (members) => members.map((member) => ({
      ...member,
      departmentName: member.department !== null && member.department !== undefined
        ? member.department.name
        : (member.roleRef.id.length > 0 ? (roleCats.get(member.roleRef.id) || '') : nameCategory(member.name)),
      subAgentCount: member.department !== null && member.department !== undefined ? member.department.subAgents.length : 0
    }))
    return {
      ok: true,
      pluginVersion: PLUGIN_VERSION,
      version: STORE_VERSION,
      members: withDepartment(store.members),
      chiefId: store.chiefId || '',
      groups: store.groups,
      preset: store.preset,
      presets: await listPresets(),
      roleLibrary: await roleLibrarySummary(),
      catalog: catalog.providers,
      catalogError: catalog.error,
      defaults: resolveDefaults(ctx),
      effortOptions: EFFORT_OPTIONS,
      limits: { maxMembers: MAX_MEMBERS, maxRoutes: MAX_ROUTES, maxGroups: 24 },
      storePath: storePath()
    }
  }

  own(ctx.connection.fetch.register({
    path: STATE_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try { return json(await snapshot()) } catch (error) { return json({ ok: false, error: String(error) }, 500) }
    }
  }))

  own(ctx.connection.fetch.register({
    path: MEMBERS_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readJson(request)
      if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
      try {
        const store = await loadStore()
        const failure = await applyMemberAction(store, body, ctx)
        if (failure !== null) return json({ ok: false, error: failure }, 400)
        await saveStore(store)
        return json(await snapshot())
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: PROBE_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readJson(request)
      if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
      try {
        // 真实推理探测：用宿主会话跑一次极小任务，验证模型真的能出字（不只是配置可解析）。
        if (text(body.action) === 'live') {
          const provider = text(body.provider)
          const model = text(body.model)
          if (provider.length === 0 || model.length === 0) return json({ ok: false, error: '缺少 provider/model' }, 400)
          const agents = ctx.get('agents')
          const sessionId = text(body.sessionId)
          const parent = agents !== undefined && agents !== null && sessionId.length > 0 ? agents.get(sessionId) : undefined
          if (parent === undefined || parent === null) return json({ ok: false, error: '当前没有活动的会话，无法做真实推理探测（请先打开一次聊天）' }, 409)
          const probeMember = {
            id: 'probe-' + provider + '-' + model,
            name: '模型探测',
            role: '连通性探测',
            emoji: '🔌',
            color: '',
            groupId: '',
            avatar: { kind: 'emoji', imageId: '' },
            roleRef: { library: '', id: '', version: '' },
            instructions: '',
            enabled: true,
            createdAt: new Date().toISOString(),
            activeRouteId: 'probe-route',
            routes: [{ id: 'probe-route', label: '探测', provider, model, reasoningEffort: text(body.reasoningEffort), enabled: true }]
          }
          const started = Date.now()
          try {
            const result = await dispatchToMember(ctx, parent, probeMember, '只回复两个字符：ok。不要解释，不要标点。', request.signal)
            const output = text(result.output).slice(0, 40)
            // 只回 "ok" 的探测：决策类模型会把这句话当判断请求，输出里没有 ok，应按不可用处理。
            const ok = result.stopReason === 'completed' && output.length > 0 && /ok/i.test(output)
            return json({ ok, provider, model, output, stopReason: result.stopReason, ms: Date.now() - started, error: ok ? '' : text(result.detail).slice(0, 300) })
          } catch (error) {
            return json({ ok: false, provider, model, ms: Date.now() - started, error: String(error && error.message ? error.message : error).slice(0, 300) })
          }
        }
        const store = await loadStore()
        const member = store.members.find((m) => m.id === text(body.memberId))
        let route
        if (member !== undefined && text(body.routeId).length > 0) {
          route = member.routes.find((r) => r.id === text(body.routeId))
          if (route === undefined) return json({ ok: false, error: '找不到该模型路由' }, 404)
        } else if (member !== undefined) {
          const candidates = candidateRoutes(member)
          route = candidates.length > 0 ? candidates[0] : normalizeRoute({ provider: '', model: '' }, 0)
        } else {
          route = normalizeRoute({ provider: text(body.provider), model: text(body.model), reasoningEffort: text(body.reasoningEffort) }, 0)
          if (route.provider.length === 0 && route.model.length === 0) return json({ ok: false, error: '缺少 memberId 或 provider/model' }, 400)
        }
        return json(await probeRoute(ctx, route))
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: DISPATCH_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readJson(request)
      if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
      const sessionId = text(body.sessionId)
      const memberId = text(body.memberId)
      const task = text(body.task)
      if (task.length === 0) return json({ ok: false, error: '缺少任务说明' }, 400)
      const store = await loadStore()
      const member = store.members.find((m) => m.id === memberId)
      if (member === undefined) return json({ ok: false, error: '找不到该成员' }, 404)
      const agents = ctx.get('agents')
      const parent = agents !== undefined && agents !== null && sessionId.length > 0 ? agents.get(sessionId) : undefined
      if (parent === undefined || parent === null) {
        return json({ ok: false, error: '会话 ' + sessionId + ' 当前没有活动的智能体，无法试跑' }, 409)
      }
      try {
        const result = await runAnyMember(ctx, parent, member, task, request.signal)
        return json({ ok: true, member: { id: member.id, name: member.name }, ...result })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: ROLES_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'POST') {
          const body = await readJson(request)
          if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
          const store = await loadStore()
          const created = await importRoles(store, body.ids, text(body.groupId), body.models, {
            asDepartment: body.asDepartment === true,
            name: text(body.departmentName)
          })
          if (created.length === 0) return json({ ok: false, error: '没有可导入的角色（id 不存在或已满员）' }, 400)
          await saveStore(store)
          return json({ ...(await snapshot()), created: created.map((member) => member.id) })
        }
        const url = new URL(request.url)
        const index = await loadRoleIndex()
        const result = await searchRoles(
          url.searchParams.get('q') || '',
          url.searchParams.get('category') || '',
          Number(url.searchParams.get('offset') || 0),
          Number(url.searchParams.get('limit') || 60)
        )
        return json({ ok: true, ...result, version: index.version, upstream: index.upstream, categories: index.categories })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: ROLE_BODY_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const id = new URL(request.url).searchParams.get('id') || ''
        const body = await loadRoleBody(id)
        return json({ ok: body.length > 0, id, body })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: PRESET_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') return json({ ok: true, presets: await listPresets() })
        const body = await readJson(request)
        if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
        const preset = await loadPreset(text(body.id))
        if (preset === null) return json({ ok: false, error: '找不到该预设' }, 404)
        const store = await loadStore()
        const added = await applyPresetToStore(store, preset, body.mode === 'replace' ? 'replace' : 'append')
        await saveStore(store)
        return json({ ...(await snapshot()), added })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: AVATAR_LIBRARY_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') {
          const items = await loadAvatarLibrary(harnessHome())
          return json({ ok: true, total: items.length, items: items.slice(0, 48) })
        }
        const body = await readJson(request)
        if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
        const action = text(body.action)

        if (action === 'import') {
          const input = Array.isArray(body.items) ? body.items : []
          const results = []
          for (const entry of input.slice(0, 50)) {
            const name = text(entry?.name).slice(0, 80)
            const decoded = decodeImageDataUrl(entry?.dataUrl)
            if (decoded === null) {
              results.push({ ok: false, name, error: '只支持 png/jpeg/webp，单张 ≤400 KB' })
              continue
            }
            const id = await saveAvatar(harnessHome(), decoded.bytes, decoded.ext)
            await addAvatarToLibrary(harnessHome(), id, name, decoded.bytes.length)
            results.push({ ok: true, id, name, bytes: decoded.bytes.length })
          }
          return json({ ok: true, results, items: (await loadAvatarLibrary(harnessHome())).slice(0, 48) })
        }

        if (action === 'delete') {
          const items = await removeAvatarFromLibrary(harnessHome(), text(body.id))
          return json({ ok: true, items: items.slice(0, 48) })
        }

        if (action === 'assign') {
          const id = text(body.id).replace(/[^a-f0-9]/g, '')
          const found = await readAvatar(harnessHome(), id)
          if (found === null) return json({ ok: false, error: '库里没有这张图' }, 404)
          const store = await loadStore()
          const member = store.members.find((entry) => entry.id === text(body.memberId))
          if (member === undefined) return json({ ok: false, error: '找不到该成员' }, 404)
          member.avatar = { kind: 'image', imageId: id }
          await saveStore(store)
          return json(await snapshot())
        }

        return json({ ok: false, error: '未知的 action' }, 400)
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: AVATAR_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') {
          const id = new URL(request.url).searchParams.get('id') || ''
          const found = await readAvatar(harnessHome(), id)
          if (found === null) return new Response('not found', { status: 404 })
          return new Response(found.bytes, {
            status: 200,
            headers: {
              'content-type': found.ext === 'jpg' ? 'image/jpeg' : 'image/' + found.ext,
              'cache-control': 'public, max-age=31536000, immutable'
            }
          })
        }
        const body = await readJson(request)
        if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
        const decoded = decodeImageDataUrl(body.dataUrl)
        if (decoded === null) return json({ ok: false, error: '头像必须是 png/jpeg/webp，且不超过 400 KB' }, 400)
        const id = await saveAvatar(harnessHome(), decoded.bytes, decoded.ext)
        await addAvatarToLibrary(harnessHome(), id, text(body.name), decoded.bytes.length)
        const store = await loadStore()
        const member = store.members.find((entry) => entry.id === text(body.memberId))
        if (member === undefined) return json({ ok: false, error: '找不到该成员' }, 404)
        member.avatar = { kind: 'image', imageId: id }
        await saveStore(store)
        return json(await snapshot())
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    // 宿主会话的 token / 缓存命中率：读 DSH 自己的 session projcache（只读）。
    path: ROUTE_BASE + '/session-stats',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const url = new URL(request.url, 'http://localhost')
        const sessionId = text(url.searchParams.get('sessionId'))
        if (sessionId.length === 0) return json({ ok: true, stats: null })
        const dir = join(harnessHome(), 'storages', 'session_projcache', 'sessions')
        let names = []
        try { names = await readdir(dir) } catch { return json({ ok: true, stats: null }) }
        const wanted = names.filter((name) => name.endsWith('.json') && (name === sessionId + '.json' || name === 'session-' + sessionId + '.json' || name.indexOf(sessionId) >= 0))
        if (wanted.length === 0) return json({ ok: true, stats: null })
        const raw = JSON.parse(await readFile(join(dir, wanted[0]), 'utf8'))
        const rows = raw?.record?.rows ?? {}
        const totals = rows?.tokenUsage?.val?.totals
        const sessionStats = rows?.sessionStats?.val
        if (totals === undefined || sessionStats === undefined) return json({ ok: true, stats: null })
        const uncached = Number(totals.uncachedInputTokens) || 0
        const cacheRead = Number(totals.cacheReadTokens) || 0
        const cacheWrite = Number(totals.cacheWriteTokens) || 0
        const output = Number(totals.outputTokens) || 0
        const input = uncached + cacheRead + cacheWrite
        const decodeMs = Number(sessionStats.decodeMs) || 0
        const decodeTokens = Number(sessionStats.decodeTokens) || 0
        return json({
          ok: true,
          stats: {
            turns: Number(sessionStats.turns) || 0,
            steps: Number(sessionStats.steps) || 0,
            inputTokens: input,
            outputTokens: output,
            totalTokens: input + output,
            cacheHitRate: input > 0 ? cacheRead / input : 0,
            tokPerSec: decodeMs > 0 ? (decodeTokens / (decodeMs / 1000)) : 0,
            llmMs: Number(sessionStats.llmMs) || 0,
            toolMs: Number(sessionStats.toolMs) || 0
          }
        })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: USAGE_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        const list = await readUsage()
        const today = new Date().toISOString().slice(0, 10)
        const models = new Map()
        const members = new Map()
        for (const entry of list) {
          const modelKey = String(entry.provider || '') + '::' + String(entry.model || '')
          const model = models.get(modelKey) || { provider: String(entry.provider || ''), model: String(entry.model || ''), total: 0, today: 0, ok: 0, ms: 0, lastAt: '' }
          model.total += 1
          model.ms += Number(entry.ms) || 0
          if (entry.ok === true) model.ok += 1
          const at = String(entry.at || '')
          if (at.slice(0, 10) === today) model.today += 1
          if (at > model.lastAt) model.lastAt = at
          models.set(modelKey, model)

          const memberKey = String(entry.memberId || '')
          const member = members.get(memberKey) || { memberId: memberKey, total: 0, today: 0, lastAt: '' }
          member.total += 1
          if (at.slice(0, 10) === today) member.today += 1
          if (at > member.lastAt) member.lastAt = at
          members.set(memberKey, member)
        }
        return json({ ok: true, models: [...models.values()], members: [...members.values()] })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: BALANCE_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const force = new URL(request.url).searchParams.get('force') === '1'
        return json({ ok: true, items: await readBalances(force) })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  // 本机 agent 平台：扫描 + 默认接入为 bot（对齐 OpenMausBot 的 bring-your-own-agents）。
  own(ctx.connection.fetch.register({
    path: PLATFORMS_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const mod = await import('./platforms.js')
        if (request.method === 'POST') {
          const body = await readJson(request)
          const result = await mod.importPlatforms({ ids: Array.isArray(body?.ids) ? body.ids : undefined })
          return json({ ok: true, ...result })
        }
        const url = new URL(request.url)
        const auto = url.searchParams.get('auto') === '1'
        if (url.searchParams.get('profiles') === '1') {
          const platforms = await mod.scanPlatforms()
          const profiles = {}
          for (const platform of platforms) profiles[platform.id] = await mod.platformProfile(platform.id)
          return json({ ok: true, platforms, profiles })
        }
        if (auto) {
          const result = await mod.importPlatforms({})
          return json({ ok: true, auto: true, ...result })
        }
        return json({ ok: true, platforms: await mod.scanPlatforms() })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: BALANCE_KEY_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = await readJson(request)
        if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
        await writeKey(text(body.id), text(body.key))
        return json({ ok: true, items: await readBalances(true) })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 400)
      }
    }
  }))

  for (const dispose of registerTools(ctx)) own(dispose)

  // 关键词触发规则：注册为 system prompt 的一个 section（全局作用域）。
  const trigger = { ...TRIGGER_DEFAULTS, ...(config !== null && typeof config === 'object' && config.triggers !== null && typeof config.triggers === 'object' ? config.triggers : {}) }
  const configureTrigger = (promptCtx) => {
    const systemPrompt = promptCtx.get('systemPrompt')
    const register = systemPrompt === undefined || systemPrompt === null
      ? undefined
      : typeof systemPrompt.section === 'function' ? systemPrompt.section.bind(systemPrompt) : undefined
    if (register === undefined) {
      console.warn('[team-workbench] systemPrompt 服务不可用，关键词触发未启用')
      return
    }
    if (trigger.enabled !== true) return
    const keywords = (Array.isArray(trigger.keywords) ? trigger.keywords : TRIGGER_DEFAULTS.keywords)
      .map((k) => String(k).trim()).filter((k) => k.length > 0)
    if (keywords.length === 0) return
    const quoted = keywords.map((k) => '「' + k + '」').join('、')
    const target = typeof trigger.member === 'string' && trigger.member.trim().length > 0
      ? '调用 agent_team_dispatch，把 name 设为「' + trigger.member.trim() + '」'
      : '先调用 agent_team_roster 查看名册，再调用 agent_team_dispatch，按 role 把任务派发给最合适的成员'
    const text = [
      '## 智能体团队触发规则',
      '',
      '当用户的消息中出现 ' + quoted + ' 时，你**必须**先完成一次团队派发，再组织最终回答：',
      '1. ' + target + '；task 用一句完整描述概括用户要什么。',
      '2. 把该成员的结论纳入回答，并注明来源成员（例如「分析师：…」）。',
      '3. 只有派发确实报错时才可跳过，并说明失败原因。',
      '',
      '不要假装配发：没有真正调用工具，就不要声称团队已经介入。'
    ].join('\n')
    const order = typeof systemPrompt.getSectionOrder === 'function' ? 900 : 900
    own(register({ name: 'agent-team:keyword-trigger', order, text }))
    console.warn('[team-workbench] 关键词触发规则已注册：' + quoted)
  }
  if (typeof ctx.inject === 'function') ctx.inject(['systemPrompt'], configureTrigger)
  else {
    const direct = ctx.get('systemPrompt')
    if (direct !== undefined && direct !== null) configureTrigger(ctx)
  }
  console.warn('[team-workbench] 已挂载 v' + PLUGIN_VERSION + '；团队配置：' + storePath())

  // 返回统一释放函数：cordis 会把它当作 effect 的清理回调，dsh/index.js 也用它
  // 组合两个半体。release() 自身幂等，被调用两次没有副作用。
  // （旧插件没有返回它——那时只靠 ctx.effect 兜底；组合场景下必须显式返回，
  //   否则外层释放不到本半体的路由与工具。）
  // 默认接入：插件启动后扫描本机 agent 平台，自动变成 bot（已接入的会跳过）。
  const autoTimer = setTimeout(() => {
    import('./platforms.js').then((mod) => mod.importPlatforms({})).catch(() => undefined)
  }, 1500)
  if (typeof autoTimer.unref === 'function') autoTimer.unref()

  return () => {
    clearTimeout(autoTimer)
    return handle.release()
  }
}
