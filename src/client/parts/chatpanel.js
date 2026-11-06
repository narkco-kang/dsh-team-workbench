    function ChatPanel(props) {
      var scope = props.scope || {};
      var sessionId = resolveSessionId(scope);
      var initial = typeof props.initialMember === "string" ? props.initialMember : "";

      var dataState = useState({ loading: true, error: "", private: [], rooms: [] });
      var data = dataState[0];
      var setData = dataState[1];
      var targetState = useState(initial.length > 0 ? { kind: "private", id: initial } : null);
      var target = targetState[0];
      var setTarget = targetState[1];
      var messagesState = useState([]);
      var messages = messagesState[0];
      var setMessages = messagesState[1];
      var textState = useState("");
      var draft = textState[0];
      var setDraft = textState[1];
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var bannerState = useState("");
      var banner = bannerState[0];
      var setBanner = bannerState[1];
      var formState = useState(null);
      var form = formState[0];
      var setForm = formState[1];

      var loadOverview = useCallback(function () {
        fetchChats().then(function (payload) {
          setData({ loading: false, error: "", private: payload.private || [], rooms: payload.rooms || [] });
        }).catch(function (error) {
          setData(function (prev) { return Object.assign({}, prev, { loading: false, error: String(error && error.message ? error.message : error) }); });
        });
      }, []);

      useEffect(function () { loadOverview(); }, [loadOverview]);

      useEffect(function () {
        if (target === null) { setMessages([]); return; }
        var url = target.kind === "private" ? "/api/team-workbench/chats/private?memberId=" + encodeURIComponent(target.id) : "/api/team-workbench/chats/group?id=" + encodeURIComponent(target.id);
        fetch(url, { cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
          if (payload && payload.ok === false) throw new Error(payload.error || "读取会话失败");
          setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        }).catch(function (error) {
          setBanner(String(error && error.message ? error.message : error));
        });
      }, [target]);

      var pickPrivate = function (memberId) { setTarget({ kind: "private", id: memberId }); };
      var pickRoom = function (roomId) { setTarget({ kind: "group", id: roomId }); };

      var send = function () {
        var body = draft.trim();
        if (body.length === 0 || target === null || busy) return;
        setBusy(true);
        setBanner("");
        var path = target.kind === "private" ? "/api/team-workbench/chats/private" : "/api/team-workbench/chats/group";
        var payload = target.kind === "private"
          ? { sessionId: sessionId, memberId: target.id, text: body }
          : { sessionId: sessionId, id: target.id, text: body };
        fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
          .then(function (res) { return res.json().then(function (json) { if (!res.ok || json.ok === false) throw new Error(json.error || ("发送失败 HTTP " + res.status)); return json; }); })
          .then(function (json) {
            setMessages(Array.isArray(json.messages) ? json.messages : []);
            setDraft("");
            loadOverview();
          })
          .catch(function (error) { setBanner(String(error && error.message ? error.message : error)); })
          .then(function () { setBusy(false); });
      };

      var openForm = function () {
        var members = data.private || [];
        setForm({ name: "", adminId: members[0] ? members[0].memberId : "", memberIds: members.slice(0, 3).map(function (m) { return m.memberId; }), responder: "lead", relayDepth: 1 });
      };
      var submitForm = function () {
        if (form === null) return;
        if (form.name.trim().length === 0) { setBanner("群聊名称不能为空"); return; }
        if (form.memberIds.length < 2) { setBanner("至少选择 2 名成员"); return; }
        setBusy(true);
        postChatRoom({ action: "create", room: form }).then(function (payload) {
          setForm(null);
          setData(function (prev) { return Object.assign({}, prev, { rooms: payload.rooms || prev.rooms }); });
          var created = (payload.rooms || [])[payload.rooms.length - 1];
          if (created) pickRoom(created.id);
          setBusy(false);
        }).catch(function (error) {
          setBanner(String(error && error.message ? error.message : error));
          setBusy(false);
        });
      };
      var removeRoom = function (roomId) {
        if (!window.confirm("删除这个群聊？聊天记录会一起删除。")) return;
        postChatRoom({ action: "delete", id: roomId }).then(function (payload) {
          setTarget(null);
          setMessages([]);
          setData(function (prev) { return Object.assign({}, prev, { rooms: payload.rooms || [] }); });
        }).catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
      };

      var members = data.private || [];
      var rooms = data.rooms || [];
      var currentMember = target !== null && target.kind === "private" ? members.filter(function (m) { return m.memberId === target.id; })[0] : null;
      var currentRoom = target !== null && target.kind === "group" ? rooms.filter(function (r) { return r.id === target.id; })[0] : null;
      var title = currentMember ? currentMember.name : currentRoom ? currentRoom.name : "";
      var responderLabel = currentRoom ? (currentRoom.responder === "auto" ? "自动挑人" : currentRoom.responder === "mention" ? "只回应 @" : "管理员先答") : "";
      var relayDepth = currentRoom && typeof currentRoom.relayDepth === "number" ? currentRoom.relayDepth : 1;
      var subtitle = currentRoom ? (currentRoom.adminName ? "管理员 " + currentRoom.adminName + " · " : "") + String(currentRoom.memberIds.length) + " 名成员 · " + responderLabel + " · 接力 " + String(relayDepth) + " 层" : "";

      var memberRow = function (m) {
        var on = target !== null && target.kind === "private" && target.id === m.memberId;
        return h("button", {
          key: m.memberId, type: "button", className: "ats-im-row" + (on ? " on" : ""),
          onClick: function () { pickPrivate(m.memberId); }
        },
          h(Avatar, { member: { id: m.memberId, name: m.name, emoji: m.emoji, color: m.color, enabled: true }, accent: colorOf(m, members.indexOf(m)), size: 32 }),
          h("span", { className: "ats-im-meta" },
            h("span", { className: "ats-im-name" }, m.name),
            h("span", { className: "ats-im-preview" }, m.count > 0 ? (m.lastText || "…") : "还没有对话")
          )
        );
      };
      var roomRow = function (room) {
        var on = target !== null && target.kind === "group" && target.id === room.id;
        return h("button", {
          key: room.id, type: "button", className: "ats-im-row" + (on ? " on" : ""),
          onClick: function () { pickRoom(room.id); }
        },
          h("span", { className: "ats-im-group-avatar" }, "👥"),
          h("span", { className: "ats-im-meta" },
            h("span", { className: "ats-im-name" }, room.name),
            h("span", { className: "ats-im-preview" }, room.count > 0 ? (room.lastText || "…") : "还没有发言")
          )
        );
      };

      return h("div", { className: "ats-root ats-im" },
        h("div", { className: "ats-im-side" },
          h("div", { className: "ats-im-hero" },
            h("span", { className: "ats-im-logo" }, "🧑‍🤝‍🧑"),
            h("div", { className: "ats-im-hero-text" },
              h("div", { className: "ats-im-hero-name" }, "智能体团队"),
              h("div", { className: "ats-im-hero-sub" }, String(members.length) + " 名成员 · " + String(rooms.length) + " 个群")
            )
          ),
          h("div", { className: "ats-im-section" }, "群聊"),
          rooms.map(roomRow),
          h("button", { className: "ats-im-add", type: "button", onClick: openForm }, "＋ 建群"),
          h("div", { className: "ats-im-section" }, "私聊"),
          members.map(memberRow)
        ),
        h("div", { className: "ats-im-main" },
          target === null
            ? h("div", { className: "ats-empty" }, "从左侧选一个成员或群聊开始")
            : h("div", { className: "ats-im-head" },
                currentRoom
                  ? h("span", { className: "ats-im-group-avatar" }, "👥")
                  : h(Avatar, { member: { id: currentMember.memberId, name: currentMember.name, emoji: currentMember.emoji, color: currentMember.color, enabled: true }, accent: colorOf(currentMember, members.indexOf(currentMember)), size: 34 }),
                h("div", { className: "ats-im-head-text" },
                  h("div", { className: "ats-im-title" }, title),
                  h("div", { className: "ats-im-sub" }, subtitle || (currentMember ? (currentMember.count > 0 ? currentMember.lastText : "私聊") : ""))
                ),
                h("span", { className: "ats-spacer" }),
                h("button", { className: "ats-btn tiny", type: "button", onClick: function () { if (props.onOpenSettings) props.onOpenSettings(); } }, "设置"),
                currentRoom ? h("button", { className: "ats-btn tiny danger", type: "button", onClick: function () { removeRoom(currentRoom.id); } }, "删除群") : null
              ),
          target === null ? null : h("div", {
            className: "ats-chat-log",
            ref: function (el) { if (el !== null) el.scrollTop = el.scrollHeight; }
          },
            messages.length === 0
              ? h("div", { className: "ats-empty" }, currentRoom ? "群已建好，说点什么让成员接话" : "打个招呼开始对话")
              : messages.map(function (m) {
                  if (m.role === "user") return h("div", { key: m.id, className: "ats-bubble user" }, h("div", { className: "ats-bubble-text" }, m.text));
                  var accent = colorOf(m, 0);
                  return h("div", { key: m.id, className: "ats-bubble agent" },
                    h(Mascot, { member: { id: m.memberId, name: m.name, emoji: m.emoji }, accent: accent, size: 26 }),
                    h("div", { className: "ats-bubble-body" },
                      h("div", { className: "ats-bubble-name" }, m.name),
                      h("div", { className: "ats-bubble-text" }, m.text)
                    )
                  );
                })
          ),
          target === null ? null : h("div", { className: "ats-compose" },
            h("button", { className: "ats-btn", type: "button", title: "新建群聊", onClick: openForm }, "＋"),
            h("textarea", {
              className: "ats-area", rows: 2, value: draft,
              placeholder: currentRoom ? "在群里发言；@成员名 可直接点名（Enter 发送）" : "发消息给 " + title + "（Enter 发送，Shift+Enter 换行）",
              disabled: busy,
              onChange: function (e) { setDraft(e.target.value); },
              onKeyDown: function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
            }),
            h("button", { className: "ats-btn primary", type: "button", disabled: busy || draft.trim().length === 0, onClick: send }, busy ? "等待回复…" : "发送")
          )
        ),
        form !== null
          ? h("div", { className: "ats-im-form" },
              h("div", { className: "ats-preset-title" }, "新建群聊"),
              h("div", { className: "ats-bar", style: { padding: "6px 0", border: "0" } },
                h("input", { className: "ats-input", style: { flex: "1 1 120px" }, value: form.name, placeholder: "群名称，例如：项目例会", onChange: function (e) { setForm(Object.assign({}, form, { name: e.target.value })); } }),
                h("select", { className: "ats-select", style: { flex: "0 0 140px" }, value: form.adminId, onChange: function (e) { setForm(Object.assign({}, form, { adminId: e.target.value })); } },
                  [{ value: "", label: "管理员（默认首位）" }].concat(members.map(function (m) { return { value: m.memberId, label: "管理员：" + m.name }; })).map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })
                ),
                h("select", { className: "ats-select", style: { flex: "0 0 120px" }, value: form.responder || "lead", onChange: function (e) { setForm(Object.assign({}, form, { responder: e.target.value })); } },
                  [{ value: "lead", label: "应答：管理员" }, { value: "auto", label: "应答：自动挑人" }, { value: "mention", label: "应答：只回应 @" }].map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })
                ),
                h("select", { className: "ats-select", style: { flex: "0 0 110px" }, value: String(form.relayDepth === undefined ? 1 : form.relayDepth), onChange: function (e) { setForm(Object.assign({}, form, { relayDepth: Number(e.target.value) })); } },
                  [{ value: "0", label: "接力：不转发" }, { value: "1", label: "接力：1 层" }, { value: "2", label: "接力：2 层" }].map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })
                )
              ),
              h("div", { className: "ats-check-list" },
                members.map(function (m) {
                  var checked = form.memberIds.indexOf(m.memberId) >= 0;
                  return h("label", { key: m.memberId, className: "ats-check" },
                    h("input", {
                      type: "checkbox", checked: checked,
                      onChange: function () {
                        var next = form.memberIds.slice();
                        var at = next.indexOf(m.memberId);
                        if (at >= 0) next.splice(at, 1); else next.push(m.memberId);
                        setForm(Object.assign({}, form, { memberIds: next }));
                      }
                    }),
                    m.emoji + " " + m.name
                  );
                })
              ),
              h("div", { className: "ats-actions" },
                h("button", { className: "ats-btn primary", type: "button", disabled: busy, onClick: submitForm }, "创建群聊"),
                h("button", { className: "ats-btn", type: "button", onClick: function () { setForm(null); } }, "取消")
              )
            )
          : null,
        banner ? h("div", { className: "ats-im-banner" }, banner) : null
      );
    }
