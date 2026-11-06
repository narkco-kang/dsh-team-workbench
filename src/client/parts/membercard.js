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
        className: "ats-card" + (member.enabled ? "" : " off") + (props.selected ? " sel" : ""),
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
