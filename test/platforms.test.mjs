import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'tw-platforms-'))
process.env.DSH_HOME = home

const { importPlatforms, scanPlatforms } = await import('../dsh/platforms.js')
const { loadStore } = await import('../dsh/team.js')

const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, cond })
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + detail))
}

const scanned = await scanPlatforms()
ok('扫描至少发现一个本机平台', scanned.length > 0, JSON.stringify(scanned.map((p) => p.id)))

const first = await importPlatforms({})
ok('首次接入创建成员', first.created.length === scanned.length, String(first.created.length))
ok('成员带 sourcePlatform', first.created.every((m) => typeof m.sourcePlatform === 'string' && m.sourcePlatform.length > 0))

const second = await importPlatforms({})
ok('二次接入不重复创建', second.created.length === 0, String(second.created.length))

const store = await loadStore()
ok('store 里成员数等于首次创建数', store.members.length === first.created.length, String(store.members.length))

const failed = results.filter((r) => !r.cond)
console.log('结果: ' + (results.length - failed.length) + ' 通过 / ' + failed.length + ' 失败')
rmSync(home, { recursive: true, force: true })
if (failed.length > 0) process.exit(1)
