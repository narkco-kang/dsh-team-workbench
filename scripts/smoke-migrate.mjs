#!/usr/bin/env node
/**
 * smoke-migrate.mjs — migrate-profile.mjs 的端到端回归
 *
 * 为什么需要它：--dry-run 不执行安装分支，所以「非 dry-run 里引用了未定义变量」
 * 这类错误 dry-run 与 node --check 都抓不到（第 4 版就踩过：安装分支残留了旧变量名
 * tarball，真实迁移一跑就 ReferenceError）。
 *
 * 做法：用假 harness + 假 CLI 真跑一遍迁移——
 *   · 假 CLI 是一个被当成 node 解释器调用的脚本，它把收到的参数写到 argv.log，
 *     并按真实 CLI 的行为把包名追加进 profile 的 dsh.profile.bundles；
 *   · 断言：CLI 收到 `plugin --profile web add <期望安装源>`；旧两支从
 *     dependencies 与 bundles 里被摘掉；本包进了 bundles；备份目录已创建；
 *     非 dry-run 在两种安装源位置（源码目录 / 无 .tgz 的包目录）都能跑通。
 *
 * 运行：node scripts/smoke-migrate.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')
const migrate = join(here, 'migrate-profile.mjs')

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ' — ' + detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  (' + detail + ')'}`)
}

const SEED_PKG = {
  name: 'dsh-profile-web',
  private: true,
  dependencies: {
    'dsh-agent-team-studio': 'link:/Users/x/agent/dsh-agent-team-studio',
    'dsh-skill-manager': 'link:/Users/x/agent/dsh-skill-manager'
  },
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', 'dsh-agent-team-studio', 'dsh-skill-manager']
    }
  }
}
const SEED_PATCH = [
  '# seed patch',
  '- id: agent-team-studio',
  '  disabled: false',
  '- id: skill-manager',
  '  disabled: false',
  ''
].join('\n')

/** 搭一个假 harness：profiles/web + .desktop-bin/{node,pnpm} + 假 node CLI。 */
function makeHarness(profile = 'web') {
  const root = mkdtempSync(join(tmpdir(), 'tw-harness-'))
  mkdirSync(join(root, 'profiles', profile), { recursive: true })
  mkdirSync(join(root, '.desktop-bin'), { recursive: true })
  writeFileSync(join(root, 'profiles', profile, 'package.json'), JSON.stringify(SEED_PKG, null, 2) + '\n')
  writeFileSync(join(root, 'profiles', profile, 'cordis.patch.yml'), SEED_PATCH)
  const argvLog = join(root, 'argv.log')
  // 假 CLI：被当成 node 调用。argv[2] 是 dsh bin 路径，之后是真实参数。
  const fakeCli = join(root, 'fake-cli.mjs')
  writeFileSync(fakeCli, [
    "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    'const args = process.argv.slice(2)',
    'appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(args) + "\\n")',
    '// 模仿真实 CLI：把包名追加进 profile 的 dsh.profile.bundles',
    'const profileDir = process.env.DSH_HOME + "/profiles/" + (process.env.DSH_PROFILE || "web")',
    'const p = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"))',
    'const source = args[args.length - 1]',
    'const name = source.endsWith(".tgz") ? "dsh-team-workbench" : JSON.parse(readFileSync(join(source, "package.json"), "utf8")).name',
    'p.dependencies = p.dependencies || {}',
    'p.dependencies[name] = "link:" + source',
    'p.dsh.profile.bundles.push(name)',
    'writeFileSync(join(profileDir, "package.json"), JSON.stringify(p, null, 2) + "\\n")',
    ''
  ].join('\n'))
  // 假 node：把自己当成解释器执行第一个参数（migrate 脚本传的是 DSH_BIN）
  const fakeNode = join(root, '.desktop-bin', 'node')
  writeFileSync(fakeNode, '#!/bin/sh\nexec "' + process.execPath + '" "$@"\n')
  chmodSync(fakeNode, 0o755)
  return { root, argvLog, fakeCli, profile }
}

function run(cwd, env, extraArgs = []) {
  return spawnSync(process.execPath, [migrate, ...extraArgs], {
    cwd,
    encoding: 'utf8',
    // DSH_BIN 指向假 CLI：migrate 脚本会用 <harness>/.desktop-bin/node 去执行它，
    // 而那个「node」也是假的（直接 exec 真 node + 参数）。这样整条安装分支都能被断言。
    env: { ...process.env, ...env, DSH_BIN: env.FAKE_CLI }
  })
}

function makeTarballDir() {
  // 造一个「含 .tgz 的源码目录」：只需有一个 .tgz 文件，脚本不会解它（假 CLI 只记参数）
  const dir = mkdtempSync(join(tmpdir(), 'tw-src-'))
  writeFileSync(join(dir, 'dsh-team-workbench-1.0.0.tgz'), 'not-a-real-tarball')
  return dir
}

function seedProfile(dir, argvLog, fakeCli) {
  writeFileSync(join(dir, 'profiles', 'web', 'package.json'), JSON.stringify(SEED_PKG, null, 2) + '\n')
  writeFileSync(join(dir, 'profiles', 'web', 'cordis.patch.yml'), SEED_PATCH)
  rmSync(argvLog, { force: true })
  // 假 CLI 与假 node 需要重写（目录是新的）
  writeFileSync(join(dir, 'fake-cli.mjs'), readFileSync(join(fakeCli), 'utf8'))
  writeFileSync(join(dir, '.desktop-bin', 'node'), '#!/bin/sh\nexec "' + process.execPath + '" "$@"\n')
  chmodSync(join(dir, '.desktop-bin', 'node'), 0o755)
}

// —— 场景 1：源码目录里有 .tgz → 安装源应该是那个 .tgz ——
// 注意：必须把 migrate 脚本本身也复制进 src，否则脚本的 pkgRoot 会指向真实仓库根、
// 命中里面的真 .tgz，导致 src 里的假 .tgz 变成死代码（上一轮审核员指出的问题）。
{
  const h = makeHarness()
  const src = makeTarballDir()
  mkdirSync(join(src, 'scripts'), { recursive: true })
  writeFileSync(join(src, 'package.json'), JSON.stringify({ name: 'dsh-team-workbench' }, null, 2))
  writeFileSync(join(src, 'scripts', 'migrate-profile.mjs'), readFileSync(migrate, 'utf8'))
  const emptyCwd1 = mkdtempSync(join(tmpdir(), 'tw-cwd1-'))
  const r = spawnSync(process.execPath, [join(src, 'scripts', 'migrate-profile.mjs')], {
    cwd: emptyCwd1,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: h.root, FAKE_ARGV_LOG: h.argvLog, FAKE_CLI: h.fakeCli, DSH_BIN: h.fakeCli }
  })
  check('场景1（源码目录 + tarball）非 dry-run 不抛错', r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').split('\n').slice(0, 2).join(' '))
  const argv = existsSync(h.argvLog) ? readFileSync(h.argvLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  const last = argv[argv.length - 1] || []
  check('场景1 CLI 收到 install/add 与 .tgz 安装源（且是 src 里那个 .tgz）',
    last.includes('plugin') && last.includes('add')
    && realpathSync(last[last.length - 1]) === realpathSync(join(src, 'dsh-team-workbench-1.0.0.tgz')),
    last.join(' '))
  const profile = JSON.parse(readFileSync(join(h.root, 'profiles', 'web', 'package.json'), 'utf8'))
  check('场景1 旧两支已从 dependencies 摘掉',
    profile.dependencies['dsh-agent-team-studio'] === undefined && profile.dependencies['dsh-skill-manager'] === undefined)
  check('场景1 旧两支已从 bundles 摘掉',
    !profile.dsh.profile.bundles.includes('dsh-agent-team-studio') && !profile.dsh.profile.bundles.includes('dsh-skill-manager'))
  check('场景1 本包已进 bundles', profile.dsh.profile.bundles.includes('dsh-team-workbench'), profile.dsh.profile.bundles.join(','))
  check('场景1 备份目录已创建', readdirSync(h.root).some((n) => n.startsWith('backup-workbench-')))
  rmSync(emptyCwd1, { recursive: true, force: true })
  rmSync(h.root, { recursive: true, force: true })
  rmSync(src, { recursive: true, force: true })
}

// —— 场景 2：把包内容复制成「已安装的包目录」（没有 .tgz）→ 安装源应该是包目录本身 ——
{
  const h = makeHarness()
  const installed = mkdtempSync(join(tmpdir(), 'tw-installed-'))
  mkdirSync(join(installed, 'dsh'), { recursive: true })
  writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'dsh-team-workbench', version: '1.0.0' }, null, 2))
  writeFileSync(join(installed, 'dsh', 'index.js'), '// stub\n')
  // 关键：cwd 必须也没有 .tgz，否则 findTarball() 会先命中 cwd 里的 tarball，
  // 测不到「回退到包目录」这条分支。
  const emptyCwd = mkdtempSync(join(tmpdir(), 'tw-cwd-'))
  const r = run(emptyCwd, { DSH_HOME: h.root, FAKE_ARGV_LOG: h.argvLog, FAKE_CLI: h.fakeCli }, ['--from', installed])
  check('场景2（已安装包目录，无 tarball）非 dry-run 不抛错', r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').split('\n').slice(0, 2).join(' '))
  const argv = existsSync(h.argvLog) ? readFileSync(h.argvLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  const last = argv[argv.length - 1] || []
  check('场景2 --from 指定的安装源被采用',
    last.includes('add') && realpathSync(last[last.length - 1]) === realpathSync(installed),
    last.join(' '))
  const profile = JSON.parse(readFileSync(join(h.root, 'profiles', 'web', 'package.json'), 'utf8'))
  check('场景2 迁移结果与场景1 一致（旧两支摘除、本包进 bundles）',
    !profile.dsh.profile.bundles.includes('dsh-agent-team-studio')
    && !profile.dsh.profile.bundles.includes('dsh-skill-manager')
    && profile.dsh.profile.bundles.includes('dsh-team-workbench'))
  const patch = readFileSync(join(h.root, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
  check('场景2 手动挂载行已改 disabled: true', /id: agent-team-studio\n\s*disabled: true/.test(patch) && /id: skill-manager\n\s*disabled: true/.test(patch))
  rmSync(emptyCwd, { recursive: true, force: true })
  rmSync(h.root, { recursive: true, force: true })
  rmSync(installed, { recursive: true, force: true })
}

// —— 场景 2b：不带 --from，脚本自身就在「无 .tgz 的包目录」里 → 应回退到包目录 ——
{
  const h = makeHarness()
  const installed = mkdtempSync(join(tmpdir(), 'tw-installed2-'))
  mkdirSync(join(installed, 'scripts'), { recursive: true })
  writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'dsh-team-workbench', version: '1.0.0' }, null, 2))
  // 把真的 migrate 脚本复制进去，模拟「已安装的包」里跑迁移
  writeFileSync(join(installed, 'scripts', 'migrate-profile.mjs'), readFileSync(migrate, 'utf8'))
  const emptyCwd = mkdtempSync(join(tmpdir(), 'tw-cwd2-'))
  const r = spawnSync(process.execPath, [join(installed, 'scripts', 'migrate-profile.mjs')], {
    cwd: emptyCwd,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: h.root, FAKE_ARGV_LOG: h.argvLog, FAKE_CLI: h.fakeCli, DSH_BIN: h.fakeCli }
  })
  check('场景2b（已安装包目录，无 .tgz，不带 --from）不抛错', r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').split('\n').slice(0, 2).join(' '))
  const argv = existsSync(h.argvLog) ? readFileSync(h.argvLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  const last = argv[argv.length - 1] || []
  // macOS 上 /var 会解析成 /private/var，比较前统一 realpath
  check('场景2b 安装源确实回退到包目录本身',
    last.includes('add') && realpathSync(last[last.length - 1]) === realpathSync(installed),
    last.join(' '))
  rmSync(emptyCwd, { recursive: true, force: true })
  rmSync(h.root, { recursive: true, force: true })
  rmSync(installed, { recursive: true, force: true })
}

// —— 场景 3：dry-run 不执行安装、不改文件 ——
{
  const h = makeHarness()
  const before = readFileSync(join(h.root, 'profiles', 'web', 'package.json'), 'utf8')
  const r = run(pkgRoot, { DSH_HOME: h.root, FAKE_ARGV_LOG: h.argvLog, FAKE_CLI: h.fakeCli }, ['--dry-run'])
  check('场景3 dry-run 成功', r.status === 0, 'exit=' + r.status)
  check('场景3 dry-run 未调用 CLI', !existsSync(h.argvLog))
  check('场景3 dry-run 未改动 profile', readFileSync(join(h.root, 'profiles', 'web', 'package.json'), 'utf8') === before)
  check('场景3 dry-run 未创建备份目录', !readdirSync(h.root).some((n) => n.startsWith('backup-workbench-')))
  rmSync(h.root, { recursive: true, force: true })
}

// —— 场景 4：非默认 profile（DSH_PROFILE=headless，harness 只有 profiles/headless）——
// 早期版本第 45 行硬编码检查 profiles/web，这里会误报「找不到 web profile」并退出。
{
  const h = makeHarness('headless')
  const r = run(pkgRoot, {
    DSH_HOME: h.root,
    DSH_PROFILE: 'headless',
    FAKE_ARGV_LOG: h.argvLog,
    FAKE_CLI: h.fakeCli
  }, ['--dry-run'])
  check('场景4 DSH_PROFILE=headless 不再误报缺 web profile', r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').split('\n')[0])
  check('场景4 dry-run 未改动 headless profile',
    !existsSync(h.argvLog),
    'argv.log 不应存在')

  // 再真跑一次（非 dry-run），确认安装分支也走通
  const r2 = run(pkgRoot, {
    DSH_HOME: h.root,
    DSH_PROFILE: 'headless',
    FAKE_ARGV_LOG: h.argvLog,
    FAKE_CLI: h.fakeCli
  }, [])
  check('场景4 headless profile 非 dry-run 走通', r2.status === 0, 'exit=' + r2.status + ' ' + (r2.stderr || '').split('\n')[0])
  const profile = JSON.parse(readFileSync(join(h.root, 'profiles', 'headless', 'package.json'), 'utf8'))
  check('场景4 改动落在 headless profile（旧两支摘除、本包进 bundles）',
    !profile.dsh.profile.bundles.includes('dsh-agent-team-studio')
    && !profile.dsh.profile.bundles.includes('dsh-skill-manager')
    && profile.dsh.profile.bundles.includes('dsh-team-workbench'),
    profile.dsh.profile.bundles.join(','))
  check('场景4 未创建 profiles/web', !existsSync(join(h.root, 'profiles', 'web')))
  rmSync(h.root, { recursive: true, force: true })
}

console.log()
if (failures.length > 0) {
  console.error('迁移端到端回归失败 ' + failures.length + ' 项：')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('迁移端到端回归全部通过（源码目录含 .tgz / --from 指定 / 无 .tgz 隐式回退 / dry-run / 非默认 profile 五种情况）')
