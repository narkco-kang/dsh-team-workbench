/**
 * 工单 / 授权 / 评估 / 策略（对齐 dsh-superagent 的 Ticket、Mandate、Eval、Policy）
 *
 * 聊天域里的映射：
 *   Thread      = 一个会话（群聊 id 或私聊成员 id）
 *   Ticket      = 用户这一条消息代表的一件活
 *   Mandate     = 用户消息本身给出的授权（谁发起、范围、策略版本）
 *   Eval        = 开工前的判断（拒绝/停止/受理）
 *   Assignment  = 某成员在这次工单里的一次执行
 *   Policy      = 版本化规则（允许的会话、最大回合、是否允许跨群）
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { harnessHome, makeId, text } from './team.js'

function dir() {
  return join(harnessHome(), 'team-workbench')
}

function ticketsPath() {
  return join(dir(), 'tickets.json')
}

function policyPath() {
  return join(dir(), 'policy.json')
}

const DEFAULT_POLICY = {
  version: 1,
  // 空数组 = 不限制
  allowThreads: [],
  maxTicketsPerThread: 200,
  // 关掉后所有工单都会被 Eval 拒绝（演练用）
  enabled: true,
  updatedAt: ''
}

export async function loadPolicy() {
  try {
    const raw = await readFile(policyPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') return { ...DEFAULT_POLICY, ...parsed }
  } catch { /* 首次运行 */ }
  return { ...DEFAULT_POLICY }
}

export async function savePolicy(patch) {
  const current = await loadPolicy()
  const next = {
    ...current,
    ...patch,
    version: Number(current.version || 1) + 1,
    updatedAt: new Date().toISOString()
  }
  await mkdir(dir(), { recursive: true })
  await writeFile(policyPath(), JSON.stringify(next, null, 2), 'utf8')
  // 策略变更送达活着的工单：不撤销 Mandate，只让执行方知道规则变了。
  const list = await loadTickets()
  let touched = 0
  for (const ticket of list) {
    if (ticket.status !== 'open') continue
    ticket.policyNotice = next.version
    touched += 1
  }
  if (touched > 0) await saveTickets(list)
  return next
}

export async function loadTickets() {
  try {
    const raw = await readFile(ticketsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveTickets(list) {
  await mkdir(dir(), { recursive: true })
  const keep = list.slice(-800)
  await writeFile(ticketsPath(), JSON.stringify(keep, null, 2), 'utf8')
  return keep
}

/** 开工前的评估：停止词、策略禁用、会话不在白名单。 */
export async function evaluate(input) {
  const policy = await loadPolicy()
  const body = text(input.text).trim()
  if (policy.enabled === false) return { verdict: 'unavailable', reason: '策略已停用工单' }
  if (/^(停止|取消|别做了|stop)(?:$|[\s，。!！、])/i.test(body)) return { verdict: 'stop', reason: '用户要求停止' }
  const allowed = Array.isArray(policy.allowThreads) ? policy.allowThreads : []
  if (allowed.length > 0 && !allowed.includes(String(input.threadId))) {
    return { verdict: 'ignore', reason: '该会话不在策略白名单内' }
  }
  return { verdict: 'accept', reason: '' }
}

/**
 * 受理：先做幂等与续单。
 * - 同一个 clientMessageId 重复到达 → 同一张工单（Trigger 幂等）；
 * - 该 Thread 还有 open 工单 → 消息并入（幂等 attach）；
 * - 该 Thread 的工单已结束且不是用户叫停 → 用同一 Mandate 恢复（不重新评估）；
 * - 否则新开一张。
 */
export async function openTicket(input) {
  const policy = await loadPolicy()
  const list = await loadTickets()
  const clientMessageId = text(input.clientMessageId)
  if (clientMessageId.length > 0) {
    const seen = list.find((entry) => entry.clientMessageId === clientMessageId)
    if (seen !== undefined) return { ticket: seen, duplicate: true, resumed: false, attached: false }
  }
  const sameThread = list.filter((entry) => entry.threadKind === (input.threadKind === 'private' ? 'private' : 'group') && entry.threadId === text(input.threadId))
  const openOne = sameThread.filter((entry) => entry.status === 'open').slice(-1)[0]
  if (openOne !== undefined) {
    openOne.inputs = Array.isArray(openOne.inputs) ? openOne.inputs : []
    openOne.inputs.push({ at: new Date().toISOString(), text: text(input.text).slice(0, 2000), actor: text(input.actor) || 'user' })
    await saveTickets(list)
    return { ticket: openOne, duplicate: false, resumed: false, attached: true }
  }
  const endedOne = sameThread.filter((entry) => entry.status === 'ended' && entry.stoppedByPerson !== true).slice(-1)[0]
  if (endedOne !== undefined) {
    endedOne.status = 'open'
    endedOne.endedAt = ''
    endedOne.report = ''
    endedOne.inputs = Array.isArray(endedOne.inputs) ? endedOne.inputs : []
    endedOne.inputs.push({ at: new Date().toISOString(), text: text(input.text).slice(0, 2000), actor: text(input.actor) || 'user' })
    endedOne.resumedAt = new Date().toISOString()
    await saveTickets(list)
    return { ticket: endedOne, duplicate: false, resumed: true, attached: false }
  }
  const ticket = {
    id: makeId('tkt'),
    threadKind: input.threadKind === 'private' ? 'private' : 'group',
    threadId: text(input.threadId),
    actor: text(input.actor) || 'user',
    text: text(input.text).slice(0, 2000),
    status: 'open',
    mandate: {
      policyVersion: policy.version,
      scope: input.threadKind === 'private' ? 'member' : 'thread',
      strength: 'normal',
      at: new Date().toISOString()
    },
    assignments: [],
    inputs: [{ at: new Date().toISOString(), text: text(input.text).slice(0, 2000), actor: text(input.actor) || 'user' }],
    subscriptions: Array.isArray(input.subscriptions) ? input.subscriptions : [],
    clientMessageId,
    stoppedByPerson: false,
    policyNotice: 0,
    report: '',
    createdAt: new Date().toISOString(),
    endedAt: ''
  }
  list.push(ticket)
  await saveTickets(list)
  return { ticket, duplicate: false, resumed: false, attached: false }
}

/** 重启恢复：running 的执行标记为 interrupted，等下一次消息续上。 */
export async function markInterrupted() {
  const list = await loadTickets()
  let count = 0
  for (const ticket of list) {
    for (const assignment of ticket.assignments) {
      if (assignment.status !== 'running') continue
      assignment.status = 'interrupted'
      assignment.endedAt = new Date().toISOString()
      assignment.note = '进程重启时中断'
      count += 1
    }
  }
  if (count > 0) await saveTickets(list)
  return count
}

export async function addAssignment(ticketId, memberId, label) {
  const list = await loadTickets()
  const ticket = list.find((entry) => entry.id === ticketId)
  if (ticket === undefined) return ''
  const id = makeId('asg')
  ticket.assignments.push({ id, memberId: text(memberId), label: text(label), status: 'running', startedAt: new Date().toISOString(), endedAt: '', ok: null, ms: 0 })
  await saveTickets(list)
  return id
}

export async function finishAssignment(assignmentId, patch) {
  const list = await loadTickets()
  for (const ticket of list) {
    const found = ticket.assignments.find((entry) => entry.id === assignmentId)
    if (found === undefined) continue
    Object.assign(found, patch, { status: 'ended', endedAt: new Date().toISOString() })
    await saveTickets(list)
    return true
  }
  return false
}

export async function endTicket(ticketId, report) {
  const list = await loadTickets()
  const ticket = list.find((entry) => entry.id === ticketId)
  if (ticket === undefined) return undefined
  ticket.status = 'ended'
  ticket.report = text(report).slice(0, 4000)
  ticket.endedAt = new Date().toISOString()
  await saveTickets(list)
  return ticket
}

/** 停止该会话下所有未结束的工单（用户发「停止」时用）。 */
export async function stopThread(threadKind, threadId) {
  const list = await loadTickets()
  let count = 0
  for (const ticket of list) {
    if (ticket.status !== 'open') continue
    if (ticket.threadKind !== threadKind || ticket.threadId !== String(threadId)) continue
    ticket.status = 'ended'
    ticket.report = '用户要求停止'
    ticket.stoppedByPerson = true
    ticket.endedAt = new Date().toISOString()
    count += 1
  }
  if (count > 0) await saveTickets(list)
  return count
}


// ── 审计面（补齐 superagent 的 Decision / Outbox / Thread 读位点 / Source）─────────

function decisionsPath() {
  return join(dir(), 'decisions.json')
}

function outboxPath() {
  return join(dir(), 'outbox.json')
}

function threadsPath() {
  return join(dir(), 'threads.json')
}

function sourcesPath() {
  return join(dir(), 'sources.json')
}

async function appendJson(file, entry, limit) {
  let list = []
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (Array.isArray(parsed)) list = parsed
  } catch { /* 首次 */ }
  list.push(entry)
  await mkdir(dir(), { recursive: true })
  await writeFile(file, JSON.stringify(list.slice(-(limit || 500)), null, 2), 'utf8')
  return entry
}

async function readJson(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 每次 Eval 的判定都留档：ignore / unavailable / stop / accept。 */
export async function recordDecision(input) {
  const policy = await loadPolicy()
  return appendJson(decisionsPath(), {
    id: makeId('dec'),
    at: new Date().toISOString(),
    threadKind: input.threadKind,
    threadId: String(input.threadId),
    verdict: text(input.verdict),
    reason: text(input.reason),
    text: text(input.text).slice(0, 500),
    policyVersion: policy.version,
    sourceKind: text(input.sourceKind) || 'chat.web'
  })
}

export async function loadDecisions(limit) {
  return (await readJson(decisionsPath())).slice(-(Number(limit) || 100)).reverse()
}

/** 回复送达记录：channel 是写回目标，status 是 delivered / failed。 */
export async function recordOutbox(input) {
  return appendJson(outboxPath(), {
    id: makeId('out'),
    at: new Date().toISOString(),
    ticketId: text(input.ticketId),
    channelKind: input.channelKind === 'private' ? 'private' : 'group',
    channelId: String(input.channelId),
    status: text(input.status) || 'delivered',
    error: text(input.error),
    preview: text(input.text).slice(0, 300)
  })
}

export async function loadOutbox(limit) {
  return (await readJson(outboxPath())).slice(-(Number(limit) || 100)).reverse()
}

/**
 * Thread 读位点：记录每个会话已经处理到的工单与时间。
 * 重启后据此判断「哪些消息已经处理过」，不重放。
 */
export async function markThreadSeen(threadKind, threadId, ticketId) {
  let map = {}
  try {
    const parsed = JSON.parse(await readFile(threadsPath(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) map = parsed
  } catch { /* 首次 */ }
  const key = (threadKind === 'private' ? 'private:' : 'group:') + String(threadId)
  map[key] = { lastTicketId: text(ticketId), lastAt: new Date().toISOString() }
  await mkdir(dir(), { recursive: true })
  await writeFile(threadsPath(), JSON.stringify(map, null, 2), 'utf8')
  return map[key]
}

export async function loadThreads() {
  try {
    const parsed = JSON.parse(await readFile(threadsPath(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 来源计数：chat.web（页面）、schedule.cron（定时任务）、agent.tool（工具派发）。 */
export async function recordSource(kind) {
  let map = {}
  try {
    const parsed = JSON.parse(await readFile(sourcesPath(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) map = parsed
  } catch { /* 首次 */ }
  const key = text(kind) || 'chat.web'
  const row = map[key] || { count: 0, firstAt: new Date().toISOString(), lastAt: '' }
  row.count += 1
  row.lastAt = new Date().toISOString()
  map[key] = row
  await mkdir(dir(), { recursive: true })
  await writeFile(sourcesPath(), JSON.stringify(map, null, 2), 'utf8')
  return row
}

export async function loadSources() {
  try {
    const parsed = JSON.parse(await readFile(sourcesPath(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function listTickets(threadKind, threadId, limit) {
  const list = await loadTickets()
  const filtered = list.filter((ticket) => (threadKind === undefined || ticket.threadKind === threadKind) && (threadId === undefined || ticket.threadId === String(threadId)))
  return filtered.slice(-(Number(limit) || 30)).reverse()
}
