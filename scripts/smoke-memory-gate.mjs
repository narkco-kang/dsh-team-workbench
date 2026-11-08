#!/usr/bin/env node
/**
 * smoke-memory-gate.mjs — 记忆注入的「相关性门」回归。
 *
 * 3.5.3 及以前的 memoryBlock 会把【本会话场景】+ 召回 6 条事实无条件塞进每一轮 prompt。
 * 群里聊完「2.16.0 灰度 / 补 tag / No-Go」之后，用户问「最近AI产品热点」，
 * 模型看到的是 1168 字的旧发布计划 + 8 个字的问题 —— 于是回答发布计划。
 *
 * 这个用例把「被污染的会话记忆」造出来，断言：
 *   1. 独立提问不注入旧话题（无论有没有向量服务）；
 *   2. 明确追问才注入对应记忆；
 *   3. TW_MEMORY_MODE=off / all 两个开关还在。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wb-memory-'))
process.env.DSH_HOME = home
// 测试环境不连本机 Ollama：只用关键词兜底，结果可复现。
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
const persona = {
  items: [{ id: 'p1', text: '偏好先给结论再给依据' }],
  updatedAt: now
}

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''))
}

const fresh = await memoryBlock(slot, persona, '最近AI产品热点', { followUp: false })
check('独立提问不注入旧场景摘要', !fresh.includes('2.16.0') && !fresh.includes('灰度'), 'chars=' + fresh.length)
check('独立提问不注入无关事实', !fresh.includes('补 tag') && !fresh.includes('名册'), 'chars=' + fresh.length)
check('用户偏好仍然保留', fresh.includes('偏好先给结论'), '')

const other = await memoryBlock(slot, persona, '帮我改一下聊天窗口的字体', { followUp: false })
check('换一个无关问题同样干净', !other.includes('2.16.0') && !other.includes('灰度'), 'chars=' + other.length)

const follow = await memoryBlock(slot, persona, '那个 tag 什么时候补', { followUp: true })
check('追问能召回相关记忆', follow.includes('2.16.0'), 'chars=' + follow.length)

const legacy = await memoryBlock(slot, persona, '最近AI产品热点', { mode: 'all' })
check('TW_MEMORY_MODE=all 仍是旧的全量注入（排障用）', legacy.includes('2.16.0'), 'chars=' + legacy.length)

const off = await memoryBlock(slot, persona, '那个 tag 什么时候补', { mode: 'off' })
check('TW_MEMORY_MODE=off 完全不注入', off === '', JSON.stringify(off.slice(0, 40)))

const empty = await memoryBlock({ l2: { summary: '', at: '' }, atoms: [], since: 0, updatedAt: '' }, { items: [] }, '随便问问', {})
check('没有记忆时返回空串', empty === '', JSON.stringify(empty))

console.log(failures === 0 ? '\n记忆门禁回归全部通过' : '\n失败 ' + failures + ' 项')
process.exit(failures === 0 ? 0 : 1)
