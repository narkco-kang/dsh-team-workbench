import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const root = '/Users/wenkangzhong/untitled folder/dsh-team-workbench'
const p = (name) => root + '/src/client/parts/' + name
let src = readFileSync(root + '/lib/client.js', 'utf8')
const part = (name) => readFileSync(p(name), 'utf8')

function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker)
  if (start < 0) throw new Error('missing start: ' + label)
  const end = text.indexOf(endMarker, start)
  if (end < 0) throw new Error('missing end: ' + label)
  return text.slice(0, start) + replacement + text.slice(end)
}

// 1. routes
src = src.replace(
  '    var ROUTE_DISPATCH = "/api/team-workbench/dispatch";',
  '    var ROUTE_DISPATCH = "/api/team-workbench/dispatch";\n' +
  '    var ROLES_ROUTE = "/api/team-workbench/roles";\n' +
  '    var ROLE_BODY_ROUTE = "/api/team-workbench/roles/body";\n' +
  '    var PRESET_ROUTE = "/api/team-workbench/preset";\n' +
  '    var AVATAR_ROUTE = "/api/team-workbench/avatar";'
)

// 2. emoji choices
const oldEmoji = '    var EMOJI_CHOICES = ["🤖", "🧭", "🔍", "🧪", "🛠️", "📊", "✍️", "🎨", "🛡️", "🧠", "📚", "⚙️"];'
if (!src.includes(oldEmoji)) throw new Error('emoji constant not found')
const emojis = ['🤖','🧭','🔍','🧪','🛠️','📊','✍️','🎨','🛡️','🧠','📚','⚙️','👔','📦','🏛️','🏗️','💻','🔗','🚀','💬','📈','🐑','🎭','🧑‍💼','🧑‍🎨','🧑‍💻','🧑‍🔬','🧑‍🏫','🧑‍⚖️','🕵️','🧲','🔬','🎯','🧩','🛰️','🗂️','💡','🧱','📐','🎬']
src = src.replace(oldEmoji, '    var EMOJI_CHOICES = ' + JSON.stringify(emojis).replace(/","/g, '", "') + ';')

// 3. comms
src = replaceBetween(src, '    //#region 小组件', '    //#region 小组件', part('comms.js') + '    //#region 小组件', 'comms')

// 4. css
src = replaceBetween(src, '    //#region 宿主通信', '    //#region 宿主通信', part('css.js') + '    //#region 宿主通信', 'css')

// 5. membercard
src = replaceBetween(src, '    function MemberCard(props) {', '    //#region 主面板', part('avatar.js') + '\n' + part('membercard.js') + '\n', 'membercard')

// 6. team + roles
src = replaceBetween(src, '    //#region 主面板', '    //#region 共享技能库面板', part('team.js') + '\n', 'team')

// 7. shell
src = replaceBetween(src, '    function readTab() {', '    //#region 注册（DSH Desktop 原生工作台）', part('shell.js') + '\n', 'shell')

// 8. apply tweaks
src = src.replace('tag.textContent = CSS + "\\n" + TW_CSS;', 'tag.textContent = CSS + "\\n" + TW_CSS + "\\n" + PANEL_CSS;')
src = src.replace(
  '          title: "智能体团队 · 技能管理",\n          panelTitle: "智能体团队 · 技能管理",',
  '          title: "智能体团队 · 技能管理工作台",\n          panelTitle: "智能体团队",'
)
src = src.replace(
  'description: "管理一支具名智能体团队（每个成员一组模型路由，按路由回退派发），以及本机共享技能库（增删改查与派发状态）。",',
  'description: "一支可分组、可换头像与表情的具名智能体团队：内置 313 个角色可按需加入，默认项目部角色配置；每人一组模型路由按序回退派发，并管理本机共享技能库。",'
)
src = src.replace('layout: { businessSide: "right", businessWidth: 0.36 }', 'layout: { businessSide: "right", businessWidth: 0.52 }')

writeFileSync(root + '/lib/client.js', src)
copyFileSync(root + '/lib/client.js', root + '/src/client/panel.js')
console.log('spliced, bytes', src.length)
