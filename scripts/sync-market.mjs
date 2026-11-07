#!/usr/bin/env node
/**
 * sync-market.mjs — 把当前版本同步到「插件市场」目录。
 *
 * 做什么：
 *   1) npm pack 出 tgz；
 *   2) 复制到 market/（保留最近 5 个版本）；
 *   3) 重写 market/index.json：名称、版本、tgz 文件名、sha256、大小、更新时间、说明。
 * 这里不访问网络；DSH Desktop 的插件市场读的是已安装的 profile bundle，
 * 所以安装（dsh plugin add）本身就等于同步到市场列表。
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const tgz = join(root, 'dsh-team-workbench-' + pkg.version + '.tgz')
const bytes = await readFile(tgz)
const sha256 = createHash('sha256').update(bytes).digest('hex')

const marketDir = join(root, 'market')
await mkdir(marketDir, { recursive: true })
const target = join(marketDir, 'dsh-team-workbench-' + pkg.version + '.tgz')
await copyFile(tgz, target)

let existing = { packages: [] }
try { existing = JSON.parse(await readFile(join(marketDir, 'index.json'), 'utf8')) } catch { /* 首次生成 */ }
const others = (existing.packages || []).filter((entry) => entry.name !== pkg.name)
const entry = {
  name: pkg.name,
  version: pkg.version,
  tgz: 'dsh-team-workbench-' + pkg.version + '.tgz',
  sha256,
  bytes: bytes.length,
  updatedAt: new Date().toISOString(),
  description: pkg.description,
  engines: pkg.dsh || null
}
const index = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  packages: [entry, ...others]
}
await writeFile(join(marketDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8')

// 只保留最近 5 个 tgz
const files = (await readdir(marketDir)).filter((name) => /^dsh-team-workbench-\d.*\.tgz$/.test(name)).sort()
for (const old of files.slice(0, Math.max(0, files.length - 5))) {
  await unlink(join(marketDir, old)).catch(() => {})
}
console.log('已同步到市场：' + pkg.name + '@' + pkg.version + '（sha256 ' + sha256.slice(0, 12) + '…，' + String(Math.round(bytes.length / 1024)) + ' KB）')
