/**
 * dsh-team-workbench — 工作台客户端（单文件 bundle，由 scripts/build-client.mjs 生成）
 *
 * 不要直接手改本文件：两个业务面板的代码从 dsh-agent-team-studio 与
 * dsh-skill-manager 的客户端 bundle 按行区间抽取。改那两处之后重新运行
 * `node scripts/build-client.mjs`，并用 `node scripts/smoke-client.mjs` 自测。
 *
 *   · 智能体增删改查：搜索、新建、批量新建、设定数量、编辑、复制、删除、批量删除。
 *   · 模型增删改查：每个智能体持有一组模型路由，可新增、编辑、删除、启用停用、
 *     设为当前、上下移动。
 *   · 试跑（在该成员当前路由上执行）与测试连接（校验单条路由）。
 * 数据经同源路由 /api/team-workbench/* 读写在宿主端的工作台配置。
 */
window.__ModuleLoader__.load({
  id: "dsh-team-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useCallback = React.useCallback;

    //#region 会话 id
    /** 解析当前会话 id：优先外部传入，其次客户端本地存储（试跑需要它）。 */
    function resolveSessionId(scope) {
      if (scope && typeof scope.sessionId === "string" && scope.sessionId.length > 0) return scope.sessionId;
      try {
        var raw = window.localStorage.getItem("dsh.sessions.current");
        if (typeof raw === "string" && raw.length > 0) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed.sessionId === "string") return parsed.sessionId;
        }
      } catch (e) { /* 隐私模式或键缺失时降级：只影响试跑，不影响管理 */ }
      return "";
    }
    //#endregion

    //#region 常量
    var ROUTE_STATE = "/api/team-workbench/state";
    var ROUTE_MEMBERS = "/api/team-workbench/members";
    var ROUTE_PROBE = "/api/team-workbench/probe";
    var ROUTE_DISPATCH = "/api/team-workbench/dispatch";
    var ROLES_ROUTE = "/api/team-workbench/roles";
    var ROLE_BODY_ROUTE = "/api/team-workbench/roles/body";
    var PRESET_ROUTE = "/api/team-workbench/preset";
    var AVATAR_ROUTE = "/api/team-workbench/avatar";
    var STYLE_ID = "dsh-team-workbench-css";
    var EMPTY_DEFAULTS = { provider: "", model: "", reasoningEffort: "" };
    var EMOJI_CHOICES = ["🤖", "🧭", "🔍", "🧪", "🛠️", "📊", "✍️", "🎨", "🛡️", "🧠", "📚", "⚙️", "👔", "📦", "🏛️", "🏗️", "💻", "🔗", "🚀", "💬", "📈", "🐑", "🎭", "🧑‍💼", "🧑‍🎨", "🧑‍💻", "🧑‍🔬", "🧑‍🏫", "🧑‍⚖️", "🕵️", "🧲", "🔬", "🎯", "🧩", "🛰️", "🗂️", "💡", "🧱", "📐", "🎬"];

    // 卡片配色板：给没有自定义颜色的成员自动分配，保证同一成员每次颜色一致。
    var PALETTE = [
      "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04",
      "#16a34a", "#0891b2", "#4f46e5", "#0d9488", "#9333ea", "#b45309"
    ];

    function isHexColor(value) {
      return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
    }

    /** 角色库 frontmatter 的命名色 → hex（与宿主端 dsh/library.js 保持一致）。 */
    var NAMED_COLORS = {
      blue: "#2563eb", indigo: "#4f46e5", violet: "#7c3aed", purple: "#9333ea", fuchsia: "#c026d3",
      pink: "#db2777", rose: "#e11d48", red: "#dc2626", orange: "#ea580c", amber: "#d97706",
      yellow: "#ca8a04", lime: "#65a30d", green: "#16a34a", emerald: "#059669", teal: "#0d9488",
      cyan: "#0891b2", sky: "#0284c7", slate: "#475569", gray: "#6b7280", grey: "#6b7280",
      stone: "#78716c", zinc: "#71717a", neutral: "#737373"
    };
    function colorOfName(value) {
      var raw = String(value || "").trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
      return NAMED_COLORS[raw] || "";
    }

    /**
     * 取成员配色。
     *
     * 优先用自定义颜色；没设时**按成员在完整列表中的位置**取色板，而不是按 id 散列。
     * 原因：散列再好也会撞色——实测 9 个成员散列后仍有 3 人同色。
     * 按位置分配能保证色板长度（12）以内两两不同，视觉上"每个卡片颜色不同"才成立。
     * 位置取的是成员在完整 team.json 里的下标，所以搜索/筛选不会让颜色跳变。
     */
    function colorOf(member, colorIndex) {
      if (member !== null && member !== undefined && isHexColor(member.color)) return member.color.trim().toLowerCase();
      var i = typeof colorIndex === "number" && colorIndex >= 0 ? colorIndex : 0;
      return PALETTE[i % PALETTE.length];
    }

    /** 把 #rrggbb 变成带透明度的 rgba，用来做卡片底色与徽章底色。 */
    function tint(hex, alpha) {
      var r = parseInt(hex.slice(1, 3), 16);
      var g = parseInt(hex.slice(3, 5), 16);
      var b = parseInt(hex.slice(5, 7), 16);
      return "rgba(" + String(r) + "," + String(g) + "," + String(b) + "," + String(alpha) + ")";
    }

    var CSS = [
      ".ats-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dsh-text-primary,#111111);}",
      ".ats-head{display:flex;align-items:center;gap:6px;padding:9px 10px;border-bottom:1px solid var(--dsh-border,rgba(127,127,127,.22));flex:0 0 auto;flex-wrap:wrap;}",
      ".ats-title{font-weight:600;font-size:13px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ats-sub{padding:5px 10px;font-size:11px;opacity:.62;line-height:1.5;}",
      ".ats-bar{display:flex;align-items:center;gap:5px;padding:6px 10px;border-bottom:1px solid var(--dsh-border,rgba(127,127,127,.16));flex:0 0 auto;flex-wrap:wrap;}",
      ".ats-search{flex:1 1 110px;min-width:80px;}",
      ".ats-num{width:52px;text-align:center;}",
      ".ats-list{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px 28px;display:flex;flex-direction:column;gap:10px;}",
      ".ats-card{border:1px solid rgba(17,17,17,.10);border-left-width:4px;border-left-style:solid;border-radius:12px;padding:11px 13px;margin-bottom:0;box-shadow:0 1px 3px rgba(17,17,17,.06);transition:box-shadow .12s ease;}",
      ".ats-card:hover{box-shadow:0 4px 12px rgba(17,17,17,.11);}",
      ".ats-card.off{opacity:.55;}",
      ".ats-card.sel{border-top-color:#2563eb;border-right-color:#2563eb;border-bottom-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.22);}",
      ".ats-card-head{display:flex;align-items:center;gap:9px;}",
      ".ats-emoji-badge{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;font-size:17px;flex:0 0 auto;}",
      ".ats-color-pick{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
      ".ats-swatch{width:24px;height:24px;border-radius:7px;border:2px solid transparent;cursor:pointer;padding:0;box-shadow:0 1px 2px rgba(17,17,17,.18);}",
      ".ats-swatch.on{border-color:#111111;}",
      ".ats-row{display:flex;align-items:center;gap:7px;}",
      ".ats-emoji{font-size:17px;line-height:1;flex:0 0 auto;}",
      ".ats-name{font-weight:600;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ats-role{font-size:11px;opacity:.66;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ats-bar .ats-field{flex:0 0 auto;min-width:120px;max-width:190px;margin:0;}",
      ".ats-bar .ats-field .ats-label:empty{display:none;}",
      ".ats-spacer{flex:1 1 auto;}",
      ".ats-chip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;padding:1px 5px;border-radius:5px;background:rgba(127,127,127,.16);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".ats-chip.cur{background:rgba(77,107,254,.20);color:inherit;}",
      ".ats-chip.off{opacity:.5;text-decoration:line-through;}",
      ".ats-actions{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap;}",
      ".ats-btn{font:inherit;font-size:11.5px;line-height:1.2;padding:4px 8px;border-radius:6px;border:1px solid var(--dsh-border,rgba(127,127,127,.32));background:transparent;color:inherit;cursor:pointer;white-space:nowrap;}",
      ".ats-btn:hover{background:rgba(127,127,127,.14);}",
      ".ats-btn:disabled{opacity:.45;cursor:default;}",
      ".ats-btn.primary{background:var(--dsh-accent,#2563eb);border-color:transparent;color:#fff;}",
      ".ats-btn.primary:hover{filter:brightness(1.08);}",
      ".ats-btn.danger{color:#dc2626;border-color:rgba(229,72,77,.5);}",
      ".ats-btn.tiny{font-size:10.5px;padding:2px 6px;}",
      ".ats-form{margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsh-border,rgba(127,127,127,.28));display:flex;flex-direction:column;gap:6px;}",
      ".ats-field{display:flex;flex-direction:column;gap:3px;}",
      ".ats-label{font-size:11px;opacity:.7;}",
      ".ats-grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px;}",
      ".ats-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;}",
      ".ats-input,.ats-select,.ats-area{font:inherit;font-size:12px;color:inherit;background:var(--dsh-input-bg,rgba(127,127,127,.10));border:1px solid var(--dsh-border,rgba(127,127,127,.28));border-radius:6px;padding:4px 6px;width:100%;box-sizing:border-box;}",
      ".ats-area{resize:vertical;min-height:52px;line-height:1.45;font-family:inherit;}",
      ".ats-check{display:flex;align-items:center;gap:5px;font-size:12px;}",
      ".ats-emoji-pick{display:flex;flex-wrap:wrap;gap:4px;}",
      ".ats-emoji-opt{font-size:15px;line-height:1;padding:3px 5px;border-radius:5px;border:1px solid transparent;background:rgba(127,127,127,.10);cursor:pointer;}",
      ".ats-emoji-opt.on{border-color:var(--dsh-accent,#2563eb);}",
      ".ats-note{font-size:11px;line-height:1.5;padding:5px 7px;border-radius:6px;background:rgba(127,127,127,.10);}",
      ".ats-note.err{background:rgba(229,72,77,.14);color:#dc2626;}",
      ".ats-note.ok{background:rgba(46,160,67,.16);}",
      ".ats-out{white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:1.5;max-height:200px;overflow:auto;padding:6px 7px;border-radius:6px;background:rgba(127,127,127,.10);margin-top:5px;}",
      ".ats-empty{opacity:.6;font-size:12px;text-align:center;padding:24px 12px;line-height:1.7;}",
      ".ats-foot{flex:0 0 auto;padding:6px 10px;font-size:10.5px;opacity:.5;border-top:1px solid var(--dsh-border,rgba(127,127,127,.16));word-break:break-all;}",
      ".ats-routes{margin-top:7px;border-top:1px solid var(--dsh-border,rgba(127,127,127,.16));padding-top:6px;display:flex;flex-direction:column;gap:4px;}",
      ".ats-route{display:flex;align-items:center;gap:6px;padding:3px 5px;border-radius:6px;background:rgba(127,127,127,.08);}",
      ".ats-route.cur{background:rgba(77,107,254,.14);}",
      ".ats-radio{flex:0 0 auto;cursor:pointer;}",
      ".ats-route-text{flex:1 1 auto;min-width:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ats-route-label{font-size:10.5px;opacity:.7;margin-right:5px;}",
      ".ats-tag{font-size:9.5px;padding:0 4px;border-radius:4px;background:rgba(127,127,127,.22);margin-left:4px;}",
      ".ats-float-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsh-border,rgba(127,127,127,.24));background:rgba(127,127,127,.08);flex:0 0 auto;}",
      ".ats-float-name{flex:1 1 auto;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ats-float-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}",
    ].join("\n");
    //#endregion

    /** 1.2.0 新增布局：分组、角色库、头像、预设与响应式网格。 */
    var PANEL_CSS = [
      ".ats-hero{display:flex;align-items:flex-start;gap:8px;padding:12px 12px 10px;border-bottom:1px solid var(--dsh-border,rgba(127,127,127,.22));flex-wrap:wrap;}",
      ".ats-hero-title{font-size:16px;font-weight:700;letter-spacing:.2px;}",
      ".ats-hero-sub{font-size:11px;opacity:.6;margin-top:3px;line-height:1.5;}",
      ".ats-preset{margin:8px 12px 0;padding:10px 12px;border:1px solid rgba(37,99,235,.35);border-radius:10px;background:rgba(37,99,235,.08);}",
      ".ats-preset-title{font-size:12px;font-weight:600;margin-bottom:4px;}",
      ".ats-preset-note{font-size:11px;opacity:.66;line-height:1.5;}",
      ".ats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;}",
      ".ats-card.editing{grid-column:1 / -1;}",
      ".ats-card.editing .ats-form{max-width:640px;}",
      ".ats-group{margin-bottom:14px;}",
      ".ats-group-head{display:flex;align-items:center;gap:7px;padding:5px 2px 8px;position:sticky;top:0;z-index:1;background:transparent;backdrop-filter:blur(6px);}",
      ".ats-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}",
      ".ats-group-name{font-size:12px;font-weight:600;}",
      ".ats-group-count{font-size:10px;opacity:.55;padding:0 5px;border-radius:999px;background:rgba(127,127,127,.16);}",
      ".ats-group-chip{font-size:10px;padding:1px 7px;border-radius:999px;white-space:nowrap;flex:0 0 auto;}",
      ".ats-group-chip.muted{background:rgba(127,127,127,.12);opacity:.6;}",
      ".ats-avatar{width:38px;height:38px;}",
      ".ats-id{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;}",
      ".ats-name-line{display:flex;align-items:center;gap:5px;min-width:0;}",
      ".ats-cats{display:flex;gap:5px;overflow-x:auto;padding:7px 12px;border-bottom:1px solid var(--dsh-border,rgba(127,127,127,.14));flex:0 0 auto;}",
      ".ats-cat{font:inherit;font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--dsh-border,rgba(127,127,127,.3));background:transparent;color:inherit;cursor:pointer;white-space:nowrap;}",
      ".ats-cat.on{background:var(--dsh-accent,#2563eb);border-color:transparent;color:#fff;}",
      ".ats-role-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(127,127,127,.18);border-radius:10px;background:rgba(127,127,127,.05);}",
      ".ats-preview{margin:8px 12px 0;padding:10px 12px;border:1px solid rgba(37,99,235,.35);border-radius:10px;background:rgba(37,99,235,.07);}",
      ".ats-preview-body{white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:1.55;max-height:240px;overflow:auto;margin-top:8px;opacity:.85;}",
      ".tw-head{flex-wrap:nowrap;gap:8px;}",
      ".tw-brand{display:flex;align-items:center;gap:6px;flex:0 0 auto;}",
      ".tw-logo{font-size:14px;line-height:1;}",
      ".tw-title{font-size:12.5px;font-weight:700;white-space:nowrap;}",
      ".tw-tabs{flex:1 1 auto;min-width:0;overflow-x:auto;}",
      ".tw-session{flex:0 0 auto;font-size:10px;opacity:.55;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      "@media (max-width:720px){.ats-grid{grid-template-columns:1fr;}.tw-title{display:none;}}",
    ].join("\n");
    //#region 宿主通信    //#region 宿主通信
    function unwrap(res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data && data.error ? data.error : "请求失败（HTTP " + res.status + "）");
        return data;
      });
    }
    function fetchState() {
      return fetch(ROUTE_STATE, { cache: "no-store" }).then(function (res) {
        if (!res.ok) throw new Error("状态读取失败（HTTP " + res.status + "）");
        return res.json();
      });
    }
    function postMembers(body) {
      return fetch(ROUTE_MEMBERS, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
    }
    function postProbe(body) {
      return fetch(ROUTE_PROBE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data && data.error ? data.error : "探测失败（HTTP " + res.status + "）");
          return data;
        });
      });
    }
    function postDispatch(body) {
      return fetch(ROUTE_DISPATCH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
    }
    //#endregion

    /** 从角色库导入成员（POST /roles）。 */
    function postRoles(body) {
      return fetch(ROLES_ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
    }
    /** 应用预设团队（POST /preset）。 */
    function postPreset(body) {
      return fetch(ROUTE_PRESET, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
    }
    /** 上传头像（POST /avatar）。 */
    function postAvatar(body) {
      return fetch(ROUTE_AVATAR, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
    }
    /** 搜索角色库（GET /roles）。 */
    function fetchRoles(query, category, offset, limit) {
      var params = "?q=" + encodeURIComponent(query || "") + "&category=" + encodeURIComponent(category || "") +
        "&offset=" + String(offset || 0) + "&limit=" + String(limit || 60);
      return fetch(ROLES_ROUTE + params, { cache: "no-store" }).then(unwrap);
    }
    /** 读取角色正文（GET /roles/body）。 */
    function fetchRoleBody(id) {
      return fetch(ROLE_BODY_ROUTE + "?id=" + encodeURIComponent(id), { cache: "no-store" }).then(unwrap);
    }
    //#region 小组件    //#region 小组件
    function Field(props) {
      return h("label", { className: "ats-field" },
        h("span", { className: "ats-label" }, props.label),
        props.multiline
          ? h("textarea", { className: "ats-area", value: props.value, placeholder: props.placeholder || "", rows: props.rows || 3, onChange: function (e) { props.onChange(e.target.value); } })
          : h("input", { className: "ats-input" + (props.className ? " " + props.className : ""), type: "text", value: props.value, placeholder: props.placeholder || "", onChange: function (e) { props.onChange(e.target.value); } })
      );
    }
    function SelectField(props) {
      return h("label", { className: "ats-field" },
        h("span", { className: "ats-label" }, props.label),
        h("select", { className: "ats-select", value: props.value, disabled: props.disabled === true, onChange: function (e) { props.onChange(e.target.value); } },
          (props.options || []).map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })
        )
      );
    }
    /** provider / model / 推理强度 三连选择器，供成员与路由共用。 */
    function RouteFields(props) {
      var draft = props.draft;
      var catalog = props.catalog || [];
      var efforts = props.effortOptions || [];
      var providers = [{ value: "", label: "（继承主智能体）" }].concat(catalog.map(function (p) {
        return { value: p.id, label: p.displayName + " (" + p.id + ")" + (p.error ? " ⚠" : "") };
      }));
      var active = catalog.filter(function (p) { return p.id === draft.provider; })[0];
      var models = [{ value: "", label: draft.provider ? "（该服务商默认模型）" : "（先选择服务商）" }].concat(
        (active && active.models ? active.models : []).map(function (m) { return { value: m.id, label: m.name + " — " + m.id }; })
      );
      var effortOpts = [{ value: "", label: "（默认）" }].concat(efforts.map(function (id) { return { value: id, label: id }; }));
      return h("div", null,
        h("div", { className: "ats-grid2" },
          h(SelectField, { label: "服务商", value: draft.provider, options: providers, onChange: function (v) { props.patch({ provider: v, model: "" }); } }),
          h(SelectField, { label: "模型", value: draft.model, disabled: !draft.provider, options: models, onChange: function (v) { props.patch({ model: v }); } })
        ),
        h(SelectField, { label: "推理强度", value: draft.reasoningEffort || "", options: effortOpts, onChange: function (v) { props.patch({ reasoningEffort: v }); } })
      );
    }
    //#endregion

    //#region 模型路由行 / 编辑器
    function RouteRow(props) {
      var route = props.route;
      var isActive = props.isActive;
      var busy = props.busy;
      var label = route.provider && route.model ? route.provider + "/" + route.model : "（继承主智能体）";
      return h("div", { className: "ats-route" + (isActive ? " cur" : "") },
        h("input", {
          className: "ats-radio", type: "radio", name: "ats-active-" + props.memberId,
          checked: isActive, disabled: busy, title: "设为当前使用的模型",
          onChange: function () { props.onActivate(route); }
        }),
        h("span", { className: "ats-route-text", title: label },
          h("span", { className: "ats-route-label" }, route.label),
          h("span", { className: "ats-chip" + (isActive ? " cur" : "") + (route.enabled ? "" : " off") }, label),
          route.reasoningEffort ? h("span", { className: "ats-tag" }, route.reasoningEffort) : null,
          isActive ? h("span", { className: "ats-tag" }, "当前") : null,
          route.enabled ? null : h("span", { className: "ats-tag" }, "停用")
        ),
        h("button", { className: "ats-btn tiny", type: "button", disabled: busy, onClick: function () { props.onEdit(route); } }, "改"),
        h("button", {
          className: "ats-btn tiny", type: "button", disabled: busy,
          onClick: function () { props.onToggle(route); }
        }, route.enabled ? "停" : "启"),
        h("button", {
          className: "ats-btn tiny danger", type: "button", disabled: busy,
          onClick: function () { props.onDelete(route); }
        }, "删")
      );
    }

    function RouteEditor(props) {
      var draftState = useState(props.route);
      var draft = draftState[0];
      var setDraft = draftState[1];
      function patch(part) { setDraft(function (prev) { return Object.assign({}, prev, part); }); }
      return h("div", { className: "ats-form" },
        h(Field, { label: "别名", value: draft.label || "", placeholder: "例如：主力 / 备用 / 便宜", onChange: function (v) { patch({ label: v }); } }),
        h(RouteFields, { draft: draft, catalog: props.catalog, effortOptions: props.effortOptions, patch: patch }),
        h("label", { className: "ats-check" },
          h("input", { type: "checkbox", checked: draft.enabled !== false, onChange: function (e) { patch({ enabled: e.target.checked }); } }),
          "启用（停用的路由不参与派发与回退）"
        ),
        h("div", { className: "ats-actions" },
          h("button", { className: "ats-btn primary", type: "button", disabled: props.busy, onClick: function () { props.onSave(draft); } }, "保存模型"),
          h("button", { className: "ats-btn", type: "button", disabled: props.busy, onClick: props.onCancel }, "取消")
        )
      );
    }
    //#endregion

    //#region 成员卡片
    //#region 头像与身份
    /** 头像：emoji + 配色渐变底；已上传图片时改渲染图片。 */
    function Avatar(props) {
      var member = props.member;
      var accent = props.accent;
      var size = props.size || 40;
      var image = member.avatar && member.avatar.kind === "image" && member.avatar.imageId ? member.avatar.imageId : "";
      var base = {
        width: size, height: size,
        borderRadius: size >= 36 ? 12 : 9,
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        background: "linear-gradient(145deg," + tint(accent, 0.95) + "," + tint(accent, 0.38) + ")",
        boxShadow: "inset 0 0 0 1px " + tint(accent, 0.5),
        overflow: "hidden"
      };
      if (image.length > 0) {
        return h("span", { className: "ats-avatar", style: base, title: member.name },
          h("img", {
            src: ROUTE_AVATAR + "?id=" + encodeURIComponent(image),
            alt: member.name,
            style: { width: "100%", height: "100%", objectFit: "cover", display: "block" }
          })
        );
      }
      return h("span", { className: "ats-avatar", style: base, title: member.name + " · " + (member.emoji || "🤖") }, member.emoji || "🤖");
    }

    /** 把文件裁成 160×160 webp（照 DS-Bot 的做法），尽量控制在 150 KB 内。 */
    function avatarDataUrl(file) {
      if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return Promise.reject(new Error("请选择 PNG / JPEG / WebP 图片"));
      if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error("图片需小于 25 MB"));
      return createImageBitmap(file).then(function (bitmap) {
        var side = 160;
        var canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        var context = canvas.getContext("2d");
        context.imageSmoothingQuality = "high";
        var crop = Math.min(bitmap.width, bitmap.height);
        context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side);
        if (bitmap.close) bitmap.close();
        var qualities = [0.9, 0.75, 0.6, 0.45];
        for (var i = 0; i < qualities.length; i += 1) {
          var url = canvas.toDataURL("image/webp", qualities[i]);
          if (url.indexOf("data:image/webp") === 0 && url.length < 150000) return url;
        }
        return canvas.toDataURL("image/png");
      });
    }
    //#endregion

    function MemberCard(props) {
      var member = props.member;
      var busy = props.busy;
      var editingState = useState(false);
      var editing = editingState[0];
      var setEditing = editingState[1];
      var draftState = useState(member);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var taskState = useState("");
      var task = taskState[0];
      var setTask = taskState[1];
      var taskOpenState = useState(false);
      var taskOpen = taskOpenState[0];
      var setTaskOpen = taskOpenState[1];
      var probeState = useState(null);
      var probe = probeState[0];
      var setProbe = probeState[1];
      var probingState = useState(false);
      var probing = probingState[0];
      var setProbing = probingState[1];
      var routeEditState = useState(null);
      var routeEdit = routeEditState[0];
      var setRouteEdit = routeEditState[1];
      var routesOpenState = useState(false);
      var routesOpen = routesOpenState[0];
      var setRoutesOpen = routesOpenState[1];
      var uploadState = useState("");
      var uploadError = uploadState[0];
      var setUploadError = uploadState[1];

      useEffect(function () { if (!editing) setDraft(member); }, [member, editing]);

      function patchMember(part) { setDraft(function (prev) { return Object.assign({}, prev, part); }); }

      var routes = member.routes || [];
      var enabledRoutes = routes.filter(function (r) { return r.enabled; });
      var current = routes.filter(function (r) { return r.id === member.activeRouteId; })[0] || enabledRoutes[0];
      var currentLabel = current ? (current.provider && current.model ? current.provider + "/" + current.model : "继承主智能体") : "继承主智能体";

      function blankRoute() {
        var d = props.defaults || EMPTY_DEFAULTS;
        return {
          id: "",
          label: "模型 " + String(routes.length + 1),
          provider: d.provider || "",
          model: d.model || "",
          reasoningEffort: d.reasoningEffort || "",
          enabled: true
        };
      }

      var accent = colorOf(member, props.colorIndex);
      var groups = props.groups || [];
      var group = groups.filter(function (g) { return g.id === member.groupId; })[0];
      var groupColor = group ? (group.color || colorOf(group, groups.indexOf(group))) : "#6b7280";

      var routesBlock = h("div", { className: "ats-routes" },
        routes.length === 0
          ? h("div", { className: "ats-role" }, "未配置模型路由 —— 派发时继承主智能体。")
          : routes.map(function (route) {
              return h(RouteRow, {
                key: route.id,
                route: route,
                memberId: member.id,
                isActive: current !== undefined && route.id === current.id,
                busy: busy,
                onEdit: function (r) { setRouteEdit(r); },
                onActivate: function (r) { props.onRouteActivate(member, r); },
                onToggle: function (r) { props.onRouteToggle(member, r); },
                onDelete: function (r) { props.onRouteDelete(member, r); }
              });
            }),
        routeEdit !== null
          ? h(RouteEditor, {
              route: routeEdit,
              catalog: props.catalog,
              effortOptions: props.effortOptions,
              busy: busy,
              onCancel: function () { setRouteEdit(null); },
              onSave: function (next) { props.onRouteSave(member, next, function () { setRouteEdit(null); }); }
            })
          : h("div", { className: "ats-actions", style: { marginTop: "2px" } },
              h("button", {
                className: "ats-btn tiny", type: "button", disabled: busy || routes.length >= (props.limits ? props.limits.maxRoutes : 8),
                onClick: function () { setRouteEdit(blankRoute()); }
              }, "＋ 添加模型")
            )
      );

      return h("div", {
        className: "ats-card" + (member.enabled ? "" : " off") + (props.selected ? " sel" : "") + (editing ? " editing" : ""),
        style: { borderLeftColor: accent, background: tint(accent, 0.06) }
      },
        h("div", { className: "ats-card-head" },
          h("input", {
            type: "checkbox", checked: props.selected === true, title: "选中以批量操作",
            onChange: function () { props.onSelectToggle(member.id); }
          }),
          h(Avatar, { member: member, accent: accent, size: 38 }),
          h("div", { className: "ats-id" },
            h("div", { className: "ats-name-line" },
              h("span", { className: "ats-name" }, member.name),
              member.enabled ? null : h("span", { className: "ats-tag" }, "停用"),
              member.roleRef && member.roleRef.id ? h("span", { className: "ats-tag", title: member.roleRef.id }, "角色库") : null
            ),
            h("div", { className: "ats-role" }, member.role)
          ),
          h("span", { className: "ats-spacer" }),
          group
            ? h("span", { className: "ats-group-chip", style: { background: tint(groupColor, 0.18), color: groupColor } }, group.name)
            : h("span", { className: "ats-group-chip muted" }, "未分组")
        ),
        h("div", { className: "ats-row", style: { marginTop: "7px", flexWrap: "wrap" } },
          h("span", { className: "ats-chip" + (current ? " cur" : "") }, "当前 " + currentLabel),
          h("span", { className: "ats-chip" }, String(routes.length) + " 条路由")
        ),
        h("div", { className: "ats-actions" },
          h("button", { className: "ats-btn" + (editing ? " primary" : ""), type: "button", onClick: function () { setEditing(!editing); } }, editing ? "收起" : "编辑"),
          h("button", { className: "ats-btn", type: "button", disabled: busy, onClick: function () { props.onDuplicate(member); } }, "复制"),
          h("button", {
            className: "ats-btn", type: "button", disabled: busy || !member.enabled,
            onClick: function () { props.onDispatch(member, task || ("请用一句话介绍你在团队中的职责：" + member.role)); }
          }, busy ? "运行中…" : "试跑"),
          h("button", {
            className: "ats-btn", type: "button", disabled: probing,
            onClick: function () {
              setProbing(true); setProbe(null);
              postProbe({ memberId: member.id })
                .then(function (data) { setProbe(data); })
                .catch(function (error) { setProbe({ ok: false, error: String(error && error.message ? error.message : error) }); })
                .then(function () { setProbing(false); });
            }
          }, probing ? "检测中…" : "测试"),
          h("button", { className: "ats-btn tiny", type: "button", onClick: function () { setRoutesOpen(!routesOpen); } }, (routesOpen ? "▾ 模型路由" : "▸ 模型路由"))
        ),

        routesOpen || editing ? routesBlock : null,

        editing
          ? h("div", { className: "ats-form" },
              h("div", { className: "ats-grid2" },
                h(Field, { label: "名称", value: draft.name, onChange: function (v) { patchMember({ name: v }); } }),
                h(Field, { label: "职责", value: draft.role, onChange: function (v) { patchMember({ role: v }); } })
              ),
              h("div", { className: "ats-grid2" },
                h(SelectField, {
                  label: "所属分组", value: draft.groupId || "",
                  options: [{ value: "", label: "未分组" }].concat(groups.map(function (g) { return { value: g.id, label: g.name }; })),
                  onChange: function (v) { patchMember({ groupId: v }); }
                }),
                h("label", { className: "ats-field" },
                  h("span", { className: "ats-label" }, "头像"),
                  h("div", { className: "ats-row" },
                    h("input", {
                      className: "ats-input", type: "file", accept: "image/png,image/jpeg,image/webp,image/gif",
                      style: { padding: "2px" },
                      onChange: function (e) {
                        var file = e.target.files && e.target.files[0];
                        if (!file) return;
                        setUploadError("");
                        avatarDataUrl(file).then(function (url) {
                          return postAvatar({ memberId: member.id, dataUrl: url });
                        }).then(function (data) {
                          props.onReload(data);
                        }).catch(function (error) {
                          setUploadError(String(error && error.message ? error.message : error));
                        });
                      }
                    }),
                    member.avatar && member.avatar.kind === "image"
                      ? h("button", { className: "ats-btn tiny", type: "button", onClick: function () { props.onAvatarClear(member); } }, "清除")
                      : null
                  )
                )
              ),
              uploadError ? h("div", { className: "ats-note err" }, uploadError) : null,
              h("div", { className: "ats-field" },
                h("span", { className: "ats-label" }, "表情"),
                h("div", { className: "ats-emoji-pick" },
                  h("button", {
                    className: "ats-btn tiny", type: "button",
                    onClick: function () {
                      var index = Math.floor(Math.random() * EMOJI_CHOICES.length);
                      patchMember({ emoji: EMOJI_CHOICES[index] });
                    }
                  }, "🎲 随机"),
                  EMOJI_CHOICES.map(function (emoji) {
                    return h("button", {
                      key: emoji, type: "button", className: "ats-emoji-opt" + (draft.emoji === emoji ? " on" : ""),
                      onClick: function () { patchMember({ emoji: emoji }); }
                    }, emoji);
                  })
                )
              ),
              h("div", { className: "ats-field" },
                h("span", { className: "ats-label" }, "卡片颜色"),
                h("div", { className: "ats-color-pick" },
                  PALETTE.map(function (c) {
                    return h("button", {
                      key: c, type: "button", title: c,
                      className: "ats-swatch" + (colorOf(draft, props.colorIndex) === c ? " on" : ""),
                      style: { background: c },
                      onClick: function () { patchMember({ color: c }); }
                    });
                  }),
                  h("input", {
                    type: "color", title: "自定义颜色",
                    value: isHexColor(draft.color) ? draft.color : colorOf(draft, props.colorIndex),
                    onChange: function (e) { patchMember({ color: e.target.value }); },
                    style: { width: "32px", height: "24px", padding: "0", border: "1px solid rgba(127,127,127,.4)", borderRadius: "7px", background: "transparent", cursor: "pointer" }
                  }),
                  h("button", {
                    className: "ats-btn tiny", type: "button", title: "清除自定义颜色，回到自动配色",
                    onClick: function () { patchMember({ color: "" }); }
                  }, "自动")
                )
              ),
              h(Field, {
                label: "角色提示词（写入该成员的 persona；留空时用角色库正文）", value: draft.instructions, multiline: true, rows: 4,
                placeholder: "例如：只回答经过核验的事实，并给出处。",
                onChange: function (v) { patchMember({ instructions: v }); }
              }),
              h("label", { className: "ats-check" },
                h("input", { type: "checkbox", checked: draft.enabled !== false, onChange: function (e) { patchMember({ enabled: e.target.checked }); } }),
                "启用该成员"
              ),
              h("div", { className: "ats-actions" },
                h("button", { className: "ats-btn primary", type: "button", disabled: busy, onClick: function () { props.onSave(draft, function () { setEditing(false); }); } }, "保存"),
                h("button", { className: "ats-btn", type: "button", disabled: busy, onClick: function () { setDraft(member); setEditing(false); } }, "取消"),
                h("span", { className: "ats-spacer" }),
                h("button", {
                  className: "ats-btn danger", type: "button", disabled: busy,
                  onClick: function () { if (window.confirm("删除智能体「" + member.name + "」？")) props.onDelete(member); }
                }, "删除智能体")
              )
            )
          : null,

        !editing
          ? h("div", { style: { marginTop: "6px" } },
              h("button", {
                className: "ats-btn tiny", type: "button",
                onClick: function () { setTaskOpen(!taskOpen); }
              }, (taskOpen ? "▾ " : "▸ ") + "试跑设置" + (task.length > 0 ? "（已填任务）" : "")),
              taskOpen
                ? h("div", { className: "ats-form", style: { marginTop: "6px" } },
                    h(Field, {
                      label: "试跑任务（在该成员当前路由上执行，失败自动回退）", value: task, multiline: true, rows: 2,
                      placeholder: "留空则使用默认自我介绍任务。", onChange: setTask
                    })
                  )
                : null
            )
          : null,

        probe
          ? h("div", { className: "ats-note" + (probe.ok ? " ok" : " err"), style: { marginTop: "6px" } },
              probe.ok
                ? "当前路由可用：" + (probe.provider || "继承") + "/" + (probe.model || "继承") +
                  (probe.resolvedReasoningEffort ? " · 推理强度 " + probe.resolvedReasoningEffort : "") +
                  (probe.reasoningEfforts && probe.reasoningEfforts.length ? " · 支持 " + probe.reasoningEfforts.join("/") : "") +
                  (probe.inputModalities && probe.inputModalities.length ? " · 输入 " + probe.inputModalities.join("+") : "")
                : "当前路由不可用：" + (probe.error || "未知错误") + (probe.code ? "（" + probe.code + "）" : ""))
          : null,

        props.result
          ? h("div", null,
              props.result.error
                ? h("div", { className: "ats-note err", style: { marginTop: "6px" } }, props.result.error)
                : props.result.stopReason === "error"
                  ? h("div", { className: "ats-note err", style: { marginTop: "6px" } },
                      "运行失败：" + (props.result.detail || "（无诊断信息，请检查该服务商的 API Key 与网络）"))
                  : h("div", null,
                      h("div", { className: "ats-note ok", style: { marginTop: "6px" } },
                        "在 " + (props.result.provider || "继承") + "/" + (props.result.model || "继承") + " 上完成（" + props.result.stopReason + "）" +
                        (props.result.attempts && props.result.attempts.length > 1
                          ? " · 尝试轨迹 " + props.result.attempts.map(function (a) { return a.route + (a.ok ? "✓" : "✗"); }).join(" → ")
                          : "")),
                      h("div", { className: "ats-out" }, props.result.output)
                    )
            )
          : null
      );
    }

    //#region 主面板
    function AgentTeamPanel(props) {
      var scope = props.scope || {};
      var sessionId = resolveSessionId(scope);

      var state = useState({ loading: true, error: "", members: [], groups: [], presets: [], preset: "", roleLibrary: null, catalog: [], defaults: EMPTY_DEFAULTS, effortOptions: [], limits: null, storePath: "", pluginVersion: "" });
      var snap = state[0];
      var setSnap = state[1];
      var busyState = useState("");
      var busy = busyState[0];
      var setBusy = busyState[1];
      var resultsState = useState({});
      var results = resultsState[0];
      var setResults = resultsState[1];
      var bannerState = useState("");
      var banner = bannerState[0];
      var setBanner = bannerState[1];
      var queryState = useState("");
      var query = queryState[0];
      var setQuery = queryState[1];
      var selectedState = useState({});
      var selected = selectedState[0];
      var setSelected = selectedState[1];
      var viewState = useState("grouped");
      var view = viewState[0];
      var setView = viewState[1];
      var presetOpenState = useState(false);
      var presetOpen = presetOpenState[0];
      var setPresetOpen = presetOpenState[1];
      var collapsedState = useState({});
      var collapsed = collapsedState[0];
      var setCollapsed = collapsedState[1];

      var load = useCallback(function () {
        setSnap(function (prev) { return Object.assign({}, prev, { loading: true, error: "" }); });
        fetchState().then(function (data) {
          setSnap({
            loading: false,
            error: data.catalogError ? String(data.catalogError) : "",
            members: Array.isArray(data.members) ? data.members : [],
            groups: Array.isArray(data.groups) ? data.groups : [],
            presets: Array.isArray(data.presets) ? data.presets : [],
            preset: typeof data.preset === "string" ? data.preset : "",
            roleLibrary: data.roleLibrary || null,
            catalog: Array.isArray(data.catalog) ? data.catalog : [],
            defaults: data.defaults || EMPTY_DEFAULTS,
            effortOptions: Array.isArray(data.effortOptions) ? data.effortOptions : [],
            limits: data.limits || null,
            storePath: typeof data.storePath === "string" ? data.storePath : "",
            pluginVersion: typeof data.pluginVersion === "string" ? data.pluginVersion : ""
          });
        }).catch(function (error) {
          setSnap(function (prev) { return Object.assign({}, prev, { loading: false, error: String(error && error.message ? error.message : error) }); });
        });
      }, []);

      useEffect(function () { load(); }, [load]);

      var applyState = useCallback(function (data) {
        setSnap(function (prev) {
          return Object.assign({}, prev, {
            loading: false,
            members: Array.isArray(data.members) ? data.members : [],
            groups: Array.isArray(data.groups) ? data.groups : prev.groups,
            preset: typeof data.preset === "string" ? data.preset : prev.preset,
            presets: Array.isArray(data.presets) ? data.presets : prev.presets,
            roleLibrary: data.roleLibrary || prev.roleLibrary,
            catalog: Array.isArray(data.catalog) ? data.catalog : prev.catalog,
            defaults: data.defaults || prev.defaults,
            effortOptions: Array.isArray(data.effortOptions) ? data.effortOptions : prev.effortOptions,
            limits: data.limits || prev.limits,
            storePath: typeof data.storePath === "string" ? data.storePath : prev.storePath,
            pluginVersion: typeof data.pluginVersion === "string" ? data.pluginVersion : prev.pluginVersion,
            error: data.catalogError ? String(data.catalogError) : ""
          });
        });
      }, []);

      var mutate = useCallback(function (busyKey, body, message, done) {
        setBusy(busyKey);
        setBanner("");
        return postMembers(body).then(function (data) {
          applyState(data);
          if (message) setBanner(typeof message === "function" ? message(data) : message);
          if (typeof done === "function") done();
        }).catch(function (error) {
          setBanner(String(error && error.message ? error.message : error));
        }).then(function () { setBusy(""); });
      }, [applyState, setBanner, setBusy]);

      function defaultTemplate() {
        var d = snap.defaults || EMPTY_DEFAULTS;
        var route = { id: "", label: "默认模型", provider: d.provider || "", model: d.model || "", reasoningEffort: d.reasoningEffort || "", enabled: true };
        return { role: "通用助手", emoji: "🤖", namePrefix: "智能体", routes: [route] };
      }

      var createOne = function () {
        mutate("save", { action: "upsert", member: { name: "", role: "通用助手", emoji: "🤖", routes: (defaultTemplate().routes) } }, "已新建智能体，请补充名称与职责。");
      };

      var applyPreset = function (mode) {
        setBusy("preset");
        setBanner("");
        postPreset({ id: "project-department", mode: mode }).then(function (data) {
          applyState(data);
          setPresetOpen(false);
          setBanner("已" + (mode === "replace" ? "替换为" : "追加") + "「项目部」预设：" + String(data.added) + " 名角色，当前 " + String(data.members.length) + " 名成员。");
        }).catch(function (error) {
          setBanner(String(error && error.message ? error.message : error));
        }).then(function () { setBusy(""); });
      };

      var addGroup = function () {
        var name = window.prompt("新分组名称（例如：研发、设计、交付）");
        if (name === null) return;
        var trimmed = String(name).trim();
        if (trimmed.length === 0) { setBanner("分组名称不能为空"); return; }
        mutate("group", { action: "group-upsert", group: { name: trimmed } }, "已新建分组「" + trimmed + "」。");
      };

      var renameGroup = function (group) {
        var name = window.prompt("分组名称", group.name);
        if (name === null) return;
        var trimmed = String(name).trim();
        if (trimmed.length === 0) return;
        mutate("group", { action: "group-upsert", group: { id: group.id, name: trimmed } }, "分组已改名。");
      };

      var deleteGroup = function (group) {
        if (!window.confirm("删除分组「" + group.name + "」？组内成员会移到「未分组」。")) return;
        mutate("group", { action: "group-delete", id: group.id }, "已删除分组，成员已移到未分组。");
      };

      var dispatch = useCallback(function (member, task) {
        setBusy(member.id);
        setBanner("");
        postDispatch({ sessionId: sessionId, memberId: member.id, task: task }).then(function (data) {
          setResults(function (prev) { return Object.assign({}, prev, { [member.id]: data }); });
        }).catch(function (error) {
          setResults(function (prev) { return Object.assign({}, prev, { [member.id]: { error: String(error && error.message ? error.message : error) } }); });
        }).then(function () { setBusy(""); });
      }, [sessionId]);

      var members = snap.members || [];
      var groups = (snap.groups || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var needle = query.trim().toLowerCase();
      var visible = needle.length === 0 ? members : members.filter(function (m) {
        var group = groups.filter(function (g) { return g.id === m.groupId; })[0];
        var hay = [m.name, m.role, m.emoji, group ? group.name : ""].concat((m.routes || []).map(function (r) { return r.provider + "/" + r.model + " " + r.label; })).join(" ").toLowerCase();
        return hay.indexOf(needle) >= 0;
      });
      var bound = members.filter(function (m) { return (m.routes || []).length > 0; }).length;
      var routeTotal = members.reduce(function (n, m) { return n + (m.routes || []).length; }, 0);
      var selectedCount = Object.keys(selected).filter(function (id) { return selected[id] === true; }).length;
      var libraryTotal = snap.roleLibrary && typeof snap.roleLibrary.total === "number" ? snap.roleLibrary.total : 0;

      var cardOf = function (member) {
        return h(MemberCard, {
          key: member.id,
          member: member,
          colorIndex: members.indexOf(member),
          catalog: snap.catalog,
          groups: groups,
          defaults: snap.defaults,
          effortOptions: snap.effortOptions,
          limits: snap.limits,
          selected: selected[member.id] === true,
          busy: busy === member.id || busy === "save",
          result: results[member.id],
          onSelectToggle: function (id) {
            setSelected(function (prev) { var next = Object.assign({}, prev); if (next[id]) delete next[id]; else next[id] = true; return next; });
          },
          onSave: function (draft, done) { mutate("save", { action: "upsert", member: draft }, "已保存「" + draft.name + "」。", done); },
          onDelete: function (m) { mutate("save", { action: "delete", id: m.id }, "已删除「" + m.name + "」。"); },
          onDuplicate: function (m) { mutate("save", { action: "duplicate", id: m.id }, "已复制「" + m.name + "」。"); },
          onDispatch: dispatch,
          onReload: applyState,
          onAvatarClear: function (m) { mutate("save", { action: "upsert", member: { id: m.id, avatar: { kind: "emoji", imageId: "" } } }, "已清除头像图片。"); },
          onRouteSave: function (m, route, done) { mutate("save", { action: "route-upsert", memberId: m.id, route: route }, "已保存模型路由。", done); },
          onRouteDelete: function (m, route) {
            if (!window.confirm("删除「" + m.name + "」的模型路由 " + (route.provider + "/" + route.model) + "？")) return;
            mutate("save", { action: "route-delete", memberId: m.id, routeId: route.id }, "已删除模型路由。");
          },
          onRouteToggle: function (m, route) { mutate("save", { action: "route-upsert", memberId: m.id, route: { id: route.id, enabled: route.enabled === false } }, route.enabled ? "已停用该路由。" : "已启用该路由。"); },
          onRouteActivate: function (m, route) { mutate("save", { action: "route-activate", memberId: m.id, routeId: route.id }, "已切换当前模型。"); }
        });
      };

      var sections = [];
      if (view === "grouped") {
        var known = {};
        groups.forEach(function (g) { known[g.id] = true; });
        groups.forEach(function (group) {
          var list = visible.filter(function (m) { return m.groupId === group.id; });
          if (list.length > 0 || needle.length === 0) sections.push({ group: group, list: list });
        });
        var ungrouped = visible.filter(function (m) { return !m.groupId || !known[m.groupId]; });
        if (ungrouped.length > 0 || groups.length === 0) sections.push({ group: null, list: ungrouped });
      }

      var listBody;
      if (snap.loading) {
        listBody = h("div", { className: "ats-empty" }, "正在读取团队配置…");
      } else if (visible.length === 0) {
        listBody = h("div", { className: "ats-empty" },
          members.length === 0
            ? "还没有成员。点「项目部预设」一键成立 15 人项目部，或从「角色库」挑角色加入。"
            : "没有匹配「" + query + "」的成员。");
      } else if (view === "flat") {
        listBody = h("div", { className: "ats-grid" }, visible.map(cardOf));
      } else {
        listBody = sections.map(function (section) {
          var group = section.group;
          var key = group ? group.id : "__none__";
          var closed = collapsed[key] === true;
          var groupColor = group ? (group.color || colorOf(group, groups.indexOf(group))) : "#6b7280";
          return h("div", { className: "ats-group", key: key },
            h("div", { className: "ats-group-head" },
              h("span", { className: "ats-dot", style: { background: groupColor } }),
              h("span", { className: "ats-group-name" }, group ? group.name : "未分组"),
              h("span", { className: "ats-group-count" }, String(section.list.length)),
              h("span", { className: "ats-spacer" }),
              group
                ? h("button", { className: "ats-btn tiny", type: "button", onClick: function () { renameGroup(group); } }, "改名")
                : null,
              group
                ? h("button", { className: "ats-btn tiny danger", type: "button", onClick: function () { deleteGroup(group); } }, "删除")
                : null,
              h("button", {
                className: "ats-btn tiny", type: "button",
                onClick: function () { setCollapsed(function (prev) { var next = Object.assign({}, prev); next[key] = !closed; return next; }); }
              }, closed ? "▸" : "▾")
            ),
            closed ? null : h("div", { className: "ats-grid" }, section.list.map(cardOf))
          );
        });
      }

      return h("div", { className: "ats-root" },
        h("div", { className: "ats-hero" },
          h("div", { style: { minWidth: 0 } },
            h("div", { className: "ats-hero-title" }, "智能体团队"),
            h("div", { className: "ats-hero-sub" },
              String(members.length) + " 名成员 · " + String(groups.length) + " 个分组 · " +
              String(routeTotal) + " 条模型路由 · " + String(bound) + " 名已配置模型" +
              (snap.pluginVersion ? " · v" + snap.pluginVersion : ""))
          ),
          h("span", { className: "ats-spacer" }),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "save", onClick: load }, "刷新"),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "preset", onClick: function () { setPresetOpen(!presetOpen); } }, "项目部预设"),
          h("button", { className: "ats-btn primary", type: "button", disabled: busy === "save", onClick: createOne }, "＋ 新建")
        ),

        presetOpen
          ? h("div", { className: "ats-preset" },
              h("div", { className: "ats-preset-title" }, "「项目部」预设 · 6 组 15 人（决策 / 设计 / 研发 / 测试 / 运营 / 交付）"),
              h("div", { className: "ats-preset-note" }, "追加：保留现有成员，只补缺失的角色；替换：清空当前团队后重建（会丢现有路由配置）。"),
              h("div", { className: "ats-actions" },
                h("button", { className: "ats-btn primary", type: "button", disabled: busy === "preset", onClick: function () { applyPreset("append"); } }, "追加缺失角色"),
                h("button", {
                  className: "ats-btn danger", type: "button", disabled: busy === "preset",
                  onClick: function () { if (window.confirm("替换会清空当前团队（含模型路由），确定继续？")) applyPreset("replace"); }
                }, "替换当前团队"),
                h("button", { className: "ats-btn", type: "button", onClick: function () { setPresetOpen(false); } }, "取消")
              )
            )
          : null,

        h("div", { className: "ats-bar" },
          h("input", {
            className: "ats-input ats-search", type: "text", value: query, placeholder: "搜索名称 / 职责 / 分组 / 模型…",
            onChange: function (e) { setQuery(e.target.value); }
          }),
          h("button", { className: "ats-btn tiny" + (view === "grouped" ? " primary" : ""), type: "button", onClick: function () { setView("grouped"); } }, "分组"),
          h("button", { className: "ats-btn tiny" + (view === "flat" ? " primary" : ""), type: "button", onClick: function () { setView("flat"); } }, "平铺"),
          h("button", { className: "ats-btn tiny", type: "button", disabled: busy === "group", onClick: addGroup }, "＋ 分组"),
          h("button", { className: "ats-btn tiny", type: "button", onClick: function () { props.onOpenRoles && props.onOpenRoles(); } }, "角色库" + (libraryTotal > 0 ? "(" + String(libraryTotal) + ")" : ""))
        ),

        banner ? h("div", { className: "ats-sub", style: { color: "#dc2626" } }, banner) : null,
        snap.error ? h("div", { className: "ats-sub", style: { color: "#dc2626" } }, snap.error) : null,

        h("div", { className: "ats-list" }, listBody),

        h("div", { className: "ats-foot" },
          "dsh-team-workbench" + (snap.pluginVersion ? " v" + snap.pluginVersion : "") +
          (snap.storePath ? " · 配置：" + snap.storePath : "")
        )
      );
    }
    //#endregion

    //#region 角色库
    function RoleLibrary(props) {
      var listState = useState({ loading: true, error: "", roles: [], total: 0, categories: [], offset: 0, limit: 60 });
      var list = listState[0];
      var setList = listState[1];
      var queryState = useState("");
      var query = queryState[0];
      var setQuery = queryState[1];
      var draftQueryState = useState("");
      var draftQuery = draftQueryState[0];
      var setDraftQuery = draftQueryState[1];
      var categoryState = useState("");
      var category = categoryState[0];
      var setCategory = categoryState[1];
      var selectedState = useState(null);
      var selected = selectedState[0];
      var setSelected = selectedState[1];
      var bodyState = useState({ loading: false, text: "", error: "" });
      var body = bodyState[0];
      var setBody = bodyState[1];
      var bannerState = useState("");
      var banner = bannerState[0];
      var setBanner = bannerState[1];
      var busyState = useState("");
      var busy = busyState[0];
      var setBusy = busyState[1];
      var groupsState = useState([]);
      var groups = groupsState[0];
      var setGroups = groupsState[1];
      var targetState = useState("");
      var target = targetState[0];
      var setTarget = targetState[1];

      useEffect(function () {
        fetchState().then(function (data) {
          setGroups(Array.isArray(data.groups) ? data.groups : []);
        }).catch(function () { /* 分组读取失败只影响「加入分组」，不影响浏览 */ });
      }, []);

      var load = useCallback(function (nextQuery, nextCategory, nextOffset) {
        setList(function (prev) { return Object.assign({}, prev, { loading: true, error: "" }); });
        fetchRoles(nextQuery, nextCategory, nextOffset, 60).then(function (data) {
          setList({
            loading: false,
            error: "",
            roles: Array.isArray(data.roles) ? data.roles : [],
            total: typeof data.total === "number" ? data.total : 0,
            categories: Array.isArray(data.categories) ? data.categories : [],
            offset: nextOffset,
            limit: 60
          });
        }).catch(function (error) {
          setList(function (prev) { return Object.assign({}, prev, { loading: false, error: String(error && error.message ? error.message : error) }); });
        });
      }, []);

      useEffect(function () { load(query, category, 0); }, [load, query, category]);

      var preview = function (role) {
        setSelected(role);
        setBody({ loading: true, text: "", error: "" });
        fetchRoleBody(role.id).then(function (data) {
          setBody({ loading: false, text: typeof data.body === "string" ? data.body : "", error: "" });
        }).catch(function (error) {
          setBody({ loading: false, text: "", error: String(error && error.message ? error.message : error) });
        });
      };

      var add = function (role) {
        setBusy(role.id);
        setBanner("");
        postRoles({ ids: [role.id], groupId: target }).then(function (data) {
          setBanner("已加入「" + role.name + "」，当前团队 " + String(data.members.length) + " 名成员。");
          if (props.onTeamChanged) props.onTeamChanged(data);
        }).catch(function (error) {
          setBanner(String(error && error.message ? error.message : error));
        }).then(function () { setBusy(""); });
      };

      var chips = [{ id: "", name: "全部" }].concat(list.categories.map(function (c) { return { id: c.id, name: c.name }; }));

      return h("div", { className: "ats-root" },
        h("div", { className: "ats-hero" },
          h("div", { style: { minWidth: 0 } },
            h("div", { className: "ats-hero-title" }, "角色库"),
            h("div", { className: "ats-hero-sub" }, "agency-agents-zh · " + String(list.categories.length) + " 个部门 · " + String(list.total) + " 个角色（按关键词筛选后）")
          )
        ),
        h("div", { className: "ats-bar" },
          h("input", {
            className: "ats-input ats-search", type: "text", value: draftQuery, placeholder: "搜索角色名 / 职责 / 部门…",
            onChange: function (e) { setDraftQuery(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter") setQuery(draftQuery); }
          }),
          h("button", { className: "ats-btn tiny primary", type: "button", onClick: function () { setQuery(draftQuery); } }, "搜索"),
          h(SelectField, {
            label: "", value: target, options: [{ value: "", label: "加入：未分组" }].concat(groups.map(function (g) { return { value: g.id, label: "加入：" + g.name }; })),
            onChange: function (v) { setTarget(v); }
          })
        ),
        h("div", { className: "ats-cats" },
          chips.map(function (chip) {
            return h("button", {
              key: chip.id, type: "button",
              className: "ats-cat" + (category === chip.id ? " on" : ""),
              onClick: function () { setCategory(chip.id); }
            }, chip.name);
          })
        ),
        banner ? h("div", { className: "ats-sub", style: { color: "#15803d" } }, banner) : null,
        list.error ? h("div", { className: "ats-sub", style: { color: "#dc2626" } }, list.error) : null,
        selected
          ? h("div", { className: "ats-preview" },
              h("div", { className: "ats-row" },
                h("span", { className: "ats-avatar", style: { width: 34, height: 34, fontSize: 18, borderRadius: 10, background: tint(colorOfName(selected.color) || "#2563eb", 0.22) } }, selected.emoji),
                h("span", { className: "ats-name" }, selected.name),
                h("span", { className: "ats-role" }, selected.categoryName),
                h("span", { className: "ats-spacer" }),
                h("button", { className: "ats-btn tiny primary", type: "button", disabled: busy === selected.id, onClick: function () { add(selected); } }, busy === selected.id ? "加入中…" : "＋ 加入团队"),
                h("button", { className: "ats-btn tiny", type: "button", onClick: function () { setSelected(null); } }, "关闭")
              ),
              h("div", { className: "ats-preview-body" }, body.loading ? "正在读取角色正文…" : (body.error ? body.error : body.text.slice(0, 2400)))
            )
          : null,
        h("div", { className: "ats-list" },
          list.loading
            ? h("div", { className: "ats-empty" }, "正在读取角色库…")
            : list.roles.length === 0
              ? h("div", { className: "ats-empty" }, "没有匹配的角色。换个关键词试试。")
              : list.roles.map(function (role) {
                  return h("div", { className: "ats-role-row", key: role.id },
                    h("span", { className: "ats-avatar", style: { width: 32, height: 32, fontSize: 17, borderRadius: 9, background: tint(colorOfName(role.color) || "#2563eb", 0.22) } }, role.emoji),
                    h("div", { className: "ats-id" },
                      h("div", { className: "ats-name-line" }, h("span", { className: "ats-name" }, role.name), h("span", { className: "ats-tag" }, role.categoryName)),
                      h("div", { className: "ats-role" }, role.description)
                    ),
                    h("span", { className: "ats-spacer" }),
                    h("button", { className: "ats-btn tiny", type: "button", onClick: function () { preview(role); } }, "预览"),
                    h("button", { className: "ats-btn tiny primary", type: "button", disabled: busy === role.id, onClick: function () { add(role); } }, busy === role.id ? "…" : "＋ 加入")
                  );
                })
        ),
        list.total > list.roles.length
          ? h("div", { className: "ats-actions", style: { padding: "0 12px 16px" } },
              h("button", {
                className: "ats-btn", type: "button", disabled: list.loading,
                onClick: function () { load(query, category, list.offset + list.limit); }
              }, "加载更多（" + String(list.offset + list.roles.length) + " / " + String(list.total) + "）")
            )
          : null
      );
    }
    //#endregion

    //#region 共享技能库面板
    /** 技能库路由前缀（服务端 dsh/skills.js）。 */
    var BASE = "/api/team-workbench/skills";
    function api(path, body) {
      var init = body === undefined
        ? { method: "GET" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      return fetch(BASE + path, init).then(function (r) {
        return r.json().then(function (j) { return { status: r.status, json: j }; });
      });
    }
    var C = {
      bg: "#ffffff", panel: "#f5f6f8", line: "#dcdfe4", text: "#111111",
      dim: "#666b73", accent: "#2563eb", ok: "#15803d", warn: "#b45309", bad: "#b91c1c"
    };

    var box = { background: C.panel, border: "1px solid " + C.line, borderRadius: 8, padding: 10, marginBottom: 8 };
    var btn = { background: "#eef0f3", color: C.text, border: "1px solid " + C.line, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
    var btnAccent = Object.assign({}, btn, { background: C.accent, color: "#ffffff", borderColor: C.accent, fontWeight: 600 });
    var btnBad = Object.assign({}, btn, { color: C.bad, borderColor: "#f0b4b4" });
    var input = { width: "100%", background: "#ffffff", color: C.text, border: "1px solid " + C.line, borderRadius: 6, padding: "6px 8px", fontSize: 12, boxSizing: "border-box" };
    var label = { fontSize: 11, color: C.dim, marginBottom: 3, display: "block" };
    var tag = { display: "inline-block", fontSize: 10, padding: "1px 6px", borderRadius: 999, border: "1px solid " + C.line, color: C.dim, marginRight: 4 };

    function SkillField(props) {
      return h("div", { style: { marginBottom: 8 } },
        h("label", { style: label }, props.title),
        props.multiline
          ? h("textarea", { style: Object.assign({}, input, { minHeight: props.rows ? props.rows * 18 : 90, fontFamily: "ui-monospace, monospace" }), value: props.value, onChange: function (e) { props.onChange(e.target.value); }, placeholder: props.placeholder })
          : h("input", { style: input, value: props.value, onChange: function (e) { props.onChange(e.target.value); }, placeholder: props.placeholder })
      );
    }

    function SkillEditor(props) {
      var s = props.draft;
      var set = props.setDraft;
      function up(k) { return function (v) { var n = Object.assign({}, s); n[k] = v; set(n); }; }
      return h("div", { style: Object.assign({}, box, { borderColor: C.accent }) },
        h("div", { style: { fontWeight: 600, marginBottom: 8 } }, props.isNew ? "新建技能" : ("编辑：" + s.name)),
        h(SkillField, { title: "技能名（小写字母/数字/-/_/.）", value: s.name, onChange: up("name"), placeholder: "my-skill" }),
        h(SkillField, { title: "功能描述（必填，会写进 frontmatter 的 description）", value: s.description, onChange: up("description"), multiline: true, rows: 2 }),
        h(SkillField, { title: "来源（会写进 frontmatter 的 source）", value: s.source, onChange: up("source"), multiline: true, rows: 2, placeholder: "例如：RFC 9110（IETF 公开标准）" }),
        h("div", { style: { display: "flex", gap: 8 } },
          h("div", { style: { flex: 1 } }, h(SkillField, { title: "分类", value: s.category, onChange: up("category"), placeholder: "dev-engineering" })),
          h("div", { style: { flex: 1 } }, h(SkillField, { title: "版本", value: s.version, onChange: up("version"), placeholder: "1.0.0" }))
        ),
        h(SkillField, { title: "正文（SKILL.md 的 markdown 部分）", value: s.body, onChange: up("body"), multiline: true, rows: 10 }),
        h("div", { style: { display: "flex", gap: 8, marginTop: 4 } },
          h("button", { style: btnAccent, onClick: props.onSave, disabled: props.busy }, props.busy ? "保存中…" : "保存并派发"),
          h("button", { style: btn, onClick: props.onCancel }, "取消")
        )
      );
    }

    function SkillDetail(props) {
      var s = props.skill;
      var apps = s.apps.length > 0 ? s.apps : [];
      return h("div", { style: { borderTop: "1px solid " + C.line, marginTop: 8, paddingTop: 8 } },
        h("div", { style: { marginBottom: 6 } },
          h("div", { style: label }, "功能描述"),
          h("div", { style: { fontSize: 12, color: C.text, whiteSpace: "pre-wrap" } }, s.description || "（未填写）")
        ),
        h("div", { style: { marginBottom: 6 } },
          h("div", { style: label }, "来源"),
          h("div", { style: { fontSize: 12, color: C.text, whiteSpace: "pre-wrap" } }, s.source || (s.origin === "third" ? "第三方 · WorkBuddy 安装" : "（未填写）"))
        ),
        h("div", { style: { marginBottom: 6 } },
          h("div", { style: label }, "已派发到"),
          h("div", null, apps.length === 0 ? h("span", { style: { fontSize: 12, color: C.warn } }, "尚未派发到任何 app") : apps.map(function (a) { return h("span", { key: a, style: tag }, a); }))
        ),
        s.missingApps && s.missingApps.length > 0
          ? h("div", { style: { fontSize: 11, color: C.warn, marginBottom: 6 } }, "缺少派发：" + s.missingApps.join("、"))
          : null,
        h("div", { style: { marginBottom: 8 } },
          h("span", { style: tag }, s.category || "未分类"),
          h("span", { style: tag }, s.version ? ("v" + s.version) : "无版本"),
          h("span", { style: tag }, s.origin === "first" ? "第一方（可编辑）" : "第三方（只读）"),
          h("span", { style: tag }, Math.round(s.sizeBytes / 1024 * 10) / 10 + " KB")
        ),
        h("details", null,
          h("summary", { style: { cursor: "pointer", fontSize: 12, color: C.dim } }, "查看完整正文"),
          h("pre", { style: { fontSize: 11, color: C.text, background: "#ffffff", padding: 8, borderRadius: 6, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap" } }, props.raw || "（加载中…）")
        ),
        s.editable
          ? h("div", { style: { display: "flex", gap: 8, marginTop: 8 } },
              h("button", { style: btn, onClick: function () { props.onEdit(s); } }, "编辑"),
              h("button", { style: btnBad, onClick: function () { props.onDelete(s.name); } }, "删除")
            )
          : h("div", { style: { fontSize: 11, color: C.dim, marginTop: 8 } }, "第三方技能为只读；如需修改请先复制成第一方技能。")
      );
    }

    function SkillManager() {
      var d0 = useState(null), data = d0[0], setData = d0[1];
      var q0 = useState(""), query = q0[0], setQuery = q0[1];
      var o0 = useState("all"), origin = o0[0], setOrigin = o0[1];
      var e0 = useState({}), expanded = e0[0], setExpanded = e0[1];
      var r0 = useState({}), raw = r0[0], setRaw = r0[1];
      var d1 = useState(null), draft = d1[0], setDraft = d1[1];
      var b0 = useState(false), busy = b0[0], setBusy = b0[1];
      var m0 = useState(""), msg = m0[0], setMsg = m0[1];

      var reload = useCallback(function () {
        api("/state").then(function (r) { if (r.json && r.json.ok) setData(r.json); });
      }, []);
      useEffect(function () { reload(); }, [reload]);

      function toggle(name) {
        var n = Object.assign({}, expanded);
        n[name] = !n[name];
        setExpanded(n);
        if (n[name] && raw[name] === undefined) {
          api("/read", { name: name }).then(function (r) {
            if (r.json && r.json.ok) { var m = Object.assign({}, raw); m[name] = r.json.skill.raw; setRaw(m); }
          });
        }
      }

      function newDraft() {
        setDraft({ name: "", description: "", source: "", category: "", version: "1.0.0", body: "# 新技能\n\n## 何时使用\n\n## 方法\n" });
      }
      function editDraft(s) {
        api("/read", { name: s.name }).then(function (r) {
          if (!r.json || !r.json.ok) return;
          var f = r.json.skill.fields || {};
          setDraft({ name: s.name, description: f.description || "", source: f.source || "", category: s.category || "", version: f.version || "1.0.0", body: r.json.skill.body || "" });
        });
      }
      function save() {
        if (!draft) return;
        setBusy(true); setMsg("");
        api("/save", draft).then(function (r) {
          setBusy(false);
          if (r.json && r.json.ok) { setMsg("已保存并派发：" + r.json.name); setDraft(null); reload(); }
          else setMsg("保存失败：" + ((r.json && r.json.error) || r.status));
        });
      }
      function remove(name) {
        if (!window.confirm("确认删除技能 " + name + " ？会同时清理所有派发链接。")) return;
        api("/delete", { name: name }).then(function (r) {
          if (r.json && r.json.ok) { setMsg("已删除：" + name); reload(); }
          else setMsg("删除失败：" + ((r.json && r.json.error) || r.status));
        });
      }
      function redeploy() {
        setBusy(true); setMsg("");
        api("/deploy", {}).then(function (r) {
          setBusy(false);
          if (r.json && r.json.ok) { setMsg("已重新派发 " + r.json.count + " 个第一方技能"); reload(); }
          else setMsg("派发失败");
        });
      }

      if (data === null) return h("div", { style: { padding: 16, color: C.dim } }, "加载中…");

      var skills = data.skills.filter(function (s) {
        if (origin !== "all" && s.origin !== origin) return false;
        if (query.length === 0) return true;
        var q = query.toLowerCase();
        return (s.name + " " + s.description + " " + (s.source || "")).toLowerCase().indexOf(q) >= 0;
      });
      var first = skills.filter(function (s) { return s.origin === "first"; });
      var third = skills.filter(function (s) { return s.origin === "third"; });

      function row(s) {
        var open = expanded[s.name] === true;
        return h("div", { key: s.name, style: box },
          h("div", { style: { display: "flex", alignItems: "center", cursor: "pointer", gap: 8 }, onClick: function () { toggle(s.name); } },
            h("span", { style: { color: C.dim, width: 10 } }, open ? "▾" : "▸"),
            h("span", { style: { fontWeight: 600, fontSize: 13, flex: "0 0 auto" } }, s.name),
            h("span", { style: { flex: 1, fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.description || "（无描述）"),
            h("span", { style: { fontSize: 10, color: s.missingApps.length > 0 ? C.warn : C.ok } }, s.apps.length + "/" + (s.origin === "first" ? 6 : 2))
          ),
          open ? h(SkillDetail, { skill: s, raw: raw[s.name], onEdit: editDraft, onDelete: remove }) : null
        );
      }

      return h("div", { style: { padding: 12, color: C.text, fontFamily: "system-ui, sans-serif", fontSize: 13, height: "100%", overflow: "auto" } },
        h("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 } },
          h("div", { style: { fontWeight: 700, fontSize: 15 } }, "共享技能库"),
          h("div", { style: { fontSize: 11, color: C.dim } }, "共 " + data.stats.total + " 个（自建 " + data.stats.first + " · 第三方 " + data.stats.third + "）")
        ),
        h("div", { style: { display: "flex", gap: 6, marginBottom: 8 } },
          h("input", { style: Object.assign({}, input, { flex: 1 }), placeholder: "搜索名称 / 功能描述 / 来源", value: query, onChange: function (e) { setQuery(e.target.value); } }),
          h("button", { style: btnAccent, onClick: newDraft }, "新建"),
          h("button", { style: btn, onClick: redeploy, disabled: busy }, "重新派发"),
          h("button", { style: btn, onClick: reload }, "刷新")
        ),
        h("div", { style: { marginBottom: 8 } },
          ["all", "first", "third"].map(function (k) {
            return h("button", { key: k, style: Object.assign({}, btn, { marginRight: 6 }, origin === k ? { background: C.accent, color: "#ffffff", borderColor: C.accent } : {}), onClick: function () { setOrigin(k); } }, k === "all" ? "全部" : (k === "first" ? "自建" : "第三方"));
          })
        ),
        msg.length > 0 ? h("div", { style: { fontSize: 12, color: C.accent, marginBottom: 8 } }, msg) : null,
        draft !== null ? h(SkillEditor, { draft: draft, setDraft: setDraft, isNew: false, busy: busy, onSave: save, onCancel: function () { setDraft(null); } }) : null,
        first.length > 0 ? h("div", { style: { marginBottom: 4, fontSize: 11, color: C.dim } }, "自建技能（可编辑）· " + first.length) : null,
        first.map(row),
        third.length > 0 ? h("div", { style: { margin: "10px 0 4px", fontSize: 11, color: C.dim } }, "第三方技能（只读）· " + third.length) : null,
        third.map(row),
        skills.length === 0 ? h("div", { style: { color: C.dim, padding: 12 } }, "没有匹配的技能") : null
      );
    }
    //#endregion

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
    ].join("\n");

    function readTab() {
      try {
        var raw = window.localStorage.getItem(TW_STORAGE_KEY);
        if (raw === "team" || raw === "roles" || raw === "skills") return raw;
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

      var body = null;
      if (tab === "team") body = h(AgentTeamPanel, { scope: scope, onOpenRoles: function () { pick("roles"); } });
      else if (tab === "roles") body = h(RoleLibrary, { onTeamChanged: function () { pick("team"); } });
      else body = h(SkillManager);

      return h("div", { className: "tw-root" },
        h("header", { className: "tw-head" },
          h("div", { className: "tw-brand" },
            h("span", { className: "tw-logo" }, "🧑‍🤝‍🧑"),
            h("span", { className: "tw-title" }, "智能体团队")
          ),
          h("div", { className: "tw-tabs", role: "tablist" },
            tabBtn("team", "团队"),
            tabBtn("roles", "角色库"),
            tabBtn("skills", "技能库")
          ),
          sessionId ? h("span", { className: "tw-session" }, "会话 " + sessionId.slice(0, 12)) : null
        ),
        h("div", { className: "tw-body" },
          // 只挂载当前标签：切走后另一块整体卸载，不保留后台定时器/请求。
          body
        )
      );
    }

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
        tag.textContent = CSS + "\n" + TW_CSS + "\n" + PANEL_CSS;
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
          title: "智能体团队 · 技能管理工作台",
          panelTitle: "智能体团队",
          repository: "https://github.com/narkco-kang/dsh-team-workbench",
          description: "一支可分组、可换头像与表情的具名智能体团队：内置 313 个角色可按需加入，默认项目部角色配置；每人一组模型路由按序回退派发，并管理本机共享技能库。",
          layout: { businessSide: "right", businessWidth: 0.52 }
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
