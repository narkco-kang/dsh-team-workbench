import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const root = '/Users/wenkangzhong/untitled folder/dsh-team-workbench'
const out = root + '/.preview'
mkdirSync(out, { recursive: true })

const team = JSON.parse(readFileSync('/Users/wenkangzhong/Library/Application Support/dsh-desktop/harness/agent-team-studio/team.json', 'utf8'))
const index = JSON.parse(readFileSync(root + '/data/roles.index.json', 'utf8'))
const preset = JSON.parse(readFileSync(root + '/presets/project-department.json', 'utf8'))

// 给现有成员按职责粗分到预设分组，便于看分组视图
const groups = preset.groups.map((g, i) => ({ id: g.id, name: g.name, color: g.color, order: i, collapsed: false }))
const pick = (name) => {
  if (/项目|产品|架构/.test(name)) return 'g-lead'
  if (/设计|UX|UI/.test(name)) return 'g-design'
  if (/工程|开发|数据/.test(name)) return 'g-dev'
  if (/审核|复核|测试/.test(name)) return 'g-deliver'
  if (/采集|调查|研究|分析|决策/.test(name)) return 'g-ops'
  return ''
}
const members = team.members.map((m) => Object.assign({}, m, { groupId: pick(m.name), avatar: { kind: 'emoji', imageId: '' }, roleRef: { library: '', id: '', version: '' } }))

const state = {
  ok: true,
  pluginVersion: '1.2.0',
  version: 3,
  members,
  groups,
  preset: '',
  presets: [{ id: 'project-department', name: '项目部', description: '', groups: 6, members: 15 }],
  roleLibrary: { version: '1.0.0', upstream: index.upstream, total: index.roles.length, categories: index.categories },
  catalog: [
    { id: 'deepseek-official', displayName: 'DeepSeek', models: [{ id: 'deepseek-v4-pro', name: 'V4 Pro' }, { id: 'deepseek-flash', name: 'Flash' }] },
    { id: 'gpt', displayName: 'GPT', models: [{ id: 'gpt-6-sol', name: '6 Sol' }] }
  ],
  catalogError: '',
  defaults: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: '' },
  effortOptions: ['minimal', 'low', 'medium', 'high', 'max'],
  limits: { maxMembers: 64, maxRoutes: 8, maxGroups: 24 },
  storePath: '/Users/wenkangzhong/Library/Application Support/dsh-desktop/harness/agent-team-studio/team.json'
}

const rolesPayload = {
  ok: true,
  total: index.roles.length,
  offset: 0,
  limit: 60,
  version: index.version,
  upstream: index.upstream,
  categories: index.categories,
  roles: index.roles.slice(0, 60)
}

const now = new Date('2026-11-07T00:30:00+08:00').toISOString()
const chatsPayload = {
  ok: true,
  private: members.map((m, i) => ({ memberId: m.id, name: m.name, emoji: m.emoji, color: m.color, count: i < 2 ? 2 : 0, lastText: i === 0 ? '这个需求的验收标准我来拆一下' : '', updatedAt: now })),
  rooms: [{ id: 'room-demo', name: '项目例会', adminId: members[0].id, adminName: members[0].name, memberIds: [members[0].id, members[2].id, members[3].id], count: 3, lastText: '工程侧两天可以完成', updatedAt: now }]
}
const messagesPayload = {
  private: [
    { id: 'm1', role: 'user', memberId: '', name: '用户', emoji: '🧑', text: '这个需求下周能上线吗？' },
    { id: 'm2', role: 'agent', memberId: members[0].id, name: members[0].name, emoji: members[0].emoji, text: '按现在的范围，周三可以出第一版；风险是接口联调，需要后端先冻结字段。' }
  ],
  group: [
    { id: 'g1', role: 'user', memberId: '', name: '用户', emoji: '🧑', text: '这个需求两天能做吗？' },
    { id: 'g2', role: 'agent', memberId: members[0].id, name: members[0].name, emoji: members[0].emoji, text: '我来安排：@' + members[2].name + ' 你评估一下工程侧。' },
    { id: 'g3', role: 'agent', memberId: members[2].id, name: members[2].name, emoji: members[2].emoji, text: '工程结论：两天可以，先做只读版本，写操作放第二期。' }
  ]
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>team workbench preview</title>
<style>html,body{margin:0;height:100%;background:#0f1115;color:#e5e7eb;font-family:-apple-system,"PingFang SC",system-ui,sans-serif;} #root{height:100%;} .preview-shell{height:100vh;display:flex;flex-direction:column;background:#0f1115;}</style>
<script src="./react.js"></script>
<script src="./react-dom.js"></script>
</head><body>
<div id="root"></div>
<script>
window.__DSH_PREVIEW__ = { state: ${JSON.stringify(state)}, roles: ${JSON.stringify(rolesPayload)}, chats: ${JSON.stringify(chatsPayload)}, messages: ${JSON.stringify(messagesPayload)} };
window.__ModuleLoader__ = { load: function (def) { window.__wbDef = def; } };
window.fetch = function (url, init) {
  var u = String(url);
  var data = null;
  if (u.indexOf('/api/team-workbench/state') === 0) data = window.__DSH_PREVIEW__.state;
  else if (u.indexOf('/api/team-workbench/roles/body') === 0) data = { ok: true, id: 'x', body: window.__DSH_PREVIEW__.roles.roles[0].description + '\\n\\n' + '（角色正文预览）' };
  else if (u.indexOf('/api/team-workbench/roles') === 0) data = window.__DSH_PREVIEW__.roles;
  else if (u.indexOf('/api/team-workbench/skills') === 0) data = { ok: true, skills: [], deployed: [] };
  else if (u.indexOf('/api/team-workbench/chats/private') === 0) data = { ok: true, member: null, messages: window.__DSH_PREVIEW__.messages.private };
  else if (u.indexOf('/api/team-workbench/chats/group') === 0) data = { ok: true, room: window.__DSH_PREVIEW__.chats.rooms[0], messages: window.__DSH_PREVIEW__.messages.group };
  else if (u.indexOf('/api/team-workbench/chats') === 0) data = window.__DSH_PREVIEW__.chats;
  else data = window.__DSH_PREVIEW__.state;
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } });
};
</script>
<script src="./panel.js"></script>
<script>
(function () {
  var React = window.React;
  var require = function (name) { return name === 'react' ? window.React : (name === 'react-dom' ? window.ReactDOM : {}); };
  var mod = window.__wbDef.factory(require);
  var registered = null;
  var ctx = {
    effect: function (fn) { try { fn(); } catch (e) { console.error(e); } },
    get: function (name) { if (name === 'desktopWorkbenches') return { register: function (descriptor, Component) { registered = Component; return function () {}; } }; return undefined; },
    logger: { info: function () {} }
  };
  mod.apply(ctx);
  if (!registered) { document.body.innerHTML = '<pre>未注册</pre>'; return; }
  var root = window.ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement('div', { className: 'preview-shell' }, React.createElement(registered, {})));
})();
</script>
</body></html>`
writeFileSync(out + '/preview.html', html)
writeFileSync(out + '/panel.js', readFileSync(root + '/lib/client.js', 'utf8'))
console.log('fixture written', out)
