/**
 * dsh-team-workbench / 会话（私聊 + 群聊）
 *
 * 每个成员一个私聊，多个成员一个群聊；消息落在
 *   $DSH_HOME/team-workbench/chats.json
 *
 * 会话记忆用「最近 N 条记录 + 新消息」的方式续聊：宿主 0.13.2 的 subagents
 * 只提供一次性激活，没有稳定的「向同一个子会话追加消息」接口，所以每次回复
 * 都带上一段有界的历史窗口，效果上是连续对话，且不依赖未公开 API。
 *
 * 群聊：用户消息默认交给管理员；管理员回复里 @成员 会被解析，被 @ 的成员各跑一轮，
 * 成员回复里的 @ 再转发一层（最多两层、每条消息最多 5 个智能体回合）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ROUTE_BASE,
  dispatchToMember,
  harnessHome,
  json,
  loadStore,
  makeId,
  readJson,
  text
} from './team.js'
import {
  addAtom,
  addPersona,
  compactIfNeeded,
  embedTexts,
  loadMemory,
  loadSettings,
  memoryBlock,
  memoryStats,
  removeAtom,
  removePersona,
  saveMemory,
  saveSettings,
  searchMemoryHybrid,
  slotOf
} from './memory.js'
import { loadSttSettings, probeStt, saveSttSettings, transcribe } from './stt.js'

const CHATS_ROUTE = ROUTE_BASE + '/chats'
const PRIVATE_ROUTE = ROUTE_BASE + '/chats/private'
const GROUP_ROUTE = ROUTE_BASE + '/chats/group'
const ROOMS_ROUTE = ROUTE_BASE + '/chats/rooms'
const SEARCH_ROUTE = ROUTE_BASE + '/chats/search'
const MEMORY_ROUTE = ROUTE_BASE + '/memory'
const STT_ROUTE = ROUTE_BASE + '/stt'
/** 总管台：用户与总管对接的固定会话；总管再 @ 成员把任务派下去。 */
const CHIEF_ROOM_ID = 'chief-desk'
const CHIEF_ROOM_NAME = '总管 · 用户对接'

/** 让总管台与会话数据保持一致；返回是否需要写回。 */
function ensureChiefRoom(chats, store) {
  const chiefId = text(store.chiefId)
  if (chiefId.length === 0 || !store.members.some((m) => m.id === chiefId)) return false
  const memberIds = store.members.filter((m) => m.enabled !== false).map((m) => m.id)
  if (!memberIds.includes(chiefId)) memberIds.unshift(chiefId)
  let room = chats.rooms.find((entry) => entry.id === CHIEF_ROOM_ID)
  if (room === undefined) {
    chats.rooms.unshift({
      id: CHIEF_ROOM_ID,
      name: CHIEF_ROOM_NAME,
      adminId: chiefId,
      memberIds,
      responder: 'lead',
      relayDepth: 2,
      createdAt: new Date().toISOString(),
      updatedAt: '',
      messages: []
    })
    return true
  }
  let changed = false
  if (room.adminId !== chiefId) { room.adminId = chiefId; changed = true }
  if (room.name !== CHIEF_ROOM_NAME) { room.name = CHIEF_ROOM_NAME; changed = true }
  if (room.responder !== 'lead') { room.responder = 'lead'; changed = true }
  if (room.relayDepth !== 2) { room.relayDepth = 2; changed = true }
  if (room.memberIds.length !== memberIds.length || room.memberIds.some((id, index) => id !== memberIds[index])) {
    room.memberIds = memberIds
    changed = true
  }
  return changed
}

const CHAT_VERSION = 1
const MAX_MESSAGES = 200
const HISTORY_WINDOW = 12
const MAX_TURNS_PER_MESSAGE = 5
const MAX_MENTIONS = 3
const MAX_ROOMS = 24

/** 聊天记录文件。 */
function chatsPath() {
  return join(harnessHome(), 'team-workbench', 'chats.json')
}

function emptyChats() {
  return { version: CHAT_VERSION, private: {}, rooms: [] }
}

async function loadChats() {
  try {
    const parsed = JSON.parse(await readFile(chatsPath(), 'utf8'))
    const priv = parsed !== null && typeof parsed.private === 'object' && parsed.private !== null ? parsed.private : {}
    const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms : []
    return {
      version: CHAT_VERSION,
      private: priv,
      rooms: rooms.filter((room) => room !== null && typeof room === 'object' && typeof room.id === 'string')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[team-workbench] 读取聊天记录失败：' + String(error))
    return emptyChats()
  }
}

async function saveChats(chats) {
  const target = chatsPath()
  await mkdir(dirname(target), { recursive: true })
  const payload = JSON.stringify({ version: CHAT_VERSION, private: chats.private, rooms: chats.rooms }, null, 1)
  const temp = target + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(temp, payload, 'utf8')
  await rename(temp, target)
}

function messageOf(role, member, body, extra) {
  return {
    id: makeId('msg'),
    role,
    memberId: member !== null && member !== undefined ? member.id : '',
    name: member !== null && member !== undefined ? member.name : '用户',
    emoji: member !== null && member !== undefined ? member.emoji : '🧑',
    color: member !== null && member !== undefined ? member.color : '',
    text: body,
    time: new Date().toISOString(),
    ...(extra !== undefined ? extra : {})
  }
}

function pushMessage(list, message) {
  list.push(message)
  if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES)
}

/** 组装最近的聊天记录。 */
function transcript(messages, selfName) {
  const recent = messages.slice(-HISTORY_WINDOW)
  if (recent.length === 0) return '（还没有聊天记录）'
  return recent.map((m) => (m.role === 'user' ? '用户：' : (m.name || selfName) + '：') + m.text).join('\n')
}

/**
 * 聊天里只补一行「身份锚点」（名字 + 职责）。
 * 完整工作要求已经由 runOnRoute 通过 persona 字段传给子智能体，这里再贴一遍是重复计费；
 * 但有的路由（实测 mg/qwen3.8-max）会忽略 persona 字段，用提示词里的一行身份把它拉回来。
 */
function personaOf(member) {
  const role = text(member.role).trim()
  return '你的身份：「' + member.name + '」' + (role.length > 0 ? '，职责是：' + role + '。' : '。') +
    '按这个职责回答，不要自称通用助手。'
}

/**
 * 去掉子智能体式的内部回执：有的路由会把提示词当「任务」，回一句
 * 「已回复用户并同步给父智能体」或结尾加「（已同步给主智能体。）」，那不是给用户看的内容。
 */
export function stripReceipts(value) {
  let out = text(value)
  out = out.replace(/^\s*已(?:回复用户|同步|完成|处理)[^\n。]{0,30}[。\.]\s*/u, '')
  out = out.replace(/[（(]\s*已(?:同步|回复|通知)[^）)]{0,40}[）)]\s*$/u, '')
  out = out.replace(/^\s*[（(]\s*已(?:同步|回复|通知)[^）)]{0,40}[）)]\s*/u, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export function privatePrompt(member, messages, userText, memoryText) {
  return [
    '【私聊】你在和用户一对一对话。',
    personaOf(member),
    memoryText.length > 0 ? '' : null,
    memoryText.length > 0 ? memoryText : null,
    '',
    '最近的聊天记录：',
    transcript(messages, member.name),
    '',
    '用户的新消息：',
    userText,
    '',
    '请直接回复用户；保持你自己的角色与职责，不要代替其他成员发言。',
    '只输出给用户看的内容：不要写「已回复用户」「已同步给父智能体」这类内部回执。'
  ].join('\n')
}

function groupRoster(room, members) {
  const alive = members.filter((m) => room.memberIds.includes(m.id))
  const admin = alive.find((m) => m.id === room.adminId) || alive[0]
  return { alive, admin }
}

function groupPreamble(room, members) {
  const { alive, admin } = groupRoster(room, members)
  return {
    alive,
    admin,
    lines: [
      '【群聊 · ' + room.name + '】',
      '成员：' + alive.map((m) => m.name).join('、') + '；管理员：' + (admin ? admin.name : '（无）')
    ]
  }
}

export function adminPrompt(room, members, messages, userText, memoryText) {
  const info = groupPreamble(room, members)
  return [
    ...info.lines,
    info.admin ? personaOf(info.admin) : null,
    memoryText.length > 0 ? '' : null,
    memoryText.length > 0 ? memoryText : null,
    '',
    '最近的群聊记录：',
    transcript(messages, '成员'),
    '',
    '用户的新消息：',
    userText,
    '',
    '你是本群管理员：先给出你负责的回复。需要其他成员协作时，在回复里用 @成员名 指派',
    '（一条消息最多 @' + String(MAX_MENTIONS) + ' 人），不要替他们回答。回复要简洁。'
  ].join('\n')
}

export function memberPrompt(room, member, members, messages, userText, asker, memoryText) {
  const info = groupPreamble(room, members)
  return [
    ...info.lines,
    personaOf(member),
    memoryText.length > 0 ? '' : null,
    memoryText.length > 0 ? memoryText : null,
    '',
    '最近的群聊记录：',
    transcript(messages, '成员'),
    '',
    (asker ? asker + ' @ 了你。' : '用户 @ 了你。') + '本轮消息：',
    userText,
    '',
    '你是成员「' + member.name + '」：只回答你这部分，结论要具体。需要别人接手时可以用 @成员名。'
  ].join('\n')
}

/** 一棒结束后的「一句结论」：去掉 markdown 与回执，取第一句有内容的，最多 60 字。 */
export function summaryOf(value) {
  const cleaned = stripReceipts(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_~`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length === 0) return ''
  const parts = cleaned.split(/[。！？!?；]/).filter((part) => part.trim().length > 0)
  const first = (parts[0] || cleaned).trim()
  return first.length > 60 ? first.slice(0, 60) + '…' : first
}

/** 从一段回复里解析 @成员名。 */
function parseMentions(body, members, exclude) {
  const skip = new Set(exclude)
  const found = []
  const sorted = members.slice().sort((a, b) => b.name.length - a.name.length)
  for (const member of sorted) {
    if (skip.has(member.id)) continue
    if (body.includes('@' + member.name)) found.push(member)
  }
  return found
}

async function parentOf(ctx, sessionId) {
  const agents = ctx.get('agents')
  if (agents === undefined || agents === null || sessionId.length === 0) return undefined
  try {
    return agents.get(sessionId)
  } catch {
    return undefined
  }
}

async function runMember(ctx, parent, member, prompt, signal) {
  const result = await dispatchToMember(ctx, parent, member, prompt, signal)
  return { text: text(result.output), stopReason: result.stopReason, detail: result.detail, provider: result.provider, model: result.model }
}

/** 私聊：发送一条消息并等待回复。 */
export async function sendPrivate(ctx, parent, member, userText, signal) {
  const chats = await loadChats()
  const key = member.id
  if (chats.private[key] === undefined) chats.private[key] = { messages: [], updatedAt: 0 }
  const thread = chats.private[key]
  pushMessage(thread.messages, messageOf('user', null, userText))
  thread.progress = { startedAt: new Date().toISOString(), current: member.name, steps: [{ name: member.name, startedAt: new Date().toISOString(), phase: 'thinking', ms: 0 }], finishedAt: '' }
  await saveChats(chats)
  const memory = await loadMemory()
  const slot = slotOf(memory, 'private', member.id)
  const memoryText = await memoryBlock(slot, memory.persona, userText)
  const raw = await runMember(ctx, parent, member, privatePrompt(member, thread.messages.slice(0, -1), userText, memoryText), signal)
  const reply = { ...raw, text: stripReceipts(raw.text) }
  const step = thread.progress.steps[0]
  step.phase = 'done'
  step.ms = Date.now() - Date.parse(step.startedAt)
  step.summary = summaryOf(reply.text)
  step.emoji = member.emoji
  thread.progress.current = ''
  thread.progress.finishedAt = new Date().toISOString()
  if (reply.text.trim().length > 0) pushMessage(thread.messages, messageOf('agent', member, reply.text, { stopReason: reply.stopReason }))
  thread.updatedAt = new Date().toISOString()
  await saveChats(chats)
  void compactIfNeeded(ctx, parent, 'private', member.id, thread.messages, member, member.name, signal)
    .catch((error) => console.warn('[team-workbench] 私聊记忆压缩失败：' + String(error)))
  return { messages: thread.messages, reply }
}

/** 应答模式：lead = 管理员先答，auto = 按内容挑最合适的人，mention = 只回应 @。 */
const RESPONDERS = ['lead', 'auto', 'mention']

function responderOf(room) {
  return RESPONDERS.includes(room.responder) ? room.responder : 'lead'
}

function relayDepthOf(room) {
  const value = Number(room.relayDepth)
  return Number.isSafeInteger(value) && value >= 0 && value <= 2 ? value : 1
}

/**
 * 本地「决策模型」：按消息与成员名字/职责的字符二元组重合度挑人。
 * 借用 OpenMausBot 的 Auto 思路，但不依赖外部分类服务；分数低于 2 时回退给管理员。
 */
function pickAutoResponder(userText, members, exclude) {
  const lower = userText.toLowerCase()
  let best = null
  let bestScore = 0
  for (const member of members) {
    if (exclude.has(member.id)) continue
    const hay = (member.name + ' ' + member.role).toLowerCase()
    const grams = new Set()
    for (let i = 0; i < hay.length - 1; i += 1) {
      const gram = hay.slice(i, i + 2)
      if (gram.trim().length === 2) grams.add(gram)
    }
    let score = 0
    for (let i = 0; i < lower.length - 1; i += 1) if (grams.has(lower.slice(i, i + 2))) score += 1
    if (userText.includes(member.name)) score += 6
    if (score > bestScore) { best = member; bestScore = score }
  }
  return bestScore >= 2 ? best : null
}

/**
 * 并发上限：显式设置优先（1-5）；没设就按成员数自动取 3-5。
 * 2-6 人 → 3，7-8 人 → 4，9 人以上 → 5。
 */
export function resolveMaxParallel(room, memberCount) {
  const configured = Number(room?.maxParallel)
  if (Number.isSafeInteger(configured) && configured >= 1 && configured <= 5) return configured
  return Math.max(3, Math.min(5, Math.ceil(Math.max(1, memberCount) / 2)))
}

/** 群聊：按应答模式选人，管理员可 @ 指派，成员之间按接力层数继续。 */
export async function sendGroup(ctx, parent, room, members, userText, signal) {
  const chats = await loadChats()
  const target = chats.rooms.find((entry) => entry.id === room.id)
  if (target === undefined) throw new Error('找不到该群聊')
  if (!Array.isArray(target.messages)) target.messages = []
  const { alive, admin } = groupRoster(target, members)
  if (alive.length === 0) throw new Error('群聊里没有有效成员')
  const memory = await loadMemory()
  pushMessage(target.messages, messageOf('user', null, userText))
  // 过程化状态：前端轮询 progress，看到「现在轮到谁」和已经跑完的每一棒。
  target.progress = { startedAt: new Date().toISOString(), current: '', parallel: [], queued: [], steps: [], finishedAt: '' }
  await saveChats(chats)

  const responder = responderOf(target)
  const relayDepth = relayDepthOf(target)
  const used = new Set()
  const turns = []
  const asked = parseMentions(userText, alive, [])

  let start = []
  let pickedId = ''
  if (asked.length > 0) {
    start = asked.slice(0, MAX_MENTIONS)
  } else if (responder === 'mention') {
    start = []
  } else if (responder === 'auto') {
    const picked = pickAutoResponder(userText, alive, used)
    pickedId = picked ? picked.id : (admin ? admin.id : '')
    start = picked ? [picked] : (admin ? [admin] : [])
  } else {
    start = admin ? [admin] : []
  }

  if (start.length === 0) return { messages: target.messages, turns, responder, pickedId }

  // 参考 dsh-superagent 的「worker slot + 并发启动」：同一层的成员各自一个子会话并行跑，
  // 用并发上限（默认 3）控制 slot；管理员那一棒仍然先跑，因为要由它决定派给谁。
  const parallelOn = target.parallel !== false
  const maxParallel = resolveMaxParallel(target, alive.length)
  if (!Array.isArray(target.progress.parallel)) target.progress.parallel = []
  // 并发完成时各自都会改 chats，统一串行落盘，避免互相覆盖。
  let saveChain = Promise.resolve()
  const persist = () => {
    saveChain = saveChain.then(() => saveChats(chats)).catch(() => undefined)
    return saveChain
  }

  const runTurn = async (member, depth, lastSpeaker) => {
    const memoryText = await memoryBlock(slotOf(memory, 'room', target.id), memory.persona, userText)
    const prompt = depth === 0 && admin !== undefined && member.id === admin.id
      ? adminPrompt(target, alive, target.messages.slice(0, -1), userText, memoryText)
      : memberPrompt(target, member, alive, target.messages.slice(0, -1), userText, lastSpeaker, memoryText)
    const step = { name: member.name, startedAt: new Date().toISOString(), phase: 'thinking', ms: 0, emoji: member.emoji }
    target.progress.steps.push(step)
    if (target.progress.parallel.length < 2) target.progress.current = member.name
    else target.progress.current = ''
    await persist()
    const raw = await runMember(ctx, parent, member, prompt, signal)
    const reply = { ...raw, text: stripReceipts(raw.text) }
    step.phase = 'done'
    step.ms = Date.now() - Date.parse(step.startedAt)
    step.summary = summaryOf(reply.text)
    target.progress.parallel = target.progress.parallel.filter((name) => name !== member.name)
    target.progress.current = target.progress.parallel[0] || ''
    await persist()
    return { member, reply, step }
  }

  const runBatch = async (batch, depth, lastSpeaker) => {
    const results = new Array(batch.length)
    let cursor = 0
    // 超出并发的成员进队列，状态条显示「排队 N 位」。
    target.progress.queued = batch.map((member) => member.name)
    const lane = async () => {
      while (cursor < batch.length) {
        const index = cursor
        cursor += 1
        const member = batch[index]
        target.progress.queued = target.progress.queued.filter((name) => name !== member.name)
        target.progress.parallel = target.progress.parallel.concat(member.name)
        await persist()
        results[index] = await runTurn(member, depth, lastSpeaker)
      }
    }
    const lanes = Math.min(parallelOn ? maxParallel : 1, batch.length)
    await Promise.all(Array.from({ length: lanes }, lane))
    target.progress.queued = []
    return results.filter((entry) => entry !== undefined)
  }

  let queue = start
  let depth = 0
  let lastSpeaker = ''

  while (queue.length > 0 && turns.length < MAX_TURNS_PER_MESSAGE && depth <= relayDepth) {
    const room = MAX_TURNS_PER_MESSAGE - turns.length
    const batch = queue.filter((member) => !used.has(member.id)).slice(0, room)
    if (batch.length === 0) break
    for (const member of batch) used.add(member.id)
    await persist()
    const results = await runBatch(batch, depth, lastSpeaker)
    target.progress.parallel = []
    const next = []
    for (const { member, reply } of results) {
      turns.push({ memberId: member.id, name: member.name, emoji: member.emoji, text: reply.text, stopReason: reply.stopReason })
      if (reply.text.trim().length > 0) pushMessage(target.messages, messageOf('agent', member, reply.text, { stopReason: reply.stopReason }))
      lastSpeaker = member.name
      for (const mentioned of parseMentions(reply.text, alive, used)) {
        if (next.length >= MAX_MENTIONS) break
        next.push(mentioned)
      }
    }
    target.updatedAt = new Date().toISOString()
    await persist()
    queue = next
    depth += 1
  }
  target.progress.current = ''
  target.progress.finishedAt = new Date().toISOString()
  await saveChats(chats)
  void compactIfNeeded(ctx, parent, 'room', target.id, target.messages, admin, target.name, signal)
    .catch((error) => console.warn('[team-workbench] 群聊记忆压缩失败：' + String(error)))
  return { messages: target.messages, turns, responder, pickedId }
}

/** 聊天记录检索：按关键词搜私聊与群聊，可按会话过滤。 */
export async function searchMessages(query, kind, scopeId, limit) {
  const needle = String(query || '').trim().toLowerCase()
  if (needle.length === 0) return { total: 0, hits: [] }
  const chats = await loadChats()
  const store = await loadStore()
  const memberById = new Map(store.members.map((member) => [member.id, member]))
  const hits = []
  const scan = (messages, chatKind, conversationId, conversationName) => {
    for (const message of Array.isArray(messages) ? messages : []) {
      if (typeof message.text !== 'string' || message.text.length === 0) continue
      if (!message.text.toLowerCase().includes(needle)) continue
      hits.push({
        id: message.id,
        kind: chatKind,
        conversationId,
        conversationName,
        role: message.role,
        memberId: message.memberId || '',
        memberName: message.name || (message.role === 'user' ? '用户' : ''),
        text: message.text,
        time: message.time || ''
      })
    }
  }
  for (const [memberId, thread] of Object.entries(chats.private)) {
    const member = memberById.get(memberId)
    if (member === undefined) continue
    if (kind === 'group') continue
    if (scopeId.length > 0 && scopeId !== memberId) continue
    scan(thread.messages, 'private', memberId, member.name)
  }
  for (const room of chats.rooms) {
    if (kind === 'private') continue
    if (scopeId.length > 0 && scopeId !== room.id) continue
    scan(room.messages, 'group', room.id, room.name)
  }
  hits.sort((a, b) => String(b.time).localeCompare(String(a.time)))
  const size = Math.min(200, Math.max(1, Number(limit) || 60))
  return { total: hits.length, hits: hits.slice(0, size) }
}

/** 面板需要的会话概览。 */
export async function chatOverview(ctx) {
  const store = await loadStore()
  const chats = await loadChats()
  if (ensureChiefRoom(chats, store)) await saveChats(chats)
  const byId = new Map(store.members.map((m) => [m.id, m]))
  const lastOf = (messages) => (Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null)
  return {
    ok: true,
    private: store.members.map((member) => {
      const thread = chats.private[member.id]
      const last = thread ? lastOf(thread.messages) : null
      return {
        memberId: member.id,
        name: member.name,
        role: member.role,
        emoji: member.emoji,
        color: member.color,
        count: thread && Array.isArray(thread.messages) ? thread.messages.length : 0,
        lastText: last ? last.text.slice(0, 120) : '',
        updatedAt: thread ? thread.updatedAt : ''
      }
    }),
    rooms: chats.rooms.map((room) => {
      const last = lastOf(room.messages)
      return {
        id: room.id,
        name: room.name,
        chief: room.id === CHIEF_ROOM_ID,
        adminId: room.adminId,
        adminName: (byId.get(room.adminId) || {}).name || '',
        memberIds: room.memberIds.filter((id) => byId.has(id)),
        responder: responderOf(room),
        relayDepth: relayDepthOf(room),
        count: Array.isArray(room.messages) ? room.messages.length : 0,
        lastText: last ? last.text.slice(0, 120) : '',
        updatedAt: room.updatedAt || ''
      }
    })
  }
}

/** 房间的增删改。 */
export async function applyRoomAction(body) {
  const chats = await loadChats()
  const store = await loadStore()
  const action = text(body?.action) || 'create'
  const known = new Set(store.members.map((m) => m.id))
  if (action === 'create') {
    if (chats.rooms.length >= MAX_ROOMS) return { error: '群聊最多 ' + String(MAX_ROOMS) + ' 个' }
    const name = text(body?.room?.name).slice(0, 40)
    if (name.length === 0) return { error: '群聊名称不能为空' }
    const memberIds = (Array.isArray(body?.room?.memberIds) ? body.room.memberIds : []).filter((id) => known.has(id))
    if (memberIds.length < 2) return { error: '群聊至少需要 2 名成员' }
    const adminId = known.has(text(body?.room?.adminId)) && memberIds.includes(text(body.room.adminId)) ? text(body.room.adminId) : memberIds[0]
    const responder = RESPONDERS.includes(text(body?.room?.responder)) ? text(body.room.responder) : 'lead'
    const relayValue = Number(body?.room?.relayDepth)
    const relayDepth = Number.isSafeInteger(relayValue) && relayValue >= 0 && relayValue <= 2 ? relayValue : 1
    const parallel = body?.room?.parallel !== false
    const configured = Number(body?.room?.maxParallel)
    const maxParallel = Number.isSafeInteger(configured) && configured >= 1 && configured <= 5 ? configured : undefined
    const room = { id: makeId('room'), name, adminId, memberIds, responder, relayDepth, parallel, maxParallel, createdAt: new Date().toISOString(), updatedAt: '', messages: [] }
    if (maxParallel === undefined) delete room.maxParallel
    chats.rooms.push(room)
    await saveChats(chats)
    return { room }
  }
  if (action === 'delete') {
    const id = text(body?.id)
    if (id === CHIEF_ROOM_ID) return { error: '总管台不能删除；要换总管请到团队页设置' }
    const before = chats.rooms.length
    chats.rooms = chats.rooms.filter((room) => room.id !== id)
    if (chats.rooms.length === before) return { error: '找不到该群聊' }
    await saveChats(chats)
    return { deleted: id }
  }
  if (action === 'update') {
    const room = chats.rooms.find((entry) => entry.id === text(body?.id))
    if (room === undefined) return { error: '找不到该群聊' }
    const name = text(body?.room?.name)
    if (name.length > 0) room.name = name.slice(0, 40)
    const memberIds = Array.isArray(body?.room?.memberIds) ? body.room.memberIds.filter((id) => known.has(id)) : null
    if (memberIds !== null) {
      if (memberIds.length < 2) return { error: '群聊至少需要 2 名成员' }
      room.memberIds = memberIds
      if (!memberIds.includes(room.adminId)) room.adminId = memberIds[0]
    }
    const adminId = text(body?.room?.adminId)
    if (adminId.length > 0 && room.memberIds.includes(adminId)) room.adminId = adminId
    if (RESPONDERS.includes(text(body?.room?.responder))) room.responder = text(body.room.responder)
    const relayValue = Number(body?.room?.relayDepth)
    if (Number.isSafeInteger(relayValue) && relayValue >= 0 && relayValue <= 2) room.relayDepth = relayValue
    if (body?.room?.parallel !== undefined) room.parallel = body.room.parallel !== false
    const parallelRaw = body?.room?.maxParallel
    if (parallelRaw === null || parallelRaw === '' || parallelRaw === 'auto') {
      delete room.maxParallel
    } else {
      const parallelValue = Number(parallelRaw)
      if (Number.isSafeInteger(parallelValue) && parallelValue >= 1 && parallelValue <= 5) room.maxParallel = parallelValue
    }
    await saveChats(chats)
    return { room }
  }
  return { error: '未知 action：' + action }
}

/** 注册会话路由与工具。 */
export function apply(ctx) {
  const closers = []
  const own = (fn) => { if (typeof fn === 'function') closers.push(fn); return fn }
  const busy = new Set()

  async function handleSend(routeKind, request) {
    const body = await readJson(request)
    if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
    const store = await loadStore()
    const userText = text(body.text)
    if (userText.length === 0) return json({ ok: false, error: '消息不能为空' }, 400)
    if (userText.length > 4000) return json({ ok: false, error: '消息最长 4000 字' }, 400)
    const sessionId = text(body.sessionId)
    const parent = await parentOf(ctx, sessionId)
    if (parent === undefined || parent === null) return json({ ok: false, error: '会话 ' + sessionId + ' 当前没有活动的智能体' }, 409)

    if (routeKind === 'private') {
      const member = store.members.find((entry) => entry.id === text(body.memberId))
      if (member === undefined) return json({ ok: false, error: '找不到该成员' }, 404)
      if (!member.enabled) return json({ ok: false, error: '成员已停用' }, 409)
      const key = 'p:' + member.id
      if (busy.has(key)) return json({ ok: false, error: '该成员正在回复上一条消息' }, 409)
      busy.add(key)
      try {
        const result = await sendPrivate(ctx, parent, member, userText, request.signal)
        return json({ ok: true, ...result })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      } finally {
        busy.delete(key)
      }
    }

    const chats = await loadChats()
    const room = chats.rooms.find((entry) => entry.id === text(body.id))
    if (room === undefined) return json({ ok: false, error: '找不到该群聊' }, 404)
    const key = 'g:' + room.id
    if (busy.has(key)) return json({ ok: false, error: '该群正在回复上一条消息' }, 409)
    busy.add(key)
    try {
      const result = await sendGroup(ctx, parent, room, store.members, userText, request.signal)
      return json({ ok: true, ...result })
    } catch (error) {
      return json({ ok: false, error: String(error) }, 500)
    } finally {
      busy.delete(key)
    }
  }

  own(ctx.connection.fetch.register({
    path: CHATS_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try { return json(await chatOverview(ctx)) } catch (error) { return json({ ok: false, error: String(error) }, 500) }
    }
  }))

  own(ctx.connection.fetch.register({
    path: PRIVATE_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'POST') return handleSend('private', request)
      try {
        const url = new URL(request.url)
        const id = url.searchParams.get('memberId') || ''
        const store = await loadStore()
        const member = store.members.find((entry) => entry.id === id)
        if (member === undefined) return json({ ok: false, error: '找不到该成员' }, 404)
        const chats = await loadChats()
        const thread = chats.private[id]
        // 轻量轮询：只回过程化状态，不带整段消息。
        if (url.searchParams.get('progress') === '1') return json({ ok: true, progress: (thread && thread.progress) || null })
        return json({ ok: true, member, messages: thread && Array.isArray(thread.messages) ? thread.messages : [] })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: GROUP_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'POST') return handleSend('group', request)
      try {
        const url = new URL(request.url)
        const id = url.searchParams.get('id') || ''
        const chats = await loadChats()
        const room = chats.rooms.find((entry) => entry.id === id)
        if (room === undefined) return json({ ok: false, error: '找不到该群聊' }, 404)
        if (url.searchParams.get('progress') === '1') return json({ ok: true, progress: room.progress || null })
        return json({ ok: true, room, messages: Array.isArray(room.messages) ? room.messages : [] })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: SEARCH_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        const result = await searchMessages(
          url.searchParams.get('q') || '',
          url.searchParams.get('kind') || '',
          url.searchParams.get('id') || '',
          Number(url.searchParams.get('limit') || 60)
        )
        return json({ ok: true, ...result })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: STT_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const url = new URL(request.url)
        if (request.method === 'GET') {
          const settings = await loadSttSettings()
          const probe = url.searchParams.get('probe') === '1' ? await probeStt(settings) : null
          // apiKey 只回「有没有配」，不回明文。
          const safe = { ...settings, apiKey: '', apiKeyConfigured: settings.apiKey.length > 0 }
          return json({ ok: true, settings: safe, probe })
        }
        const type = String(request.headers.get('content-type') || '')
        if (type.includes('application/json')) {
          const body = await readJson(request)
          if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
          if (text(body.action) === 'settings') {
            const incoming = body.stt !== null && typeof body.stt === 'object' ? { ...body.stt } : {}
            const current = await loadSttSettings()
            // 前端拿不到明文 key，留空表示沿用旧值。
            if (text(incoming.apiKey).length === 0) incoming.apiKey = current.apiKey
            const saved = await saveSttSettings(incoming)
            return json({ ok: true, settings: { ...saved, apiKey: '', apiKeyConfigured: saved.apiKey.length > 0 } })
          }
          if (text(body.action) === 'probe') return json({ ok: true, probe: await probeStt(await loadSttSettings()) })
          return json({ ok: false, error: '未知的 action' }, 400)
        }
        const bytes = Buffer.from(await request.arrayBuffer())
        const settings = await loadSttSettings()
        const value = await transcribe(bytes, {
          settings,
          filename: url.searchParams.get('filename') || 'speech.webm',
          contentType: type || 'audio/webm',
          durationMs: Number(url.searchParams.get('ms') || 0)
        })
        return json({ ok: true, text: value })
      } catch (error) {
        return json({ ok: false, error: String(error && error.message ? error.message : error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: MEMORY_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') {
          const url = new URL(request.url)
          const kind = url.searchParams.get('kind') === 'room' ? 'room' : 'private'
          const id = url.searchParams.get('id') || ''
          const memory = await loadMemory()
          const q = url.searchParams.get('q') || ''
          if (id.length === 0) {
            if (q.trim().length === 0) {
              const settings = await loadSettings()
              return json({
                ok: true, stats: memoryStats(memory), persona: memory.persona, private: memory.private, rooms: memory.rooms,
                settings: { embedding: { ...settings.embedding, key: settings.embedding.key.length > 0 ? '已配置' : '' } }
              })
            }
            const store = await loadStore()
            const names = new Map(store.members.map((member) => ['private:' + member.id, member.name]))
            for (const room of (await loadChats()).rooms) names.set('room:' + room.id, room.name)
            const hits = (await searchMemoryHybrid(memory, q, 30)).map((row) => ({
              kind: row.kind,
              id: row.id,
              conversationName: names.get(row.kind + ':' + row.id) || row.id,
              atom: row.atom,
              score: row.score
            }))
            return json({ ok: true, q, total: hits.length, hits })
          }
          const slot = slotOf(memory, kind, id)
          // 兼容旧的 summary/facts 字段名，同时给出分层的 l2/atoms 与画像。
          return json({
            ok: true, kind, id, stats: memoryStats(memory), persona: memory.persona,
            memory: {
              summary: slot.l2.summary,
              facts: slot.atoms.map((atom) => ({ id: atom.id, text: atom.text, at: atom.at, importance: atom.importance, key: atom.key })),
              l2: slot.l2,
              atoms: slot.atoms,
              since: slot.since,
              updatedAt: slot.updatedAt
            }
          })
        }
        const body = await readJson(request)
        if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
        const actionName = text(body.action) || 'remember'
        if (actionName === 'settings') {
          const current = await loadSettings()
          const incoming = body.embedding !== null && typeof body.embedding === 'object' ? body.embedding : {}
          await saveSettings({
            embedding: {
              enabled: incoming.enabled === undefined ? current.embedding.enabled : incoming.enabled !== false,
              baseUrl: text(incoming.baseUrl) || current.embedding.baseUrl,
              model: text(incoming.model) || current.embedding.model,
              key: incoming.key === '已配置' || incoming.key === undefined ? current.embedding.key : text(incoming.key)
            }
          })
          return json({ ok: true })
        }
        if (actionName === 'test') {
          const settings = await loadSettings()
          const vectors = await embedTexts(settings, ['连通性测试'])
          return json({ ok: true, dim: vectors[0].length })
        }
        const kind = text(body.kind) === 'room' ? 'room' : 'private'
        const id = text(body.id)
        if (id.length === 0) return json({ ok: false, error: '缺少会话 id' }, 400)
        const memory = await loadMemory()
        const slot = slotOf(memory, kind, id)
        const action = text(body.action) || 'remember'
        if (action === 'forget-fact') {
          if (!removeAtom(slot, text(body.factId))) return json({ ok: false, error: '找不到这条事实' }, 404)
        } else if (action === 'forget-persona') {
          if (!removePersona(memory.persona, text(body.factId))) return json({ ok: false, error: '找不到这条画像' }, 404)
          memory.persona.updatedAt = new Date().toISOString()
        } else if (action === 'clear') {
          slot.l2 = { summary: '', at: '' }
          slot.atoms = []
          slot.since = 0
        } else if (action === 'remember') {
          const fact = text(body.text).trim()
          if (fact.length === 0) return json({ ok: false, error: '事实不能为空' }, 400)
          addAtom(slot, { text: fact, key: text(body.key), importance: Number(body.importance) || 3 })
          if (body.persona === true) addPersona(memory.persona, fact)
        } else {
          return json({ ok: false, error: '未知的 action' }, 400)
        }
        slot.updatedAt = new Date().toISOString()
        await saveMemory(memory)
        return json({ ok: true, kind, id, persona: memory.persona, memory: { summary: slot.l2.summary, facts: slot.atoms, l2: slot.l2, atoms: slot.atoms, since: slot.since, updatedAt: slot.updatedAt } })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(ctx.connection.fetch.register({
    path: ROOMS_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readJson(request)
      if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
      try {
        const result = await applyRoomAction(body)
        if (result.error !== undefined) return json({ ok: false, error: result.error }, 400)
        return json({ ok: true, ...result, ...(await chatOverview(ctx)) })
      } catch (error) {
        return json({ ok: false, error: String(error) }, 500)
      }
    }
  }))

  own(registerChatTools(ctx))

  return () => {
    while (closers.length > 0) {
      const close = closers.pop()
      try { close() } catch { /* 已释放 */ }
    }
  }
}

function registerChatTools(ctx) {
  const chat = {
    name: 'agent_team_chat',
    description: '和某个智能体成员私聊：发送一条消息并返回它的回复（带最近聊天记录，可连续追问）。消息会保存在工作台的会话里。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['member', 'message'],
      properties: {
        member: { type: 'string', description: '成员名字，必须在名册中。' },
        message: { type: 'string', description: '要发送给该成员的消息。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['member', 'reply'],
        properties: {
          member: { type: 'string' },
          reply: { type: 'string' },
          stopReason: { type: 'string' }
        }
      },
      render: (_args, value) => [{ type: 'text', text: value.member + '：' + value.reply }]
    },
    async execute(args, exec) {
      const parent = exec?.agent
      if (parent === undefined || parent === null) throw new Error('agent_team_chat 需要一个调用方会话')
      const store = await loadStore()
      const member = store.members.find((entry) => entry.name === text(args?.member))
      if (member === undefined) {
        const names = store.members.map((m) => m.name).slice(0, 30)
        throw new Error('名册中没有名为「' + text(args?.member) + '」的成员。可用成员：' + (names.length > 0 ? names.join('、') : '（空）'))
      }
      const result = await sendPrivate(ctx, parent, member, text(args?.message), exec?.signal)
      const last = result.messages[result.messages.length - 1]
      return { member: member.name, reply: last ? last.text : '', stopReason: last ? (last.stopReason || '') : '' }
    }
  }

  const groupChat = {
    name: 'agent_team_group_chat',
    description: '在群里发言：管理员先回复，回复中的 @成员名 会转给对应成员执行，返回本轮所有成员的回复。群消息会保存在工作台。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['group', 'message'],
      properties: {
        group: { type: 'string', description: '群聊名称。' },
        message: { type: 'string', description: '要发到群里的消息。' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['group', 'replies'],
        properties: {
          group: { type: 'string' },
          replies: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['member', 'reply'],
              properties: { member: { type: 'string' }, reply: { type: 'string' } }
            }
          }
        }
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.group + '：\n' + value.replies.map((entry) => entry.member + '：' + entry.reply).join('\n')
      }]
    },
    async execute(args, exec) {
      const parent = exec?.agent
      if (parent === undefined || parent === null) throw new Error('agent_team_group_chat 需要一个调用方会话')
      const chats = await loadChats()
      const room = chats.rooms.find((entry) => entry.name === text(args?.group))
      if (room === undefined) throw new Error('没有名为「' + text(args?.group) + '」的群聊')
      const store = await loadStore()
      const result = await sendGroup(ctx, parent, room, store.members, text(args?.message), exec?.signal)
      return { group: room.name, replies: result.turns.map((turn) => ({ member: turn.name, reply: turn.text })) }
    }
  }

  const disposers = [ctx.tools.register(chat), ctx.tools.register(groupChat)]
  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* 已释放 */ }
    }
  }
}
