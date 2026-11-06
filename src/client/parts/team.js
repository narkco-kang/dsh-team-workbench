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
