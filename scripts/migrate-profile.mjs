#!/usr/bin/env node
/**
 * migrate-profile.mjs — 把 web profile 从「两支 UI 插件」切到「一个原生工作台」
 *
 * 做三件事（每步都先备份、都幂等、失败即停）：
 *   1. 备份 profile 的 package.json / cordis.patch.yml 到 harness 下带时间戳的目录；
 *   2. 用官方 CLI 安装本包（.tgz），它会写 dsh.profile.bundles 与 dependencies；
 *   3. 从 bundles / dependencies 摘掉 dsh-agent-team-studio 与 dsh-skill-manager，
 *      并关掉 cordis.patch.yml 里它们的手动挂载行。
 *
 * 为什么必须摘掉：本包提供**同名**的 11 个模型工具
 * （agent_team_roster / agent_team_dispatch / agent_team_task +
 *   skill_manager_list / skill_manager_read / skill_manager_save /
 *   skill_manager_delete / skill_manager_deploy），同时挂载会工具重名冲突；
 * 而且两套 UI 会同时出现，旧的浮动管理台仍在页面上（就是「无法回收」那个）。
 *
 * 用法：
 *   node scripts/migrate-profile.mjs --dry-run     # 只打印将要做的改动
 *   node scripts/migrate-profile.mjs               # 真改（需要能写 <harness>/profiles/web）
 *   node scripts/migrate-profile.mjs --from <路径> # 指定安装源（.tgz 或包目录）
 *   node scripts/migrate-profile.mjs --rollback <备份目录>
 *
 * 安装源解析顺序：--from 指定值 → 包根/当前目录里最新的 .tgz → 包目录本身。
 * 因此从 tarball 装进 profile 之后，也能在 node_modules/dsh-team-workbench 里直接跑迁移。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const rollbackAt = args.indexOf('--rollback')

const HARNESS = process.env.DSH_HOME || join(homedir(), 'Library', 'Application Support', 'dsh-desktop', 'harness')

function fail(message) { console.error('错误：' + message); process.exit(1) }
function info(message) { console.log(message) }

const PROFILE = process.env.DSH_PROFILE || 'web'
const profileDir = join(HARNESS, 'profiles', PROFILE)
// 检查必须用 PROFILE 本身：早期版本这里硬编码了 'web'，于是 DSH_PROFILE=headless
// 且 harness 只有 profiles/headless 时会误报「找不到 web profile」并直接退出。
if (!existsSync(profileDir)) fail('找不到 ' + PROFILE + ' profile：' + profileDir)
const pkgPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')
const OLD_UI = ['dsh-agent-team-studio', 'dsh-skill-manager']
const NEW_PKG = pkg.name

// —— 回滚 ——
if (rollbackAt >= 0) {
  const dir = args[rollbackAt + 1]
  if (!dir || !existsSync(dir)) fail('回滚需要给出备份目录：node scripts/migrate-profile.mjs --rollback <dir>')
  for (const name of ['package.json', 'cordis.patch.yml']) {
    const from = join(dir, name)
    if (!existsSync(from)) { info('跳过（备份里没有）：' + name); continue }
    copyFileSync(from, join(profileDir, name))
    info('已恢复 ' + name)
  }
  info('\n回滚完成。请完整退出并重新打开 DSH Desktop。')
  info('提示：pnpm 的 node_modules 链接可能仍指向新包，必要时在 profile 目录里重新 pnpm install。')
  process.exit(0)
}

// —— 备份 ——
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backupDir = join(HARNESS, 'backup-workbench-' + stamp)
if (!dryRun) {
  mkdirSync(backupDir, { recursive: true })
  for (const name of ['package.json', 'cordis.patch.yml']) {
    if (existsSync(join(profileDir, name))) copyFileSync(join(profileDir, name), join(backupDir, name))
  }
  info('已备份到 ' + backupDir)
}

// —— 1. 安装本包（官方 CLI 通道）——
const cli = join(HARNESS, '.desktop-bin', 'node')
// dsh CLI 入口默认按 DSH Desktop 的安装位置解析；DSH_BIN 可覆盖，
// 既方便 Desktop 升级/换位置，也让 scripts/smoke-migrate.mjs 能用假 CLI 做端到端回归。
const dshBin = process.env.DSH_BIN
  || '/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js'
// 安装源：优先 .tgz（规范 3.6 推荐的发布形态），找不到就退回包目录本身。
// 为什么不能只认「包根有 .tgz」：从 tarball 安装到 profile 的
// node_modules/dsh-team-workbench 之后，包目录里并没有 .tgz，
// 此时迁移只能以包目录为安装源——否则这个脚本在安装后就跑不起来。
const fromArg = args.indexOf('--from')
function findTarball() {
  const dirs = [fromArg >= 0 ? dirname(resolve(args[fromArg + 1] || '.')) : pkgRoot, process.cwd()]
  for (const dir of dirs) {
    let names = []
    try { names = readdirSync(dir).filter((n) => n.endsWith('.tgz')).sort() } catch { names = [] }
    if (names.length > 0) return join(dir, names[names.length - 1])
  }
  return undefined
}
const installSource = fromArg >= 0
  ? resolve(args[fromArg + 1])
  : (findTarball() || pkgRoot)
const installCmd = [cli, dshBin, 'plugin', '--profile', PROFILE, 'add', installSource]
info('\n安装源：' + installSource + (installSource.endsWith('.tgz') ? '（tarball）' : '（包目录）'))
info('即将执行安装：\n  DSH_HOME=' + HARNESS + ' ' + installCmd.join(' '))
if (!dryRun) {
  const { spawnSync } = await import('node:child_process')
  // 注意：这里必须与上面 installCmd 用同一个 installSource。
  // 曾经这里残留了改造前的变量名 tarball，导致非 dry-run 路径直接 ReferenceError，
  // 而 --dry-run 覆盖不到——所以现在有 scripts/smoke-migrate.mjs 做端到端回归。
  const r = spawnSync(cli, [dshBin, 'plugin', '--profile', PROFILE, 'add', installSource], {
    env: { ...process.env, DSH_HOME: HARNESS },
    stdio: 'inherit'
  })
  if (r.status !== 0) fail('安装失败（退出码 ' + r.status + '）')
}

// —— 2. 摘掉旧的两支 UI 插件 ——
const profilePkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const changed = []
for (const name of OLD_UI) {
  if (profilePkg.dependencies && profilePkg.dependencies[name] !== undefined) {
    delete profilePkg.dependencies[name]
    changed.push('dependencies: -' + name)
  }
  const bundles = profilePkg.dsh && profilePkg.dsh.profile && profilePkg.dsh.profile.bundles
  if (Array.isArray(bundles) && bundles.includes(name)) {
    profilePkg.dsh.profile.bundles = bundles.filter((b) => b !== name)
    changed.push('bundles: -' + name)
  }
}
const bundles = (profilePkg.dsh && profilePkg.dsh.profile && profilePkg.dsh.profile.bundles) || []
if (!bundles.includes(NEW_PKG)) {
  profilePkg.dsh = profilePkg.dsh || {}
  profilePkg.dsh.profile = profilePkg.dsh.profile || {}
  profilePkg.dsh.profile.bundles = [...bundles, NEW_PKG]
  changed.push('bundles: +' + NEW_PKG)
}
if (changed.length === 0) info('\nprofile 已是目标状态，无需改动')
else {
  info('\npackage.json 改动：\n  ' + changed.join('\n  '))
  if (!dryRun) writeFileSync(pkgPath, JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
}

// —— 3. 关掉旧插件的手动挂载行 ——
let patch = readFileSync(patchPath, 'utf8')
let patchChanged = 0
patch = patch.replace(/^(\s*)- id: (agent-team-studio|skill-manager)\n(\s*)disabled: false\n/gm, (_m, indent, id, ind2) => {
  patchChanged += 1
  return `${indent}- id: ${id}\n${ind2}disabled: true\n`
})
if (patchChanged > 0) {
  info('cordis.patch.yml：' + patchChanged + ' 条旧插件挂载行改为 disabled: true')
  if (!dryRun) writeFileSync(patchPath, patch, 'utf8')
} else {
  info('cordis.patch.yml：没有需要关闭的旧挂载行（可能本来就没有）')
}

info('\n' + (dryRun ? '（dry-run，未做任何改动）' : '迁移完成'))
info('\n下一步（必须由用户手动执行）：')
info('  1. 完整退出 DSH Desktop，再重新打开（插件层在启动时组装）')
info('  2. 打开后从侧栏顶部模式切换器切到「智能体团队 · 技能管理」，核对两个标签')
if (dryRun) {
  // dry-run 不会创建备份目录，这里不能给出一个「看起来能跑、实际目录不存在」的回滚命令。
  info('  3. 本次是 dry-run，未创建备份目录；真正执行迁移时会打印可用的回滚命令')
} else {
  info('  3. 如出现问题，回滚（备份确实已在第 1 步创建）：')
  info('     node scripts/migrate-profile.mjs --rollback ' + backupDir)
}
