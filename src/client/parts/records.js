    //#region 会话记录检索
    function RecordSearch(props) {
      var queryState = useState("");
      var query = queryState[0];
      var setQuery = queryState[1];
      var kindState = useState("");
      var kind = kindState[0];
      var setKind = kindState[1];
      var resultState = useState({ loading: false, error: "", hits: [], total: 0, searched: false });
      var result = resultState[0];
      var setResult = resultState[1];

      var run = function (nextQuery, nextKind) {
        var text = (nextQuery === undefined ? query : nextQuery).trim();
        if (text.length === 0) return;
        setResult(function (prev) { return Object.assign({}, prev, { loading: true, error: "", searched: true }); });
        fetchChatSearch(text, nextKind === undefined ? kind : nextKind, "").then(function (payload) {
          setResult({ loading: false, error: "", hits: payload.hits || [], total: payload.total || 0, searched: true });
        }).catch(function (error) {
          setResult({ loading: false, error: String(error && error.message ? error.message : error), hits: [], total: 0, searched: true });
        });
      };

      var pickKind = function (next) {
        setKind(next);
        if (result.searched && query.trim().length > 0) run(query, next);
      };

      var formatTime = function (value) {
        if (typeof value !== "string" || value.length === 0) return "";
        var date = new Date(value);
        if (isNaN(date.getTime())) return value;
        return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      };

      return h("div", { className: "ats-root" },
        h("div", { className: "ats-hero" },
          h("div", { style: { minWidth: 0 } },
            h("div", { className: "ats-hero-title" }, "会话记录"),
            h("div", { className: "ats-hero-sub" }, "检索私聊与群聊的历史消息；点一条结果回到那段对话")
          )
        ),
        h("div", { className: "ats-bar" },
          h("input", {
            className: "ats-input ats-search", type: "text", value: query, placeholder: "搜索聊天内容，例如：验收 或 两天",
            onChange: function (e) { setQuery(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter") run(); }
          }),
          h("button", { className: "ats-btn tiny primary", type: "button", disabled: result.loading || query.trim().length === 0, onClick: function () { run(); } }, result.loading ? "搜索中…" : "搜索"),
          h("button", { className: "ats-btn tiny" + (kind === "" ? " primary" : ""), type: "button", onClick: function () { pickKind(""); } }, "全部"),
          h("button", { className: "ats-btn tiny" + (kind === "private" ? " primary" : ""), type: "button", onClick: function () { pickKind("private"); } }, "私聊"),
          h("button", { className: "ats-btn tiny" + (kind === "group" ? " primary" : ""), type: "button", onClick: function () { pickKind("group"); } }, "群聊")
        ),
        result.error ? h("div", { className: "ats-sub", style: { color: "#dc2626" } }, result.error) : null,
        h("div", { className: "ats-list" },
          !result.searched
            ? h("div", { className: "ats-empty" }, "输入关键词，搜索所有私聊与群聊记录")
            : result.loading
              ? h("div", { className: "ats-empty" }, "正在检索…")
              : result.hits.length === 0
                ? h("div", { className: "ats-empty" }, "没有找到包含「" + query.trim() + "」的消息")
                : h("div", { className: "ats-search-results" },
                    h("div", { className: "ats-sub", style: { padding: "4px 2px 8px" } }, "共 " + String(result.total) + " 条，显示前 " + String(result.hits.length) + " 条"),
                    result.hits.map(function (hit) {
                      return h("button", {
                        key: hit.id, type: "button", className: "ats-hit",
                        onClick: function () { if (props.onOpen) props.onOpen(hit.kind, hit.conversationId); }
                      },
                        h("span", { className: "ats-hit-kind" + (hit.kind === "group" ? " group" : "") }, hit.kind === "group" ? "群" : "私"),
                        h("span", { className: "ats-hit-meta" },
                          h("span", { className: "ats-hit-head" },
                            h("span", { className: "ats-hit-name" }, hit.conversationName),
                            h("span", { className: "ats-hit-who" }, hit.role === "user" ? "我" : hit.memberName),
                            h("span", { className: "ats-hit-time" }, formatTime(hit.time))
                          ),
                          h("span", { className: "ats-hit-text" }, hit.text)
                        )
                      );
                    })
                  )
        )
      );
    }
    //#endregion

