#!/usr/bin/env node
/**
 * smoke-docs.mjs — README 里的「测试项数」必须与实际跑出来的 PASS 数一致
 *
 * 为什么需要：这些数字是人工维护的，改测试后很容易漏改文档，于是交付里出现
 * 「README 说 39 项、实跑 45 项」这类口径漂移（评审过程中真的被指出过两次）。
 * 与其每次靠人眼比对，不如让这个脚本去跑一遍再对答案。
 *
 * 运行：node scripts/smoke-docs.mjs
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const readme = readFileSync(join(root, 'README.md'), 'utf8')

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ' — ' + detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  (' + detail + ')'}`)
}

// 表格里每一行都必须与 README 中的写法对得上
const CASES = [
  { script: 'smoke-client.mjs', label: '结构', pattern: /`smoke-client\.mjs`（结构 (\d+) 项）/ },
  { script: 'smoke-server.mjs', label: '服务端', pattern: /`smoke-server\.mjs`（真执行 `apply\(\)`，(\d+) 项/ },
  { script: 'run-tools.mjs', label: '工具契约', pattern: /`run-tools\.mjs`（临时 HOME 内真调用，(\d+) 项/ },
  { script: 'smoke-migrate.mjs', label: '迁移', pattern: /`smoke-migrate\.mjs`（假 harness \+ 假 CLI 真跑，(\d+) 项/ },
  { script: 'render-client.mjs', label: 'SSR', pattern: /`render-client\.mjs`（真实 React SSR (\d+) 项）/ }
]

for (const c of CASES) {
  const run = spawnSync(process.execPath, [join(here, c.script)], { encoding: 'utf8' })
  const actual = (run.stdout || '').split('\n').filter((l) => l.startsWith('PASS')).length
  const m = c.pattern.exec(readme)
  const claimed = m === null ? null : Number(m[1])
  check(`${c.script}: 实跑通过（退出码 0）`, run.status === 0, 'exit=' + run.status)
  check(`${c.script}: README 声明的项数与实跑一致`, claimed === actual, `README=${claimed} 实跑=${actual}`)
}

// 「已知未验证项」也当成一种声明来核对：必须全部未勾选
const unchecked = (readme.match(/^- \[ \]/gm) || []).length
const checked = (readme.match(/^- \[x\]/gim) || []).length
check('README 的未验证项至少列了一条', unchecked > 0, String(unchecked))
check('README 没有被勾选的未验证项', checked === 0, String(checked))

console.log()
if (failures.length > 0) {
  console.error('文档口径核对失败 ' + failures.length + ' 项：')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('文档口径核对通过（README 的测试项数与实跑一致，未验证项仍全部未勾选）')
