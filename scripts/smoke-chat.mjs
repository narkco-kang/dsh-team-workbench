#!/usr/bin/env node
/**
 * smoke-chat.mjs — 私聊 / 群聊服务端冒烟（假 subagents，不调真模型）。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wb-chat-'))
process.env.DSH_HOME = home

const routes = new Map()
const tools = []
const prompts = []
const parent = { id: 'parent' }
let engineerName = '前端开发者'
let relayMentionTo = ''

const subagents = {
  list: () => ['spawn'],
  start: (provider, request) => {
    const prompt = request.prompt[0].text
    prompts.push(prompt)
    let output = '收到。'
    if (prompt.includes('【群聊') && prompt.includes('你是本群管理员')) output = '我来安排：@' + engineerName + ' 你评估一下。'
    else if (prompt.includes('你是成员「' + engineerName + '」')) {
      output = '结论：可以，两天完成。'
      if (relayMentionTo.length > 0 && prompt.includes('接力测')) output += '@' + relayMentionTo + ' 你补一下风险。'
    }
    else if (prompt.includes('你是成员')) output = '成员回复：好。'
    const id = 'child-' + String(prompts.length)
    // 「慢测」让这一轮多花 1.5s：用来验证超过 grace 的后台成员也会被主管汇总。
    const slow = prompt.includes('慢测') && prompt.includes('「前端开发者」')
    return {
      id,
      childId: id,
      result: slow
        ? new Promise((resolve) => {
          setTimeout(() => resolve({ stopReason: 'completed', output: [{ type: 'text', text: output }] }), 1500)
        })
        : Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: output }] }),
      dispose: async () => {}
    }
  }
}

const connection = { fetch: { register: (route) => { routes.set(route.path, route.fetch); return () => {} } } }
const toolRegistry = { register: (t) => { tools.push(t); return () => {} } }
const ctx = {
  connection,
  tools: toolRegistry,
  get(name) {
    if (name === 'connection') return connection
    if (name === 'tools') return toolRegistry
    if (name === 'subagents') return subagents
    if (name === 'agents') return { get: (id) => (id === 'session-1' ? parent : undefined) }
    if (name === 'llm') return { listProviders: () => [], listModels: async () => [] }
    if (name === 'systemPrompt') return undefined
    return undefined
  },
  effect(fn) { try { fn() } catch { /* 挂载期效果 */ } return () => {} },
  inject(_names, fn) { /* 跳过关键词触发 */ },
  logger: { info() {}, warn() {} }
}

const mod = await import('../dsh/index.js')
mod.apply(ctx, {})

const call = async (path, body) => {
  const handler = routes.get(path.split('?')[0])
  if (!handler) throw new Error('missing route ' + path)
  const request = new Request('http://x' + path, body === undefined
    ? { method: 'GET' }
    : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  const response = await handler(request)
  return response.json()
}

let failures = 0
const check = (name, ok, detail) => { if (!ok) failures += 1; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : '')) }

const preset = await call('/api/team-workbench/preset', { id: 'project-department', mode: 'replace' })
check('预设团队就绪', preset.ok === true && preset.members.length >= 10, String(preset.members && preset.members.length))
const members = preset.members
const architect = members.find((m) => m.name === '架构师') || members[0]
const engineer = members.find((m) => m.name === '前端开发者') || members[1]
engineerName = engineer.name

const overview = await call('/api/team-workbench/chats')
check('会话概览返回私聊列表', overview.ok === true && overview.private.length === members.length, String(overview.private && overview.private.length))
check('会话概览返回群聊列表', Array.isArray(overview.rooms))

const first = await call('/api/team-workbench/chats/private', { sessionId: 'session-1', memberId: architect.id, text: '你好，先介绍下你负责什么' })
check('私聊发送成功', first.ok === true && first.messages.length === 2, first.error || String(first.messages && first.messages.length))
check('私聊回复非空', first.ok === true && first.reply.text.length > 0)
const second = await call('/api/team-workbench/chats/private', { sessionId: 'session-1', memberId: architect.id, text: '继续，说细一点' })
check('私聊可连续追问', second.ok === true && second.messages.length === 4, String(second.messages && second.messages.length))
check('第二次请求带上了历史记录', prompts.some((p) => p.includes('你好，先介绍下你负责什么')), 'prompts=' + String(prompts.length))

const roomRes = await call('/api/team-workbench/chats/rooms', {
  action: 'create',
  room: { name: '项目例会', adminId: architect.id, memberIds: [architect.id, engineer.id, members[2].id] }
})
check('创建群聊', roomRes.ok === true && roomRes.room && roomRes.room.name === '项目例会', roomRes.error || '')
const roomId = roomRes.room.id

const group = await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: roomId, text: '这个需求两天能做吗？' })
check('群聊管理员回复并 @ 了成员', group.ok === true && group.turns.length === 2, group.error || String(group.turns && group.turns.length))
const groupVisible = group.messages.filter((m) => m.hidden !== true)
check('群聊对外只有用户消息 + 管理员汇总', groupVisible.length === 2 && groupVisible[0].role === 'user' && groupVisible[1].name === group.turns[0].name, groupVisible.map((m) => m.name + ':' + m.text.slice(0, 20)).join(' | '))
check('成员回答仍作为内部记录保留', group.messages.filter((m) => m.hidden === true).length >= 1, String(group.messages.length))
check('被 @ 的成员确实收到了任务', prompts.some((p) => p.includes('@ 了你') && p.includes('两天')), '')

check('群聊对外文本不含 @ 指令', groupVisible.every((m) => !String(m.text).includes('@')), groupVisible.map((m) => String(m.text).slice(0, 24)).join(' | '))

// 接力：成员之间的讨论留在内部记录/状态条，对外只发一条汇总，且不带 @ 指令。
relayMentionTo = architect.name
const relayRoomRes = await call('/api/team-workbench/chats/rooms', {
  action: 'create',
  room: { name: '接力房', adminId: architect.id, memberIds: [architect.id, engineer.id], relayDepth: 1 }
})
const relay = await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: relayRoomRes.room.id, text: '接力测：这个需求两天能做吗？' })
relayMentionTo = ''
const relayVisible = (relay.messages || []).filter((m) => m.hidden !== true)
check('接力两棒只对外一条汇总', relay.ok === true && relay.turns.length === 2 && relayVisible.length === 2, 'turns=' + String(relay.turns && relay.turns.length) + ' visible=' + String(relayVisible.length))
check('接力消息不带 @ 点名', relayVisible.every((m) => !String(m.text).includes('@')), relayVisible.map((m) => String(m.text).slice(0, 24)).join(' | '))

const direct = await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: roomId, text: '@' + engineer.name + ' 你直接说结论' })
check('用户 @ 成员时跳过管理员', direct.ok === true && direct.turns.length === 1 && direct.turns[0].name === engineer.name, direct.turns && direct.turns[0] && direct.turns[0].name)

// 根因回归：独立提问不能继承上一轮的话题（实测「最近AI产品热点」被答成 2.16.0 发布）。
const beforeFresh = prompts.length
await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: roomId, text: '最近AI产品热点' })
const freshPrompts = prompts.slice(beforeFresh)
const freshMember = freshPrompts.filter((p) => p.includes('你是成员「'))
check('独立提问不带上一轮成员答案', freshMember.length > 0 && freshMember.every((p) => !p.includes('两天完成')), 'member prompts=' + String(freshMember.length))
check('独立提问不带上一轮用户消息', freshPrompts.every((p) => !p.includes('这个需求两天能做吗')), '')
check('本轮消息确实交给了成员', freshMember.some((p) => p.includes('最近AI产品热点')), '')

// 根因回归 2：会话记忆不能把旧话题灌进新一轮。
// 实测：记忆里存着「2.16.0 灰度 / 补 tag / No-Go」时，旧版会把它们无条件注入每一轮，
// 于是「最近AI产品热点」也被答成发布结论。
const memoryFile = join(process.env.DSH_HOME, 'team-workbench', 'memory.json')
mkdirSync(dirname(memoryFile), { recursive: true })
writeFileSync(memoryFile, JSON.stringify({
  version: 2,
  persona: { items: [], updatedAt: '' },
  private: {},
  rooms: {
    [roomId]: {
      l2: { summary: '2.16.0 成员人格注入定于 11-12 灰度、11-13 发布；11-09 补 tag=2.16.0；当前结论 No-Go。', at: new Date().toISOString() },
      atoms: [
        { id: 'a1', text: '补 tag 是 2.16.0 发布的前置条件，最新 tag 仅到 v2.6.0', key: '约束:tag', importance: 5, at: new Date().toISOString(), hits: 1 },
        { id: 'a2', text: '11-12 18:00 四项判据全绿才能转 Go', key: '约束:判据', importance: 4, at: new Date().toISOString(), hits: 1 }
      ],
      since: 0,
      updatedAt: new Date().toISOString()
    }
  }
}, null, 1), 'utf8')

const beforeMemory = prompts.length
await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: roomId, text: '最近AI产品热点' })
const memoryFresh = prompts.slice(beforeMemory)
check('记忆不把旧话题塞进独立提问', memoryFresh.length > 0 && memoryFresh.every((p) => !p.includes('2.16.0') && !p.includes('灰度')), 'prompts=' + String(memoryFresh.length) + ' 首个长度=' + String(memoryFresh[0] && memoryFresh[0].length))

const beforeFollow = prompts.length
await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: roomId, text: '那个 tag 什么时候补' })
const followPrompts = prompts.slice(beforeFollow)
check('追问仍然能召回相关记忆', followPrompts.some((p) => p.includes('2.16.0')), 'prompts=' + String(followPrompts.length))

const testAuto = members.find((m) => m.name === '测试自动化工程师') || members[2]
const autoRoomRes = await call('/api/team-workbench/chats/rooms', {
  action: 'create',
  room: { name: '自动分诊', adminId: architect.id, memberIds: [architect.id, engineer.id, testAuto.id], responder: 'auto', relayDepth: 0 }
})
check('创建 Auto 应答房', autoRoomRes.ok === true && autoRoomRes.room.responder === 'auto', autoRoomRes.error || '')
const autoMsg = await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: autoRoomRes.room.id, text: '这次接口自动化测试怎么安排？' })
check('Auto 模式挑了匹配的人', autoMsg.ok === true && autoMsg.pickedId.length > 0 && autoMsg.turns[0].memberId === autoMsg.pickedId, autoMsg.turns && autoMsg.turns[0] && autoMsg.turns[0].name)
check('relayDepth=0 时只跑第一棒', autoMsg.turns.length === 1, String(autoMsg.turns && autoMsg.turns.length))

await call('/api/team-workbench/chats/rooms', { action: 'update', id: roomId, room: { relayDepth: 0 } })
const shallow = await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: roomId, text: '再确认一下范围' })
check('lead 房 relayDepth=0 不再转发 @', shallow.turns.length === 1 && shallow.turns[0].name === architect.name, String(shallow.turns && shallow.turns.length))

// 慢成员：超过 grace 的回复走后台，仍必须由主管汇总，且不对外散落成员消息。
process.env.TW_WORK_GRACE_MS = '500'
const slowRoomRes = await call('/api/team-workbench/chats/rooms', {
  action: 'create',
  room: { name: '慢成员房', adminId: testAuto.id, memberIds: [testAuto.id, engineer.id] }
})
const slow = await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: slowRoomRes.room.id, text: '慢测：这个需求两天能做吗？' })
delete process.env.TW_WORK_GRACE_MS
await new Promise((resolve) => setTimeout(resolve, 400))
const slowVisible = (slow.messages || []).filter((m) => m.hidden !== true)
check('慢成员也由主管汇总成一条', slowVisible.length === 2 && slowVisible[1].name === testAuto.name, slowVisible.map((m) => m.name + ':' + m.text.slice(0, 16)).join(' | '))
check('慢成员的原始回答仍是内部记录', (slow.messages || []).some((m) => m.hidden === true && m.name === engineer.name), '')
check('汇总提示词带上了慢成员的结论', prompts.some((p) => p.includes('请以管理员身份给用户一条汇总回复') && p.includes('结论：可以，两天完成。')), '')

const balance = await call('/api/team-workbench/balance')
check('余额接口可用（未配置 Key 时列出三个服务商）', balance.ok === true && Array.isArray(balance.items) && balance.items.length === 3, String((balance.items || []).length))

const usage = await call('/api/team-workbench/usage')
check('用量统计接口可用', usage.ok === true && Array.isArray(usage.models) && Array.isArray(usage.members), String((usage.models || []).length) + ' 个模型')

const search = await call('/api/team-workbench/chats/search?q=' + encodeURIComponent('两天') + '&kind=group')
check('聊天记录检索命中群消息', search.ok === true && search.total > 0 && search.hits.every((h) => h.kind === 'group'), search.total + ' 条')
const searchPrivate = await call('/api/team-workbench/chats/search?q=' + encodeURIComponent('你好') + '&kind=private')
check('私聊检索可按 kind 过滤', searchPrivate.ok === true && searchPrivate.hits.length > 0 && searchPrivate.hits.every((h) => h.kind === 'private'), searchPrivate.total + ' 条')

const toolNames = tools.map((t) => t.name)
check('注册了 agent_team_chat 与 agent_team_group_chat', toolNames.includes('agent_team_chat') && toolNames.includes('agent_team_group_chat'), toolNames.join(','))
const chatTool = tools.find((t) => t.name === 'agent_team_chat')
const toolResult = await chatTool.execute({ member: architect.name, message: '工具调用测试' }, { agent: parent })
check('agent_team_chat 工具可执行', toolResult.reply.length > 0, String(toolResult.reply.length))

console.log(failures === 0 ? '\n会话功能冒烟全部通过' : '\n失败 ' + failures + ' 项')
process.exit(failures === 0 ? 0 : 1)
