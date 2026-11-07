import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'tw-schema-'))
process.env.DSH_HOME = home

const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, cond })
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + detail))
}

// 造一个带 sourcePlatform 的成员（自动接入的 bot 就是这种）
const { importPlatforms } = await import('../dsh/platforms.js')
const imported = await importPlatforms({})
const member = imported.created[0]
ok('造出带 sourcePlatform 的成员', member !== undefined && typeof member.sourcePlatform === 'string', String(imported.created.length))

// 从 MEMBER_SCHEMA 里提取已声明的属性名
const source = readFileSync(new URL('../dsh/team.js', import.meta.url), 'utf8')
const start = source.indexOf('const MEMBER_SCHEMA = {')
const end = source.indexOf('const GROUP_SCHEMA', start)
const block = source.slice(start, end)
const declared = new Set([...block.matchAll(/^ {4}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]))

const missing = Object.keys(member).filter((key) => !declared.has(key))
ok('成员所有字段都在 MEMBER_SCHEMA 里声明', missing.length === 0, missing.join(','))

const failed = results.filter((r) => !r.cond)
console.log('结果: ' + (results.length - failed.length) + ' 通过 / ' + failed.length + ' 失败')
rmSync(home, { recursive: true, force: true })
if (failed.length > 0) process.exit(1)
