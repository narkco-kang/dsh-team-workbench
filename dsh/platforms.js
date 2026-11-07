/**
 * 本机 agent 平台接入：把设备上已安装的 agent（Claude Code / Codex / Grok / Ollama）
 * 扫描出来，一键变成团队里的 bot（对齐 OpenMausBot 的「bring your own agents」）。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  for (const platform of platforms) {
    if (only.length > 0 && !only.includes(platform.id)) continue
    if (state.imported.includes(platform.id)) continue
    if (store.members.some((member) => member.sourcePlatform === platform.id)) {
      state.imported.push(platform.id)
      continue
    }
    const blueprint = CANDIDATES.find((item) => item.id === platform.id)
    const member = {
      id: makeId('mmw'),
      name: platform.name + '（本机）',
      role: platform.role,
      emoji: platform.emoji,
      color: '',
      groupId: '',
      avatar: { kind: 'emoji', imageId: '' },
      roleRef: { library: '', id: '', version: '' },
      instructions: blueprint !== undefined ? blueprint.instructions : '',
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
  if (created.length > 0) {
    await saveStore(store)
    await saveState({ ...state, lastImportAt: new Date().toISOString() })
  } else if (state.imported.length > 0) {
    await saveState(state)
  }
  return { platforms, created, imported: state.imported }
}
