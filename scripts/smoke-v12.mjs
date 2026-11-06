#!/usr/bin/env node
/**
 * smoke-v12.mjs — 1.2.0 服务端功能冒烟：分组、角色导入、预设、角色检索。
 * 用临时 DSH_HOME，不触碰真实团队配置。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wb-v12-'))
process.env.DSH_HOME = home

const mod = await import('../dsh/team.js')
const { default: skills } = { default: null }
const routes = new Map()
const tools = []
const connection = { fetch: { register: (route) => { routes.set(route.path, route.fetch); return () => {} } } }
const toolRegistry = { register: (t) => { tools.push(t); return () => {} } }
const ctx = {
  connection,
  tools: toolRegistry,
  get(name) {
    if (name === 'connection') return { fetch: { register: (route) => { routes.set(route.path, route.fetch); return () => {} } } }
    if (name === 'tools') return { register: (t) => { tools.push(t); return () => {} } }
    if (name === 'llm') return { listProviders: () => [], listModels: async () => [] }
    return undefined
  },
  effect(fn) { fn(); return () => {} },
  inject(names, fn) { if (names.includes('systemPrompt')) return; fn && fn(ctx) },
  logger: { info() {}, warn() {} }
}
// dsh/index.js 会顺手挂技能库；这里只测团队半体
await mod.apply(ctx, {})

const call = async (path, body) => {
  const handler = routes.get(path.split('?')[0])
  if (!handler) throw new Error('missing route ' + path)
  const request = new Request('http://x' + path, body === undefined ? { method: 'GET' } : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  const response = await handler(request)
  return response.json()
}

let failures = 0
const check = (name, ok, detail) => { if (!ok) failures += 1; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : '')) }

const s0 = await call('/api/team-workbench/state')
check('初始状态可读', s0.ok === true && Array.isArray(s0.members) && Array.isArray(s0.groups))
check('角色库概要随状态返回', s0.roleLibrary && s0.roleLibrary.total > 300, s0.roleLibrary && String(s0.roleLibrary.total))

const preset = await call('/api/team-workbench/preset', { id: 'project-department', mode: 'replace' })
check('应用项目部预设', preset.ok === true && preset.groups.length === 6 && preset.members.length === 15, preset.members ? preset.members.length + ' 人 / ' + preset.groups.length + ' 组' : JSON.stringify(preset))
check('预设成员带分组', preset.members.every((m) => m.groupId.length > 0))
check('预设成员带角色引用', preset.members.every((m) => m.roleRef.id.length > 0))

const search = await call('/api/team-workbench/roles?q=' + encodeURIComponent('前端') + '&offset=0&limit=5')
check('角色检索命中', search.ok === true && search.total > 0 && search.roles.length > 0, String(search.total))

const bodyRoute = routes.get('/api/team-workbench/roles/body')
const bodyRes = await bodyRoute(new Request('http://x/api/team-workbench/roles/body?id=engineering/engineering-frontend-developer'))
const bodyJson = await bodyRes.json()
check('角色正文可读', bodyJson.ok === true && bodyJson.body.length > 500, String(bodyJson.body.length))

const imported = await call('/api/team-workbench/roles', { ids: ['testing/testing-api-tester'], groupId: preset.groups.find((g) => g.name === '测试').id })
check('从角色库加入成员', imported.ok === true && imported.members.length === 16, imported.members && String(imported.members.length))

const grouped = await call('/api/team-workbench/members', { action: 'group-upsert', group: { name: '增长' } })
check('新建分组', grouped.ok === true && grouped.groups.some((g) => g.name === '增长'))
const groupId = grouped.groups.find((g) => g.name === '增长').id
const moved = await call('/api/team-workbench/members', { action: 'upsert', member: { id: grouped.members[0].id, groupId } })
check('成员改分组', moved.ok === true && moved.members.find((m) => m.id === grouped.members[0].id).groupId === groupId)
const removed = await call('/api/team-workbench/members', { action: 'group-delete', id: groupId })
check('删除分组后成员落未分组', removed.ok === true && removed.members.find((m) => m.id === grouped.members[0].id).groupId === '')

const roster = tools.find((t) => t.name === 'agent_team_roster')
const rosterValue = await roster.execute({})
check('名册工具输出含分组', Array.isArray(rosterValue.groups) && rosterValue.groups.length > 0)
check('名册成员带头像字段', rosterValue.members.every((m) => m.avatar && typeof m.avatar.kind === 'string'))
const roleTool = tools.find((t) => t.name === 'agent_team_roles')
const roleToolValue = await roleTool.execute({ query: '测试', limit: 5 })
check('角色检索工具可用', roleToolValue.total > 0 && roleToolValue.roles.length > 0, String(roleToolValue.total))

console.log(failures === 0 ? '\n1.2.0 服务端功能冒烟全部通过' : '\n失败 ' + failures + ' 项')
process.exit(failures === 0 ? 0 : 1)
