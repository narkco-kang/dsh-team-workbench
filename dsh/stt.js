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
import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { harnessHome, text } from './team.js'

/** 找 ffmpeg：云厂商多数不收 webm/opus，要先转码。 */
const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
let ffmpegPathCache = null
async function ffmpegPath() {
  if (ffmpegPathCache !== null) return ffmpegPathCache
  for (const candidate of FFMPEG_CANDIDATES) {
    try { await readFile(candidate); ffmpegPathCache = candidate; return candidate } catch { /* 试下一个 */ }
  }
  const found = await new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
    child.on('error', () => resolve(''))
    child.on('close', (code) => resolve(code === 0 ? 'ffmpeg' : ''))
  })
  ffmpegPathCache = found
  return found
}

/**
 * 把浏览器录音（webm/opus）转成云厂商普遍支持的 mp3（16k 单声道）。
 * 转码失败就返回 null，调用方保留原始音频。
 */
export async function convertToMp3(bytes, contentType) {
  const binary = await ffmpegPath()
  if (binary.length === 0) return null
  const stamp = String(process.pid) + '-' + String(Date.now()) + '-' + String(Math.round(Math.random() * 1e6))
  const input = join(tmpdir(), 'stt-in-' + stamp + (String(contentType).includes('wav') ? '.wav' : '.webm'))
  const output = join(tmpdir(), 'stt-out-' + stamp + '.mp3')
  try {
    await writeFile(input, bytes)
    const ok = await new Promise((resolve) => {
      const child = spawn(binary, ['-y', '-loglevel', 'error', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', output])
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    })
    if (!ok) return null
    const converted = await readFile(output)
    return converted.length > 0 ? converted : null
  } catch {
    return null
  } finally {
    void unlink(input).catch(() => {})
    void unlink(output).catch(() => {})
  }
}

const SETTINGS_FILE = 'stt-settings.json'
/**
 * 转写服务预设：不绑定某一家。
 * protocol:
 *   local    → 本地 stt 的 /api（multipart，回 {code,data}）
 *   openai   → /audio/transcriptions（OpenAI 及兼容方：GLM-ASR、SiliconFlow、Groq、本地 stt /v1…）
 *   minimax  → /speech_to_text（MiniMax，multipart + language 头，回 {text}）
 */
const PROVIDERS = {
  local: { label: '本地 stt（faster-whisper）', protocol: 'local', apiBase: 'http://127.0.0.1:9977', apiModel: 'medium' },
  openai: { label: 'OpenAI Whisper', protocol: 'openai', apiBase: 'https://api.openai.com/v1', apiModel: 'whisper-1' },
  glm: { label: '智谱 GLM-ASR', protocol: 'openai', apiBase: 'https://open.bigmodel.cn/api/paas/v4', apiModel: 'glm-asr-2512' },
  minimax: { label: 'MiniMax ASR', protocol: 'minimax', apiBase: 'https://api.minimax.chat/v1', apiModel: 'asr-1.0' },
  custom: { label: '自定义 OpenAI 兼容', protocol: 'openai', apiBase: '', apiModel: '' }
}

export function providerPresets() {
  return Object.keys(PROVIDERS).map((id) => ({ id, label: PROVIDERS[id].label, protocol: PROVIDERS[id].protocol, apiBase: PROVIDERS[id].apiBase, apiModel: PROVIDERS[id].apiModel }))
}

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'local',
  baseUrl: 'http://127.0.0.1:9977',
  model: 'medium',
  language: 'zh',
  fallbackWebSpeech: false,
  apiBase: '',
  apiKey: '',
  apiModel: '',
  // 模型校对：识别完再用团队里的某个成员做最小纠错（同音字/错字/漏标点），不改写。
  reviewEnabled: false,
  // 直接指定「校对模型」，不用再挑成员（成员换模型时校对不会跟着变）。
  reviewProvider: '',
  reviewModel: '',
  // 兼容旧配置：只有选了成员、没选模型时才用成员路由。
  reviewMemberId: '',
  // 语音场景的常用术语，开箱即用；用户可在面板里改。
  reviewGlossary: '智能体、语音识别、接口联调、验收清单'
}
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
      fallbackWebSpeech: parsed?.fallbackWebSpeech === true,
      provider: PROVIDERS[parsed?.provider] !== undefined ? parsed.provider : (parsed?.mode === 'openai' ? 'custom' : 'local'),
      apiBase: text(parsed?.apiBase) || PROVIDERS[parsed?.provider]?.apiBase || '',
      apiKey: text(parsed?.apiKey),
      apiModel: text(parsed?.apiModel) || PROVIDERS[parsed?.provider]?.apiModel || '',
      reviewEnabled: parsed?.reviewEnabled === true,
      reviewProvider: text(parsed?.reviewProvider),
      reviewModel: text(parsed?.reviewModel),
      reviewMemberId: text(parsed?.reviewMemberId),
      // 没填就用默认术语表（用户明确要的默认值）。
      reviewGlossary: text(parsed?.reviewGlossary) || DEFAULT_SETTINGS.reviewGlossary
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
    fallbackWebSpeech: next.fallbackWebSpeech === true,
    provider: PROVIDERS[next.provider] !== undefined ? next.provider : 'local',
    apiBase: text(next.apiBase),
    apiKey: next.apiKey === undefined ? '' : text(next.apiKey),
    apiModel: text(next.apiModel),
    reviewEnabled: next.reviewEnabled === true,
    reviewProvider: text(next.reviewProvider),
    reviewModel: text(next.reviewModel),
    reviewMemberId: text(next.reviewMemberId),
    reviewGlossary: text(next.reviewGlossary) || DEFAULT_SETTINGS.reviewGlossary
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
  const providerId = PROVIDERS[settings.provider] !== undefined ? settings.provider : 'local'
  const protocol = PROVIDERS[providerId].protocol
  const language = settings.language || 'zh'
  // 云厂商多数不接受 webm/opus（MiniMax 会直接 400: unsupported audio format），先转成 mp3。
  let payloadBytes = bytes
  let payloadType = options.contentType || 'audio/webm'
  let payloadName = options.filename || 'speech.webm'
  if (protocol !== 'local') {
    const mp3 = await convertToMp3(bytes, payloadType)
    if (mp3 !== null) {
      payloadBytes = mp3
      payloadType = 'audio/mpeg'
      payloadName = payloadName.replace(/\.[a-z0-9]+$/i, '') + '.mp3'
    } else if (providerId === 'minimax') {
      throw new Error('这台机器没找到 ffmpeg：MiniMax 不接受浏览器录的 webm，需要先把音频转成 mp3/wav')
    }
  }
  const form = new FormData()
  form.append('file', new Blob([payloadBytes], { type: payloadType }), payloadName)
  const headers = {}
  let endpoint = ''

  if (protocol === 'local') {
    const base = text(settings.baseUrl).replace(/\/+$/, '')
    endpoint = base + '/api'
    form.append('language', language)
    form.append('response_format', 'text')
    form.append('model', settings.model || 'medium')
  } else {
    const apiBase = text(settings.apiBase).replace(/\/+$/, '')
    if (apiBase.length === 0) throw new Error('没有配置接口地址')
    if (text(settings.apiKey).length > 0) headers.authorization = 'Bearer ' + text(settings.apiKey)
    if (protocol === 'minimax') {
      endpoint = apiBase + '/speech_to_text'
      form.append('model', text(settings.apiModel) || 'asr-1.0')
      form.append('response_format', 'json')
      headers.language = language
    } else {
      endpoint = apiBase + '/audio/transcriptions'
      form.append('model', text(settings.apiModel) || 'whisper-1')
      form.append('language', language)
      form.append('response_format', 'text')
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const raw = await response.text()
  if (!response.ok) throw new Error('STT HTTP ' + String(response.status) + '：' + raw.slice(0, 200))

  // 各家响应形态不同：本地 stt {code,data}；MiniMax {text,duration}；OpenAI 兼容多为纯文本或 {text}。
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { /* 纯文本 */ }
  if (parsed !== null && typeof parsed === 'object' && 'code' in parsed) {
    if (Number(parsed.code) !== 0) throw new Error('STT 失败：' + text(parsed.msg || raw).slice(0, 200))
    return cleanTranscript(parsed.data)
  }
  if (parsed !== null && typeof parsed === 'object' && typeof parsed.text === 'string') return cleanTranscript(parsed.text)
  return cleanTranscript(raw)
}

/** 生成 0.8 秒 16k 单声道 WAV（低音量正弦），用于「测通断 + 测延迟」，不依赖麦克风。 */
export function makeTestWav(seconds = 0.8) {
  const rate = 16000
  const total = Math.max(1, Math.floor(rate * seconds))
  const buffer = Buffer.alloc(44 + total * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + total * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(total * 2, 40)
  for (let index = 0; index < total; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * index) / rate) * 0.08 * 32767)
    buffer.writeInt16LE(value, 44 + index * 2)
  }
  return buffer
}

/** 一键自检：拿一段合成音频走当前服务商，回报连通性、耗时与返回文本长度。 */
export async function selftest(settings) {
  const started = Date.now()
  try {
    const value = await transcribe(makeTestWav(0.8), { settings, filename: 'selftest.wav', contentType: 'audio/wav' })
    return { ok: true, ms: Date.now() - started, text: text(value).slice(0, 80) }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: String(error && error.message ? error.message : error) }
  }
}
