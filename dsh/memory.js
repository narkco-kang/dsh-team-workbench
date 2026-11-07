/**
 * dsh-team-workbench / 会话记忆
 *
 * 每条会话（每个成员的私聊、每个群聊、总管台）除了「最近 12 条」的短期窗口，
 * 还有一份落盘的长期记忆：
 *   { summary: 一段话摘要, facts: [{ id, text, at }], since: 上次压缩到的消息下标 }
 *
 * 记忆更新是「压缩」而不是「追加」：每积累 12 条新消息，就让该会话的负责人
 * 把「旧摘要 + 新消息」压成新的摘要与事实列表；提示词里拼「摘要 + 事实 + 最近 12 条」。
 *
 * 存储：$DSH_HOME/team-workbench/memory.json
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dispatchToMember, harnessHome, makeId, text } from './team.js'

const MEMORY_FILE = 'memory.json'
const MEMORY_VERSION = 1
const COMPACT_AFTER = 12
const MAX_FACTS = 24
const MAX_SUMMARY = 1600
const TRANSCRIPT_FOR_COMPACT = 40

function memoryPath() {
  return join(harnessHome(), 'team-workbench', MEMORY_FILE)
}

function emptyMemory() {
  return { version: MEMORY_VERSION, private: {}, rooms: {} }
}

/** 读取记忆；损坏或缺失时返回空记忆。 */
export async function loadMemory() {
  try {
    const parsed = JSON.parse(await readFile(memoryPath(), 'utf8'))
    return {
      version: MEMORY_VERSION,
      private: parsed !== null && typeof parsed.private === 'object' && parsed.private !== null ? parsed.private : {},
      rooms: parsed !== null && typeof parsed.rooms === 'object' && parsed.rooms !== null ? parsed.rooms : {}
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[team-workbench] 读取会话记忆失败：' + String(error))
    return emptyMemory()
  }
}

export async function saveMemory(memory) {
  const target = memoryPath()
  await mkdir(dirname(target), { recursive: true })
  const payload = JSON.stringify({ version: MEMORY_VERSION, private: memory.private, rooms: memory.rooms }, null, 1)
  const temp = target + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(temp, payload, 'utf8')
  await rename(temp, target)
}

/** 取某条会话的记忆槽（没有就建一个空的，不落盘）。 */
export function slotOf(memory, kind, id) {
  const bag = kind === 'room' ? memory.rooms : memory.private
  if (bag[id] === undefined) bag[id] = { summary: '', facts: [], since: 0, updatedAt: '' }
  const slot = bag[id]
  if (!Array.isArray(slot.facts)) slot.facts = []
  if (typeof slot.summary !== 'string') slot.summary = ''
  if (!Number.isSafeInteger(slot.since)) slot.since = 0
  return slot
}

/** 把记忆拼成提示词里的一段。 */
export function memoryBlock(slot) {
  if (slot === undefined || slot === null) return ''
  const facts = Array.isArray(slot.facts) ? slot.facts : []
  if (slot.summary.trim().length === 0 && facts.length === 0) return ''
  return [
    '【这段会话的长期记忆】',
    slot.summary.trim().length > 0 ? '摘要：' + slot.summary.trim() : '',
    facts.length > 0 ? '已知事实：' + facts.map((fact) => fact.text).join('；') : '',
    '（记忆可能过时，和新消息冲突时以新消息为准。）'
  ].filter((line) => line.length > 0).join('\n')
}

/** 记忆里的事实增删（去重、限量）。 */
export function addFact(slot, body) {
  const value = text(body).trim().slice(0, 300)
  if (value.length === 0) return
  if (slot.facts.some((fact) => fact.text === value)) return
  slot.facts.push({ id: makeId('fact'), text: value, at: new Date().toISOString() })
  if (slot.facts.length > MAX_FACTS) slot.facts = slot.facts.slice(-MAX_FACTS)
}

export function removeFact(slot, factId) {
  const before = slot.facts.length
  slot.facts = slot.facts.filter((fact) => fact.id !== factId)
  return before !== slot.facts.length
}

/** 从模型回复里抠出 { summary, facts[] }。 */
function parseCompaction(raw) {
  const body = text(raw).trim()
  if (body.length === 0) return null
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(body.slice(start, end + 1))
    const summary = text(value.summary).trim().slice(0, MAX_SUMMARY)
    const facts = Array.isArray(value.facts)
      ? value.facts.map((item) => text(item).trim().slice(0, 300)).filter((item) => item.length > 0).slice(0, MAX_FACTS)
      : []
    return { summary, facts }
  } catch {
    return null
  }
}

function compactPrompt(slot, messages, peerName) {
  const lines = messages.slice(-TRANSCRIPT_FOR_COMPACT).map((message) => (message.role === 'user' ? '用户：' : (message.name || '成员') + '：') + message.text)
  return [
    '你在维护一段会话的长期记忆（' + peerName + '）。',
    '已有摘要：' + (slot.summary.trim().length > 0 ? slot.summary.trim() : '（空）'),
    '已有事实：' + (slot.facts.length > 0 ? slot.facts.map((fact) => fact.text).join('；') : '（空）'),
    '',
    '新的聊天记录：',
    lines.join('\n'),
    '',
    '请把这些内容压成更短、可长期复用的记忆，只保留：用户的偏好、目标、约束、已确认的决定、进行中的事项。',
    '不要编造，不要保留寒暄。只输出一行 JSON，不要代码块：',
    '{"summary":"不超过 300 字的摘要","facts":["一条事实","另一条事实"]}'
  ].join('\n')
}

/**
 * 必要时压缩一段会话：新消息达到 COMPACT_AFTER 条就请该会话的负责人（私聊=本人，
 * 群聊=管理员）总结一次。失败不影响聊天，只是这段记忆暂不更新。
 */
export async function compactIfNeeded(ctx, parent, kind, id, messages, member, peerName, signal) {
  if (member === undefined || member === null) return false
  const memory = await loadMemory()
  const slot = slotOf(memory, kind, id)
  const fresh = messages.length - slot.since
  if (fresh < COMPACT_AFTER) return false
  const prompt = compactPrompt(slot, messages, peerName)
  const result = await dispatchToMember(ctx, parent, member, prompt, signal)
  const parsed = parseCompaction(result.output)
  if (parsed === null) return false
  slot.summary = parsed.summary
  for (const fact of parsed.facts) addFact(slot, fact)
  slot.since = messages.length
  slot.updatedAt = new Date().toISOString()
  await saveMemory(memory)
  return true
}
