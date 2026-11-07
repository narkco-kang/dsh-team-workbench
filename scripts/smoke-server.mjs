#!/usr/bin/env node
/**
 * smoke-server.mjs — 服务端半体的运行时注册冒烟测试
 *
 * 结构测试（smoke-client.mjs）用源码字符串判断工具数，只能防文档漂移，
 * 证明不了「运行时真的注册了 11 个、没有重复、并且都能释放」。这里用桩 ctx
 * 真正执行 apply()，用「活登记表」统计运行时注册集合：
 * 注册时放进 Set，对应 disposer 被调用时移出 Set——释放后 Set 必须为空。
 *
 * 运行：node scripts/smoke-server.mjs
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ' — ' + detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  (' + detail + ')'}`)
}

/**
 * 记录所有注册的桩 ctx。
 * liveTools / liveRoutes 是「活登记表」：注册时加入，disposer 调用时移除。
 * 释放之后两张表都必须为空，才算真的把注册收干净了。
 */
function makeCtx() {
  const tools = []
  const routes = []
  const effects = []
  const logs = []
  const liveTools = new Set()
  const liveRoutes = new Set()
  return {
    ctx: {
      tools: {
        register: (descriptor) => {
          tools.push(descriptor)
          const record = descriptor.name + '#' + tools.length
          liveTools.add(record)
          return () => { liveTools.delete(record) }
        }
      },
      connection: {
        fetch: {
          register: (route) => {
            routes.push(route)
            const record = route.path + '#' + routes.length
            liveRoutes.add(record)
            return () => { liveRoutes.delete(record) }
          }
        }
      },
      effect: (fn) => { effects.push(fn); return () => {} },
      // 关键词触发行需要 systemPrompt 服务：本测试走「服务缺失」分支。
      get: () => undefined,
      inject: () => undefined,
      logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)) }
    },
    tools, routes, effects, logs, liveTools, liveRoutes
  }
}

const mod = await import(join(root, 'dsh', 'index.js'))
check('服务端入口导出 name/apply/inject', typeof mod.name === 'string' && typeof mod.apply === 'function' && Array.isArray(mod.inject))
check('name 与 package.json 一致（dsh-team-workbench）', mod.name === 'dsh-team-workbench', mod.name)
check('inject 含 connection 与 tools', mod.inject.includes('connection') && mod.inject.includes('tools'), mod.inject.join(','))

// —— 首次挂载 ——
const first = makeCtx()
const dispose = mod.apply(first.ctx, {})
check('首次挂载运行时注册了 11 个工具', first.tools.length === 11, String(first.tools.length))

const toolNames = first.tools.map((t) => t.name)
const EXPECTED = [
  'agent_team_roster', 'agent_team_dispatch', 'agent_team_task', 'agent_team_roles', 'agent_team_chat', 'agent_team_group_chat',
  'skill_manager_list', 'skill_manager_read', 'skill_manager_save', 'skill_manager_delete', 'skill_manager_deploy'
]
check('工具名与契约完全一致', EXPECTED.every((n) => toolNames.includes(n)) && toolNames.length === EXPECTED.length, toolNames.join(', '))
check('工具名没有重复注册', new Set(toolNames).size === toolNames.length)
check('每个工具都有 description / parameters / execute',
  first.tools.every((t) => typeof t.description === 'string' && t.description.length > 0 && t.parameters !== undefined && typeof t.execute === 'function'))

check('首次挂载运行时注册了 25 条路由（团队 12 + 技能库 5 + 会话 8）', first.routes.length === 25, String(first.routes.length))
const routePaths = first.routes.map((r) => r.path)
check('路由全部落在本包命名空间 /api/team-workbench',
  routePaths.every((p) => typeof p === 'string' && p.startsWith('/api/team-workbench')), routePaths.join(', '))
check('路由路径没有重复注册', new Set(routePaths).size === routePaths.length)
check('四条团队路由齐全', ['/api/team-workbench/state', '/api/team-workbench/members', '/api/team-workbench/probe', '/api/team-workbench/dispatch'].every((p) => routePaths.includes(p)))
check('五条技能库路由齐全', ['/api/team-workbench/skills/state', '/api/team-workbench/skills/read', '/api/team-workbench/skills/save', '/api/team-workbench/skills/delete', '/api/team-workbench/skills/deploy'].every((p) => routePaths.includes(p)))
check('没有残留旧插件路由前缀（agent-team-studio / skill-manager）',
  !routePaths.some((p) => p.includes('/api/agent-team-studio') || p.includes('/api/skill-manager')))
check('只挂了一个 ctx.effect（释放钩子）', first.effects.length === 1, String(first.effects.length))
check('释放钩子可执行', first.effects.length === 1 && typeof first.effects[0] === 'function')
check('挂载期间 11 个工具都是活的', first.liveTools.size === 11, String(first.liveTools.size))
check('挂载期间 25 条路由都是活的', first.liveRoutes.size === 25, String(first.liveRoutes.size))

// —— 释放 ——
check('apply 返回释放函数', typeof dispose === 'function')
dispose()
check('释放后工具登记表为空', first.liveTools.size === 0, [...first.liveTools].join(', '))
check('释放后路由登记表为空', first.liveRoutes.size === 0, [...first.liveRoutes].join(', '))

// —— 重新挂载（热重载场景）：不应留下重复登记 ——
const second = makeCtx()
const dispose2 = mod.apply(second.ctx, {})
check('重新挂载后工具数仍是 11（无累积）', second.tools.length === 11, String(second.tools.length))
check('重新挂载后路由数仍是 25（无累积）', second.routes.length === 25, String(second.routes.length))
check('重新挂载后工具名没有重复', new Set(second.tools.map((t) => t.name)).size === 11)
dispose2()
check('第二次释放后登记表也为空', second.liveTools.size === 0 && second.liveRoutes.size === 0, String(second.liveTools.size) + '/' + String(second.liveRoutes.size))

console.log()
if (failures.length > 0) {
  console.error('服务端冒烟测试失败 ' + failures.length + ' 项：')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('服务端冒烟测试全部通过（运行时实际注册 11 工具 / 25 路由，释放后登记表清空）')