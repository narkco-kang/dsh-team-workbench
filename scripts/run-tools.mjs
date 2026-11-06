#!/usr/bin/env node
/**
 * run-tools.mjs — 工具契约的运行时回归（在**临时 HOME** 里真调用 execute）
 *
 * 为什么单独一个脚本：smoke-server.mjs 只做注册与释放，从没调用过工具的 execute，
 * 所以「声明的 output.schema 与实际返回对象不一致」这类缺陷它抓不到（真的漏过一次：
 * agent_team_task 第一关失败分支缺 rounds/auditFeedback/reviewFeedback/resubmitHint）。
 *
 * 安全前提：本脚本 import 之前先把 HOME 指向临时目录，因此 skills.js 在模块顶层
 * 捕获的 FIRST_PARTY_SRC / LIBRARY / TARGETS 全部落在临时目录里，
 * 不会碰到真实 ~/.skills-src（脚本末尾会显式断言这一点）。
 *
 * 运行：node scripts/run-tools.mjs
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ' — ' + detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  (' + detail + ')'}`)
}

// —— 关键：先把 HOME 换到临时目录，再 import 服务端模块 ——
const REAL_HOME = process.env.HOME
const sandboxHome = mkdtempSync(join(tmpdir(), 'tw-home-'))
process.env.HOME = sandboxHome

/** 记录注册的桩 ctx（与 smoke-server 同款）。
 *  get('subagents') 返回一个「provider 可用、但 start 一定失败」的桩：
 *  这样 agent_team_task 的第一关派发会走到 catch 分支并返回 status:'error' 的对象，
 *  正好覆盖那条曾漏掉 4 个 required 字段的错误返回路径。 */
function makeCtx() {
  const tools = []
  const routes = []
  const services = {
    subagents: {
      list: () => ['spawn'],
      start: async () => { throw new Error('（桩）派发失败：用于触发第一关失败分支') }
    },
    systemPrompt: undefined
  }
  return {
    ctx: {
      tools: { register: (d) => { tools.push(d); return () => {} } },
      connection: { fetch: { register: (r) => { routes.push(r); return () => {} } } },
      effect: () => () => {},
      get: (name) => services[name],
      inject: () => undefined,
      logger: { info: () => {}, warn: () => {} }
    },
    tools, routes, services
  }
}

const mod = await import(join(root, 'dsh', 'index.js'))
const registry = makeCtx()
const dispose = mod.apply(registry.ctx, {})
const byName = new Map(registry.tools.map((t) => [t.name, t]))

/** 按 JSON Schema（仅本包用到的关键字）校验一个对象。 */
function validate(schema, value, path = '$') {
  const errors = []
  if (schema === undefined) return errors
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [`${path}: 期望 object，实际 ${Array.isArray(value) ? 'array' : typeof value}`]
    }
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: 缺少 required 字段`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (schema.properties !== undefined && schema.properties[key] === undefined) {
          errors.push(`${path}.${key}: 不在 properties 里（additionalProperties: false）`)
        }
      }
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined) errors.push(...validate(sub, value[key], path + '.' + key))
    }
    return errors
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: 期望 array`]
    return value.flatMap((v, i) => validate(schema.items, v, `${path}[${i}]`))
  }
  if (schema.type === 'string') return typeof value === 'string' ? [] : [`${path}: 期望 string，实际 ${typeof value}`]
  if (schema.type === 'integer') return Number.isInteger(value) ? [] : [`${path}: 期望 integer，实际 ${typeof value}`]
  if (schema.type === 'boolean') return typeof value === 'boolean' ? [] : [`${path}: 期望 boolean`]
  return errors
}

// —— 1. 每个工具的参数契约与输出契约都要自洽 ——
for (const tool of registry.tools) {
  const params = tool.parameters || {}
  if (params.type === 'object' && params.additionalProperties === false) {
    const declared = Object.keys(params.properties || {})
    const missing = (params.required || []).filter((k) => !declared.includes(k))
    check(`${tool.name}: required 都在 properties 里`, missing.length === 0, missing.join(','))
    if (tool.name === 'skill_manager_save') {
      // 实现会读 descriptionEn -> frontmatter 的 description_en；参数 schema 必须放行
      check('skill_manager_save: 参数 schema 声明了 descriptionEn',
        declared.includes('descriptionEn'), declared.join(','))
    }
  }
  const out = tool.output && tool.output.schema
  check(`${tool.name}: 声明了输出 schema`, out !== undefined && out.type === 'object')
}

// —— 2. agent_team_task 第一关失败分支：必须满足自己声明的 required ——
{
  const gate = byName.get('agent_team_task')
  const required = gate.output.schema.required
  // producer 指向不存在的成员 -> 抛错（这是参数错误，不是我们要测的返回分支）
  let threw = null
  try {
    await gate.execute({ task: 'x', producer: '不存在的成员' })
  } catch (error) {
    threw = error
  }
  check('agent_team_task: 未知 producer 会抛错', threw !== null)

  // 直接命中「第一关产出失败」分支：桩 ctx 的 get('subagents') 返回 undefined，
  // 于是 dispatchToMember 抛错 -> 该分支返回 status:'error' 的对象。
  const producer = (await (async () => {
    const state = await byName.get('agent_team_roster').execute({})
    return state.members && state.members.find((m) => m.enabled !== false)
  })())
  check('agent_team_task: 名册里有一个可用的 producer 用于触发该分支', producer !== undefined, producer && producer.name)

  let returned = null
  try {
    returned = await gate.execute({ task: '契约回归：不要真的派发', producer: producer.name }, { agent: { fake: true } })
  } catch (error) {
    returned = { __threw: String(error && error.message ? error.message : error) }
  }
  check('agent_team_task: 第一关失败分支确实返回了对象（而不是抛错）', returned !== null && returned.__threw === undefined, returned && returned.__threw)
  if (returned !== null && returned.__threw === undefined) {
    check('agent_team_task: 返回 status = error', returned.status === 'error', String(returned.status))
    const errs = validate(gate.output.schema, returned)
    check('agent_team_task: 实际返回满足 output.schema（required 11 个字段全部在场）', errs.length === 0, errs.slice(0, 3).join(' | '))
    check('agent_team_task: 第一关失败分支补齐了 rounds/auditFeedback/reviewFeedback/resubmitHint',
      returned.rounds === 0
      && typeof returned.auditFeedback === 'string'
      && typeof returned.reviewFeedback === 'string'
      && typeof returned.resubmitHint === 'string' && returned.resubmitHint.length > 0,
      JSON.stringify({ rounds: returned.rounds, hint: String(returned.resubmitHint).slice(0, 24) }))
  }
}

// —— 3. skill_manager_* 在临时 HOME 里真跑（绝不碰真实 ~/.skills-src）——
{
  const save = byName.get('skill_manager_save')
  const list = byName.get('skill_manager_list')
  const read = byName.get('skill_manager_read')
  const del = byName.get('skill_manager_delete')
  const deploy = byName.get('skill_manager_deploy')

  const bad = await save.execute({ name: '契约-回归', description: 'x' })
  const badErrs = validate(save.output.schema, bad)
  check('skill_manager_save: 非法名返回错误对象且符合输出契约', bad && bad.ok === false && badErrs.length === 0, JSON.stringify(bad))

  const empty = await save.execute({ name: 'contract-probe', description: '   ' })
  check('skill_manager_save: 空描述被拒绝', empty && empty.ok === false, JSON.stringify(empty))

  const saved = await save.execute({
    name: 'contract-probe',
    description: '用于工具契约回归的临时技能',
    descriptionZh: '契约回归',
    descriptionEn: 'Temporary skill for tool contract regression',
    category: 'dev-engineering',
    version: '0.0.1',
    body: '# contract-probe\n'
  })
  const savedErrs = validate(save.output.schema, saved)
  check('skill_manager_save: 正常保存返回符合输出契约', saved && saved.ok === true && savedErrs.length === 0, JSON.stringify(saved).slice(0, 120))

  const skillPath = join(sandboxHome, '.skills-src', 'contract-probe', 'SKILL.md')
  check('skill_manager_save: SKILL.md 写在临时 HOME 下', existsSync(skillPath), skillPath)
  if (existsSync(skillPath)) {
    const text = readFileSync(skillPath, 'utf8')
    check('skill_manager_save: descriptionEn 真的写进 frontmatter 的 description_en',
      text.includes('description_en:') && text.includes('Temporary skill for tool contract regression'))
    check('skill_manager_save: 分类软链接建在临时 HOME 的分类库里',
      existsSync(join(sandboxHome, '.skills', 'dev-engineering', 'contract-probe')))
  }

  const listed = await list.execute({})
  check('skill_manager_list: 返回符合输出契约且含刚建的技能',
    validate(list.output.schema, listed).length === 0
    && Array.isArray(listed.skills) && listed.skills.some((s) => s.name === 'contract-probe'))

  const one = await read.execute({ name: 'contract-probe' })
  check('skill_manager_read: 读回 frontmatter 与正文', validate(read.output.schema, one).length === 0 && one.ok === true && String(one.skill.body).includes('contract-probe'))

  const gone = await del.execute({ name: 'contract-probe' })
  check('skill_manager_delete: 删除并清理派发链接', validate(del.output.schema, gone).length === 0 && gone.ok === true)
  check('skill_manager_delete: 源目录已移除', !existsSync(join(sandboxHome, '.skills-src', 'contract-probe')))

  const deployed = await deploy.execute({})
  const deployErrs = validate(deploy.output.schema, deployed)
  check('skill_manager_deploy: 返回符合输出契约', deployed.ok === true && deployErrs.length === 0, deployErrs.join(' | ') + ' ' + JSON.stringify(deployed).slice(0, 60))
}

// —— 4. 路由 handler 可被调用且返回 Response（不触网）——
{
  const stateRoute = registry.routes.find((r) => r.path === '/api/team-workbench/state')
  const skillsState = registry.routes.find((r) => r.path === '/api/team-workbench/skills/state')
  let teamResponse = null
  try {
    teamResponse = await stateRoute.fetch(new Request('http://localhost/api/team-workbench/state'))
  } catch (error) {
    teamResponse = { error: String(error) }
  }
  const teamJson = teamResponse instanceof Response ? await teamResponse.json() : null
  check('团队 /state handler 可调用并返回 JSON', teamJson !== null && teamJson.ok === true, JSON.stringify(teamJson === null ? teamResponse : { ok: teamJson.ok, error: teamJson.error }).slice(0, 80))

  const skillsResponse = await skillsState.fetch(new Request('http://localhost/api/team-workbench/skills/state'))
  const skillsJson = await skillsResponse.json()
  check('技能库 /skills/state handler 可调用并返回 JSON', skillsJson.ok === true && Array.isArray(skillsJson.skills))
}

// —— 5. 收尾：确认没碰真实 HOME ——
check('全程未创建真实 ~/.skills-src/contract-probe',
  !existsSync(join(REAL_HOME, '.skills-src', 'contract-probe')),
  join(REAL_HOME, '.skills-src', 'contract-probe'))

dispose()
rmSync(sandboxHome, { recursive: true, force: true })

console.log()
if (failures.length > 0) {
  console.error('工具契约回归失败 ' + failures.length + ' 项：')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('工具契约回归全部通过（临时 HOME，真实 ~/.skills-src 未被触碰）')
