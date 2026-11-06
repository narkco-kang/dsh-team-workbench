#!/usr/bin/env node
/**
 * build-roles.mjs — 把 agency-agents-zh 的角色快照编译成角色库数据。
 *
 * 输入：AGENCY_DIR（默认 ../agency-agents-zh）指向 agency-agents-zh 的本地检出；
 *      AGENCY_COMMIT / AGENCY_VERSION 记录上游版本（默认从 UPSTREAM.md 读版本）。
 * 输出：data/roles.index.json（索引）、data/roles.body.json.gz（正文）、
 *      NOTICE-agency-agents-zh.md（MIT 归属与来源）。
 *
 * 产物入库，安装方无需运行本脚本，也不在运行期访问网络。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const agency = resolve(process.env.AGENCY_DIR || join(root, '..', 'agency-agents-zh'))

const COLOR_NAMES = new Set(['blue','indigo','violet','purple','fuchsia','pink','rose','red','orange','amber','yellow','lime','green','emerald','teal','cyan','sky','slate','gray','grey','stone','zinc','neutral'])

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---', 4)
  if (end < 0) return null
  const head = text.slice(4, end)
  const body = text.slice(end + 4).replace(/^\n+/, '')
  const fields = {}
  for (const line of head.split('\n')) {
    const match = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line)
    if (match !== null) fields[match[1]] = match[2].trim()
  }
  return { fields, body }
}

function normalColor(value) {
  const raw = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (COLOR_NAMES.has(raw.toLowerCase())) return raw.toLowerCase()
  return ''
}

async function readCategoryNames() {
  const names = new Map()
  try {
    const catalog = await readFile(join(agency, 'CATALOG.md'), 'utf8')
    let current = ''
    for (const line of catalog.split('\n')) {
      const heading = /^##\s+(?:\S+\s+)?(.+?)\s*\((\d+)\)\s*$/.exec(line)
      if (heading !== null) { current = heading[1].trim(); continue }
      const row = /^\|\s*[^|]+\|\s*`([a-z0-9-]+)\//.exec(line)
      if (row !== null && current.length > 0 && !names.has(row[1])) names.set(row[1], current)
    }
  } catch { /* 没有 CATALOG 时退回目录名 */ }
  return names
}

async function main() {
  if (!existsSync(join(agency, 'CATALOG.md'))) {
    console.error('找不到 agency-agents-zh：' + agency + '（用 AGENCY_DIR 指定）')
    process.exit(1)
  }
  const categoryNames = await readCategoryNames()
  const dirs = (await readdir(agency, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'assets' && entry.name !== 'scripts' && entry.name !== 'evals' && entry.name !== 'examples' && entry.name !== 'integrations')
  const roles = []
  const bodies = {}
  for (const dir of dirs) {
    const files = (await readdir(join(agency, dir.name))).filter((name) => name.endsWith('.md'))
    for (const file of files.sort()) {
      const raw = await readFile(join(agency, dir.name, file), 'utf8')
      const parsed = parseFrontmatter(raw)
      if (parsed === null || !parsed.fields.name) continue
      const id = dir.name + '/' + file.replace(/\.md$/, '')
      const description = (parsed.fields.description || '').replace(/\s+/g, ' ').trim()
      roles.push({
        id,
        category: dir.name,
        categoryName: categoryNames.get(dir.name) || dir.name,
        name: parsed.fields.name,
        description,
        emoji: (parsed.fields.emoji || '🤖').trim(),
        color: normalColor(parsed.fields.color),
        chars: parsed.body.length
      })
      bodies[id] = parsed.body.trim()
    }
  }
  roles.sort((a, b) => (a.categoryName + a.name).localeCompare(b.categoryName + b.name, 'zh'))
  const categories = []
  const seen = new Set()
  for (const role of roles) {
    if (seen.has(role.category)) continue
    seen.add(role.category)
    categories.push({ id: role.category, name: role.categoryName, count: roles.filter((r) => r.category === role.category).length })
  }
  const commit = process.env.AGENCY_COMMIT || ''
  const index = {
    version: '1.0.0',
    upstream: { repository: 'https://github.com/jnMetaCode/agency-agents-zh', commit, license: 'MIT' },
    categories,
    roles
  }
  await mkdir(join(root, 'data'), { recursive: true })
  await writeFile(join(root, 'data', 'roles.index.json'), JSON.stringify(index, null, 1), 'utf8')
  const gz = gzipSync(Buffer.from(JSON.stringify(bodies), 'utf8'), { level: 9 })
  await writeFile(join(root, 'data', 'roles.body.json.gz'), gz)
  await writeFile(join(root, 'NOTICE-agency-agents-zh.md'), [
    '# 第三方内容归属：agency-agents-zh',
    '',
    '- 上游：https://github.com/jnMetaCode/agency-agents-zh',
    '- 版本：' + (process.env.AGENCY_VERSION || '1.5.0') + (commit ? ' · commit ' + commit : ''),
    '- 许可证：MIT（全文见上游 LICENSE）',
    '- 使用方式：角色元数据与正文原样收录于 data/roles.index.json 与 data/roles.body.json.gz，',
    '  仅做 frontmatter 解析与正文去首尾空白，未修改角色内容。',
    '- 收录数量：' + String(roles.length) + ' 个角色，' + String(categories.length) + ' 个部门。',
    ''
  ].join('\n'), 'utf8')
  console.log('角色 ' + String(roles.length) + ' / 部门 ' + String(categories.length) + '；索引 ' + String((JSON.stringify(index).length / 1024).toFixed(1)) + ' KB；正文 gzip ' + String((gz.length / 1024 / 1024).toFixed(2)) + ' MB')
}

main().catch((error) => { console.error(error); process.exit(1) })
