/**
 * 服务商余额查询：只支持官方公开余额接口的三类 Key。
 * Key 存在 $DSH_HOME/agent-team-studio/balance-keys.json（0600），
 * 只发给对应服务商的官方域名，不返回给前端、不写日志。
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { harnessHome } from './team.js'

export const BALANCE_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek 官方', hint: 'platform.deepseek.com 的 API Key（sk-…）', endpoint: 'https://api.deepseek.com/user/balance' },
  { id: 'moonshot', name: 'Moonshot / Kimi', hint: 'platform.moonshot.cn 的 API Key（sk-…）', endpoint: 'https://api.moonshot.cn/v1/users/me/balance' },
  { id: 'openrouter', name: 'OpenRouter', hint: 'openrouter.ai/keys 的 Key（sk-or-…）', endpoint: 'https://openrouter.ai/api/v1/credits' }
]

function keysPath() {
  return join(harnessHome(), 'agent-team-studio', 'balance-keys.json')
}

export async function readKeys() {
  try {
    const parsed = JSON.parse(await readFile(keysPath(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function writeKey(id, key) {
  const known = BALANCE_PROVIDERS.some((p) => p.id === id)
  if (!known) throw new Error('未知的服务商：' + id)
  const keys = await readKeys()
  if (typeof key === 'string' && key.trim().length > 0) keys[id] = key.trim()
  else delete keys[id]
  await mkdir(dirname(keysPath()), { recursive: true })
  await writeFile(keysPath(), JSON.stringify(keys), { mode: 0o600 })
  await chmod(keysPath(), 0o600)
}

async function jsonFetch(url, key, headers) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 9000)
  try {
    const response = await fetch(url, { headers: { authorization: 'Bearer ' + key, ...(headers || {}) }, signal: controller.signal })
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* 非 JSON */ }
    if (!response.ok) {
      const message = body && (body.error?.message || body.message) ? String(body.error?.message || body.message) : 'HTTP ' + response.status
      throw new Error(message.slice(0, 200))
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

async function queryOne(provider, key) {
  if (provider.id === 'deepseek') {
    const body = await jsonFetch(provider.endpoint, key)
    const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
    const first = infos[0]
    if (!first) throw new Error('接口没有返回余额')
    return { balance: Number(first.total_balance), currency: String(first.currency || 'CNY'), detail: '赠送 ' + String(first.granted_balance ?? '-') + ' · 充值 ' + String(first.topped_up_balance ?? '-') }
  }
  if (provider.id === 'moonshot') {
    const body = await jsonFetch(provider.endpoint, key)
    const data = body?.data || {}
    return { balance: Number(data.available_balance), currency: 'CNY', detail: '现金 ' + String(data.cash_balance ?? '-') + ' · 代金券 ' + String(data.voucher_balance ?? '-') }
  }
  if (provider.id === 'openrouter') {
    const body = await jsonFetch(provider.endpoint, key, { 'HTTP-Referer': 'https://github.com/narkco-kang/dsh-team-workbench' })
    const data = body?.data || {}
    const remaining = Number(data.total_credits) - Number(data.total_usage)
    return { balance: remaining, currency: 'USD', detail: '总额 ' + String(data.total_credits) + ' · 已用 ' + String(data.total_usage) }
  }
  throw new Error('该服务商没有公开余额接口')
}

let cache = { at: 0, items: [] }

export async function readBalances(force) {
  if (!force && Date.now() - cache.at < 30_000) return cache.items
  const keys = await readKeys()
  const items = []
  for (const provider of BALANCE_PROVIDERS) {
    const key = typeof keys[provider.id] === 'string' ? keys[provider.id] : ''
    if (key.length === 0) {
      items.push({ id: provider.id, name: provider.name, configured: false, ok: false, error: '', balance: null, currency: '', detail: '', checkedAt: '' })
      continue
    }
    try {
      const result = await queryOne(provider, key)
      items.push({ id: provider.id, name: provider.name, configured: true, ok: true, error: '', balance: result.balance, currency: result.currency, detail: result.detail, checkedAt: new Date().toISOString() })
    } catch (error) {
      items.push({ id: provider.id, name: provider.name, configured: true, ok: false, error: String(error && error.message ? error.message : error).slice(0, 200), balance: null, currency: '', detail: '', checkedAt: new Date().toISOString() })
    }
  }
  cache = { at: Date.now(), items }
  return items
}
