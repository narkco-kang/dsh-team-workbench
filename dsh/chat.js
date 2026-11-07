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
import { addFact, compactIfNeeded, loadMemory, memoryBlock, removeFact, saveMemory, slotOf } from './memory.js'

const CHATS_ROUTE = ROUTE_BASE + '/chats'
const PRIVATE_ROUTE = ROUTE_BASE + '/chats/private'
const GROUP_ROUTE = ROUTE_BASE + '/chats/group'
const ROOMS_ROUTE = ROUTE_BASE + '/chats/rooms'
const SEARCH_ROUTE = ROUTE_BASE + '/chats/search'
const MEMORY_ROUTE = ROUTE_BASE + '/memory'
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

function privatePrompt(member, messages, userText, memoryText) {
  return [
    '【私聊】你在和用户一对一对话。',
    memoryText.length > 0 ? '' : null,
    memoryText.length > 0 ? memoryText : null,
    '',
    '最近的聊天记录：',
    transcript(messages, member.name),
    '',
    '用户的新消息：',
    userText,
    '',
    '请直接回复用户；保持你自己的角色与职责，不要代替其他成员发言。'
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

function adminPrompt(room, members, messages, userText, memoryText) {
  const info = groupPreamble(room, members)
  return [
    ...info.lines,
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

function memberPrompt(room, member, members, messages, userText, asker, memoryText) {
  const info = groupPreamble(room, members)
  return [
    ...info.lines,
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
  const memory = await loadMemory()
  const slot = slotOf(memory, 'private', member.id)
  const reply = await runMember(ctx, parent, member, privatePrompt(member, thread.messages.slice(0, -1), userText, memoryBlock(slot)), signal)
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

  let queue = start
  let depth = 0
  let lastSpeaker = ''

  while (queue.length > 0 && turns.length < MAX_TURNS_PER_MESSAGE && depth <= relayDepth) {
    const next = []
    for (const member of queue) {
      if (used.has(member.id)) continue
      used.add(member.id)
      if (turns.length >= MAX_TURNS_PER_MESSAGE) break
      const memoryText = memoryBlock(slotOf(memory, 'room', target.id))
      const prompt = depth === 0 && admin !== undefined && member.id === admin.id
        ? adminPrompt(target, alive, target.messages.slice(0, -1), userText, memoryText)
        : memberPrompt(target, member, alive, target.messages.slice(0, -1), userText, lastSpeaker, memoryText)
      const reply = await runMember(ctx, parent, member, prompt, signal)
      turns.push({ memberId: member.id, name: member.name, emoji: member.emoji, text: reply.text, stopReason: reply.stopReason })
      if (reply.text.trim().length > 0) pushMessage(target.messages, messageOf('agent', member, reply.text, { stopReason: reply.stopReason }))
      target.updatedAt = new Date().toISOString()
      await saveChats(chats)
      lastSpeaker = member.name
      for (const mentioned of parseMentions(reply.text, alive, used)) {
        if (next.length >= MAX_MENTIONS) break
        next.push(mentioned)
      }
    }
    queue = next
    depth += 1
  }
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
    const room = { id: makeId('room'), name, adminId, memberIds, responder, relayDepth, createdAt: new Date().toISOString(), updatedAt: '', messages: [] }
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
        const id = new URL(request.url).searchParams.get('memberId') || ''
        const store = await loadStore()
        const member = store.members.find((entry) => entry.id === id)
        if (member === undefined) return json({ ok: false, error: '找不到该成员' }, 404)
        const chats = await loadChats()
        const thread = chats.private[id]
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
        const id = new URL(request.url).searchParams.get('id') || ''
        const chats = await loadChats()
        const room = chats.rooms.find((entry) => entry.id === id)
        if (room === undefined) return json({ ok: false, error: '找不到该群聊' }, 404)
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
          if (id.length === 0) return json({ ok: true, private: memory.private, rooms: memory.rooms })
          return json({ ok: true, kind, id, memory: slotOf(memory, kind, id) })
        }
        const body = await readJson(request)
        if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
        const kind = text(body.kind) === 'room' ? 'room' : 'private'
        const id = text(body.id)
        if (id.length === 0) return json({ ok: false, error: '缺少会话 id' }, 400)
        const memory = await loadMemory()
        const slot = slotOf(memory, kind, id)
        const action = text(body.action) || 'remember'
        if (action === 'forget-fact') {
          if (!removeFact(slot, text(body.factId))) return json({ ok: false, error: '找不到这条事实' }, 404)
        } else if (action === 'clear') {
          slot.summary = ''
          slot.facts = []
          slot.since = 0
        } else if (action === 'remember') {
          const fact = text(body.text).trim()
          if (fact.length === 0) return json({ ok: false, error: '事实不能为空' }, 400)
          addFact(slot, fact)
        } else {
          return json({ ok: false, error: '未知的 action' }, 400)
        }
        slot.updatedAt = new Date().toISOString()
        await saveMemory(memory)
        return json({ ok: true, kind, id, memory: slot })
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
      if (member === undefined) throw new Error('名册中没有名为「' + text(args?.member) + '」的成员')
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
