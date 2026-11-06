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

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>team workbench preview</title>
<style>html,body{margin:0;height:100%;background:#0f1115;color:#e5e7eb;font-family:-apple-system,"PingFang SC",system-ui,sans-serif;} #root{height:100%;} .preview-shell{height:100vh;display:flex;flex-direction:column;background:#0f1115;}</style>
<script src="./react.js"></script>
<script src="./react-dom.js"></script>
</head><body>
<div id="root"></div>
<script>
window.__DSH_PREVIEW__ = { state: ${JSON.stringify(state)}, roles: ${JSON.stringify(rolesPayload)} };
window.__ModuleLoader__ = { load: function (def) { window.__wbDef = def; } };
window.fetch = function (url, init) {
  var u = String(url);
  var data = null;
  if (u.indexOf('/api/team-workbench/state') === 0) data = window.__DSH_PREVIEW__.state;
  else if (u.indexOf('/api/team-workbench/roles/body') === 0) data = { ok: true, id: 'x', body: window.__DSH_PREVIEW__.roles.roles[0].description + '\\n\\n' + '（角色正文预览）' };
  else if (u.indexOf('/api/team-workbench/roles') === 0) data = window.__DSH_PREVIEW__.roles;
  else if (u.indexOf('/api/team-workbench/skills') === 0) data = { ok: true, skills: [], deployed: [] };
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
