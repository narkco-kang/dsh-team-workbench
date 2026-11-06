#!/usr/bin/env node
/**
 * ensure-react.mjs — 为 SSR 冒烟测试准备一份 React 18
 *
 * 来源按顺序尝试：
 *   1. --react <dir> / $DSH_REACT_DIR 指定的目录；
 *   2. 已解出的缓存目录（默认 <包>/.cache/react）；
 *   3. 从 DSH Desktop 的 app.asar 里解出 react 与 react-dom（委托 extract-asar.py）。
 *
 * 为什么要从 asar 解：SSR 测试必须用**宿主同一份** React 才有意义，而 profile 的
 * node_modules 里没有 react（React 是宿主内置的，不落地成普通依赖）。
 * 为什么委托 Python：Electron 的 asar 补丁会拦截 .asar 路径，且本机这份 0.11.1 构建的
 * 条目数据偏移不是固定对齐的；Python 直接 open(2) 读、用 integrity 哈希对齐最直接。
 *
 * 用法：
 *   node scripts/ensure-react.mjs [--react <dir>] [--out <dir>] [--force]
 * 成功时把可用目录的绝对路径打印到 stdout 的**最后一行**。
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASAR = '/Applications/DSH Desktop.app/Contents/Resources/app.asar'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const force = process.argv.includes('--force')
const explicit = arg('--react') ? resolve(arg('--react')) : (process.env.DSH_REACT_DIR ? resolve(process.env.DSH_REACT_DIR) : undefined)
const outDir = resolve(arg('--out') || process.env.DSH_REACT_DIR || join(root, '.cache', 'react'))

function usable(dir) {
  return dir !== undefined
    && existsSync(join(dir, 'node_modules', 'react', 'package.json'))
    && existsSync(join(dir, 'node_modules', 'react-dom', 'package.json'))
}
function done(dir, note) {
  console.log(note + '：' + dir)
  console.log(dir)
  process.exit(0)
}

if (usable(explicit)) done(explicit, '复用 --react / DSH_REACT_DIR 指定的 React 目录')
if (!force && usable(outDir)) done(outDir, '复用已解出的 React 目录')
if (!existsSync(ASAR)) {
  console.error('找不到 app.asar：' + ASAR)
  console.error('请用 --react <含 node_modules/react 的目录> 指定一份 React 18。')
  process.exit(1)
}

const extractor = join(here, 'extract-asar.py')
const python = process.env.PYTHON || 'python3'
const result = spawnSync(python, [extractor, ASAR, outDir, 'react', 'react-dom'], { encoding: 'utf8' })
if (result.error) {
  console.error('调用 ' + python + ' 失败：' + String(result.error.message))
  console.error('可用 --react <dir> 指定现成 React；或安装 python3 后重试。')
  process.exit(1)
}
if (result.status !== 0) {
  console.error('extract-asar.py 退出码 ' + result.status)
  console.error((result.stderr || '').trim())
  process.exit(1)
}
const stats = (result.stdout || '').trim().split('\n').pop()
if (!usable(outDir)) {
  console.error('解出的目录不可用：' + outDir)
  process.exit(1)
}
done(outDir, '已从 app.asar 解出 React（' + stats + '）')
