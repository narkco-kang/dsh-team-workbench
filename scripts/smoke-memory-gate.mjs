#!/usr/bin/env node
/**
 * smoke-memory-gate.mjs — 「旧记忆不得干扰新会话」的回归。
 *
 * 3.5.3 及以前：memoryBlock 把【本会话场景】+ 6 条召回无条件塞进每一轮。
 * 群里聊完 2.16.0 之后，用户问「最近AI产品热点」，模型收到的是 1168 字旧发布计划
 * + 8 个字的问题，于是照着记忆回答。
 *
 * 3.5.5 起是两道结构性闸门，不靠提示词措辞：
 *   1. continuity 硬门：这一轮不是接着上一轮 → 一条记忆都不注入；
 *   2. 字数硬预算：整块 ≤ max(120, 本句长度×2+40) 且 ≤ 320 字。
 * 这个用例用「被污染的会话记忆」把这些约束全部钉住。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wb-memory-'))
process.env.DSH_HOME = home
// 不连本机 Ollama：只用关键词兜底，结果可复现。
mkdirSync(join(home, 'team-workbench'), { recursive: true })
writeFileSync(join(home, 'team-workbench', 'memory-settings.json'), JSON.stringify({ embedding: { enabled: false } }), 'utf8')

const { memoryBlock } = await import('../dsh/memory.js')

const now = new Date().toISOString()
const slot = {
  l2: {
    summary: '2.16.0 成员人格注入定于 11-12 灰度、11-13 发布；范围收窄为只保留 subagent persona 单通道；11-09 冻结范围并补 tag=2.16.0；当前结论 No-Go。',
    at: now
  },
  atoms: [
    { id: 'a1', text: '补 tag 是 2.16.0 发布的前置条件，最新 tag 仅到 v2.6.0', key: '约束:tag', importance: 5, at: now, hits: 1 },
    { id: 'a2', text: '11-12 18:00 四项判据全绿才能转 Go', key: '约束:判据', importance: 4, at: now, hits: 1 },
    { id: 'a3', text: '名册现有 5 个身份、0 个正式群组', key: '事实:名册', importance: 3, at: now, hits: 1 }
  ],
  since: 0,
  updatedAt: now
}
const persona = { items: [{ id: 'p1', text: '偏好先给结论再给依据' }], updatedAt: now }

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''))
}
const budgetOf = (question) => Math.min(320, Math.max(120, question.length * 2 + 40))

// —— 闸门 1：不是接着上一轮 → 一个字都不注入 ——
const independent = await memoryBlock(slot, persona, '最近AI产品热点', { followUp: false, continuity: false })
check('新会话第一句不注入任何旧记忆', independent === '', JSON.stringify(independent))

const sweep = [
  '最近AI产品热点',
  '帮我把界面字体调大点',
  '你好',
  '今天几号',
  '给我讲讲 RAG 的召回原理',
  '这个季度的行业趋势有哪些',
  '把面板宽度改成 420',
  '列一下 DSH 的插件槽位',
  '写个 Python 快速排序',
  '解释一下 BM25',
  '明天天气怎么样',
  '推荐几本设计书'
]
const leaked = []
for (const question of sweep) {
  const block = await memoryBlock(slot, persona, question, { followUp: false, continuity: false })
  if (block !== '') leaked.push(question + '→' + block.length)
}
check('无关问题扫一遍，旧记忆零泄漏', leaked.length === 0, leaked.join(' | '))

const markerButNew = await memoryBlock(slot, persona, '那个字体怎么调大', { followUp: true, continuity: true })
check('有追问词但和旧话题无关时也不注入', !markerButNew.includes('2.16.0') && !markerButNew.includes('灰度'), JSON.stringify(markerButNew.slice(0, 60)))

// —— 闸门 2：明确追问才出场，且字数被硬预算卡住 ——
const follow = await memoryBlock(slot, persona, '那个 tag 什么时候补', { followUp: true, continuity: true })
check('追问能召回相关记忆', follow.includes('2.16.0'), 'chars=' + follow.length)
check('追问的记忆不超硬预算', follow.length <= budgetOf('那个 tag 什么时候补'), follow.length + '/' + budgetOf('那个 tag 什么时候补'))

const shortQuestion = '2.16.0 能发吗'
const shortFollow = await memoryBlock(slot, persona, shortQuestion, { followUp: false, continuity: true })
check('短问题的记忆被预算压住（不会反客为主）', shortFollow.length <= budgetOf(shortQuestion), shortFollow.length + '/' + budgetOf(shortQuestion))

const longQuestion = '把 2.16.0 的发布判据、回滚条件、以及 11-12 那天的具体时间点按顺序列给我，并标注哪些是已确认、哪些还待裁决'
const longFollow = await memoryBlock(slot, persona, longQuestion, { followUp: false, continuity: true })
check('长问题可以有更多记忆，但仍有上限', longFollow.length <= budgetOf(longQuestion) && longFollow.length <= 320, longFollow.length + '/' + budgetOf(longQuestion))

// —— 开关与空槽 ——
const legacy = await memoryBlock(slot, persona, '最近AI产品热点', { mode: 'all' })
check('TW_MEMORY_MODE=all 仍是旧的全量注入（排障用）', legacy.includes('2.16.0'), 'chars=' + legacy.length)

const off = await memoryBlock(slot, persona, '那个 tag 什么时候补', { mode: 'off' })
check('TW_MEMORY_MODE=off 完全不注入', off === '', JSON.stringify(off.slice(0, 40)))

const emptySlot = { l2: { summary: '', at: '' }, atoms: [], since: 0, updatedAt: '' }
const empty = await memoryBlock(emptySlot, { items: [] }, '随便问问', { continuity: true })
check('没有记忆时返回空串', empty === '', JSON.stringify(empty))

console.log(failures === 0 ? '\n记忆门禁回归全部通过（旧记忆不可能污染新会话）' : '\n失败 ' + failures + ' 项')
process.exit(failures === 0 ? 0 : 1)
