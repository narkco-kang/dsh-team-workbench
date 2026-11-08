/**
 * dsh-team-workbench / 会话记忆（L0–L3 分层 + BM25 召回）
 *
 * 参考 TencentCloud/TencentDB-Agent-Memory 的分层思路（不是接它的服务）：
 *   L0 对话：chats.json 的原始消息
 *   L1 原子事实：atoms[]，带 key / 重要度 / 来源消息 / 访问计数
 *   L2 场景摘要：l2.summary
 *   L3 用户画像：persona.items[]
 *
 * 召回：BM25（中文按二元组切词）+ 重要度 + 时间衰减 + 访问强化，取前 K 条；
 * 记忆面板里还能按关键词跨会话检索（渐进披露的下钻入口）。
 *
 * 存储：$DSH_HOME/team-workbench/memory.json（version 2）
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { dispatchToMember, harnessHome, makeId, text } from './team.js'

const MEMORY_FILE = 'memory.json'
const MEMORY_VERSION = 2
const COMPACT_AFTER = 12
const MAX_ATOMS = 40
const MAX_PERSONA = 12
const MAX_SUMMARY = 1600
const RECALL_LIMIT = 6
const TRANSCRIPT_FOR_COMPACT = 40
const BM25_K1 = 1.2
const BM25_B = 0.75
const SIMILARITY_MERGE = 0.8

const SETTINGS_FILE = 'memory-settings.json'
const VECTORS_FILE = 'memory-vectors.json'
const EMBED_BATCH = 16
const EMBED_TIMEOUT_MS = 15000

/** 默认走本机 Ollama 的 OpenAI 兼容端点；没有就自动退回 BM25。 */
const DEFAULT_SETTINGS = {
  // qwen3-embedding:0.6b 对中文明显更稳（nomic-embed-text 在中文上区分度很差，别用）。
  embedding: { enabled: true, baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3-embedding:0.6b', key: '' }
}

function memoryPath() {
  return join(harnessHome(), 'team-workbench', MEMORY_FILE)
}

function settingsPath() {
  return join(harnessHome(), 'team-workbench', SETTINGS_FILE)
}

function vectorsPath() {
  return join(harnessHome(), 'team-workbench', VECTORS_FILE)
}

export async function loadSettings() {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8'))
    const embedding = parsed !== null && typeof parsed.embedding === 'object' && parsed.embedding !== null ? parsed.embedding : {}
    return {
      embedding: {
        enabled: embedding.enabled !== false,
        baseUrl: text(embedding.baseUrl) || DEFAULT_SETTINGS.embedding.baseUrl,
        model: text(embedding.model) || DEFAULT_SETTINGS.embedding.model,
        key: text(embedding.key)
      }
    }
  } catch {
    return { embedding: { ...DEFAULT_SETTINGS.embedding } }
  }
}

export async function saveSettings(settings) {
  const target = settingsPath()
  await mkdir(dirname(target), { recursive: true })
  const embedding = settings.embedding || DEFAULT_SETTINGS.embedding
  const payload = JSON.stringify({
    embedding: {
      enabled: embedding.enabled !== false,
      baseUrl: text(embedding.baseUrl) || DEFAULT_SETTINGS.embedding.baseUrl,
      model: text(embedding.model) || DEFAULT_SETTINGS.embedding.model,
      key: text(embedding.key)
    }
  }, null, 2)
  const temp = target + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(temp, payload, 'utf8')
  await rename(temp, target)
}

function hashOf(value) {
  return createHash('sha1').update(text(value)).digest('hex').slice(0, 16)
}

async function loadVectors() {
  try {
    const parsed = JSON.parse(await readFile(vectorsPath(), 'utf8'))
    return { model: text(parsed?.model), items: parsed !== null && typeof parsed.items === 'object' && parsed.items !== null ? parsed.items : {} }
  } catch {
    return { model: '', items: {} }
  }
}

async function saveVectors(cache) {
  const target = vectorsPath()
  await mkdir(dirname(target), { recursive: true })
  const temp = target + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(temp, JSON.stringify({ model: cache.model, items: cache.items }), 'utf8')
  await rename(temp, target)
}

/** 调 OpenAI 兼容的 /embeddings；失败抛错，由调用方回退 BM25。 */
export async function embedTexts(settings, texts) {
  const cfg = settings.embedding || DEFAULT_SETTINGS.embedding
  if (cfg.enabled === false) throw new Error('向量召回已关闭')
  const base = text(cfg.baseUrl).replace(/\/+$/, '')
  if (base.length === 0) throw new Error('没有配置 embedding 地址')
  const headers = { 'content-type': 'application/json' }
  if (text(cfg.key).length > 0) headers.authorization = 'Bearer ' + text(cfg.key)
  const response = await fetch(base + '/embeddings', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model, input: texts }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error('embedding HTTP ' + String(response.status))
  const body = await response.json()
  const rows = Array.isArray(body?.data) ? body.data : []
  const vectors = rows.map((row) => (Array.isArray(row?.embedding) ? row.embedding : null)).filter((vector) => Array.isArray(vector))
  if (vectors.length !== texts.length) throw new Error('embedding 返回条数不匹配')
  return vectors
}

/** 补齐缺失/变更的原子向量；批量小、失败不影响聊天。 */
async function ensureVectors(atoms, settings, cache) {
  const model = text((settings.embedding || {}).model)
  if (cache.model !== model) { cache.model = model; cache.items = {} }
  const missing = []
  for (const atom of atoms) {
    const entry = cache.items[atom.id]
    if (entry === undefined || entry.h !== hashOf(atom.text)) missing.push(atom)
  }
  for (let offset = 0; offset < missing.length; offset += EMBED_BATCH) {
    const batch = missing.slice(offset, offset + EMBED_BATCH)
    const vectors = await embedTexts(settings, batch.map((atom) => atom.text))
    batch.forEach((atom, index) => { cache.items[atom.id] = { h: hashOf(atom.text), v: vectors[index] } })
  }
  if (missing.length > 0) await saveVectors(cache)
  return cache
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let left = 0
  let right = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    left += a[index] * a[index]
    right += b[index] * b[index]
  }
  if (left === 0 || right === 0) return 0
  return dot / Math.sqrt(left * right)
}

/** 中文虚词二元组：不参与召回打分。 */
const STOPWORDS = new Set([
  '的了', '我们', '你们', '他们', '这个', '那个', '可以', '就是', '然后', '而且',
  '但是', '因为', '所以', '如果', '已经', '还是', '一个', '不是', '没有', '什么',
  '怎么', '这样', '那样', '以及', '并且', '或者', '就是', '现在', '时候', '一下'
])

/** 同义词组：查询命中任意一个词，就把同组其它词一起拿来匹配。 */
const SYNONYMS = [
  ['上线', '发布', '发版', '交付', '上线时间'],
  ['接口', 'api', '联调', '对接'],
  ['验收', '验收标准', '验收条件', '测试通过'],
  ['需求', '功能', '特性', '诉求'],
  ['测试', '用例', 'qa', '自测'],
  ['文档', '说明', '说明书', '手册'],
  ['预算', '报价', '费用', '成本'],
  ['排期', '工期', '时间表', '计划'],
  ['风险', '隐患', '阻塞'],
  ['用户', '客户', '甲方']
]

/** 把查询词扩展成「原词 + 同组其它词」，并去掉停用词。 */
export function expandTerms(value) {
  const base = tokenize(value).filter((token) => !STOPWORDS.has(token))
  const expanded = new Set(base)
  for (const group of SYNONYMS) {
    const hit = group.some((word) => value.toLowerCase().includes(word))
    if (!hit) continue
    for (const word of group) for (const token of tokenize(word)) expanded.add(token)
  }
  return expanded
}

function emptyMemory() {
  return { version: MEMORY_VERSION, persona: { items: [], updatedAt: '' }, private: {}, rooms: {} }
}

/** 中文按二元组、英文按词切；去重由调用方决定。 */
export function tokenize(value) {
  const lower = text(value).toLowerCase()
  const out = []
  for (const word of lower.match(/[a-z0-9]+/g) || []) out.push(word)
  const cjk = lower.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const segment of cjk.split(/\s+/)) {
    for (let index = 0; index + 1 < segment.length; index += 1) out.push(segment.slice(index, index + 2))
  }
  return out
}

function jaccardSimilar(a, b) {
  const left = new Set(tokenize(a))
  const right = new Set(tokenize(b))
  if (left.size === 0 || right.size === 0) return 0
  let common = 0
  for (const token of left) if (right.has(token)) common += 1
  return common / (left.size + right.size - common)
}

/** 读取记忆；v1（summary + facts）就地升级成 v2。 */
export async function loadMemory() {
  try {
    const parsed = JSON.parse(await readFile(memoryPath(), 'utf8'))
    return {
      version: MEMORY_VERSION,
      persona: normalizePersona(parsed?.persona),
      private: migrateBag(parsed?.private),
      rooms: migrateBag(parsed?.rooms)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[team-workbench] 读取会话记忆失败：' + String(error))
    return emptyMemory()
  }
}

function normalizePersona(value) {
  const items = Array.isArray(value?.items)
    ? value.items
        .map((item) => ({ id: text(item?.id) || makeId('persona'), text: text(item?.text).slice(0, 300), at: text(item?.at) }))
        .filter((item) => item.text.length > 0)
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
    from: text(raw?.from),
    hits: Number.isFinite(Number(raw?.hits)) ? Math.max(0, Math.round(Number(raw.hits))) : 0
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

/** 一组事实的 BM25 统计（df / 平均长度）。 */
function atomStats(atoms) {
  const df = new Map()
  let total = 0
  for (const atom of atoms) {
    const terms = new Set(atomTerms(atom))
    total += terms.size
    for (const term of terms) df.set(term, (df.get(term) || 0) + 1)
  }
  return { df, N: atoms.length, avg: atoms.length > 0 ? total / atoms.length : 0 }
}

function atomTerms(atom) {
  const textTerms = tokenize(atom.text).filter((token) => !STOPWORDS.has(token))
  const keyTerms = tokenize(atom.key).filter((token) => !STOPWORDS.has(token))
  // key 是人工/模型标注的属性名，命中它比命中正文更有价值。
  return textTerms.concat(keyTerms, keyTerms)
}

function bm25(atom, queryTerms, stats) {
  const terms = atomTerms(atom)
  const length = terms.length
  const tf = new Map()
  for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1)
  let score = 0
  for (const term of queryTerms) {
    const freq = tf.get(term) || 0
    if (freq === 0) continue
    const df = stats.df.get(term) || 0
    const idf = Math.log(1 + (stats.N - df + 0.5) / (df + 0.5))
    const norm = freq + BM25_K1 * (1 - BM25_B + BM25_B * length / (stats.avg || 1))
    score += idf * (freq * (BM25_K1 + 1)) / norm
  }
  return score
}

function recencyBoost(atom) {
  const age = (Date.now() - Date.parse(atom.at || '')) / 86400000
  if (!Number.isFinite(age)) return 0
  return Math.max(0, 2 - age / 30)
}

/** 同 key 只留最新；按 BM25 + 重要度 + 新鲜度 + 访问次数排序。 */
function rankAtoms(atoms, userText) {
  const queryTerms = expandTerms(userText)
  const stats = atomStats(atoms)
  const byKey = new Map()
  for (const atom of atoms) {
    if (atom.key.length === 0) continue
    const previous = byKey.get(atom.key)
    if (previous === undefined || String(atom.at) > String(previous.at)) byKey.set(atom.key, atom)
  }
  const merged = atoms.filter((atom) => atom.key.length === 0 || byKey.get(atom.key) === atom)
  return merged
    .map((atom) => {
      const relevance = queryTerms.size > 0 ? bm25(atom, queryTerms, stats) : 0
      const score = relevance * 3 + atom.importance + recencyBoost(atom) + Math.min(2, atom.hits * 0.4)
      return { atom, score, relevant: relevance > 0 }
    })
    .sort((a, b) => Number(b.relevant) - Number(a.relevant) || b.score - a.score)
}

/** 按当前用户消息召回事实；没有关键词时按重要度/新鲜度取前几条。 */
export function recallAtoms(slot, userText, limit = RECALL_LIMIT) {
  return rankAtoms(slot.atoms, userText).slice(0, limit).map((entry) => entry.atom)
}

/** 被召回的事实累加 hits，下次更容易被想起（访问强化）。 */
export function touchAtoms(atoms) {
  for (const atom of atoms) atom.hits = (atom.hits || 0) + 1
}

/**
 * 混合召回：BM25 与向量各出一份排名，用 RRF（1/(60+rank)）融合。
 * 向量服务不可用时自动退回 BM25，不影响聊天。
 */
export async function recallAtomsHybrid(slot, userText, limit = RECALL_LIMIT) {
  const lexicalRanked = rankAtoms(slot.atoms, userText)
  // 查询词在事实里一个都没命中时，BM25 的排序没有信息量，直接交给向量。
  const keywordsPresent = lexicalRanked.some((entry) => entry.relevant)
  const lexical = lexicalRanked.slice(0, Math.max(limit * 3, 12)).map((entry) => entry.atom)
  let settings
  try {
    settings = await loadSettings()
  } catch {
    return lexical.slice(0, limit)
  }
  try {
    const cache = await loadVectors()
    await ensureVectors(slot.atoms, settings, cache)
    const [queryVector] = await embedTexts(settings, [userText])
    const vectorRank = slot.atoms
      .map((atom) => ({ atom, score: cosine(queryVector, (cache.items[atom.id] || {}).v) }))
      .filter((entry) => entry.score > 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
    if (!keywordsPresent && vectorRank.length > 0) {
      return vectorRank.slice(0, limit).map((entry) => entry.atom)
    }
    const fused = new Map()
    // 向量在语义近似上更稳，权重略高；两边都命中的事实会累积两份 RRF。
    const add = (id, rank, weight) => fused.set(id, (fused.get(id) || 0) + weight / (60 + rank))
    lexical.forEach((atom, index) => add(atom.id, index, 1))
    vectorRank.forEach((entry, index) => add(entry.atom.id, index, 1.3))
    return slot.atoms
      .filter((atom) => fused.has(atom.id))
      .sort((a, b) => fused.get(b.id) - fused.get(a.id))
      .slice(0, limit)
  } catch {
    return lexical.slice(0, limit)
  }
}

/**
 * 记忆注入模式：
 *   off    完全不注入；
 *   strict 默认，只在「确实相关」时注入（3.5.4 起）；
 *   all    3.5.3 及以前的行为（无条件把场景 + 6 条事实灌进每一轮），只用于排查。
 */
export function memoryMode(value) {
  const raw = value === undefined || value === null ? process.env.TW_MEMORY_MODE : value
  const mode = text(raw).trim().toLowerCase()
  return mode === 'off' || mode === 'all' ? mode : 'strict'
}

const INJECT_ATOMS = 3
const INJECT_SUMMARY_CHARS = 500
const INJECT_PERSONA_ITEMS = 3
const ATOM_VECTOR_GATE = 0.55

/** 查询词与一段文本共享多少个（长度 ≥ 2 的）中文/英文词元。 */
function sharedTermCount(query, corpus) {
  const wanted = expandTerms(query)
  if (wanted.size === 0) return 0
  const have = new Set(tokenize(corpus))
  let hits = 0
  for (const term of wanted) if (have.has(term)) hits += 1
  return hits
}

/**
 * 只取「真的相关」的事实：BM25 命中，或向量相似度过门限。
 * 一条都不相关就返回空 —— 这正是 3.5.3 之前缺失的一步：
 * 旧的 recallAtomsHybrid 无论相关与否都会凑满 6 条，于是群里聊过的
 * 「2.16.0 灰度 / tag / No-Go」被无条件塞进每一轮，连「最近AI产品热点」
 * 这种独立提问也会被它拽回旧话题。
 */
async function gatedAtoms(slot, userText, limit) {
  if (slot === undefined || slot === null || !Array.isArray(slot.atoms) || slot.atoms.length === 0) return []
  const picked = []
  const take = (atom) => {
    if (picked.length >= limit) return
    if (picked.some((entry) => entry.id === atom.id)) return
    picked.push(atom)
  }
  // 语义相近优先：只有向量相似度过门限的事实才算「与这轮相关」。
  try {
    const settings = await loadSettings()
    const cache = await loadVectors()
    await ensureVectors(slot.atoms, settings, cache)
    const [queryVector] = await embedTexts(settings, [userText])
    const ranked = slot.atoms
      .map((atom) => ({ atom, score: cosine(queryVector, (cache.items[atom.id] || {}).v) }))
      .filter((entry) => entry.score >= ATOM_VECTOR_GATE)
      .sort((a, b) => b.score - a.score)
    for (const entry of ranked) take(entry.atom)
    if (ranked.length > 0) return picked
  } catch { /* 没有向量服务、或这一轮不许联网取向量：退回下面的关键词判定。 */ }
  // 关键词兜底要求「两处词元重合」：像「最近AI产品热点」只和旧事实共享一个
  // “产品”二字，不该把「名册 5 个身份」这种无关事实塞进来。
  for (const entry of rankAtoms(slot.atoms, userText)) {
    if (entry.relevant && sharedTermCount(userText, entry.atom.text) >= 2) take(entry.atom)
  }
  return picked
}

/** 记忆块：只在确实和本轮相关时注入，绝不无条件粘贴。 */
export async function memoryBlock(slot, persona, userText, options) {
  const opts = options !== undefined && options !== null && typeof options === 'object' ? options : {}
  const mode = memoryMode(opts.mode)
  if (mode === 'off') return ''
  if (mode === 'all') return legacyMemoryBlock(slot, persona, userText)

  const followUp = opts.followUp === true
  const parts = []

  const items = persona !== undefined && persona !== null && Array.isArray(persona.items) ? persona.items : []
  const personaText = items
    .slice(-INJECT_PERSONA_ITEMS)
    .map((item) => text(item.text).trim())
    .filter((line) => line.length > 0)
    .join('；')
  if (personaText.length > 0) parts.push('【用户偏好】' + personaText.slice(0, 400))

  const summary = slot !== undefined && slot !== null && slot.l2 !== undefined && slot.l2 !== null ? text(slot.l2.summary).trim() : ''
  if (summary.length > 0) {
    // 场景摘要是「上一段话题」的浓缩，最容易把模型拉回去：默认要两处词元重合才带，
    // 明确追问（继续/刚才/那个…）时一处重合就够。
    const shared = sharedTermCount(userText, summary)
    if (shared >= (followUp ? 1 : 2)) parts.push('【更早的话题 · 可能相关】' + summary.slice(0, INJECT_SUMMARY_CHARS))
  }

  const atoms = await gatedAtoms(slot, userText, INJECT_ATOMS)
  if (atoms.length > 0) parts.push('【可能相关的事实】' + atoms.map((atom) => text(atom.text).trim().slice(0, 120)).join('；'))

  if (parts.length === 0) return ''
  return [
    '【历史记忆 · 仅供参考】',
    ...parts,
    '（上面是更早对话留下的记录。只有与本轮消息确实相关时才使用；不相关就整段忽略，按用户这条消息本身回答。）'
  ].join('\n')
}

/** 3.5.3 及以前的注入方式：L3 画像 + L2 场景 + 6 条召回，全部无条件灌进去。 */
async function legacyMemoryBlock(slot, persona, userText) {
  const parts = []
  if (persona !== undefined && persona !== null && Array.isArray(persona.items) && persona.items.length > 0) {
    parts.push('【用户画像】' + persona.items.map((item) => item.text).join('；'))
  }
  if (slot !== undefined && slot !== null && slot.l2.summary.trim().length > 0) parts.push('【本会话场景】' + slot.l2.summary.trim())
  const atoms = slot !== undefined && slot !== null ? await recallAtomsHybrid(slot, userText, RECALL_LIMIT) : []
  if (atoms.length > 0) parts.push('【相关事实】' + atoms.map((atom) => atom.text).join('；'))
  if (parts.length === 0) return ''
  return ['【长期记忆】', ...parts, '（记忆可能过时，和新消息冲突时以新消息为准。）'].join('\n')
}

/** 写一条原子事实；同 key 覆盖、近重复合并、超出上限时丢掉分最低的。 */
export function addAtom(slot, raw) {
  const atom = normalizeAtom(raw)
  if (atom.text.length === 0) return false
  const exact = slot.atoms.find((item) => item.text === atom.text)
  if (exact !== undefined) { exact.hits = (exact.hits || 0) + 1; return false }
  // 近重复不新增，而是合并：留更长的那句、取更高重要度、累加访问次数。
  const near = slot.atoms.find((item) => jaccardSimilar(item.text, atom.text) >= SIMILARITY_MERGE)
  if (near !== undefined) {
    if (atom.text.length > near.text.length) near.text = atom.text
    near.importance = Math.max(near.importance, atom.importance)
    near.hits = (near.hits || 0) + 1
    if (atom.key.length > 0 && near.key.length === 0) near.key = atom.key
    return false
  }
  if (atom.key.length > 0) slot.atoms = slot.atoms.filter((item) => item.key !== atom.key)
  slot.atoms.push(atom)
  if (slot.atoms.length > MAX_ATOMS) {
    const keep = new Set(rankAtoms(slot.atoms, '').slice(0, MAX_ATOMS).map((entry) => entry.atom.id))
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
  if (value.length === 0) return false
  if (persona.items.some((item) => item.text === value || jaccardSimilar(item.text, value) >= SIMILARITY_MERGE)) return false
  persona.items.push({ id: makeId('persona'), text: value, at: new Date().toISOString() })
  if (persona.items.length > MAX_PERSONA) persona.items = persona.items.slice(-MAX_PERSONA)
  return true
}

export function removePersona(persona, itemId) {
  const before = persona.items.length
  persona.items = persona.items.filter((item) => item.id !== itemId)
  return persona.items.length !== before
}

/** 记忆规模：面板顶部展示，也方便排查「怎么没记住」。 */
export function memoryStats(memory) {
  const slots = [...Object.values(memory.private), ...Object.values(memory.rooms)]
  return {
    conversations: slots.length,
    atoms: slots.reduce((total, slot) => total + slot.atoms.length, 0),
    scenes: slots.filter((slot) => slot.l2.summary.trim().length > 0).length,
    persona: memory.persona.items.length
  }
}

/** 跨会话检索事实：记忆面板的关键词下钻。 */
export function searchMemory(memory, query, limit = 30) {
  const rows = []
  for (const [id, slot] of Object.entries(memory.private)) {
    for (const atom of slot.atoms) rows.push({ kind: 'private', id, atom })
  }
  for (const [id, slot] of Object.entries(memory.rooms)) {
    for (const atom of slot.atoms) rows.push({ kind: 'room', id, atom })
  }
  const terms = expandTerms(query)
  if (terms.size === 0) return rows.slice(0, limit)
  const stats = atomStats(rows.map((row) => row.atom))
  return rows
    .map((row) => ({ ...row, score: bm25(row.atom, terms, stats) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** 跨会话检索：BM25 + 向量 RRF。 */
export async function searchMemoryHybrid(memory, query, limit = 30) {
  const lexical = searchMemory(memory, query, limit * 2)
  let settings
  try {
    settings = await loadSettings()
  } catch {
    return lexical.slice(0, limit)
  }
  try {
    const rows = []
    for (const [id, slot] of Object.entries(memory.private)) for (const atom of slot.atoms) rows.push({ kind: 'private', id, atom })
    for (const [id, slot] of Object.entries(memory.rooms)) for (const atom of slot.atoms) rows.push({ kind: 'room', id, atom })
    const cache = await loadVectors()
    await ensureVectors(rows.map((row) => row.atom), settings, cache)
    const [queryVector] = await embedTexts(settings, [query])
    const vectorRank = rows
      .map((row) => ({ row, score: cosine(queryVector, (cache.items[row.atom.id] || {}).v) }))
      .filter((entry) => entry.score > 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
    const fused = new Map()
    const add = (key, rank) => fused.set(key, (fused.get(key) || 0) + 1 / (60 + rank))
    lexical.forEach((row, index) => add(row.kind + ':' + row.atom.id, index))
    vectorRank.forEach((entry, index) => add(entry.row.kind + ':' + entry.row.atom.id, index))
    return rows
      .filter((row) => fused.has(row.kind + ':' + row.atom.id))
      .sort((a, b) => fused.get(b.kind + ':' + b.atom.id) - fused.get(a.kind + ':' + a.atom.id))
      .slice(0, limit)
      .map((row) => ({ ...row, score: fused.get(row.kind + ':' + row.atom.id) }))
  } catch {
    return lexical.slice(0, limit)
  }
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
  touchAtoms(slot.atoms.slice(-parsed.atoms.length - 3))
  slot.since = messages.length
  slot.updatedAt = new Date().toISOString()
  await saveMemory(memory)
  return true
}
