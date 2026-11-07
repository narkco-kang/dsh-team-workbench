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
const DEFAULT_SETTINGS = { enabled: true, baseUrl: 'http://127.0.0.1:9977', model: 'tiny', language: 'zh', fallbackWebSpeech: false }
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
      language: text(parsed?.language) || DEFAULT_SETTINGS.language,
      // 默认不回退浏览器识别：Electron 里 Web Speech 往往要联网，失败信息反而盖住真正的原因。
      fallbackWebSpeech: parsed?.fallbackWebSpeech === true
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
    language: text(next.language) || DEFAULT_SETTINGS.language,
    fallbackWebSpeech: next.fallbackWebSpeech === true
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
/** whisper 在静音/噪声上常见的「幻觉」句子：整句命中就丢掉，避免给用户编一段话。 */
const HALLUCINATIONS = [
  /^谢谢(大家)?观看[。！!]?$/u,
  /^感谢(大家)?观看[。！!]?$/u,
  /^请不吝点赞[^。]*$/u,
  /^明镜与点点栏目$/u,
  /^字幕由[^。]*提供[。]?$/u,
  /^中文字幕[^。]*$/u,
  /^关注公众号[^。]*$/u,
  /^订阅(一下)?频道[^。]*$/u,
  /^thank(s)? (you )?for watching[.!]?$/iu,
  /^subtitles? by[^.]*$/iu,
  /^please subscribe[^.]*$/iu
]

export function isHallucination(value) {
  const line = text(value).trim()
  if (line.length === 0) return true
  return HALLUCINATIONS.some((pattern) => pattern.test(line))
}

/** 清掉逐行幻觉；剩下的若都是空白就返回空串（前端会提示「没识别到内容」）。 */
export function cleanTranscript(value) {
  return text(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isHallucination(line))
    .join(' ')
    .trim()
}

export async function transcribe(bytes, options = {}) {
  const settings = options.settings || await loadSttSettings()
  if (settings.enabled === false) throw new Error('语音识别已关闭')
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('音频为空')
  // 太短的录音让 whisper 猜，猜出来的多半是幻觉；宁可让用户重说。
  const durationMs = Number(options.durationMs)
  if (Number.isFinite(durationMs) && durationMs > 0 && durationMs < 600) throw new Error('录音太短（不到 1 秒），请按住麦克风说一句')
  if (bytes.length < 1500) throw new Error('没有录到声音（音频过小），检查麦克风权限后重试')
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
    return cleanTranscript(payload.data)
  }
  return cleanTranscript(raw)
}
