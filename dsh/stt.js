/**
 * dsh-team-workbench / 语音识别（本地 STT）
 *
 * 对接 jianchang512/stt（faster-whisper 本地服务）：POST {baseUrl}/api
 *   multipart: file=<音频> language=zh model=tiny|base|small|medium|large-v3 response_format=text
 *   返回 { code: 0, msg: 'ok', data: '识别文字' }
 *
 * 服务不可用时由前端回退浏览器 Web Speech API；这里只负责转发与错误透传。
 *
 * 配置：$DSH_HOME/team-workbench/stt-settings.json
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { harnessHome, text } from './team.js'

const SETTINGS_FILE = 'stt-settings.json'
const DEFAULT_SETTINGS = { enabled: true, baseUrl: 'http://127.0.0.1:9977', model: 'tiny', language: 'zh' }
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const TIMEOUT_MS = 120000

function settingsPath() {
  return join(harnessHome(), 'team-workbench', SETTINGS_FILE)
}

export async function loadSttSettings() {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8'))
    return {
      enabled: parsed?.enabled !== false,
      baseUrl: text(parsed?.baseUrl) || DEFAULT_SETTINGS.baseUrl,
      model: text(parsed?.model) || DEFAULT_SETTINGS.model,
      language: text(parsed?.language) || DEFAULT_SETTINGS.language
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSttSettings(next) {
  const target = settingsPath()
  await mkdir(dirname(target), { recursive: true })
  const payload = JSON.stringify({
    enabled: next.enabled !== false,
    baseUrl: text(next.baseUrl) || DEFAULT_SETTINGS.baseUrl,
    model: text(next.model) || DEFAULT_SETTINGS.model,
    language: text(next.language) || DEFAULT_SETTINGS.language
  }, null, 2)
  const temp = target + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(temp, payload, 'utf8')
  await rename(temp, target)
  return loadSttSettings()
}

/** 探测本地服务是否在线（只打根路径，不跑识别）。 */
export async function probeStt(settings) {
  const base = text(settings.baseUrl).replace(/\/+$/, '')
  if (base.length === 0) return { ok: false, error: '没有配置 STT 地址' }
  try {
    const response = await fetch(base + '/', { signal: AbortSignal.timeout(3000) })
    return { ok: response.status < 500, status: response.status }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/**
 * 转发一段音频到本地 STT。
 * @param {Buffer} bytes 音频字节
 * @param {{ filename?: string, contentType?: string, settings?: object }} options
 */
export async function transcribe(bytes, options = {}) {
  const settings = options.settings || await loadSttSettings()
  if (settings.enabled === false) throw new Error('语音识别已关闭')
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('音频为空')
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error('音频超过 ' + String(Math.round(MAX_AUDIO_BYTES / 1024 / 1024)) + 'MB 上限')
  const base = text(settings.baseUrl).replace(/\/+$/, '')
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: options.contentType || 'audio/webm' }), options.filename || 'speech.webm')
  form.append('language', settings.language || 'zh')
  form.append('model', settings.model || 'tiny')
  form.append('response_format', 'text')
  const response = await fetch(base + '/api', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const raw = await response.text()
  if (!response.ok) throw new Error('STT HTTP ' + String(response.status) + '：' + raw.slice(0, 200))
  let payload = null
  try { payload = JSON.parse(raw) } catch { /* 可能是纯文本 */ }
  if (payload !== null && typeof payload === 'object' && 'code' in payload) {
    if (Number(payload.code) !== 0) throw new Error('STT 失败：' + text(payload.msg || raw).slice(0, 200))
    return text(payload.data).trim()
  }
  return text(raw).trim()
}
