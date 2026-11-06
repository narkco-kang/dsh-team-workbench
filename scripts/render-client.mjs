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
  throw new Error('未预期的 require：' + name)
})
const ctx = {
  effect: (fn) => { fn(); return fn },
  get: () => ({ register: (descriptor, Component) => { registry = { descriptor, Component }; return () => {} } }),
  logger: { info: () => {} }
}
loaded.apply(ctx)
check('拿到了业务组件', registry !== null && typeof registry.Component === 'function')

// —— 渲染：两个标签各来一次 ——
function renderWith(tab) {
  storage.value = tab
  const errors = []
  const originalError = console.error
  console.error = (...args) => { errors.push(String(args[0])) }
  let html = ''
  try {
    html = renderToString(React.createElement(registry.Component, { entry: registry.descriptor }))
  } catch (error) {
    errors.push('render 抛错：' + (error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error)))
  } finally {
    console.error = originalError
  }
  return { html, errors }
}

const team = renderWith('team')
check('团队标签渲染成功（无抛错）', !team.errors.some((e) => e.startsWith('render 抛错')), team.errors.find((e) => e.startsWith('render 抛错')))
check('团队标签输出含外壳与标签按钮', team.html.includes('tw-root') && team.html.includes('智能体团队') && team.html.includes('共享技能库'))
check('团队标签渲染出团队面板根节点', team.html.includes('ats-root'), team.html.includes('ats-root') ? undefined : team.html.slice(0, 200))
check('团队标签渲染出搜索/新建等真实控件', team.html.includes('搜索') || team.html.includes('新建'))

const skills = renderWith('skills')
check('技能库标签渲染成功（无抛错）', !skills.errors.some((e) => e.startsWith('render 抛错')), skills.errors.find((e) => e.startsWith('render 抛错')))
check('技能库标签把团队面板整体卸载（不共存）', !skills.html.includes('ats-root'))
check('技能库标签渲染出“加载中”占位', skills.html.includes('加载中') && skills.html.includes('共享技能库'), skills.html.slice(0, 160))

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
