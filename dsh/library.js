import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

/**
 * 角色库与预设的只读数据层。
 *
 * 数据在构建期生成（scripts/build-roles.mjs），运行期只读本地文件：
 *   data/roles.index.json   索引（可一次返回给面板）
 *   data/roles.body.json.gz 角色正文（首次用到才解压，之后常驻）
 *   presets/*.json          预设团队
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
export const DATA_DIR = join(root, 'data')
export const PRESET_DIR = join(root, 'presets')

let indexCache = null
let bodyCache = null

/** 读取角色索引；失败时返回空索引而不是抛错（面板仍可用）。 */
export async function loadRoleIndex() {
  if (indexCache !== null) return indexCache
  try {
    const parsed = JSON.parse(await readFile(join(DATA_DIR, 'roles.index.json'), 'utf8'))
    indexCache = {
      version: typeof parsed.version === 'string' ? parsed.version : '',
      upstream: parsed.upstream || null,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      roles: Array.isArray(parsed.roles) ? parsed.roles : []
    }
  } catch (error) {
    indexCache = { version: '', upstream: null, categories: [], roles: [], error: String(error) }
  }
  return indexCache
}

/** 按 id 读取角色正文（markdown）。 */
export async function loadRoleBody(id) {
  if (bodyCache === null) {
    const raw = await readFile(join(DATA_DIR, 'roles.body.json.gz'))
    bodyCache = JSON.parse(gunzipSync(raw).toString('utf8'))
  }
  return typeof bodyCache[id] === 'string' ? bodyCache[id] : ''
}

/** 搜索 / 分页。q 命中名称、描述与分类名。 */
export async function searchRoles(query = '', category = '', offset = 0, limit = 60) {
  const index = await loadRoleIndex()
  const needle = String(query || '').trim().toLowerCase()
  const categoryId = String(category || '').trim()
  const all = index.roles.filter((role) => {
    if (categoryId.length > 0 && role.category !== categoryId) return false
    if (needle.length === 0) return true
    return (role.name + ' ' + role.description + ' ' + role.categoryName + ' ' + role.id).toLowerCase().includes(needle)
  })
  const start = Math.max(0, Number(offset) || 0)
  const size = Math.min(200, Math.max(1, Number(limit) || 60))
  return {
    total: all.length,
    offset: start,
    limit: size,
    roles: all.slice(start, start + size)
  }
}

/** 列出预设。 */
export async function listPresets() {
  const out = []
  for (const id of ['project-department']) {
    try {
      const parsed = JSON.parse(await readFile(join(PRESET_DIR, id + '.json'), 'utf8'))
      out.push({ id, name: parsed.name || id, description: parsed.description || '', groups: (parsed.groups || []).length, members: (parsed.members || []).length })
    } catch { /* 缺预设时跳过 */ }
  }
  return out
}

/** 读取一个预设。 */
export async function loadPreset(id) {
  const safe = String(id || '').replace(/[^a-z0-9-]/gi, '')
  if (safe.length === 0) return null
  try {
    return JSON.parse(await readFile(join(PRESET_DIR, safe + '.json'), 'utf8'))
  } catch {
    return null
  }
}

/** 命名色 → hex（agency-agents-zh 的 frontmatter 同时出现命名色与 hex）。 */
const NAMED_COLORS = {
  blue: '#2563eb', indigo: '#4f46e5', violet: '#7c3aed', purple: '#9333ea', fuchsia: '#c026d3',
  pink: '#db2777', rose: '#e11d48', red: '#dc2626', orange: '#ea580c', amber: '#d97706',
  yellow: '#ca8a04', lime: '#65a30d', green: '#16a34a', emerald: '#059669', teal: '#0d9488',
  cyan: '#0891b2', sky: '#0284c7', slate: '#475569', gray: '#6b7280', grey: '#6b7280',
  stone: '#78716c', zinc: '#71717a', neutral: '#737373'
}

export function colorOfName(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw
  return NAMED_COLORS[raw] || ''
}

/** 头像目录。 */
export function avatarDir(home) {
  return join(home, 'team-workbench', 'avatars')
}

/** 解析 data URL 图片；只接受 png/jpeg/webp，返回 { bytes, ext }。 */
export function decodeImageDataUrl(value) {
  const match = /^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(String(value || ''))
  if (match === null) return null
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length === 0 || bytes.length > 400 * 1024) return null
  return { bytes, ext: match[1] === 'jpeg' ? 'jpg' : match[1] }
}

/** 保存头像文件，返回 sha256 短 id。 */
export async function saveAvatar(home, bytes, ext) {
  const dir = avatarDir(home)
  await mkdir(dir, { recursive: true })
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
  await writeFile(join(dir, id + '.' + ext), bytes)
  return id
}

/** 读取头像文件。 */
export async function readAvatar(home, id) {
  const safe = String(id || '').replace(/[^a-f0-9]/g, '')
  if (safe.length !== 32) return null
  for (const ext of ['webp', 'png', 'jpg']) {
    try {
      return { bytes: await readFile(join(avatarDir(home), safe + '.' + ext)), ext }
    } catch { /* 尝试下一种扩展名 */ }
  }
  return null
}
