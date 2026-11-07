#!/usr/bin/env node
/**
 * smoke-chat.mjs — 私聊 / 群聊服务端冒烟（假 subagents，不调真模型）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wb-chat-'))
process.env.DSH_HOME = home

const routes = new Map()
const tools = []
const prompts = []
const parent = { id: 'parent' }
let engineerName = '前端开发者'

const subagents = {
  list: () => ['spawn'],
  start: (provider, request) => {
    const prompt = request.prompt[0].text
    prompts.push(prompt)
    let output = '收到。'
    if (prompt.includes('【群聊') && prompt.includes('你是本群管理员')) output = '我来安排：@' + engineerName + ' 你评估一下。'
    else if (prompt.includes('你是成员「' + engineerName + '」')) output = '结论：可以，两天完成。'
    else if (prompt.includes('你是成员')) output = '成员回复：好。'
    const id = 'child-' + String(prompts.length)
    return {
      id,
      childId: id,
      result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: output }] }),
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
check('群聊消息落库（用户 + 2 条回复）', group.messages.length === 3, String(group.messages && group.messages.length))
check('被 @ 的成员确实收到了任务', prompts.some((p) => p.includes('@ 了你') && p.includes('两天')), '')

const direct = await call('/api/team-workbench/chats/group', { sessionId: 'session-1', id: roomId, text: '@' + engineer.name + ' 你直接说结论' })
check('用户 @ 成员时跳过管理员', direct.ok === true && direct.turns.length === 1 && direct.turns[0].name === engineer.name, direct.turns && direct.turns[0] && direct.turns[0].name)

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
