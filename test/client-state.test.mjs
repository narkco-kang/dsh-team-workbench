#!/usr/bin/env node
/**
 * client-state.test.mjs — 客户端状态命名守卫
 *
 * 3.4.0 的线上事故：把 useState 的 setter 存成了 `var jumpToLatest = jumpState[1]`，
 * 于是 JSX 里 `jumpToLatest ? …` 永远为真，而 `setJumpToLatest(...)` 是未定义标识符，
 * 只在浏览器里运行回调时抛 ReferenceError —— SSR 冒烟测试抓不到，面板直接白屏。
 *
 * 这里做两条静态检查：
 *   1. 调用了 setXxx(...) 就必须存在 setXxx 的声明；
 *   2. useState 持有者取 [1] 时，变量名必须以 set 开头（setter 命名约定）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = readFileSync(join(root, 'src', 'client', 'panel.js'), 'utf8')

const failures = []
const ok = (name, cond, detail) => {
  if (!cond) failures.push(name + (detail ? ' — ' + detail : ''))
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''))
}

// 1. 调用到的 setXxx 必须有声明
const called = new Set()
for (const m of source.matchAll(/\b(set[A-Z][A-Za-z0-9_$]*)\s*\(/g)) called.add(m[1])
const declared = new Set()
for (const m of source.matchAll(/\b(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
// 逗号连写的声明：var e0 = useState({}), expanded = e0[0], setExpanded = e0[1];
for (const line of source.split(String.fromCharCode(10))) {
  if (!line.includes('useState(')) continue
  for (const m of line.matchAll(/([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1])
}
// 解构出来的 setter：[a, setA] = useState(...)
for (const m of source.matchAll(/\[([^\]]*)\]\s*=\s*useState\s*\(/g)) {
  const parts = m[1].split(',').map((x) => x.trim()).filter((x) => x.length > 0)
  if (parts.length >= 2) declared.add(parts[1])
}
// 浏览器/宿主全局，不算未声明
const globals = new Set(['setTimeout', 'setInterval', 'setItem', 'setAttribute', 'setPointerCapture', 'setRangeText', 'setSelectionRange'])
const missing = [...called].filter((name) => !declared.has(name) && !globals.has(name)).sort()
ok('所有 setXxx(...) 都有声明', missing.length === 0, missing.join(', '))

// 2. useState 持有者取 [1] 的变量必须以 set 开头
const holders = new Set()
for (const m of source.matchAll(/\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*useState\s*\(/g)) holders.add(m[1])
const badSetters = []
for (const m of source.matchAll(/\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\[1\]/g)) {
  const [, name, holder] = m
  if (!holders.has(holder)) continue
  if (!/^set[A-Z]/.test(name)) badSetters.push(name + ' = ' + holder + '[1]')
}
ok('useState 的 setter 命名以 set 开头', badSetters.length === 0, badSetters.join('; '))

if (failures.length > 0) {
  console.log('\n失败 ' + String(failures.length) + ' 项：')
  failures.forEach((line) => console.log('  · ' + line))
  process.exit(1)
}
console.log('\n结果: 2 通过 / 0 失败')

