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
    var STYLE_ID = "dsh-team-workbench-css";
    var EMPTY_DEFAULTS = { provider: "", model: "", reasoningEffort: "" };
    var EMOJI_CHOICES = ["🤖", "🧭", "🔍", "🧪", "🛠️", "📊", "✍️", "🎨", "🛡️", "🧠", "📚", "⚙️"];

    // 卡片配色板：给没有自定义颜色的成员自动分配，保证同一成员每次颜色一致。
    var PALETTE = [
      "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04",
      "#16a34a", "#0891b2", "#4f46e5", "#0d9488", "#9333ea", "#b45309"
    ];

    function isHexColor(value) {
      return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
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
      ".ats-spacer{flex:1 1 auto;}",
      ".ats-chip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;padding:1px 5px;border-radius:5px;background:rgba(127,127,127,.16);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".ats-chip.cur{background:rgba(77,107,254,.20);color:inherit;}",
      ".ats-chip.off{opacity:.5;text-decoration:line-through;}",
      ".ats-actions{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap;}",
      ".ats-btn{font:inherit;font-size:11.5px;line-height:1.2;padding:4px 8px;border-radius:6px;border:1px solid var(--dsh-border,rgba(127,127,127,.32));background:transparent;color:inherit;cursor:pointer;}",
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

    //#region 宿主通信
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

    //#region 小组件
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
      // 试跑设置默认折叠：成员一多，每张卡片都常驻一个输入框会让页面很乱。
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
      return h("div", {
        className: "ats-card" + (member.enabled ? "" : " off") + (props.selected ? " sel" : ""),
        style: { borderLeftColor: accent, background: tint(accent, 0.06) }
      },
        h("div", { className: "ats-card-head" },
          h("input", {
            type: "checkbox", checked: props.selected === true, title: "选中以批量操作",
            onChange: function () { props.onSelectToggle(member.id); }
          }),
          h("span", { className: "ats-emoji-badge", style: { background: tint(accent, 0.20) } }, member.emoji || "🤖"),
          h("span", { className: "ats-name" }, member.name),
          h("span", { className: "ats-role" }, member.role),
          h("span", { className: "ats-spacer" })
        ),
        h("div", { className: "ats-row", style: { marginTop: "4px", flexWrap: "wrap" } },
          h("span", { className: "ats-chip" + (current ? " cur" : "") }, "当前 " + currentLabel),
          h("span", { className: "ats-role" }, "共 " + String(routes.length) + " 条模型路由"),
          member.enabled ? null : h("span", { className: "ats-tag" }, "成员已停用")
        ),

        // 模型路由列表（增删改查）
        h("div", { className: "ats-routes" },
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
        ),

        // 成员编辑表单
        editing
          ? h("div", { className: "ats-form" },
              h("div", { className: "ats-grid2" },
                h(Field, { label: "名称", value: draft.name, onChange: function (v) { patchMember({ name: v }); } }),
                h(Field, { label: "职责", value: draft.role, onChange: function (v) { patchMember({ role: v }); } })
              ),
              h("div", { className: "ats-field" },
                h("span", { className: "ats-label" }, "图标"),
                h("div", { className: "ats-emoji-pick" },
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
                    style: { width: "32px", height: "24px", padding: "0", border: "1px solid #dcdfe4", borderRadius: "7px", background: "transparent", cursor: "pointer" }
                  }),
                  h("button", {
                    className: "ats-btn tiny", type: "button", title: "清除自定义颜色，回到自动配色",
                    onClick: function () { patchMember({ color: "" }); }
                  }, "自动")
                )
              ),
              h(Field, {
                label: "角色提示词（写入该成员的 persona）", value: draft.instructions, multiline: true, rows: 4,
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
          : h("div", { className: "ats-actions" },
              h("button", { className: "ats-btn", type: "button", onClick: function () { setEditing(true); } }, "编辑"),
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
              }, probing ? "检测中…" : "测试连接")
            ),

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
    //#endregion

    //#region 主面板
    function AgentTeamPanel(props) {
      var scope = props.scope || {};
      var sessionId = resolveSessionId(scope);

      var state = useState({ loading: true, error: "", members: [], catalog: [], defaults: EMPTY_DEFAULTS, effortOptions: [], limits: null, storePath: "", pluginVersion: "" });
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
      var countState = useState("");
      var countInput = countState[0];
      var setCountInput = countState[1];

      var load = useCallback(function () {
        setSnap(function (prev) { return Object.assign({}, prev, { loading: true, error: "" }); });
        fetchState().then(function (data) {
          setSnap({
            loading: false,
            error: data.catalogError ? String(data.catalogError) : "",
            members: Array.isArray(data.members) ? data.members : [],
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

      /** 统一的变更入口：置忙、发请求、套用新状态、提示。 */
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
        mutate("save", { action: "upsert", member: { name: "", role: "通用助手", emoji: "🤖", routes: (defaultTemplate().routes) } }, "已新建智能体，请为它配置模型。");
      };
      var batchCreate = function (n) {
        mutate("save", { action: "batch-create", count: n, template: defaultTemplate() }, function (data) { return "已批量新建，当前 " + String(data.members.length) + " 名成员。"; });
      };
      var setCount = function (n) {
        if (!Number.isSafeInteger(n) || n < 0) { setBanner("数量必须是 ≥0 的整数"); return; }
        mutate("save", { action: "set-count", count: n, template: defaultTemplate() }, function (data) { return "团队数量已设为 " + String(data.members.length) + "。"; });
      };
      var deleteSelected = function () {
        var ids = Object.keys(selected).filter(function (id) { return selected[id] === true; });
        if (ids.length === 0) { setBanner("请先勾选要删除的智能体"); return; }
        if (!window.confirm("删除选中的 " + String(ids.length) + " 名智能体？")) return;
        mutate("save", { action: "delete-many", ids: ids }, function () { return "已删除 " + String(ids.length) + " 名成员。"; }, function () { setSelected({}); });
      };

      var selectAllVisible = function (visible) {
        var next = Object.assign({}, selected);
        var allOn = visible.length > 0 && visible.every(function (m) { return next[m.id] === true; });
        visible.forEach(function (m) { if (allOn) delete next[m.id]; else next[m.id] = true; });
        setSelected(next);
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
      var needle = query.trim().toLowerCase();
      var visible = needle.length === 0 ? members : members.filter(function (m) {
        var hay = [m.name, m.role, m.emoji].concat((m.routes || []).map(function (r) { return r.provider + "/" + r.model + " " + r.label; })).join(" ").toLowerCase();
        return hay.indexOf(needle) >= 0;
      });
      var bound = members.filter(function (m) { return (m.routes || []).length > 0; }).length;
      var routeTotal = members.reduce(function (n, m) { return n + (m.routes || []).length; }, 0);
      var selectedCount = Object.keys(selected).filter(function (id) { return selected[id] === true; }).length;
      var maxMembers = snap.limits ? snap.limits.maxMembers : 48;

      return h("div", { className: "ats-root" },
        h("div", { className: "ats-head" },
          h("span", { className: "ats-title" }, "智能体团队工作台"),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "save", onClick: load }, "刷新"),
          h("button", { className: "ats-btn primary", type: "button", disabled: busy === "save", onClick: createOne }, "＋ 新建")
        ),
        h("div", { className: "ats-sub" },
          String(members.length) + " 名成员 · " + String(routeTotal) + " 条模型路由 · " + String(bound) + " 名已配置模型"
          + (snap.pluginVersion ? " · v" + snap.pluginVersion : "")
        ),

        // 数量增删改查
        h("div", { className: "ats-bar" },
          h("span", { className: "ats-label" }, "数量"),
          h("button", { className: "ats-btn tiny", type: "button", disabled: busy === "save" || members.length === 0, onClick: function () { setCount(members.length - 1); } }, "−1"),
          h("input", {
            className: "ats-input ats-num", type: "text", value: countInput,
            placeholder: String(members.length), title: "输入目标数量后点「设定」",
            onChange: function (e) { setCountInput(e.target.value.replace(/[^0-9]/g, "")); }
          }),
          h("button", { className: "ats-btn tiny", type: "button", disabled: busy === "save" || members.length >= maxMembers, onClick: function () { setCount(members.length + 1); } }, "＋1"),
          h("button", { className: "ats-btn tiny", type: "button", disabled: busy === "save" || members.length + 5 > maxMembers, onClick: function () { batchCreate(5); } }, "＋5"),
          h("button", {
            className: "ats-btn tiny primary", type: "button",
            disabled: busy === "save" || countInput.length === 0,
            onClick: function () { setCount(Number(countInput)); setCountInput(""); }
          }, "设定数量"),
          h("span", { className: "ats-spacer" })
        ),

        // 搜索 + 批量选择
        h("div", { className: "ats-bar" },
          h("input", {
            className: "ats-input ats-search", type: "text", value: query, placeholder: "搜索名称 / 职责 / 模型…",
            onChange: function (e) { setQuery(e.target.value); }
          }),
          h("button", { className: "ats-btn tiny", type: "button", onClick: function () { selectAllVisible(visible); } }, "全选"),
          h("button", {
            className: "ats-btn tiny danger", type: "button", disabled: selectedCount === 0 || busy === "save",
            onClick: deleteSelected
          }, "删除选中" + (selectedCount > 0 ? "(" + String(selectedCount) + ")" : ""))
        ),

        banner ? h("div", { className: "ats-sub", style: { color: "#dc2626" } }, banner) : null,
        snap.error ? h("div", { className: "ats-sub", style: { color: "#dc2626" } }, snap.error) : null,

        h("div", { className: "ats-list" },
          snap.loading
            ? h("div", { className: "ats-empty" }, "正在读取团队配置…")
            : visible.length === 0
              ? h("div", { className: "ats-empty" },
                  members.length === 0 ? "还没有智能体。" : "没有匹配「" + query + "」的智能体。",
                  members.length === 0 ? h("br") : null,
                  members.length === 0 ? "点右上角「＋ 新建」，或用「＋5 / 设定数量」批量创建。" : null
                )
              : visible.map(function (member) {
                  return h(MemberCard, {
                    key: member.id,
                    member: member,
                    // 用完整列表里的下标决定自动配色，搜索/筛选时颜色不会跳。
                    colorIndex: members.indexOf(member),
                    catalog: snap.catalog,
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
                    onRouteSave: function (m, route, done) { mutate("save", { action: "route-upsert", memberId: m.id, route: route }, "已保存模型路由。", done); },
                    onRouteDelete: function (m, route) {
                      if (!window.confirm("删除「" + m.name + "」的模型路由 " + (route.provider + "/" + route.model) + "？")) return;
                      mutate("save", { action: "route-delete", memberId: m.id, routeId: route.id }, "已删除模型路由。");
                    },
                    onRouteToggle: function (m, route) { mutate("save", { action: "route-upsert", memberId: m.id, route: { id: route.id, enabled: route.enabled === false } }, route.enabled ? "已停用该路由。" : "已启用该路由。"); },
                    onRouteActivate: function (m, route) { mutate("save", { action: "route-activate", memberId: m.id, routeId: route.id }, "已切换当前模型。"); }
                  });
                })
        ),
        h("div", { className: "ats-foot" },
          "dsh-team-workbench" + (snap.pluginVersion ? " v" + snap.pluginVersion : "") +
          (snap.storePath ? " · 配置：" + snap.storePath : "")
        )
      );
    }

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
        tag.textContent = CSS + "\n" + TW_CSS;
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
