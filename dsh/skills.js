/**
 * dsh-skill-manager —— 本机共享技能库的可视化管理插件。
 *
 * 两个来源：
 *   · 第一方 ~/.skills-src           自建技能，可增删改
 *   · 第三方 ~/.workbuddy-ai/skills  WorkBuddy 安装，只读
 * 负责把技能软链接派发到各 agent app，并提供 HTTP 路由与模型工具。
 *
 * 只依赖 Node 内置模块。
 *
 * @module dsh-team-workbench/dsh/skills
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SKILLS_NAME = 'dsh-team-workbench/skills'
export const inject = ['connection', 'tools']

const HOME = homedir()
const FIRST_PARTY_SRC = join(HOME, '.skills-src')
const THIRD_PARTY_SRC = join(HOME, '.workbuddy-ai', 'skills')
const LIBRARY = join(HOME, '.skills')
// [app 名, 目录, 是否所有技能都派发到这里]
// DSH 与 Codex 收全部技能；其余 app 目前只收第一方（自建）技能。
const TARGETS = [
  ['DeepSeek Harness', join(HOME, '.agents', 'skills'), true],
  ['Codex', join(HOME, '.codex', 'skills'), true],
  ['Claude Code', join(HOME, '.claude', 'skills'), false],
  ['WorkBuddy', join(HOME, '.workbuddy', 'skills'), false],
  ['Qwen Code', join(HOME, '.qwen', 'skills'), false],
  ['Hermes', join(HOME, '.hermes', 'skills-global'), false]
]
const ROUTE_BASE = '/api/team-workbench'
const ROUTES = {
  state: ROUTE_BASE + '/skills/state',
  read: ROUTE_BASE + '/skills/read',
  save: ROUTE_BASE + '/skills/save',
  remove: ROUTE_BASE + '/skills/delete',
  deploy: ROUTE_BASE + '/skills/deploy'
}
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

function json(value, status) {
  return new Response(JSON.stringify(value), {
    status: status === undefined ? 200 : status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}
async function readJson(request) {
  try { const body = await request.json(); return body !== null && typeof body === 'object' ? body : undefined } catch { return undefined }
}
function listDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
  } catch { return [] }
}

/** 解析 frontmatter（name/description/version/source/category 等简单标量）。 */
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (m === null) return { data: {}, body: text }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value) } catch { value = value.slice(1, -1) }
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    data[key] = value
  }
  return { data, body: text.slice(m[0].length) }
}

/** 组装 SKILL.md：所有值走 JSON.stringify，天然是合法 YAML 双引号标量。 */
function buildSkillFile(f) {
  const lines = ['---']
  lines.push('name: ' + JSON.stringify(f.name))
  lines.push('description: ' + JSON.stringify(f.description))
  if (f.description_zh) lines.push('description_zh: ' + JSON.stringify(f.description_zh))
  if (f.description_en) lines.push('description_en: ' + JSON.stringify(f.description_en))
  if (f.version) lines.push('version: ' + JSON.stringify(f.version))
  if (f.source) lines.push('source: ' + JSON.stringify(f.source))
  if (f.category) lines.push('category: ' + JSON.stringify(f.category))
  if (f.allowedTools) lines.push('allowed-tools: ' + JSON.stringify(f.allowedTools))
  lines.push('---', '')
  lines.push(String(f.body === undefined ? '' : f.body).replace(/^\n+/, ''))
  return lines.join('\n')
}

function realpathSafe(path) {
  try { return realpathSync(path) } catch { return undefined }
}
/** 该技能已派发到哪些 app。 */
function deployedApps(name, origin) {
  const expected = join(origin === 'first' ? FIRST_PARTY_SRC : THIRD_PARTY_SRC, name)
  const apps = []
  for (const entry of TARGETS) {
    const real = realpathSafe(join(entry[1], name))
    if (real !== undefined && real === expected) apps.push(entry[0])
  }
  return apps
}
/** 从分类库反查类别。 */
function categoryOf(name) {
  for (const cat of listDirs(LIBRARY)) {
    const real = realpathSafe(join(LIBRARY, cat, name))
    if (real !== undefined) return cat
  }
  return ''
}

function describeSkill(name, origin, root) {
  const file = join(root, name, 'SKILL.md')
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return undefined }
  const parsed = parseFrontmatter(text)
  const d = parsed.data
  let sizeBytes = 0
  let mtime = 0
  try { const st = statSync(file); sizeBytes = st.size; mtime = st.mtimeMs } catch { /* noop */ }
  const extra = []
  try {
    for (const e of readdirSync(join(root, name), { withFileTypes: true })) {
      if (e.name !== 'SKILL.md') extra.push(e.name)
    }
  } catch { /* noop */ }
  const apps = deployedApps(name, origin)
  return {
    name,
    origin,
    displayName: typeof d.name === 'string' ? d.name : name,
    description: typeof d.description === 'string' ? d.description : '',
    descriptionZh: typeof d.description_zh === 'string' ? d.description_zh : '',
    version: typeof d.version === 'string' ? d.version : '',
    source: typeof d.source === 'string' ? d.source : '',
    category: categoryOf(name),
    apps,
    // 只检查该技能「本应」去的目标：第三方技能只要求 DSH 与 Codex
    missingApps: TARGETS
      .filter((t) => origin === 'first' || t[2] === true)
      .map((t) => t[0])
      .filter((label) => apps.indexOf(label) === -1),
    editable: origin === 'first',
    sizeBytes,
    mtime,
    extraFiles: extra
  }
}

function collect() {
  const out = []
  for (const name of listDirs(FIRST_PARTY_SRC)) {
    const s = describeSkill(name, 'first', FIRST_PARTY_SRC)
    if (s !== undefined) out.push(s)
  }
  for (const name of listDirs(THIRD_PARTY_SRC)) {
    if (existsSync(join(FIRST_PARTY_SRC, name))) continue
    const s = describeSkill(name, 'third', THIRD_PARTY_SRC)
    if (s !== undefined) out.push(s)
  }
  return out
}

function snapshot() {
  const skills = collect()
  const first = skills.filter((s) => s.origin === 'first')
  const third = skills.filter((s) => s.origin === 'third')
  return {
    ok: true,
    firstPartySrc: FIRST_PARTY_SRC,
    thirdPartySrc: THIRD_PARTY_SRC,
    library: LIBRARY,
    targets: TARGETS.map((t) => ({ app: t[0], dir: t[1], exists: existsSync(t[1]) })),
    stats: {
      total: skills.length,
      first: first.length,
      third: third.length,
      notDeployed: skills.filter((s) => s.missingApps.length > 0).length
    },
    skills
  }
}

function readSkill(name) {
  if (!NAME_PATTERN.test(name)) return undefined
  const first = join(FIRST_PARTY_SRC, name, 'SKILL.md')
  const third = join(THIRD_PARTY_SRC, name, 'SKILL.md')
  if (existsSync(first)) {
    const text = readFileSync(first, 'utf8')
    const p = parseFrontmatter(text)
    return { name, origin: 'first', fields: p.data, body: p.body, raw: text }
  }
  if (existsSync(third)) {
    const text = readFileSync(third, 'utf8')
    const p = parseFrontmatter(text)
    return { name, origin: 'third', fields: p.data, body: p.body, raw: text }
  }
  return undefined
}

/** 把技能软链接到分类库与各 app。force=true 时覆盖已有软链接（不覆盖实体目录）。 */
function linkOne(name, category) {
  const src = join(FIRST_PARTY_SRC, name)
  const result = { name, linked: [], skipped: [] }
  const places = []
  if (category) {
    places.push([category, join(LIBRARY, category, name)])
  }
  for (const t of TARGETS) places.push([t[0], join(t[1], name)])
  for (const place of places) {
    const dst = place[1]
    try {
      const st = lstatSync(dst)
      if (st.isSymbolicLink()) {
        const real = realpathSafe(dst)
        if (real === src) { result.skipped.push(place[0]); continue }
        unlinkSync(dst)
      } else {
        result.skipped.push(place[0] + '(实体)')
        continue
      }
    } catch { /* 不存在，正常 */ }
    try {
      mkdirSync(join(dst, '..'), { recursive: true })
      symlinkSync(src, dst)
      result.linked.push(place[0])
    } catch (error) {
      result.skipped.push(place[0] + '(失败:' + String(error && error.code ? error.code : error) + ')')
    }
  }
  return result
}

function removeLinks(name) {
  const removed = []
  const places = []
  for (const cat of listDirs(LIBRARY)) places.push([cat, join(LIBRARY, cat, name)])
  for (const t of TARGETS) places.push([t[0], join(t[1], name)])
  for (const place of places) {
    try {
      if (lstatSync(place[1]).isSymbolicLink()) { unlinkSync(place[1]); removed.push(place[0]) }
    } catch { /* noop */ }
  }
  return removed
}

function saveSkill(input) {
  const name = String(input.name === undefined ? '' : input.name).trim()
  if (!NAME_PATTERN.test(name)) return { ok: false, error: '技能名只能是小写字母/数字/点/下划线/连字符，且以字母或数字开头' }
  const description = String(input.description === undefined ? '' : input.description).trim()
  if (description.length === 0) return { ok: false, error: '功能描述不能为空' }
  const dir = join(FIRST_PARTY_SRC, name)
  const isNew = !existsSync(join(dir, 'SKILL.md'))
  mkdirSync(dir, { recursive: true })
  const text = buildSkillFile({
    name,
    description,
    description_zh: input.descriptionZh,
    description_en: input.descriptionEn,
    version: input.version === undefined || String(input.version).length === 0 ? '1.0.0' : String(input.version),
    source: input.source,
    category: input.category,
    allowedTools: input.allowedTools,
    body: input.body
  })
  writeFileSync(join(dir, 'SKILL.md'), text, 'utf8')
  const link = input.category ? linkOne(name, String(input.category)) : linkOne(name, undefined)
  return { ok: true, name, created: isNew, bytes: Buffer.byteLength(text, 'utf8'), deploy: link }
}

function deleteSkill(name) {
  if (!NAME_PATTERN.test(name)) return { ok: false, error: '非法技能名' }
  const dir = join(FIRST_PARTY_SRC, name)
  if (!existsSync(dir)) return { ok: false, error: '第一方源里没有这个技能（第三方技能不可删除）' }
  const removedLinks = removeLinks(name)
  rmSync(dir, { recursive: true, force: true })
  return { ok: true, name, removedLinks }
}

function deployAll() {
  const results = []
  for (const name of listDirs(FIRST_PARTY_SRC)) {
    const category = categoryOf(name)
    results.push(linkOne(name, category.length > 0 ? category : undefined))
  }
  return { ok: true, count: results.length, results }
}

export function apply(ctx) {
  const disposers = []
  const own = (d) => { if (typeof d === 'function') disposers.push(d) }
  const guard = (fn) => async (request) => {
    try { return await fn(request) } catch (error) { return json({ ok: false, error: String(error) }, 500) }
  }
  own(ctx.connection.fetch.register({ path: ROUTES.state, methods: ['GET'], requestBody: 'buffered', fetch: guard(async () => json(snapshot())) }))
  own(ctx.connection.fetch.register({ path: ROUTES.read, methods: ['POST'], requestBody: 'buffered', fetch: guard(async (request) => {
    const body = await readJson(request)
    if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
    const found = readSkill(String(body.name === undefined ? '' : body.name))
    return found === undefined ? json({ ok: false, error: '找不到该技能' }, 404) : json({ ok: true, skill: found })
  }) }))
  own(ctx.connection.fetch.register({ path: ROUTES.save, methods: ['POST'], requestBody: 'buffered', fetch: guard(async (request) => {
    const body = await readJson(request)
    if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
    const result = saveSkill(body)
    return json(result, result.ok ? 200 : 400)
  }) }))
  own(ctx.connection.fetch.register({ path: ROUTES.remove, methods: ['POST'], requestBody: 'buffered', fetch: guard(async (request) => {
    const body = await readJson(request)
    if (body === undefined) return json({ ok: false, error: '请求体必须是 JSON 对象' }, 400)
    const result = deleteSkill(String(body.name === undefined ? '' : body.name))
    return json(result, result.ok ? 200 : 400)
  }) }))
  own(ctx.connection.fetch.register({ path: ROUTES.deploy, methods: ['POST'], requestBody: 'buffered', fetch: guard(async () => json(deployAll())) }))
  // 逐个登记工具 disposer，让释放链把它们收回去（旧实现把数组丢进 own，等于没登记）。
  for (const disposeTool of registerTools(ctx)) own(disposeTool)
  ctx.logger.info('[team-workbench] 已挂载：' + FIRST_PARTY_SRC)
  return () => { for (const d of disposers.reverse()) { try { d() } catch { /* noop */ } } }
}

const TEXT = { type: 'string' }
const OUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }]
}
function registerTools(ctx) {
  const list = ctx.tools.register({
    name: 'skill_manager_list',
    description: '列出本机共享技能库里的技能：名称、功能描述、来源、类别、版本，以及已派发到哪些 agent app。',
    parameters: { type: 'object', additionalProperties: false, properties: { origin: { type: 'string', description: "first=自建 / third=第三方；留空为全部" }, query: { type: 'string', description: '按名称或描述过滤' } } },
    output: OUT,
    execute: async (args) => {
      const snap = snapshot()
      let skills = snap.skills
      if (args && args.origin === 'first') skills = skills.filter((s) => s.origin === 'first')
      if (args && args.origin === 'third') skills = skills.filter((s) => s.origin === 'third')
      if (args && typeof args.query === 'string' && args.query.length > 0) {
        const q = args.query.toLowerCase()
        skills = skills.filter((s) => (s.name + ' ' + s.description).toLowerCase().indexOf(q) >= 0)
      }
      return { stats: snap.stats, skills }
    }
  })
  const read = ctx.tools.register({
    name: 'skill_manager_read',
    description: '读取某个技能的 功能描述、来源、frontmatter 与正文全文。',
    parameters: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: TEXT } },
    output: OUT,
    execute: async (args) => {
      const found = readSkill(String(args.name))
      return found === undefined ? { ok: false, error: '找不到该技能' } : { ok: true, skill: found }
    }
  })
  const save = ctx.tools.register({
    name: 'skill_manager_save',
    description: '新建或更新一个第一方技能（写入 ~/.skills-src 并派发软链接）。必须提供 name 与 description（功能描述）。',
    parameters: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: TEXT, description: TEXT, descriptionZh: TEXT, descriptionEn: { type: 'string', description: '英文功能描述，会写进 frontmatter 的 description_en' }, source: { type: 'string', description: '来源说明，会写进 frontmatter 的 source 字段' }, category: { type: 'string', description: '分类，如 dev-engineering' }, version: TEXT, allowedTools: TEXT, body: { type: 'string', description: 'SKILL.md 的 markdown 正文' } } },
    output: OUT,
    execute: async (args) => saveSkill(args)
  })
  const remove = ctx.tools.register({
    name: 'skill_manager_delete',
    description: '删除一个第一方技能（从 ~/.skills-src 移除并清理所有派发软链接）。第三方技能不可删。',
    parameters: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: TEXT } },
    output: OUT,
    execute: async (args) => deleteSkill(String(args.name))
  })
  const deploy = ctx.tools.register({
    name: 'skill_manager_deploy',
    description: '把所有第一方技能重新派发（软链接）到分类库与各 agent app。新增/删除技能后调用。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: OUT,
    execute: async () => deployAll()
  })
  return [list, read, save, remove, deploy]
}