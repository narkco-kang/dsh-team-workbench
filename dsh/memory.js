/**
 * dsh-team-workbench / 会话记忆（L0–L3 分层）
 *
 * 参考 TencentCloud/TencentDB-Agent-Memory 的分层思路（不是照搬服务）：
 *   L0 对话：chats.json 的原始消息（每条会话各自一份）
 *   L1 原子事实：atoms[]，可带 key（同一 key 的新事实覆盖旧的），带重要度与来源消息
 *   L2 场景摘要：l2.summary，一段会话最近一次压缩出的场景块
 *   L3 用户画像：persona.items[]，跨会话共享的偏好/目标/约束
 *
 * 召回是「渐进披露」：提示词里只放 L3 画像 + L2 摘要 + 按当前消息打分的前 K 条原子事实，
 * 其余事实留在文件里，靠「记忆」面板或 /memory?q= 下钻，避免把所有事实一股脑塞进上下文。
 *
 * 存储：$DSH_HOME/team-workbench/memory.json（version 2）
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dispatchToMember, harnessHome, makeId, text } from './team.js'

const MEMORY_FILE = 'memory.json'
const MEMORY_VERSION = 2
const COMPACT_AFTER = 12
const MAX_ATOMS = 40
const MAX_PERSONA = 12
const MAX_SUMMARY = 1600
const RECALL_LIMIT = 6
const TRANSCRIPT_FOR_COMPACT = 40

function memoryPath() {
  return join(harnessHome(), 'team-workbench', MEMORY_FILE)
}

function emptyMemory() {
  return { version: MEMORY_VERSION, persona: { items: [], updatedAt: '' }, private: {}, rooms: {} }
}

/** 读取记忆；v1（summary + facts）就地升级成 v2。 */
export async function loadMemory() {
  try {
    const parsed = JSON.parse(await readFile(memoryPath(), 'utf8'))
    const memory = {
      version: MEMORY_VERSION,
      persona: normalizePersona(parsed?.persona),
      private: migrateBag(parsed?.private),
      rooms: migrateBag(parsed?.rooms)
    }
    return memory
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[team-workbench] 读取会话记忆失败：' + String(error))
    return emptyMemory()
  }
}

function normalizePersona(value) {
  const items = Array.isArray(value?.items)
    ? value.items.map((item) => ({ id: text(item?.id) || makeId('persona'), text: text(item?.text).slice(0, 300), at: text(item?.at) })).filter((item) => item.text.length > 0)
    : []
  return { items: items.slice(-MAX_PERSONA), updatedAt: text(value?.updatedAt) }
}

function migrateBag(bag) {
  const out = {}
  if (bag === null || typeof bag !== 'object') return out
  for (const [id, raw] of Object.entries(bag)) {
    if (raw === null || typeof raw !== 'object') continue
    const atoms = Array.isArray(raw.atoms)
      ? raw.atoms.map(normalizeAtom).filter((atom) => atom.text.length > 0)
      : Array.isArray(raw.facts)
        ? raw.facts.map((fact) => normalizeAtom({ text: fact?.text, at: fact?.at })).filter((atom) => atom.text.length > 0)
        : []
    out[id] = {
      l2: { summary: text(raw.l2?.summary) || text(raw.summary), at: text(raw.l2?.at) || text(raw.updatedAt) },
      atoms: atoms.slice(-MAX_ATOMS),
      since: Number.isSafeInteger(raw.since) ? raw.since : 0,
      updatedAt: text(raw.updatedAt)
    }
  }
  return out
}

function normalizeAtom(raw) {
  return {
    id: text(raw?.id) || makeId('atom'),
    text: text(raw?.text).trim().slice(0, 300),
    key: text(raw?.key).trim().slice(0, 80),
    importance: Number.isFinite(Number(raw?.importance)) ? Math.max(1, Math.min(5, Math.round(Number(raw.importance)))) : 3,
    at: text(raw?.at) || new Date().toISOString(),
    from: text(raw?.from)
  }
}

export async function saveMemory(memory) {
  const target = memoryPath()
  await mkdir(dirname(target), { recursive: true })
  const payload = JSON.stringify({ version: MEMORY_VERSION, persona: memory.persona, private: memory.private, rooms: memory.rooms }, null, 1)
  const temp = target + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(temp, payload, 'utf8')
  await rename(temp, target)
}

/** 取某条会话的记忆槽（没有就建一个空的，不落盘）。 */
export function slotOf(memory, kind, id) {
  const bag = kind === 'room' ? memory.rooms : memory.private
  if (bag[id] === undefined) bag[id] = { l2: { summary: '', at: '' }, atoms: [], since: 0, updatedAt: '' }
  const slot = bag[id]
  if (!Array.isArray(slot.atoms)) slot.atoms = []
  if (slot.l2 === undefined || slot.l2 === null) slot.l2 = { summary: '', at: '' }
  if (!Number.isSafeInteger(slot.since)) slot.since = 0
  return slot
}

/** 关键词打分：二元组重合 + 重要度 + 时间衰减；同 key 的事实只留最新一条。 */
function scoreOf(atom, lower) {
  let score = atom.importance
  let matched = 0
  if (lower.length > 0) {
    const hay = atom.text.toLowerCase()
    for (let i = 0; i < lower.length - 1; i += 1) {
      const gram = lower.slice(i, i + 2)
      if (gram.trim().length === 2 && hay.includes(gram)) { score += 3; matched += 1 }
    }
  }
  const age = (Date.now() - Date.parse(atom.at || '')) / 86400000
  if (Number.isFinite(age)) score += Math.max(0, 2 - age / 30)
  return { score, matched }
}

/** 按当前用户消息召回事实；没有关键词时按重要度/时间取前几条。 */
export function recallAtoms(slot, userText, limit = RECALL_LIMIT) {
  const lower = text(userText).toLowerCase()
  const byKey = new Map()
  for (const atom of slot.atoms) {
    if (atom.key.length === 0) continue
    const previous = byKey.get(atom.key)
    if (previous === undefined || String(atom.at) > String(previous.at)) byKey.set(atom.key, atom)
  }
  const merged = slot.atoms.filter((atom) => atom.key.length === 0 || byKey.get(atom.key) === atom)
  return merged
    .map((atom) => { const { score, matched } = scoreOf(atom, lower); return { atom, score, matched } })
    // 命中关键词的排前面；同样命中时再比重要度与新鲜度。
    .sort((a, b) => Number(b.matched > 0) - Number(a.matched > 0) || b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.atom)
}

/** 记忆块：L3 画像 + L2 场景 + 召回的 L1 事实。 */
export function memoryBlock(slot, persona, userText) {
  const parts = []
  const items = persona !== undefined && persona !== null && Array.isArray(persona.items) ? persona.items : []
  if (items.length > 0) parts.push('【用户画像】' + items.map((item) => item.text).join('；'))
  if (slot !== undefined && slot !== null && slot.l2.summary.trim().length > 0) parts.push('【本会话场景】' + slot.l2.summary.trim())
  const atoms = slot !== undefined && slot !== null ? recallAtoms(slot, userText, RECALL_LIMIT) : []
  if (atoms.length > 0) parts.push('【相关事实】' + atoms.map((atom) => atom.text).join('；'))
  if (parts.length === 0) return ''
  return ['【长期记忆】', ...parts, '（记忆可能过时，和新消息冲突时以新消息为准。）'].join('\n')
}

/** 写一条原子事实；同 key 覆盖、同文本去重，超出上限时丢掉分最低的。 */
export function addAtom(slot, raw) {
  const atom = normalizeAtom(raw)
  if (atom.text.length === 0) return false
  if (slot.atoms.some((item) => item.text === atom.text)) return false
  if (atom.key.length > 0) slot.atoms = slot.atoms.filter((item) => item.key !== atom.key)
  slot.atoms.push(atom)
  if (slot.atoms.length > MAX_ATOMS) {
    const keep = new Set(recallAtoms({ atoms: slot.atoms }, '', MAX_ATOMS).map((item) => item.id))
    slot.atoms = slot.atoms.filter((item) => keep.has(item.id))
  }
  return true
}

export function removeAtom(slot, atomId) {
  const before = slot.atoms.length
  slot.atoms = slot.atoms.filter((atom) => atom.id !== atomId)
  return before !== slot.atoms.length
}

export function addPersona(persona, body) {
  const value = text(body).trim().slice(0, 300)
  if (value.length === 0 || persona.items.some((item) => item.text === value)) return false
  persona.items.push({ id: makeId('persona'), text: value, at: new Date().toISOString() })
  if (persona.items.length > MAX_PERSONA) persona.items = persona.items.slice(-MAX_PERSONA)
  return true
}

export function removePersona(persona, itemId) {
  const before = persona.items.length
  persona.items = persona.items.filter((item) => item.id !== itemId)
  return before !== persona.items.length
}

function parseCompaction(raw) {
  const body = text(raw).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(body.slice(start, end + 1))
    const scenario = text(value.scenario).trim().slice(0, MAX_SUMMARY)
    const atoms = Array.isArray(value.atoms)
      ? value.atoms
          .map((item) => (typeof item === 'string' ? { text: item } : { text: item?.text, key: item?.key, importance: item?.importance }))
          .filter((item) => text(item.text).trim().length > 0)
          .slice(0, 12)
      : []
    const persona = Array.isArray(value.persona) ? value.persona.map((item) => text(item).trim()).filter((item) => item.length > 0).slice(0, 6) : []
    return { scenario, atoms, persona }
  } catch {
    return null
  }
}

function compactPrompt(slot, messages, peerName) {
  const lines = messages.slice(-TRANSCRIPT_FOR_COMPACT).map((message) => (message.role === 'user' ? '用户：' : (message.name || '成员') + '：') + message.text)
  return [
    '你在维护一段会话的分层记忆（' + peerName + '）。',
    '已有场景摘要：' + (slot.l2.summary.trim().length > 0 ? slot.l2.summary.trim() : '（空）'),
    '已有事实：' + (slot.atoms.length > 0 ? slot.atoms.map((atom) => atom.text).join('；') : '（空）'),
    '',
    '新的聊天记录：',
    lines.join('\n'),
    '',
    '请输出 JSON（不要代码块）：',
    '{"scenario":"不超过 300 字的场景摘要",',
    ' "atoms":[{"text":"一条原子事实","key":"同属性覆盖用，如 偏好:回复风格","importance":1-5}],',
    ' "persona":["跨会话都成立的用户画像，例如 偏好先给结论"]}',
    '只保留用户的偏好、目标、约束、已确认的决定、进行中的事项；不要寒暄，不要编造。'
  ].join('\n')
}

/**
 * 必要时压缩一段会话：新消息达到 COMPACT_AFTER 条就请负责人把「旧场景 + 新消息」
 * 压成新的 L2 场景、L1 原子与 L3 画像。后台执行，失败不影响聊天。
 */
export async function compactIfNeeded(ctx, parent, kind, id, messages, member, peerName, signal) {
  if (member === undefined || member === null) return false
  const memory = await loadMemory()
  const slot = slotOf(memory, kind, id)
  const fresh = messages.length - slot.since
  if (fresh < COMPACT_AFTER) return false
  const result = await dispatchToMember(ctx, parent, member, compactPrompt(slot, messages, peerName), signal)
  const parsed = parseCompaction(result.output)
  if (parsed === null) return false
  if (parsed.scenario.length > 0) slot.l2 = { summary: parsed.scenario, at: new Date().toISOString() }
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  for (const atom of parsed.atoms) addAtom(slot, { ...atom, from: lastUser ? lastUser.id : '' })
  for (const item of parsed.persona) addPersona(memory.persona, item)
  if (parsed.persona.length > 0) memory.persona.updatedAt = new Date().toISOString()
  slot.since = messages.length
  slot.updatedAt = new Date().toISOString()
  await saveMemory(memory)
  return true
}
