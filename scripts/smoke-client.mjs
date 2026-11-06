#!/usr/bin/env node
/**
 * smoke-client.mjs — lib/client.js 的结构化冒烟测试
 *
 * 在没有宿主、没有 React DOM 的情况下，用桩件把客户端 bundle 跑一遍，验证：
 *   1. 模块加载器声明与包名一致（必须等于 package.json 的 name，否则 Desktop 认不出归属）；
 *   2. 注册描述符齐全：title / panelTitle / repository / description / layout；
 *   3. 布局合法：businessSide 为 right，businessWidth 落在 0.25–0.7（否则宿主 register 直接抛错）；
 *   4. CSS 变量作用域落在 .tw-root 上（旧代码挂在已删除的浮动管理台容器上）；
 *   5. 不再引用任何浮动窗口/胶囊容器（.ats-float-panel / #dsh-manager-dock / openTab）。
 *
 * 运行：node scripts/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const src = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ' — ' + detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  (' + detail + ')'}`)
}

// —— 1. 装载 bundle ——
let captured = null
const win = {
  __ModuleLoader__: { load: (def) => { captured = def } },
  localStorage: { getItem: () => null, setItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {} }
}
globalThis.window = win
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, dataset: {}, appendChild() {}, remove() {} }), head: { appendChild() {} } }

new Function('window', src)(win)
check('模块加载器被调用一次', captured !== null)
check('load({ id }) 与 package.json name 一致', captured !== null && captured.id === pkg.name, captured && captured.id)

const loaded = captured.factory((name) => {
  if (name === 'react') {
    const React = { createElement: () => null, useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {}, useCallback: (f) => f }
    return React
  }
  throw new Error('未预期的 require：' + name)
})
check('导出 apply', typeof loaded.apply === 'function')
check('导出 name = 包名', loaded.name === pkg.name, loaded.name)

// —— 2. 注册描述符 ——
const effects = []
const registered = []
const ctx = {
  effect: (fn, label) => { effects.push({ fn, label }); return fn },
  get: (name) => (name === 'desktopWorkbenches' ? { register: (descriptor, Component) => { registered.push({ descriptor, Component }); return () => {} } } : undefined),
  logger: { info: () => {} }
}
loaded.apply(ctx)

check('apply 注册了两个 ctx.effect（样式 + 工作台）', effects.length === 2, String(effects.length))
for (const e of effects) if (typeof e.fn === 'function') e.fn()
check('向 desktopWorkbenches.register 提交了 1 个面板', registered.length === 1, String(registered.length))

const d = registered[0] && registered[0].descriptor
check('描述符有 title', d && typeof d.title === 'string' && d.title.length > 0, d && d.title)
check('描述符有 repository（GitHub URL）', d && /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(d.repository || ''), d && d.repository)
check('描述符有 description', d && typeof d.description === 'string' && d.description.length > 0)
const fullPage = d !== undefined && d !== null && d.customFrame === true
check('整页模式（customFrame）或右侧分栏', fullPage || (d && d.layout && d.layout.businessSide === 'right'), fullPage ? 'customFrame' : (d && JSON.stringify(d.layout)))
check('分栏宽度在 0.25–0.7（整页模式不适用）', fullPage || (d && d.layout && d.layout.businessWidth >= 0.25 && d.layout.businessWidth <= 0.7), fullPage ? '整页' : (d && String(d.layout.businessWidth)))
check('业务组件是个函数', registered[0] && typeof registered[0].Component === 'function')

// —— 3. 源码里不应再有浮动载体 ——
const forbidden = ['dsh-manager-dock', '__DSH_DOCK__', 'ats-float-panel', 'ats-float-fab', 'managerDock', 'betterSidebar', 'registerTab', 'openTab', 'closeTab', 'ensureDock', 'FloatingHost']
for (const token of forbidden) {
  const hit = src.includes(token)
  check(`不再引用浮动载体符号 "${token}"`, !hit, hit ? '仍然出现' : undefined)
}
check('浅色 CSS 变量定义在 .tw-root', /\.tw-root\{--dsh-surface/.test(src))

// 生成物里不得残留旧插件身份：页脚包名、失效常量、旧包名的带引号字面量。
// （曾经漏过：页脚硬编码 "dsh-agent-team-studio"，界面会显示成另一个包。）
const FORBIDDEN_STRINGS = ['"dsh-agent-team-studio"', '"dsh-skill-manager"', 'TAB_ID', 'agent-team-studio:roster']
for (const needle of FORBIDDEN_STRINGS) {
  check(`生成物不含旧插件身份字面量 ${needle}`, !src.includes(needle), src.includes(needle) ? '仍然出现' : undefined)
}
check('页脚显示的是本工作台包名', src.includes('"dsh-team-workbench" + (snap.pluginVersion'))

// 功能版本必须与 package.json 的 version 一致（否则 /state 与界面会显示另一个版本号）
const teamSrc = readFileSync(join(root, 'dsh', 'team.js'), 'utf8')
const pluginVersion = /const PLUGIN_VERSION = '([^']+)'/.exec(teamSrc)
check('dsh/team.js 的 PLUGIN_VERSION 与 package.json version 一致',
  pluginVersion !== null && pluginVersion[1] === pkg.version,
  pluginVersion ? pluginVersion[1] + ' vs ' + pkg.version : '未找到 PLUGIN_VERSION')

// 文档口径：本包模型工具共 11 个（团队 4 + 会话 2 + 技能库 5）。
// 这个数字容易被漏写成 7，因此在测试里钉住（审核流水线抓到过一次）。
const TEAM_TOOLS = ['agent_team_roster', 'agent_team_dispatch', 'agent_team_task', 'agent_team_roles', 'agent_team_chat', 'agent_team_group_chat']
const SKILL_TOOLS = ['skill_manager_list', 'skill_manager_read', 'skill_manager_save', 'skill_manager_delete', 'skill_manager_deploy']
const teamSources = ['team.js', 'chat.js', 'skills.js'].map((file) => readFileSync(join(root, 'dsh', file), 'utf8')).join('\n')
const serverTools = [...TEAM_TOOLS, ...SKILL_TOOLS].filter((t) => teamSources.includes("name: '" + t + "'"))
check('服务端注册的工具数与文档一致（11 个）', serverTools.length === 11, String(serverTools.length))
for (const doc of ['README.md', 'dsh/index.js', 'dsh/team.js', 'scripts/migrate-profile.mjs']) {
  const text = readFileSync(join(root, doc), 'utf8')
  check(doc + ' 不再出现「7 个」的旧口径', !text.includes('7 个'))
  check(doc + ' 列出了 agent_team_task', text.includes('agent_team_task'))
  if (doc !== 'dsh/team.js') check(doc + ' 的工具数口径是 11 个', text.includes('11 个'))
}
check('技能库路由前缀已切到本工作台', src.includes('"/api/team-workbench/skills"'))
check('团队路由前缀已切到本工作台', src.includes('"/api/team-workbench/state"') && src.includes('"/api/team-workbench/members"') && src.includes('"/api/team-workbench/probe"') && src.includes('"/api/team-workbench/dispatch"'))
check('样式 id 已改为本工作台的', src.includes('"dsh-team-workbench-css"') && !src.includes('"dsh-agent-team-studio-css"'))

console.log()
if (failures.length > 0) {
  console.error('冒烟测试失败 ' + failures.length + ' 项：')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('冒烟测试全部通过')
