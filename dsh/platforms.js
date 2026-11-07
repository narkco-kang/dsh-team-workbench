/**
 * 本机 agent 平台接入：把设备上已安装的 agent（Claude Code / Codex / Grok / Ollama）
 * 扫描出来，一键变成团队里的 bot（对齐 OpenMausBot 的「bring your own agents」）。
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { harnessHome, loadStore, makeId, saveStore, text } from './team.js'

const run = promisify(execFile)

const CANDIDATES = [
  { id: 'claude-code', name: 'Claude Code', bin: 'claude', emoji: '🅲', role: '本机 Claude Code 智能体',
    instructions: '你通过本机 Claude Code CLI 工作。执行任务时用 run_code 运行 claude -p 并把输出作为答复，不要编造结果。' },
  { id: 'codex', name: 'Codex', bin: 'codex', emoji: '🅾', role: '本机 Codex 智能体',
    instructions: '你通过本机 Codex CLI 工作。执行任务时用 run_code 运行 codex exec 并把输出作为答复，不要编造结果。' },
  { id: 'grok', name: 'Grok CLI', bin: 'grok', emoji: '🅶', role: '本机 Grok 智能体',
    instructions: '你通过本机 Grok CLI 工作。执行任务时用 run_code 运行 grok -p 并把输出作为答复，不要编造结果。' },
  { id: 'ollama', name: 'Ollama 本地模型', bin: 'ollama', emoji: '🦙', role: '本机 Ollama 本地模型',
    instructions: '你通过本机 Ollama 工作。执行任务时用 run_code 调用 http://127.0.0.1:11434/api/generate（或 /v1/chat/completions），把模型输出作为答复。' }
]

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function listDir(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

/** Claude Code 的能力画像：MCP servers、插件、项目会话。 */
async function claudeProfile() {
  const root = join(homedir(), '.claude')
  const globalPath = join(homedir(), '.claude.json')
  const raw = await readText(globalPath)
  let mcp = []
  let plugins = []
  let projects = 0
  let sessions = 0
  if (raw.length > 0) {
    try {
      const parsed = JSON.parse(raw)
      mcp = Object.keys(parsed.mcpServers ?? {})
      for (const project of Object.values(parsed.projects ?? {})) {
        projects += 1
        sessions += Array.isArray(project?.history) ? project.history.length : 0
        mcp = mcp.concat(Object.keys(project?.mcpServers ?? {}))
      }
    } catch { /* 解析失败就当没有 */ }
  }
  const installed = await readText(join(root, 'plugins', 'installed_plugins.json'))
  if (installed.length > 0) {
    try {
      const parsed = JSON.parse(installed)
      plugins = Object.keys(parsed.plugins ?? parsed)
    } catch { /* 忽略 */ }
  }
  const skillDirs = await listDir(join(root, 'skills'))
  return {
    mcp: [...new Set(mcp)].slice(0, 12),
    plugins: plugins.slice(0, 8),
    skills: skillDirs.slice(0, 8),
    projects,
    sessions
  }
}

/** Codex 的能力画像：model、mcp_servers、skills、prompts。 */
async function codexProfile() {
  const root = join(homedir(), '.codex')
  const toml = await readText(join(root, 'config.toml'))
  const model = /^\s*model\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? ''
  const mcp = [...toml.matchAll(/^\s*\[mcp_servers\.([A-Za-z0-9_-]+)\]/gm)].map((match) => match[1])
  const skills = await listDir(join(root, 'skills'))
  const prompts = await listDir(join(root, 'prompts'))
  return { model, mcp: mcp.slice(0, 12), skills: skills.slice(0, 8), prompts: prompts.length }
}

/** 把能力画像拼成 bot 的第一人称说明（截断，避免把 instructions 撑爆）。 */
function capabilityText(platform, profile) {
  if (platform.id === 'claude-code') {
    const parts = []
    if (profile.mcp.length > 0) parts.push('可用 MCP：' + profile.mcp.join('、'))
    if (profile.plugins.length > 0) parts.push('已装插件：' + profile.plugins.join('、'))
    if (profile.skills.length > 0) parts.push('技能目录：' + profile.skills.join('、'))
    if (profile.projects > 0) parts.push('本机有 ' + profile.projects + ' 个项目、约 ' + profile.sessions + ' 条会话历史')
    return parts.join('；')
  }
  if (platform.id === 'codex') {
    const parts = []
    if (profile.model.length > 0) parts.push('默认模型：' + profile.model)
    if (profile.mcp.length > 0) parts.push('MCP：' + profile.mcp.join('、'))
    if (profile.skills.length > 0) parts.push('技能：' + profile.skills.join('、'))
    if (profile.prompts > 0) parts.push('提示词模板 ' + profile.prompts + ' 个')
    return parts.join('；')
  }
  return ''
}

/** 该平台在设备上的能力画像（没有配置就返回空）。 */
export async function platformProfile(platformId) {
  if (platformId === 'claude-code') return claudeProfile()
  if (platformId === 'codex') return codexProfile()
  return {}
}

function statePath() {
  return join(harnessHome(), 'team-workbench', 'platforms.json')
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : { imported: [] }
  } catch {
    return { imported: [] }
  }
}

async function saveState(state) {
  await mkdir(dirname(statePath()), { recursive: true })
  await writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
  return state
}

/** 扫描本机：CLI 是否在 PATH、Ollama 端口是否活着。 */
export async function scanPlatforms() {
  const found = []
  for (const item of CANDIDATES) {
    let bin = ''
    try {
      const result = await run('/usr/bin/which', [item.bin], { timeout: 5000 })
      bin = text(result.stdout).trim()
    } catch {
      bin = ''
    }
    let alive = bin.length > 0
    if (item.id === 'ollama') {
      try {
        const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) })
        alive = response.ok
      } catch {
        alive = bin.length > 0
      }
    }
    if (!alive) continue
    found.push({ id: item.id, name: item.name, emoji: item.emoji, role: item.role, bin, detectedAt: new Date().toISOString() })
  }
  return found
}

/** 把扫描到的平台变成成员；已接入过的跳过（按 sourcePlatform 去重）。 */
export async function importPlatforms(options) {
  const only = Array.isArray(options?.ids) ? options.ids.map(text) : []
  const state = await loadState()
  const store = await loadStore()
  const platforms = await scanPlatforms()
  const created = []
  let refreshed = 0
  for (const platform of platforms) {
    if (only.length > 0 && !only.includes(platform.id)) continue
    if (state.imported.includes(platform.id)) continue
    const existing = store.members.find((member) => member.sourcePlatform === platform.id)
    if (existing !== undefined) {
      // 已接入过：如果还没有能力清单，就补一次（老版本建的 bot 也能升级）。
      const profile = await platformProfile(platform.id)
      const capability = capabilityText(platform, profile)
      if (capability.length > 0 && !existing.instructions.includes('【本机能力】')) {
        const blueprintExisting = CANDIDATES.find((item) => item.id === platform.id)
        existing.instructions = ((blueprintExisting !== undefined ? blueprintExisting.instructions : '') + '\n\n【本机能力】' + capability).slice(0, 1500)
        refreshed += 1
      }
      state.imported.push(platform.id)
      continue
    }
    const blueprint = CANDIDATES.find((item) => item.id === platform.id)
    // 建 bot 时把本机能力（MCP / 插件 / 技能 / 会话）写进说明，省得它每次都现查。
    const profile = await platformProfile(platform.id)
    const capability = capabilityText(platform, profile)
    const baseInstructions = blueprint !== undefined ? blueprint.instructions : ''
    const instructions = (baseInstructions + (capability.length > 0 ? '\n\n【本机能力】' + capability : '')).slice(0, 1500)
    const member = {
      id: makeId('mmw'),
      name: platform.name + '（本机）',
      role: platform.role,
      emoji: platform.emoji,
      color: '',
      groupId: '',
      avatar: { kind: 'emoji', imageId: '' },
      roleRef: { library: '', id: '', version: '' },
      instructions,
      enabled: true,
      createdAt: new Date().toISOString(),
      activeRouteId: '',
      routes: [],
      sourcePlatform: platform.id
    }
    store.members.push(member)
    created.push(member)
    state.imported.push(platform.id)
  }
  if (created.length > 0 || refreshed > 0) {
    await saveStore(store)
    await saveState({ ...state, lastImportAt: new Date().toISOString() })
  } else if (state.imported.length > 0) {
    await saveState(state)
  }
  return { platforms, created, refreshed, imported: state.imported }
}
