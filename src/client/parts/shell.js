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
