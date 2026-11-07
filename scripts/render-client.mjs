#!/usr/bin/env node
/**
 * render-client.mjs — 用真实 React 做一次服务端渲染（SSR）冒烟测试
 *
 * 结构检查（smoke-client.mjs）只能证明注册描述符对不对，证明不了面板本身能不能渲染。
 * 这里用宿主同一份 React 18 把 WorkbenchPanel 真渲染一遍，能抓到：
 *   · 合并两块面板后的重名/未定义标识符（这是本次合并最主要的回归风险）；
 *   · JSX 结构、条件分支、样式对象是否可用；
 *   · 两个标签各自的分支是否都能渲染。
 *
 * SSR 不执行 useEffect，所以两个面板都停在“加载中”状态——这正是我们要的：
 * 只验证渲染路径本身，不触网。
 *
 * 运行：node scripts/render-client.mjs
 *   React 来源：DSH Desktop 的 app.asar 解出的 react / react-dom
 *   （用 --react <dir> 指定其它含 node_modules/react 的目录）
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const argIdx = process.argv.indexOf('--react')
function usableReact(dir) {
  return dir !== undefined
    && existsSync(join(dir, 'node_modules', 'react', 'package.json'))
    && existsSync(join(dir, 'node_modules', 'react-dom', 'package.json'))
}
function resolveReactRoot() {
  if (argIdx >= 0 && process.argv[argIdx + 1]) return resolve(process.argv[argIdx + 1])
  if (process.env.DSH_REACT_DIR) return resolve(process.env.DSH_REACT_DIR)
  const cached = join(root, '.cache', 'react')
  if (usableReact(cached)) return cached
  // 没现成的就自己准备（委托 ensure-react.mjs：从 app.asar 解出宿主同一份 React 18）
  const prepared = spawnSync(process.execPath, [join(here, 'ensure-react.mjs')], { encoding: 'utf8' })
  const last = (prepared.stdout || '').trim().split('\n').pop()
  if (prepared.status === 0 && usableReact(last)) {
    console.log((prepared.stdout || '').trim().split('\n').slice(0, -1).join('\n'))
    return last
  }
  console.error('没能准备 React。请用 --react <含 node_modules/react 的目录> 指定一份 React 18。')
  console.error((prepared.stderr || '').trim())
  process.exit(1)
}
const reactRoot = resolveReactRoot()

const require = createRequire(join(reactRoot, 'noop.js'))
const React = require('react')
const { renderToString } = require('react-dom/server')
console.log('React ' + React.version + ' 来自 ' + reactRoot)

const src = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name + (detail ? ' — ' + detail : ''))
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`)
}

// —— 桩：模块加载器 / DOM / localStorage ——
let captured = null
const storage = { value: null }
const win = {
  __ModuleLoader__: { load: (def) => { captured = def } },
  localStorage: { getItem: () => storage.value, setItem: (_k, v) => { storage.value = v } },
  sessionStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1440,
  innerHeight: 900
}
const fakeEl = () => ({ id: '', dataset: {}, style: {}, textContent: '', appendChild() {}, remove() {} })
const doc = {
  getElementById: () => null,
  createElement: fakeEl,
  createTextNode: () => ({}),
  head: { appendChild: () => {} },
  body: { appendChild: () => {}, children: { length: 0 } },
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {}
}
globalThis.window = win
globalThis.document = doc
globalThis.fetch = () => Promise.reject(new Error('SSR 冒烟测试不触网'))

new Function('window', 'document', src)(win, doc)
check('bundle 被加载', captured !== null && captured.id === 'dsh-team-workbench')

let registry = null
const loaded = captured.factory((name) => {
  if (name === 'react') return React
  if (name === 'react-dom') return { render: () => {}, unmountComponentAtNode: () => {} }
  throw new Error('未预期的 require：' + name)
})
const ctx = {
  effect: (fn) => { fn(); return fn },
  get: () => undefined,
  logger: { info: () => {} }
}
loaded.apply(ctx)
const Panel = loaded.__panel
check('拿到了业务组件（__panel）', typeof Panel === 'function')

// —— 渲染：两个标签各来一次 ——
function renderWith(tab) {
  storage.value = tab
  const errors = []
  const originalError = console.error
  console.error = (...args) => { errors.push(String(args[0])) }
  let html = ''
  try {
    html = renderToString(React.createElement(Panel, {}))
  } catch (error) {
    errors.push('render 抛错：' + (error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error)))
  } finally {
    console.error = originalError
  }
  return { html, errors }
}

const team = renderWith('team')
check('团队标签渲染成功（无抛错）', !team.errors.some((e) => e.startsWith('render 抛错')), team.errors.find((e) => e.startsWith('render 抛错')))
check('团队标签输出含外壳与三个标签按钮', team.html.includes('tw-root') && team.html.includes('智能体团队') && team.html.includes('角色库') && team.html.includes('技能库'))
check('团队标签渲染出团队面板根节点', team.html.includes('ats-root'), team.html.includes('ats-root') ? undefined : team.html.slice(0, 200))
check('团队标签渲染出搜索/新建/预设等真实控件', team.html.includes('搜索') && team.html.includes('新建') && team.html.includes('项目部预设'))

const chat = renderWith('chat')
check('会话标签渲染成功（无抛错）', !chat.errors.some((e) => e.startsWith('render 抛错')), chat.errors.find((e) => e.startsWith('render 抛错')))
check('会话标签渲染出 DS-Bot 侧栏与建群入口', chat.html.includes('bt-side') && chat.html.includes('bt-list') && chat.html.includes('新建群聊'))
// 没有选中会话时也必须有输入框：DS-Bot 的聊天页不会出现「空页没有输入框」。
// SSR 不跑 useEffect，正好停在「一个会话都还没选中」的状态。
check('会话标签未选中会话时也有输入框', chat.html.includes('ats-compose') && chat.html.includes('ats-area'), chat.html.includes('ats-area') ? undefined : '没有 textarea')

const balance = renderWith('balance')
check('额度标签渲染成功（无抛错）', !balance.errors.some((e) => e.startsWith('render 抛错')), balance.errors.find((e) => e.startsWith('render 抛错')))
check('额度标签渲染出服务商卡片', balance.html.includes('服务商余额') && balance.html.includes('DeepSeek 官方'))

const records = renderWith('records')
check('记录标签渲染成功（无抛错）', !records.errors.some((e) => e.startsWith('render 抛错')), records.errors.find((e) => e.startsWith('render 抛错')))
check('记录标签渲染出检索入口', records.html.includes('会话记录') && records.html.includes('搜索聊天内容'))

const roles = renderWith('roles')
check('角色库标签渲染成功（无抛错）', !roles.errors.some((e) => e.startsWith('render 抛错')), roles.errors.find((e) => e.startsWith('render 抛错')))
check('角色库标签渲染出分类与搜索', roles.html.includes('角色库') && roles.html.includes('正在读取角色库'))

const skills = renderWith('skills')
check('技能库标签渲染成功（无抛错）', !skills.errors.some((e) => e.startsWith('render 抛错')), skills.errors.find((e) => e.startsWith('render 抛错')))
check('技能库标签把团队面板整体卸载（不共存）', !skills.html.includes('ats-root'))
check('技能库标签渲染出“加载中”占位', skills.html.includes('加载中') && skills.html.includes('技能库'), skills.html.slice(0, 160))

// 业务区容器的宽度自适应与窄窗口表现无法在 SSR 阶段验证（需要真实排版），
// 按《工作台开发规范》第 8 节列入安装后的待验证项，见 README 的交付清单。

// React 会对 SSR 期的 useEffect 发警告，属预期；其它错误才算问题。
const unexpected = [...team.errors, ...skills.errors].filter((e) => !/useLayoutEffect|useEffect/.test(e))
check('渲染期间没有 React 报错（useEffect 的 SSR 警告不计）', unexpected.length === 0, unexpected.slice(0, 2).join(' / '))

console.log()
if (failures.length > 0) {
  console.error('SSR 冒烟测试失败 ' + failures.length + ' 项：')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('SSR 冒烟测试全部通过（两个标签都真实渲染过）')
