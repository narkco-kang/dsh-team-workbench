#!/usr/bin/env node
/**
 * dispatch-compat.test.mjs —— 团队派发「宿主 subagents API 兼容层」回归测试
 *
 * 【为什么有这个测试】2026-10-30 实测：agent_team_dispatch 对所有成员、所有路由都失败，
 *   原始诊断 `TypeError: subagents.start is not a function`。
 *   根因不是模型额度，是宿主 API 改名：插件 2026-10-11 按旧 API `subagents.start(name, request)`
 *   写的，而宿主 @deepseek-ai/dsh-subagent 0.2.x 只暴露 `list()` + `startActivation({provider, request, signal})`。
 *   同一处还有两个隐蔽差异：receipt 字段从 `id` 变为 `childId`，且 `signal` 变成必填
 *   （startExternal 里无条件 `spec.signal.throwIfAborted()`）。
 *   ⇒ dsh/team.js 里新增 `startChild()` 收口两代 API；本测试锁住这个收口不再回退。
 *
 * 【为什么要在运行时做一份临时副本】`startChild` / `runOnRoute` 是模块内部函数，未对外导出。
 *   为了**不为了测试而扩大发布模块的导出面**（那会让 57770 B / 已冻结 sha 变化），
 *   本测试在系统临时目录复制一份 team.js 并追加一行 export，再 import 这份副本。
 *   被测字节与仓库里的 dsh/team.js 完全相同（复制后只追加 export 语句，不改任何实现行）。
 *
 * 运行：node test/dispatch-compat.test.mjs   （退出码 0 = 全绿）
 *
 * @module dsh-team-workbench/test/dispatch-compat
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 【注意】必须用 fileURLToPath：宿主路径里有空格（…/Application Support/…），
// 直接取 new URL(import.meta.url).pathname 会拿到 %20 编码路径 ⇒ fs 打开失败（实测）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEAM_JS = path.resolve(HERE, '../dsh/team.js')

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (extra ? '  —— ' + extra : '')) }
}

const source = fs.readFileSync(TEAM_JS, 'utf8')

// ── 0. 静态回归锁：不允许再直接调用已被宿主移除的 subagents.start ────────────
ok('R1 已引入 startChild 兼容层', source.includes('async function startChild(subagents, providerName, request)'))
ok('R2 实现里不再直接 subagents.start(...)', !/await\s+subagents\.start\(/.test(source))
ok('R3 派发调用走 startChild', source.includes('startChild(subagents, providerName, { ...request, signal })'))
ok('R4 receipt 兼容 childId', source.includes("typeof run.childId === 'string'"))

// ── 用临时副本导出内部函数（不改仓库实现）─────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-dispatch-compat-'))
// team.js 还静态 import 了同目录的 balance.js 等模块；只复制 team.js 会在临时目录里
// 找不到它们（ERR_MODULE_NOT_FOUND）。这里把 dsh/ 下的 .js 全复制一份，副本与仓库逐字节相同。
const sourceDir = path.resolve(HERE, '../dsh')
for (const name of fs.readdirSync(sourceDir)) {
  if (name.endsWith('.js')) fs.copyFileSync(path.join(sourceDir, name), path.join(tmpDir, name))
}
const tmpFile = path.join(tmpDir, 'team-exported.mjs')
fs.writeFileSync(tmpFile, source + '\nexport { startChild, runOnRoute };\n')

let startChild
let runOnRoute
try {
  ({ startChild, runOnRoute } = await import(pathToFileURL(tmpFile).href))
} catch (error) {
  console.log('  ✗ 无法加载被测模块：' + error)
  console.log('结果: ' + pass + ' 通过 / ' + (fail + 1) + ' 失败')
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.exit(1)
}

const settle = () => Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'child-ok' }] })
const member = { name: '复核员2', role: '通用助手', instructions: '', routes: [], activeRouteId: '' }

// ── A. 新宿主：只有 startActivation，没有 start ────────────────────────────
{
  let seen = null
  const stub = {
    list: () => ['spawn'],
    startActivation: (spec) => {
      seen = spec
      return { childId: 'child-new-1', result: settle(), dispose: async () => {} }
    }
  }
  const ctx = { get: (key) => (key === 'subagents' ? stub : undefined) }
  const out = await runOnRoute(ctx, { id: 'p1' }, member, null, '探针任务', new AbortController().signal)
  ok('A1 新宿主走 startActivation', seen !== null)
  ok('A2 provider 传对', seen?.provider === 'spawn', String(seen?.provider))
  ok('A3 request 保留 prompt/parent/persona', Array.isArray(seen?.request?.prompt) && seen?.request?.parent?.id === 'p1' && typeof seen?.request?.persona === 'string')
  ok('A4 signal 是 AbortSignal', seen?.signal instanceof AbortSignal)
  ok('A5 receipt.childId 映射成 childSessionId', out.childSessionId === 'child-new-1', out.childSessionId)
  ok('A6 结果文本透传', out.output === 'child-ok', out.output)
  ok('A7 stopReason 透传', out.stopReason === 'completed', out.stopReason)
}

// ── B. 旧宿主：只有 start（回归保护，不因升级而丢掉旧路径）─────────────────
{
  let seen = null
  const stub = {
    list: () => ['spawn'],
    start: (name, request) => {
      seen = { name, request }
      return { id: 'old-1', result: settle(), dispose: async () => {} }
    }
  }
  const ctx = { get: (key) => (key === 'subagents' ? stub : undefined) }
  const out = await runOnRoute(ctx, { id: 'p2' }, member, null, '探针任务', undefined)
  ok('B1 旧宿主走 start', seen?.name === 'spawn')
  ok('B2 旧宿主 run.id 映射成 childSessionId', out.childSessionId === 'old-1', out.childSessionId)
}

// ── C. 两代都没有 ⇒ 必须显式报错，不许静默成功 ─────────────────────────────
{
  const stub = { list: () => ['spawn'] }
  let message = ''
  try { await startChild(stub, 'spawn', { label: 'x' }) } catch (error) { message = String(error?.message ?? error) }
  ok('C1 两代 API 都缺时报明确错误', message.includes('既无 start 也无 startActivation'), message)
}

fs.rmSync(tmpDir, { recursive: true, force: true })

console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
