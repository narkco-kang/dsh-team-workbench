#!/usr/bin/env node
/**
 * build-client.mjs — 生成 lib/client.js（工作台客户端单文件）
 *
 * 为什么用脚本而不是手写：两个业务面板（智能体团队、共享技能库）的代码是
 * 已经在本机跑通、且被回归测试覆盖过的。手抄一遍必然漂移。这里从两个既有
 * 客户端 bundle 里**按行区间抽取**，只做必要的定点替换，再拼上新的工作台外壳，
 * 因此面板逻辑与旧插件逐字一致。
 *
 * 运行：node scripts/build-client.mjs
 *
 * 抽取区间（改旧插件后要重新核对，脚本会断言边界，漂移会直接报错）：
 *   dsh-agent-team-studio/lib/client.js
 *     1-11    文件头 + 模块加载器声明（含 React require）
 *     12-12   factory 开头（module/exports）
 *     67-129  CSS（去掉变量声明行，整段搬过来）
 *     133-700 AgentTeamPanel 及其全部子组件、常量
 *     704-742 resolveSessionId（面板需要它，与旧插件同一实现）
 *   dsh-skill-manager/lib/client.js
 *     33-223  颜色常量、box/btn/input 样式、Field/Editor/Detail/SkillManager
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const ATS = join(root, '..', 'dsh-agent-team-studio', 'lib', 'client.js')
const SM = join(root, '..', 'dsh-skill-manager', 'lib', 'client.js')
const OUT = join(root, 'lib', 'client.js')

// 前置条件：本脚本是**源码工作区工具**，要读两个兄弟包的面板源码。
// 单纯从 tarball 装出来的包里没有这两个兄弟目录，所以这里先给出明确报错，
// 而不是让 readFileSync 抛一句没有上下文的 ENOENT。
// （发布包里已经带 https:// 生成好的 lib/client.js，普通使用者不需要跑本脚本。）
for (const [label, path] of [['dsh-agent-team-studio', ATS], ['dsh-skill-manager', SM]]) {
  if (existsSync(path)) continue
  console.error('缺少源文件：' + path)
  console.error('本脚本需要与 ' + label + ' 并列放在同一个工作区里（读它的客户端源码做抽取）。')
  console.error('只安装了发布包时不需要运行本脚本：lib/client.js 已经随包提供。')
  process.exit(1)
}

const ats = readFileSync(ATS, 'utf8').split('\n')
const sm = readFileSync(SM, 'utf8').split('\n')

/** 取闭区间 [a,b]（1 基，含两端）。 */
function slice(lines, a, b, label) {
  const out = lines.slice(a - 1, b)
  if (out.some((l) => l === undefined)) throw new Error(`${label}: 区间 ${a}-${b} 超出文件范围`)
  return out.join('\n')
}
/** 断言某行的特征，防止上游改动后静默抽错。 */
function assertLine(lines, n, needle, label) {
  const line = lines[n - 1]
  if (line === undefined || line.indexOf(needle) === -1) {
    throw new Error(`${label}: 第 ${n} 行不再包含 ${JSON.stringify(needle)}，实际：${JSON.stringify(line)}`)
  }
}

// —— 边界断言 ——
// 行号以 awk/sed 为准（编辑器显示的编号可能与文件实际编号不一致，曾因此抽错区间）。
assertLine(ats, 11, 'window.__ModuleLoader__.load', 'ATS')
assertLine(ats, 12, 'id: "dsh-agent-team-studio"', 'ATS')
assertLine(ats, 13, 'factory: (require) => {', 'ATS')
assertLine(ats, 34, 'var PALETTE = [', 'ATS')
assertLine(ats, 65, 'var CSS = [', 'ATS')
assertLine(ats, 129, '].join("\\n");', 'ATS')
assertLine(ats, 133, 'function unwrap(res)', 'ATS')
assertLine(ats, 161, '//#region 小组件', 'ATS')
assertLine(ats, 483, 'function AgentTeamPanel(props)', 'ATS')
assertLine(ats, 700, '}', 'ATS')
assertLine(ats, 703, '//#region 回退面板（better-sidebar 不可用时）', 'ATS')
assertLine(ats, 707, 'function resolveSessionId(scope)', 'ATS')
assertLine(ats, 717, '}', 'ATS')
assertLine(sm, 33, 'var C = {', 'SM')
assertLine(sm, 114, 'function SkillManager()', 'SM')
assertLine(sm, 223, '}', 'SM')

const atsHeader = slice(ats, 1, 11, 'ATS header')
const atsFactoryOpen = slice(ats, 12, 15, 'ATS factory open')
// 132 起是 //#region 宿主通信：连区域标记一起取，避免常量段与组件段之间的
// //#endregion / //#region 配对被打断（曾因此生成出语法错误的文件）。
const atsCore = slice(ats, 23, 700, 'ATS 常量 + 样式 + 组件')
const atsSession = slice(ats, 706, 717, 'ATS session')
const smCore = slice(sm, 33, 223, 'SM core')

/** 定点替换：必须命中且只命中一次。 */
function replaceOnce(text, from, to, label) {
  const parts = text.split(from)
  if (parts.length !== 2) throw new Error(`${label}: 期望命中 1 次，实际 ${parts.length - 1} 次`)
  return parts[0] + to + parts[1]
}

// 旧客户端把浅色主题变量注入在 #dsh-manager-dock 上（浮动管理台的容器）。
// 那套容器已经不存在了，改由工作台外壳的 .tw-root 承担（见下方 TW_CSS）。
// 同时剔掉只服务于浮动载体的三条样式（.ats-float-*），它们在新包里是死代码。
// 33-700 是一个连续区间（常量 / 主题工具 / CSS / 宿主通信 / 小组件 / 成员卡片 / 主面板），
// 一起抽取可以避开区域标记配对被切断的问题；其中三条只服务于浮动载体的样式要剔掉。
const FLOAT_CSS_LINES = ['.ats-float-panel{', '.ats-float-fab{', '.ats-float-fab:hover{']
const ROUTE_REWRITES = [
  ['var ROUTE_STATE = "/api/agent-team-studio/state";', 'var ROUTE_STATE = "/api/team-workbench/state";'],
  ['var ROUTE_MEMBERS = "/api/agent-team-studio/members";', 'var ROUTE_MEMBERS = "/api/team-workbench/members";'],
  ['var ROUTE_PROBE = "/api/agent-team-studio/probe";', 'var ROUTE_PROBE = "/api/team-workbench/probe";'],
  ['var ROUTE_DISPATCH = "/api/agent-team-studio/dispatch";', 'var ROUTE_DISPATCH = "/api/team-workbench/dispatch";'],
  ['var STYLE_ID = "dsh-agent-team-studio-css";', 'var STYLE_ID = "dsh-team-workbench-css";'],
  // 页脚显示的包名：抽过来的面板代码里硬编码了旧包名，会在界面上显示成另一个包。
  ['"dsh-agent-team-studio" + (snap.pluginVersion', '"dsh-team-workbench" + (snap.pluginVersion'],
  // 旧插件用 TAB_ID 去注册侧边栏页面；工作台不注册侧边栏页面，这个常量已无人使用。
  ['    var TAB_ID = "agent-team-studio:roster";\n', '']
]

let components = replaceOnce(
  atsCore
    .split('\n')
    .filter((line) => !FLOAT_CSS_LINES.some((needle) => line.includes(needle)))
    .join('\n'),
  'var sessionId = typeof scope.sessionId === "string" ? scope.sessionId : "";',
  'var sessionId = resolveSessionId(scope);',
  'AgentTeamPanel 取会话 id'
)
for (const [from, to] of ROUTE_REWRITES) {
  components = replaceOnce(components, from, to, '路由前缀重写 ' + from)
}

// 两块面板原本是两个独立 bundle，各自有同名的 Field / Editor / Detail 顶层函数。
// 合并进同一个 factory 作用域后，后声明的会覆盖先声明的——团队面板的编辑表单会
// 变成技能库的字段组件（props 不匹配，输入框直接坏掉）。所以这里给技能库那套
// 统一加前缀；这些名字只出现在本片段内（已核对），加前缀不会漏改。
const SM_RENAME = [['Field', 'SkillField'], ['Editor', 'SkillEditor'], ['Detail', 'SkillDetail']]
let skills = smCore
for (const [from, to] of SM_RENAME) {
  const before = skills
  skills = skills.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
  if (skills === before) throw new Error(`技能库重命名 ${from} -> ${to} 没有命中任何位置`)
}

// 头部注释：原文件描述的是 better-sidebar 侧边栏页面 + 浮动回退，两条载体都不再使用。
const header = atsHeader
  .split('\n')
  .filter((line) => !/better-sidebar|registerTab|浮动回退面板/.test(line))
  .join('\n')
  .replace(
    ' * dsh-agent-team-studio — 侧边栏管理界面（客户端 bundle）',
    ' * dsh-team-workbench — 工作台客户端（单文件 bundle，由 scripts/build-client.mjs 生成）\n'
    + ' *\n'
    + ' * 不要直接手改本文件：两个业务面板的代码从 dsh-agent-team-studio 与\n'
    + ' * dsh-skill-manager 的客户端 bundle 按行区间抽取。改那两处之后重新运行\n'
    + ' * `node scripts/build-client.mjs`，并用 `node scripts/smoke-client.mjs` 自测。'
  )
  .replace(' * 数据经同源路由 /api/agent-team-studio/* 读写在宿主端的团队配置。',
           ' * 数据经同源路由 /api/team-workbench/* 读写在宿主端的工作台配置。')

const shell = `
    //#region 工作台外壳（DSH Desktop 原生工作台）
    /**
     * 一个工作台 = 一个业务面板。两块业务（智能体团队 / 共享技能库）在面板内
     * 用顶部标签切换，共享宿主分配的右侧业务区；**不再有浮动窗口、胶囊或任何
     * 常驻 DOM**——进出工作台完全由宿主的模式切换器与工作台管理负责，
     * 因此不存在「关不掉、收不回」的残留。
     *
     * 数据经同源路由 /api/team-workbench/* 读写（见服务端 dsh/）。
     */
    var TW_STORAGE_KEY = "dsh.teamWorkbench.view.v1";
    /** 工作台外壳样式：填满宿主分配的业务区，内部滚动，不越界、不遮挡宿主入口。 */
    var TW_CSS = [
      // 面板里大量样式用 var(--dsh-*)，这里在业务区内重定义成浅色值，
      // 与管理台原来的做法一致：只影响本面板，不动宿主其它区域。
      ".tw-root{--dsh-surface:#ffffff;--dsh-text-primary:#111111;--dsh-text-secondary:#555b63;--dsh-border:#dcdfe4;--dsh-accent:#2563eb;--dsh-input-bg:#ffffff;display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;background:#ffffff;color:#111111;}",
      ".tw-head{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #dcdfe4;flex:0 0 auto;flex-wrap:wrap;background:#f5f6f8;}",
      ".tw-tabs{display:flex;gap:4px;flex:1 1 auto;min-width:0;overflow:auto;}",
      ".tw-tab{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid #dcdfe4;background:#eef0f3;color:#111111;cursor:pointer;white-space:nowrap;}",
      ".tw-tab-on{background:#2563eb;border-color:#2563eb;color:#ffffff;font-weight:600;}",
      ".tw-session{font-size:11px;color:#666b73;white-space:nowrap;}",
      ".tw-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;}",
      ".tw-body>*{flex:1 1 auto;min-height:0;}"
    ].join("\\n");

    function readTab() {
      try {
        var raw = window.localStorage.getItem(TW_STORAGE_KEY);
        if (raw === "team" || raw === "skills") return raw;
      } catch (e) { /* 隐私模式降级为默认标签 */ }
      return "team";
    }
    function writeTab(id) {
      try { window.localStorage.setItem(TW_STORAGE_KEY, id); } catch (e) { /* 同上 */ }
    }

    function WorkbenchPanel(props) {
      var tabState = useState(readTab);
      var tab = tabState[0];
      var setTab = tabState[1];
      var sessionId = resolveSessionId(props && props.scope);
      var scope = { sessionId: sessionId };

      function pick(id) {
        setTab(function (prev) { return prev === id ? prev : (writeTab(id), id); });
      }
      function tabBtn(id, text) {
        var on = tab === id;
        return h("button", {
          key: id,
          type: "button",
          className: "tw-tab" + (on ? " tw-tab-on" : ""),
          "aria-pressed": on ? "true" : "false",
          onClick: function () { pick(id); }
        }, text);
      }

      return h("div", { className: "tw-root" },
        h("header", { className: "tw-head" },
          h("div", { className: "tw-tabs", role: "tablist" },
            tabBtn("team", "智能体团队"),
            tabBtn("skills", "共享技能库")
          ),
          sessionId ? h("span", { className: "tw-session" }, "会话 " + sessionId.slice(0, 14)) : null
        ),
        h("div", { className: "tw-body" },
          // 只挂载当前标签：切走后另一块整体卸载，不保留后台定时器/请求。
          tab === "team"
            ? h(AgentTeamPanel, { scope: scope })
            : h(SkillManager)
        )
      );
    }
    //#endregion

    //#region 注册（DSH Desktop 原生工作台）
    function serviceOf(ctx, name) {
      try { if (ctx && typeof ctx.get === "function") return ctx.get(name); } catch (e) { /* 服务缺失不是错误 */ }
      try { if (ctx && ctx[name] !== undefined) return ctx[name]; } catch (e) { /* 同上 */ }
      return undefined;
    }

    function apply(ctx) {
      ctx.effect(function () {
        if (typeof document === "undefined") return;
        if (document.getElementById(STYLE_ID) !== null) return;
        var tag = document.createElement("style");
        tag.id = STYLE_ID;
        tag.dataset.plugin = "team-workbench";
        tag.textContent = CSS + "\\n" + TW_CSS;
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }, "team-workbench: panel css");

      // 宿主工作台服务由 dsh-desktop-workbenches 提供（package.json 的
      // dsh.client.inject 保证它先加载）。拿不到就什么都不挂，而不是退回浮动窗口：
      // 浮动载体正是「无法回收」的来源，本包不再保留这条路径。
      ctx.effect(function () {
        var service = serviceOf(ctx, "desktopWorkbenches");
        if (service === undefined || service === null || typeof service.register !== "function") {
          console.warn("[team-workbench] 未拿到 desktopWorkbenches 服务，工作台未注册（需要 DSH Desktop 的工作台能力）");
          return;
        }
        return service.register({
          title: "智能体团队 · 技能管理",
          panelTitle: "智能体团队 · 技能管理",
          repository: "https://github.com/narkco-kang/dsh-team-workbench",
          description: "管理一支具名智能体团队（每个成员一组模型路由，按路由回退派发），以及本机共享技能库（增删改查与派发状态）。",
          layout: { businessSide: "right", businessWidth: 0.36 }
        }, WorkbenchPanel);
      }, "team-workbench: register");
    }
    //#endregion

    exports.apply = apply;
    exports.inject = [];
    exports.name = "dsh-team-workbench";
    return module.exports;
  }
});
`

const merged = [
  header,
  atsFactoryOpen.replace('id: "dsh-agent-team-studio"', 'id: "dsh-team-workbench"'),
  '',
  '    var React = require("react");',
  '    var h = React.createElement;',
  '    var useState = React.useState;',
  '    var useEffect = React.useEffect;',
  '    var useCallback = React.useCallback;',
  '',

  '    //#region 会话 id',
  atsSession,
  '    //#endregion',
  '',
  components,
  '',
  '    //#region 共享技能库面板',
  '    /** 技能库路由前缀（服务端 dsh/skills.js）。 */',
  '    var BASE = "/api/team-workbench/skills";',
  '    function api(path, body) {',
  '      var init = body === undefined',
  '        ? { method: "GET" }',
  '        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };',
  '      return fetch(BASE + path, init).then(function (r) {',
  '        return r.json().then(function (j) { return { status: r.status, json: j }; });',
  '      });',
  '    }',
  skills,
  '    //#endregion',
  shell
].join('\n')

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, merged, 'utf8')
console.log('written', OUT, merged.length, 'bytes,', merged.split('\n').length, 'lines')
