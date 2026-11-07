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
      ".ats-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:28px 16px;text-align:center;line-height:1.6;color:var(--bt-ink-2);}",
      ".ats-dep-subs{display:flex;flex-direction:column;gap:5px;max-height:240px;overflow:auto;}",
      ".ats-dep-sub{display:flex;align-items:center;gap:6px;padding:3px 6px;border:1px solid var(--bt-line);border-radius:8px;}",
      ".ats-dep-sub-name{font-size:12px;white-space:nowrap;}",
      ".ats-dep-sub-role{flex:1 1 auto;min-width:0;font-size:11px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".ats-lib{margin:6px 0 2px;padding:8px;border:1px solid var(--bt-line);border-radius:10px;background:var(--bt-hover);}",
      ".ats-lib-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;}",
      ".ats-lib-title{flex:1 1 auto;font-size:12px;font-weight:500;}",
      ".ats-lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;max-height:220px;overflow:auto;}",
      ".ats-lib-cell{position:relative;}",
      ".ats-lib-pick{width:100%;aspect-ratio:1;padding:0;border:1px solid var(--bt-line);border-radius:8px;overflow:hidden;background:#fff;cursor:pointer;}",
      ".ats-lib-pick img{width:100%;height:100%;object-fit:cover;display:block;}",
      ".ats-lib-pick:hover{outline:2px solid var(--bt-accent);outline-offset:1px;}",
      ".ats-lib-del{position:absolute;top:2px;right:2px;width:18px;height:18px;line-height:1;padding:0;border:0;border-radius:50%;background:rgba(17,24,39,.7);color:#fff;font-size:11px;cursor:pointer;}",
      ".ats-hit-mark{background:#fde68a;color:#111827;border-radius:3px;padding:0 2px;box-shadow:inset 0 -1px 0 rgba(180,120,0,.25);}",
      ".ats-hit-group{display:flex;flex-direction:column;gap:6px;margin-bottom:10px;}",
      ".ats-hit-day{display:flex;align-items:center;gap:6px;font-size:11.5px;line-height:18px;color:var(--bt-ink-2);padding:2px 2px 0;position:sticky;top:0;background:linear-gradient(180deg,var(--bt-bg,#fff) 70%,transparent);z-index:2;}",
      ".ats-hit-day-dot{width:6px;height:6px;border-radius:50%;background:var(--bt-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--bt-accent) 22%,transparent);}",
      ".ats-hit-day-count{opacity:.6;font-size:11px;}",
      ".ats-empty-icon{font-size:34px;line-height:1;opacity:.9;filter:drop-shadow(0 3px 6px rgba(15,23,42,.18));}",
      ".ats-empty-title{font-size:13px;font-weight:500;color:var(--bt-ink);}",
      ".ats-empty-hint{font-size:11.5px;opacity:.7;max-width:280px;}",
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

    // DS-Bot 左侧栏原样搬过来（ds-bot/src/client/styles.js 的 SHELL_CSS）：
    // 变量、.bt-side、.bt-side-top、.bt-brand、.bt-round、.bt-list、.bt-row 及状态。
    var BT_CSS = [
      ".dta-shell,.ats-root{--bt-ink:#141414;--bt-danger:#e02135;--bt-ink-2:rgba(20,20,20,.6);--bt-ink-3:rgba(20,20,20,.36);--bt-bubble:#eeeeee;--bt-sidebar:#f7f7f7;--bt-main:#fcfcfc;--bt-line:rgba(20,20,20,.08);--bt-line-2:rgba(20,20,20,.15);--bt-line-weak:rgba(20,20,20,.1);--bt-hover:rgba(119,119,119,.09);--bt-active:rgba(119,119,119,.17);--bt-card:#ffffff;--bt-accent:#4d6bfe;--bt-green:#00c972;--bt-star:#ff9800;--bt-user:#070707;--bt-user-ink:#fcfcfc;--bt-tag-bg:rgba(20,20,20,.06);--bt-tag-ink:rgba(20,20,20,.56);--bt-font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif);}",
      ".bt-side{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;gap:2px;padding:0 12px 8px 0;color:var(--bt-ink);font-family:var(--bt-font)}",
      ".bt-side-top{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:6px 5px 0 0}",
      ".bt-brand{display:inline-flex;align-items:center;gap:6px;margin-right:auto;padding:4px 8px 4px 4px;border:0;border-radius:8px;background:none;cursor:pointer;font-family:inherit;font-size:15px;line-height:20px;font-weight:600;letter-spacing:-.01em;color:var(--bt-ink);white-space:nowrap}",
      ".bt-brand-whale{display:inline-flex;color:var(--bt-accent)}",
      ".bt-round{width:36px;height:36px;border-radius:50%;border:1px solid var(--bt-line);background:var(--bt-main);color:var(--bt-ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:background-color .12s ease,transform .12s ease}",
      ".bt-round:hover{background:var(--bt-hover)}",
      ".bt-round:active{transform:scale(.94)}",
      ".bt-list{display:flex;flex-direction:column;gap:3px;overflow-y:auto;min-height:0;flex:1 1 auto}",
      ".bt-side:not(.bt-rail)>.bt-list{margin-right:-12px;scrollbar-gutter:stable;scrollbar-width:auto;scrollbar-color:auto}",
      ".bt-side:not(.bt-rail)>.bt-list::-webkit-scrollbar{width:12px}",
      ".bt-side:not(.bt-rail)>.bt-list::-webkit-scrollbar-track{background:transparent}",
      ".bt-side:not(.bt-rail)>.bt-list::-webkit-scrollbar-thumb{border:4px solid transparent;border-radius:6px;background:color-mix(in srgb,var(--bt-ink) 16%,transparent) padding-box}",
      ".bt-side:not(.bt-rail)>.bt-list:hover::-webkit-scrollbar-thumb{background-color:color-mix(in srgb,var(--bt-ink) 30%,transparent)}",
      ".ats-im-main{position:relative;}",
      ".ats-dept-view{position:absolute;inset:0;z-index:6;background:var(--bt-bg,#fff);display:flex;flex-direction:column;padding:12px 14px;overflow:auto;}",
      ".ats-dept-view-head{display:flex;align-items:center;gap:8px;padding:4px 2px 10px;border-bottom:1px solid var(--bt-line);}",
      ".ats-dept-view-title{font-size:15px;font-weight:600;}",
      ".ats-dept-view-sub{font-size:11.5px;opacity:.65;}",
      ".ats-dept-list{display:flex;flex-direction:column;gap:6px;padding:10px 0;}",
      ".ats-dept-item{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--bt-line);border-radius:10px;background:transparent;cursor:pointer;text-align:left;}",
      ".ats-dept-item:hover{background:var(--bt-hover);}",
      ".ats-dept-item-body{display:flex;flex-direction:column;min-width:0;gap:2px;}",
      ".ats-dept-item-name{font-size:13px;font-weight:500;}",
      ".ats-dept-item-text{font-size:11.5px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px;}",
      ".bt-dept-mark{width:54px;height:54px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,.3)),rgba(127,127,127,.12);box-shadow:0 1px 1px rgba(15,23,42,.06),0 2px 5px -1px rgba(15,23,42,.14),inset 0 1px 0 rgba(255,255,255,.9);}",
      ".bt-dept-badge{position:absolute;right:2px;bottom:2px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--bt-accent);color:#fff;font-size:10px;line-height:16px;text-align:center;}",
      ".bt-person-mark{position:relative;}",
      ".bt-dept{margin-top:6px;}",
      ".bt-round.on{background:var(--bt-accent);color:#fff;}",
      ".bt-person.bulk{cursor:pointer;}",
      ".bt-person.picked{outline:2px solid var(--bt-accent);outline-offset:-2px;border-radius:14px;}",
      ".bt-pick{position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;border:1px solid var(--bt-line);background:#fff;color:#fff;font-size:10px;line-height:14px;text-align:center;z-index:2;}",
      ".bt-person.picked .bt-pick{background:var(--bt-accent);color:#fff;border-color:var(--bt-accent);}",
      ".bt-person{position:relative;}",
      ".bt-person.drag-over,.bt-row.drag-over{outline:2px dashed var(--bt-accent);outline-offset:-2px;background:rgba(77,107,254,.08);}",
      ".bt-person[draggable=\"true\"]{cursor:grab;}",
      ".bt-bulkbar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-top:1px solid var(--bt-line);background:var(--bt-bg,#fff);}",
      ".bt-bulk-count{font-size:12px;}",
      ".bt-bulk-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;border:1px solid var(--bt-line);background:transparent;cursor:pointer;}",
      ".bt-bulk-btn.danger{color:#dc2626;border-color:rgba(220,38,38,.4);}",
      ".bt-bulk-btn:disabled{opacity:.5;cursor:default;}",
      ".bt-dept-head{display:flex;align-items:center;gap:6px;padding:4px 6px 2px;font-size:11px;color:var(--bt-ink-2);}",
      ".bt-dept-name{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".bt-dept-count{font-size:10.5px;opacity:.65;}",
      ".ats-merge{margin:6px 0 8px;padding:8px 10px;border:1px solid var(--bt-line);border-radius:10px;background:var(--bt-hover);}",
      ".ats-modal{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:20px;}",
      ".ats-modal-card{width:min(920px,96vw);max-height:86vh;overflow:auto;background:var(--bt-card,#fff);border-radius:14px;box-shadow:0 24px 60px -18px rgba(15,23,42,.5);padding:14px 16px;}",
      ".ats-modal-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;}",
      ".ats-modal-title{font-size:14px;font-weight:600;}",
      ".ats-subs-table{display:flex;flex-direction:column;gap:6px;}",
      ".ats-subs-row{display:flex;align-items:center;gap:6px;}",
      ".ats-merge-head{font-size:12px;opacity:.75;margin-bottom:6px;}",
      ".ats-merge-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;}",
      ".ats-merge-row{display:flex;align-items:center;gap:8px;padding:4px 2px;}",
      ".ats-merge-name{font-size:13px;font-weight:500;}",
      ".ats-dept-block{margin:2px 0 8px;width:100%;}",
      ".ats-dept-check{font-weight:500;}",
      ".ats-dept-head{display:flex;align-items:center;gap:8px;width:100%;}",
      ".ats-dept-toggle{flex:1 1 auto;text-align:left;font:inherit;font-size:12.5px;padding:2px 0;border:0;background:transparent;cursor:pointer;color:inherit;}",
      ".ats-dept-toggle:hover{text-decoration:underline;}",
      ".ats-dept-members{display:flex;flex-wrap:wrap;gap:4px 14px;padding-left:24px;width:100%;}",
      ".bt-people{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:2px 0 4px;}",
      ".bt-person{display:flex;flex-direction:column;align-items:center;gap:4px;padding:7px 4px 6px;border:0;border-radius:14px;background:transparent;cursor:pointer;box-sizing:border-box;width:100%;transition:background-color .12s ease;}",
      ".bt-person:hover{background:var(--bt-hover);}",
      ".bt-person[aria-current=page]{background:var(--bt-active);}",
      ".bt-person-name{max-width:100%;font-family:inherit;font-size:10.5px;line-height:14px;color:var(--bt-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent;border:0;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:3px;}",
      ".bt-person-name:hover{text-decoration:underline;}",
      ".bt-person-mark{width:54px;height:54px;padding:0;border:0;background:transparent;cursor:pointer;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;transition:transform .12s ease;}",
      ".bt-person-mark:hover{transform:scale(1.06);}",
      ".ats-mascot{filter:drop-shadow(0 1.5px 2px rgba(15,23,42,.22));transform:rotate(-3deg);transform-origin:50% 70%;}",
      ".ats-mascot g[filter] > :is(rect,circle,path,ellipse){stroke:rgba(255,255,255,.34);stroke-width:.9;stroke-linejoin:round;}",
      ".ats-mascot .ats-mascot-eyes~*{stroke:none;}",
      ".bt-person-mark:hover .ats-mascot{filter:drop-shadow(0 3px 6px rgba(15,23,42,.32));}",
      ".bt-person-mark:focus-visible,.bt-person-name:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px;}",
      ".bt-row{display:flex;align-items:center;gap:8px;min-height:54px;padding:8px;border:0;border-radius:12px;background:transparent;color:var(--bt-ink);text-align:left;cursor:pointer;width:100%;box-sizing:border-box;font-family:inherit;transition:background-color .12s ease}",
      ".bt-row:hover{background:var(--bt-hover)}",
      ".bt-row[aria-current=page]{background:var(--bt-active)}",
      ".bt-row:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}",
      ".bt-row[aria-current=page] .bt-row-name{font-weight:500}",
      ".bt-row-body{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}",
      ".bt-row-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:14px;line-height:20px;font-weight:400}",
      ".bt-row-title{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".bt-tag.chief{background:color-mix(in srgb,var(--bt-accent) 16%,transparent);color:var(--bt-accent);}",
      ".bt-tag{flex:none;max-width:96px;font-size:12px;line-height:16px;font-weight:400;padding:1px 6px;border-radius:4px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".bt-row-preview{font-size:13px;line-height:18px;color:var(--bt-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".bt-unread{width:8px;height:8px;border-radius:50%;background:var(--bt-accent);flex:none;margin-right:2px;animation:bt-fade .13s cubic-bezier(.22,1,.36,1)}",
      ".bt-mark{display:inline-block;flex:none;position:relative;line-height:0}",
      ".bt-mark svg{width:100%;height:100%;overflow:visible}",
      ".bt-hint{padding:14px;text-align:center;font-size:13px;color:var(--bt-ink-2)}",
      ".bt-leftcol{display:flex;--bt-lc-clear:var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px));background:var(--bt-leftcol-fill,var(--bt-sidebar));border-right:.5px solid var(--bt-line);box-sizing:border-box;color:var(--bt-ink);font-family:var(--bt-font)}",
      ".bt-leftcol>.bt-side{width:100%}",
      "@media (prefers-reduced-motion:reduce){.bt-mark *{animation:none!important;transition:none!important}}"
    ].join("\n");

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
      ".ats-card{scroll-margin-top:10px;}",
      ".ats-card.chief{box-shadow:inset 0 0 0 1.5px var(--bt-accent,#4d6bfe);}",
      ".ats-tag.chief{background:color-mix(in srgb,var(--bt-accent,#4d6bfe) 16%,transparent);color:var(--bt-accent,#4d6bfe);}",
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
      ".dta-shell{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#ffffff;color:#111111;}",
      ".dta-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(127,127,127,.22);flex:0 0 auto;background:#0f1115;color:#e5e7eb;}",
      ".dta-brand{font-size:16px;line-height:1;}",
      ".dta-title{font-size:13px;font-weight:700;}",
      ".dta-spacer{flex:1 1 auto;}",
      ".dta-btn{font:inherit;font-size:11.5px;padding:4px 10px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;cursor:pointer;}",
      ".dta-body{flex:1 1 auto;min-height:0;display:flex;}",
      ".dta-body>.tw-root{flex:1 1 auto;min-width:0;width:100%;}",
      ".dta-launcher{position:fixed;right:16px;bottom:92px;z-index:2147483000;font:inherit;font-size:12px;padding:8px 14px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:var(--dsh-accent,#2563eb);color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);}",
      ".ats-chat-body{display:flex;flex:1 1 auto;min-height:0;}",
      ".ats-search-results{display:flex;flex-direction:column;gap:8px;}",
      ".ats-hit{display:flex;gap:8px;align-items:flex-start;padding:9px 10px;border:1px solid rgba(127,127,127,.18);border-radius:10px;background:rgba(127,127,127,.04);cursor:pointer;font:inherit;color:inherit;text-align:left;}",
      ".ats-hit:hover{background:rgba(37,99,235,.07);}",
      ".ats-hit-kind{flex:0 0 auto;width:22px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;background:rgba(37,99,235,.18);color:var(--dsh-accent,#2563eb);}",
      ".ats-hit-kind.group{background:rgba(124,58,237,.18);color:#7c3aed;}",
      ".ats-hit-meta{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto;}",
      ".ats-hit-head{display:flex;align-items:center;gap:6px;min-width:0;}",
      ".ats-hit-name{font-size:12px;font-weight:600;white-space:nowrap;}",
      ".ats-hit-who{font-size:10.5px;opacity:.6;}",
      ".ats-hit-time{margin-left:auto;font-size:10px;opacity:.5;white-space:nowrap;}",
      ".ats-btn.recording{color:#dc2626;border-color:rgba(220,38,38,.5);}",
      ".ats-hit-text{font-size:11.5px;line-height:1.5;opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}",
      ".ats-im{flex-direction:row;background:var(--bt-main,#fcfcfc);}",
      // 左栏直接使用 DS-Bot 的 .bt-leftcol / .bt-side / .bt-row 规则，见 BT_CSS。
      ".ats-im-appcol{width:280px;flex:0 0 auto;display:flex;min-height:0;background:var(--bt-sidebar);border-right:.5px solid var(--bt-line);padding:8px 12px 8px 12px;box-sizing:border-box;}",
      ".ats-im-appcol>.bt-side{width:100%;padding:0;}",
      ".ats-im-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0;}",
      ".ats-im-head{display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid var(--dsh-border,rgba(127,127,127,.18));}",
      ".ats-im-head-text{min-width:0;}",
      ".ats-im-title{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".ats-im-sub{font-size:10.5px;opacity:.55;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".ats-im-form{position:absolute;left:230px;right:12px;top:56px;z-index:5;padding:10px 12px;border:1px solid rgba(37,99,235,.35);border-radius:12px;background:var(--dsh-surface,#fff);box-shadow:0 10px 30px rgba(0,0,0,.18);}",
      ".ats-im-banner{position:absolute;left:230px;right:12px;bottom:8px;padding:6px 10px;border-radius:8px;background:rgba(220,38,38,.12);color:#dc2626;font-size:11px;}",
      "@media (max-width:720px){.ats-im-appcol{width:200px;}.ats-im-form{left:210px;}}",
      ".ats-chat-list{width:186px;flex:0 0 auto;overflow:auto;border-right:1px solid var(--dsh-border,rgba(127,127,127,.18));padding:6px;display:flex;flex-direction:column;gap:4px;}",
      ".ats-chat-item{display:flex;align-items:center;gap:7px;padding:6px 7px;border-radius:8px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit;}",
      ".ats-chat-item:hover{background:rgba(127,127,127,.10);}",
      ".ats-chat-item.on{background:rgba(37,99,235,.12);border-color:rgba(37,99,235,.35);}",
      ".ats-chat-emoji{width:28px;height:28px;flex:0 0 auto;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:15px;}",
      ".ats-chat-emoji.small{width:24px;height:24px;font-size:13px;border-radius:7px;}",
      ".ats-chat-meta{display:flex;flex-direction:column;min-width:0;gap:1px;}",
      ".ats-chat-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ats-chat-preview{font-size:10.5px;opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ats-chat-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0;}",
      ".ats-chat-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsh-border,rgba(127,127,127,.16));}",
      ".ats-chat-title{font-size:13px;font-weight:600;}",
      ".ats-chat-sub{font-size:10.5px;opacity:.55;}",
      ".ats-chat-log{flex:1 1 auto;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px;}",
      ".ats-bubble{max-width:86%;display:flex;gap:6px;}",
      ".ats-bubble.user{align-self:flex-end;justify-content:flex-end;}",
      ".ats-bubble.agent{align-self:flex-start;}",
      ".ats-bubble-body{display:flex;flex-direction:column;gap:2px;min-width:0;}",
      ".ats-bubble-name{font-size:10.5px;opacity:.6;}",
      ".ats-msgbar{display:flex;align-items:center;gap:2px;margin-top:2px;opacity:.55;transition:opacity .12s ease;}",
      ".ats-bubble:hover .ats-msgbar{opacity:1;}",
      ".ats-msgbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:12px;opacity:.75;}",
      ".ats-msgbtn:hover{background:rgba(127,127,127,.14);opacity:1;}",
      ".ats-msgbtn.on{background:rgba(77,107,254,.16);color:var(--bt-accent);opacity:1;}",
      ".ats-msgmeta{font-size:10.5px;opacity:.6;white-space:nowrap;margin-left:4px;font-variant-numeric:tabular-nums;}",
      ".ats-bubble-text{white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.55;padding:7px 10px;border-radius:10px;background:rgba(127,127,127,.12);}",
      ".ats-bubble.user .ats-bubble-text{background:var(--dsh-accent,#2563eb);color:#fff;}",
      /* 输入框照 DS-Bot / DSH 会话页：居中卡片、max-width 820、圆角 16、
         文本 14/20，底部一行「＋ / 🎤 …… 发送」。 */
      ".ats-compose{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 24px 64px;background:var(--bt-main);}",
      ".ats-mention{position:absolute;left:12px;right:12px;bottom:calc(100% + 6px);z-index:20;display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:12px;border:1px solid var(--bt-line);background:var(--bt-card,#fff);box-shadow:0 16px 32px -12px rgba(15,23,42,.35);max-height:220px;overflow:auto;}",
      ".ats-mention-row{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;cursor:pointer;font:inherit;text-align:left;}",
      ".ats-mention-row.on,.ats-mention-row:hover{background:rgba(77,107,254,.12);}",
      ".ats-mention-name{font-size:12.5px;font-weight:600;}",
      ".ats-mention-role{font-size:11px;opacity:.55;}",
      ".ats-thinking{display:flex;align-items:center;gap:7px;width:100%;max-width:1000px;min-height:22px;margin:0 0 8px;padding:0 2px;font-size:12px;color:var(--bt-ink-3);}",
      ".ats-thinking.on{align-self:flex-start;width:auto;max-width:1000px;padding:3px 10px 3px 6px;border-radius:999px;background:rgba(77,107,254,.10);color:var(--bt-accent);font-size:11.5px;}",
      ".ats-thinking.on{color:var(--bt-ink-2);}",
      ".ats-thinking-dot{width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:var(--bt-accent);animation:btThinkingPulse 1.1s ease-in-out infinite;}",
      "@keyframes btThinkingPulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}",
      ".ats-thinking-sec{opacity:.75;font-variant-numeric:tabular-nums;}",
      ".ats-thinking-hint{opacity:.55;}",
      ".ats-stats{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;max-width:1000px;padding:6px 8px 0;font-size:10.5px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;}",
      ".ats-stats-item{white-space:nowrap;}",
      ".ats-stats-item.muted{opacity:.65;}",
      ".ats-thinking-label{font-size:10.5px;letter-spacing:.04em;padding:1px 6px;border-radius:999px;background:rgba(77,107,254,.12);color:var(--bt-accent);}",
      ".ats-thinking-trail{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;}",
      ".ats-thinking-chip{font-size:10.5px;padding:1px 6px;border-radius:999px;background:rgba(20,20,20,.06);color:var(--bt-ink-2);}",
      ".ats-thinking{min-height:22px;}",
      ".ats-composer{display:flex;flex-direction:column;gap:10px;width:100%;max-width:1000px;box-sizing:border-box;padding:16px 18px 12px;border:1px solid var(--bt-line-2);border-radius:20px;background:var(--bt-card);box-shadow:0 2px 10px -2px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);transition:border-color .12s ease,box-shadow .12s ease;}",
      ".ats-composer:focus-within{border-color:var(--bt-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 14%,transparent),0 2px 10px -2px rgba(0,0,0,.06);}",
      ".ats-composer .ats-area{width:100%;min-height:64px;max-height:280px;overflow-y:auto;resize:none;padding:4px;border:0;border-radius:0;background:transparent;font-size:15px;line-height:22px;color:var(--bt-ink);outline:none;box-shadow:none;}",
      ".ats-composer .ats-area::placeholder{color:var(--bt-ink-3);}",
      ".ats-composer .ats-area:disabled{opacity:.6;}",
      ".ats-composer-bar{display:flex;align-items:center;gap:8px;}",
      ".ats-round{width:38px;height:38px;flex:0 0 auto;border-radius:50%;border:1px solid var(--bt-line);background:transparent;color:var(--bt-ink);font:inherit;font-size:18px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}",
      ".ats-round:hover{background:var(--bt-hover);}",
      ".ats-round.recording{color:#dc2626;border-color:rgba(220,38,38,.5);}",
      ".ats-send{height:38px;padding:0 20px;border-radius:999px;border:0;background:var(--bt-accent);color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;}",
      ".ats-send:hover{filter:brightness(1.05);}",
      ".ats-send:disabled{background:var(--bt-active);color:var(--bt-ink-3);cursor:default;filter:none;}",
      // 3D 按钮：一层顶部高光 + 一层底部暗边 + 两层投影，按下时压回去。
      ".tw-tab,.ats-btn,.bt-round,.ats-round,.ats-send{position:relative;background-image:linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,.28) 52%,rgba(255,255,255,0));box-shadow:0 1px 1px rgba(15,23,42,.06),0 2px 5px -1px rgba(15,23,42,.14),inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(15,23,42,.07);transition:transform .12s ease,box-shadow .12s ease,filter .12s ease,background-color .12s ease;}",
      ".tw-tab:hover,.ats-btn:hover,.bt-round:hover,.ats-round:hover,.ats-send:hover{transform:translateY(-1px);box-shadow:0 2px 3px rgba(15,23,42,.08),0 6px 14px -4px rgba(15,23,42,.22),inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(15,23,42,.06);}",
      ".tw-tab:active,.ats-btn:active,.bt-round:active,.ats-round:active,.ats-send:active{transform:translateY(0) scale(.98);box-shadow:inset 0 2px 5px rgba(15,23,42,.2),inset 0 -1px 0 rgba(255,255,255,.5);}",
      ".tw-tab:disabled,.ats-btn:disabled,.ats-send:disabled{transform:none;box-shadow:none;background-image:none;}",
      ".tw-tab{padding:0 11px;min-width:34px;justify-content:center;}",
      ".tw-tab-icon{font-size:15px;line-height:1;}",
      ".tw-tab-on{box-shadow:0 1px 1px rgba(15,23,42,.08),0 3px 8px -2px rgba(15,23,42,.18),inset 0 1px 0 rgba(255,255,255,.9),inset 0 -2px 0 rgba(15,23,42,.18);}",
      // 图标本体也加一点浮雕感：emoji 有阴影，SVG 有 drop-shadow。
      ".ats-btn svg,.ats-round svg,.bt-round svg{filter:drop-shadow(0 1px 1px rgba(15,23,42,.22));}",
      ".ats-round{text-shadow:0 1px 0 rgba(255,255,255,.75);}",
      ".ats-send{text-shadow:0 1px 1px rgba(15,23,42,.28);}",
      // 输入类控件用内阴影，看起来是“凹”进去的。
      ".ats-input,.ats-select{box-shadow:inset 0 1px 2px rgba(15,23,42,.08),inset 0 -1px 0 rgba(255,255,255,.6);}",
      // 图标按钮的统一提示：悬停 0.55s 后浮现（替代浏览器原生 title，样式跟随主题）。
      "[data-tip]{position:relative;}",
      "[data-tip]::after{content:attr(data-tip);position:absolute;left:50%;top:calc(100% + 8px);transform:translate(-50%,-3px);padding:4px 8px;border-radius:6px;background:rgba(17,24,39,.92);color:#fff;font-size:11px;line-height:1.35;font-weight:400;white-space:nowrap;pointer-events:none;opacity:0;z-index:9000;box-shadow:0 6px 16px -4px rgba(0,0,0,.35);transition:opacity .12s ease .55s,transform .12s ease .55s;}",
      "[data-tip]:hover::after,[data-tip]:focus-visible::after{opacity:1;transform:translate(-50%,0);}",
      "[data-tip-side=top]::after{top:auto;bottom:calc(100% + 8px);transform:translate(-50%,3px);}",
      "[data-tip-side=top]:hover::after,[data-tip-side=top]:focus-visible::after{transform:translate(-50%,0);}",
      ".ats-check-list{display:flex;flex-wrap:wrap;gap:6px 12px;max-height:120px;overflow:auto;margin:6px 0;}",
      ".ats-mascot .ats-mascot-bob{animation:ats-bob 3.8s ease-in-out infinite;transform-origin:50% 60%;}",
      ".ats-mascot.working .ats-mascot-bob{animation-duration:1.1s;}",
      ".ats-mascot .ats-mascot-eyes{transform-box:fill-box;transform-origin:center;animation:ats-blink 5.2s infinite;}",
      ".ats-mascot.sleeping .ats-mascot-eyes{animation:none;transform:scaleY(.12);}",
      ".ats-mascot.working .ats-mascot-eyes{transform:scaleY(.58);}",
      ".ats-mascot.working .ats-mascot-ring{filter:drop-shadow(0 0 5px rgba(251,191,36,.9));animation-duration:1.1s;}",
      ".ats-im-group-stack{display:inline-flex;align-items:center;flex:0 0 auto;min-width:40px;}",
      ".ats-im-head-stack{display:inline-flex;align-items:center;flex:0 0 auto;}",
      ".ats-im-name-line{display:flex;align-items:center;gap:5px;min-width:0;}",
      ".ats-im-role{font-size:9.5px;line-height:14px;padding:0 6px;border-radius:6px;background:rgba(127,127,127,.14);color:inherit;opacity:.72;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;}",
      ".ats-role-chip{display:inline-block;font-size:10px;line-height:15px;padding:0 6px;border-radius:6px;background:rgba(127,127,127,.14);opacity:.8;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ats-im-head-stack .ats-im-stack-cell{margin-left:-10px;}",
      ".ats-im-stack-cell{margin-left:-9px;border:2px solid var(--dsh-bg,#fff);border-radius:50%;background:var(--dsh-bg,#fff);line-height:0;}",
      ".ats-im-stack-cell:first-child{margin-left:0;}",
      ".ats-im-stack-more{font-size:10px;opacity:.65;margin-left:2px;}",
      "@keyframes ats-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.2px)}}",
      "@keyframes ats-blink{0%,92%,100%{transform:scaleY(1)}94%,96%{transform:scaleY(.08)}}",
      "@keyframes ats-poke{0%{transform:scale(1)}30%{transform:scale(.86,1.12)}65%{transform:scale(1.08,.93)}100%{transform:scale(1)}}",
      "@keyframes ats-spin{to{transform:rotate(360deg)}}",
      ".ats-mascot.poked .ats-mascot-bob{animation:ats-poke .5s cubic-bezier(.3,1.6,.4,1);}",
      ".ats-mascot .ats-mascot-ring{transform-box:fill-box;transform-origin:center;animation:ats-spin 1.6s linear infinite;}",
      ".ats-mascot:hover .ats-mascot-bob{animation-duration:1.6s;}",
      "@media (max-width:720px){.ats-grid{grid-template-columns:1fr;}.tw-title{display:none;}}",
    ].join("\n");
    //#region 宿主通信    //#region 宿主通信
    // 统一解析：服务端若返回纯文本（例如 "not found"），不能直接 res.json()，
    // 否则会抛 "Unexpected token 'o', ... is not valid JSON"，用户完全看不懂。
    function readJsonResponse(res) {
      return res.text().then(function (raw) {
        var data = null;
        try { data = raw.length > 0 ? JSON.parse(raw) : null; } catch (error) { data = null; }
        if (data === null) {
          var hint = res.status === 404
            ? "接口不存在（HTTP 404）——插件可能刚更新但 Harness 还没重启，请重启 Harness 后再试。"
            : "服务端返回了非 JSON 内容（HTTP " + res.status + "）。";
          throw new Error(hint + " 原始返回：" + String(raw || "").slice(0, 60));
        }
        return data;
      });
    }
    function unwrap(res) {
      return readJsonResponse(res).then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data && data.error ? data.error : "请求失败（HTTP " + res.status + "）");
        return data;
      });
    }
    function fetchState() {
      return fetch(ROUTE_STATE, { cache: "no-store" }).then(function (res) {
        return readJsonResponse(res).then(function (data) {
          if (!res.ok) throw new Error("状态读取失败（HTTP " + res.status + "）");
          return data;
        });
      });
    }
    function postMembers(body) {
      return fetch(ROUTE_MEMBERS, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
    }
    function postProbe(body) {
      return fetch(ROUTE_PROBE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (res) {
        return readJsonResponse(res).then(function (data) {
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
    /** 会话概览（GET /chats）。 */
    function fetchChats() {
      return fetch("/api/team-workbench/chats", { cache: "no-store" }).then(unwrap);
    }
    /** 群聊增删改（POST /chats/rooms）。 */
    function postChatRoom(body) {
      return fetch("/api/team-workbench/chats/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
    }
    /** 聊天记录检索（GET /chats/search）。 */
    function fetchChatSearch(query, kind, id) {
      var params = "?q=" + encodeURIComponent(query || "") + "&kind=" + encodeURIComponent(kind || "") + "&id=" + encodeURIComponent(id || "");
      return fetch("/api/team-workbench/chats/search" + params, { cache: "no-store" }).then(unwrap);
    }
    /** 会话记忆（GET/POST /memory）。 */
    function fetchMemory(kind, id) {
      return fetch("/api/team-workbench/memory?kind=" + encodeURIComponent(kind) + "&id=" + encodeURIComponent(id), { cache: "no-store" }).then(unwrap);
    }
    /** 查询麦克风权限状态：granted / prompt / denied / unknown。 */
    function checkMicPermission() {
      if (typeof navigator === "undefined" || !navigator.permissions || !navigator.permissions.query) return Promise.resolve("unknown");
      try {
        return navigator.permissions.query({ name: "microphone" }).then(function (status) { return status.state; }).catch(function () { return "unknown"; });
      } catch (error) {
        return Promise.resolve("unknown");
      }
    }
    /** 本地 STT（jianchang512/stt）设置与转写。 */
    function fetchSttSettings(probe) {
      return fetch("/api/team-workbench/stt" + (probe ? "?probe=1" : ""), { cache: "no-store" }).then(unwrap);
    }
    var STT_PRESETS = [
      { id: "local", label: "本地 stt（faster-whisper）", apiBase: "http://127.0.0.1:9977", apiModel: "medium", protocol: "local" },
      { id: "openai", label: "OpenAI Whisper", apiBase: "https://api.openai.com/v1", apiModel: "whisper-1", protocol: "openai" },
      { id: "glm", label: "智谱 GLM-ASR", apiBase: "https://open.bigmodel.cn/api/paas/v4", apiModel: "glm-asr-2512", protocol: "openai" },
      { id: "minimax", label: "MiniMax ASR", apiBase: "https://api.minimax.chat/v1", apiModel: "asr-1.0", protocol: "minimax" },
      { id: "custom", label: "自定义 OpenAI 兼容", apiBase: "", apiModel: "", protocol: "openai" }
    ];
    function postSttSettings(stt) {
      return fetch("/api/team-workbench/stt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "settings", stt: stt }) }).then(unwrap);
    }
    function postSttAudio(blob, durationMs) {
      var query = "?filename=speech.webm" + (durationMs ? "&ms=" + String(Math.round(durationMs)) : "");
      return fetch("/api/team-workbench/stt" + query, {
        method: "POST",
        headers: { "content-type": blob.type || "audio/webm" },
        body: blob,
        signal: AbortSignal.timeout(150000)
      }).then(function (res) {
        var type = String((res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") : "") || "");
        // 路由没注册时宿主会回 404 + HTML；接口异常时是 JSON {ok:false,error}——两种都要能读出原因。
        if (type.indexOf("json") < 0) {
          if (res.status === 404) throw new Error("语音接口未就绪（重启 Harness 后生效）");
          throw new Error("语音接口异常 HTTP " + res.status);
        }
        return readJsonResponse(res).then(function (payload) {
          if (!payload || payload.ok === false) throw new Error((payload && payload.error) || "语音识别失败");
          if (!res.ok) throw new Error("语音接口异常 HTTP " + res.status);
          return payload;
        });
      });
    }
    function fetchMemorySettings() {
      return fetch("/api/team-workbench/memory", { cache: "no-store" }).then(unwrap);
    }
    function searchMemoryServer(q) {
      return fetch("/api/team-workbench/memory?q=" + encodeURIComponent(q), { cache: "no-store" }).then(unwrap);
    }
    function postMemory(body) {
      return fetch("/api/team-workbench/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
    }
    /** 服务商余额（GET /balance）。 */
    function fetchBalances(force) {
      return fetch("/api/team-workbench/balance" + (force ? "?force=1" : ""), { cache: "no-store" }).then(unwrap);
    }
    /** 保存或清除余额查询用的 Key（POST /balance/key）。 */
    function postBalanceKey(id, key) {
      return fetch("/api/team-workbench/balance/key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: id, key: key }) }).then(unwrap);
    }
    /** 本机派发用量（GET /usage）。 */
    function fetchUsage() {
      return fetch("/api/team-workbench/usage", { cache: "no-store" }).then(unwrap);
    }
    /** 把 ISO 时间转成「x 分钟前」。 */
    function agoText(iso) {
      if (typeof iso !== "string" || iso.length === 0) return "";
      var time = new Date(iso).getTime();
      if (isNaN(time)) return "";
      var seconds = Math.floor((Date.now() - time) / 1000);
      if (seconds < 60) return "刚刚";
      if (seconds < 3600) return Math.floor(seconds / 60) + " 分钟前";
      if (seconds < 86400) return Math.floor(seconds / 3600) + " 小时前";
      return Math.floor(seconds / 86400) + " 天前";
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
          route.enabled ? null : h("span", { className: "ats-tag" }, "停用"),
          props.usage ? h("span", { className: "ats-tag", title: "本机派发统计（不是服务商余额）" }, "今日 " + String(props.usage.today || 0) + " 次") : null
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
    /** 稳定的数字哈希：同一成员的动态表情每次渲染一致。 */
    function hashOf(value) {
      var text = String(value || "");
      var hash = 0;
      for (var i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
      return Math.abs(hash);
    }

    /** 把 #rrggbb 调暗/调亮，用于渐变第二档。 */
    /** 往白色方向混一点，用来做高光渐变。 */
    function lighten(hex, amount) {
      var mix = function (start) {
        var value = parseInt(hex.slice(start, start + 2), 16);
        return Math.max(0, Math.min(255, Math.round(value + (255 - value) * amount)));
      };
      return "#" + [1, 3, 5].map(function (start) { return mix(start).toString(16).padStart(2, "0"); }).join("");
    }

    function shade(hex, factor) {
      var channel = function (start) {
        var value = parseInt(hex.slice(start, start + 2), 16);
        return Math.max(0, Math.min(255, Math.round(value * factor)));
      };
      return "#" + [1, 3, 5].map(function (start) { return channel(start).toString(16).padStart(2, "0"); }).join("");
    }

    // 12 种「不规则立体形状」：没有直角、没有尖角，靠轮廓差异区分不同智能体。
    var MASCOT_SHAPES = [
      { kind: "blob", eyes: 0, node: function (id) { return h("path", { d: "M33 5.5c13.5 0 23 8.4 24.8 20.6 1.8 12.3-5.6 22.4-16.4 26.3-10.8 3.9-23.5-1-28.6-11.2C8 31 12.6 15.9 22.8 10.2 26 8 29.4 6.6 33 5.5z", fill: "url(#" + id + ")" }); } },
      { kind: "bean", eyes: 0, node: function (id) { return h("path", { d: "M21 10c10-6 24-4 31 5 7 9 5 22-3 29-8 7-20 8-28 2C12 40 9 28 14 19c2-4 4-7 7-9z", fill: "url(#" + id + ")" }); } },
      { kind: "capsule", eyes: 0, node: function (id) { return h("path", { d: "M23 7h18c7 0 12 5 12 12v22c0 8-6 13-13 13H24c-7 0-12-5-12-12V20c0-8 4-13 11-13z", fill: "url(#" + id + ")" }); } },
      { kind: "egg", eyes: 0, hl: [0, 3], face: [0, 1], node: function (id) { return h("path", { d: "M32 5.5c10.5 0 19.5 13 19.5 27 0 13-8.5 22-19.5 22s-19.5-9-19.5-22c0-14 9-27 19.5-27z", fill: "url(#" + id + ")" }); } },
      { kind: "dome", eyes: 0, hl: [0, 10], face: [0, 6], node: function (id) { return h("path", { d: "M9.5 51c0-14.5 10-26.5 22.5-26.5S54.5 36.5 54.5 51c0 3.6-2.8 6-6.4 6H15.9c-3.6 0-6.4-2.4-6.4-6z", fill: "url(#" + id + ")" }); } },
      { kind: "cloud", eyes: 0, hl: [-3, 4], face: [0, 2], node: function (id) { return h("path", { d: "M14.5 46c-5.2 0-8.5-4.2-8.5-9.3 0-5.9 4.8-10.2 10.4-9.9C17.6 18.6 24 12 32.3 12c8.6 0 15.2 6.8 15.6 15.4 6.2-.4 11.1 3.9 11.1 9.6 0 5.2-3.8 9-9 9z", fill: "url(#" + id + ")" }); } },
      { kind: "clover", eyes: 0, node: function (id) { return h("path", { d: "M32 6c6.5 0 11 4.5 11 10 5.5 0 10 4.5 10 10 0 5-3.5 9-8 9.8 1 1.8 1.5 3.8 1.5 6 0 6.5-4.5 11-10.5 11-4.5 0-8-2.5-9.5-6-1.5 3.5-5 6-9.5 6-6 0-10.5-4.5-10.5-11 0-2.2.5-4.2 1.5-6C9.5 35 6 31 6 26c0-5.5 4.5-10 10-10C16 10.5 20.5 6 27 6z", fill: "url(#" + id + ")" }); } },
      { kind: "crystal", eyes: 0, hl: [0, 4], face: [0, 2], node: function (id) { return h("path", { d: "M32 5c2.6 0 4.8 1 6.4 3L55 24c2.6 3 3 7 .4 10.4L45 50.5c-3 3.4-7.5 4-10.9 1.4L10 33.6c-3.6-2.8-3.6-7.4-.4-10.6L26 7.8c1.6-1.8 3.6-2.8 6-2.8z", fill: "url(#" + id + ")" }); } },
      { kind: "drop", eyes: 0, hl: [0, 8], face: [0, 5], node: function (id) { return h("path", { d: "M32 6c9.5 10 18 17.5 18 27a18 18 0 11-36 0C14 23.5 22.5 16 32 6z", fill: "url(#" + id + ")" }); } },
      { kind: "squircle", eyes: 0, node: function (id) { return h("path", { d: "M24 7h16c11 0 17 6 17 17v16c0 11-6 17-17 17H24c-11 0-17-6-17-17V24C7 13 13 7 24 7z", fill: "url(#" + id + ")" }); } },
      { kind: "triangle", eyes: 2, hl: [-2, 6], face: [0, 3], node: function (id) { return h("path", { d: "M32 7c3 0 5.5 1.6 7.4 5l15 26c3.4 6 1 12-4.6 13.6-2.4.7-4.6.4-7-.6L14 45.5C9.6 43.9 7 39.6 8.4 34c.8-3 2.2-5.4 4.2-8.2L27 9.5C28.6 7.4 30 7 32 7z", fill: "url(#" + id + ")" }); } },
      { kind: "pebble", eyes: 0, hl: [0, 3], face: [0, 1], node: function (id) { return h("path", { d: "M17 12c8-6 22-7 30-1 8 6 10 17 6 26-4 9-15 15-26 13-10-2-17-10-18-20-1-7 3-14 8-18z", fill: "url(#" + id + ")" }); } }
    ];

    /**
     * 动态表情：按成员 id 稳定生成一张会呼吸、眨眼、被戳会弹一下的小脸，
     * 造型与表情参考 DS-Bot 的 BotMark（渐变身体 + 挖空眼 + 腮红 + 状态徽标）。
     */
    // 照搬 Fei2411/DS-Bot 的 characters：20 个由 SDF 模型投影出的三视角角色，
    // 图层 = body / paints / shade / light，眼睛是从所有图层里挖空的胶囊。
    var DS_CHARACTER_KEYS = ["whale","star","moon","wave","squircle","zed","hex","gumdrop","peanut","saucer","bunny","kitty","beacon","plus","magnet","acorn","pebbles","cushion","ring","gem"];
    var DS_CHARACTERS = {"whale":{"label":"Whale","body":"M65.3 20.9l5.1 .1 4.8 .9 4.8 1.7 4.3 2.3 3.8 3.1 3 3.4 2.3 3.8 1.6 4.3 .9 4.3 0 4.8-.8 4.8-1.4 4.3-2.3 4.3-3.2 4.3-3.4 3.3-4.3 3.1-7.2 3.5-7.6 1.7-7.2 .1-9.6-1.6-3.3-1-2.9-1.7-8.8-8.9-6-4.7-3.3-.5-7.7 1.1-4.8-.1-4.7-1.2-1.9-1.2-1-1-.5-1.5 .4-1.4 1.1-1.3 1.9-1.3 4.7-1.5 7.7-.6 1.1-.5 .7-1 0-1.4-2.8-7.2-1.2-5.3-.1-4.3 .4-1.4 .9-1.2 1.9-.2 2 1 2.2 2.3 2.2 3.4 3.2 7.6 1.9 9.7 .5-.1 1.1-7.2 1.8-4.8 3.2-5.2 3.9-4.3 4.9-3.9 5.6-2.9 5.8-1.9z","paints":[["M93.3 55.8l1-.3 .1 1.2-2.4 5.3-3.4 4.8-3.8 3.8-4.8 3.4-5.7 2.8-4.8 1.5-4.8 .4 20.1-17.4 5.2-3.7z","#fff",1]],"shade":"M88.6 29.5l2.4 2.9 1.9 2.8 2.4 6.3 .5 3.3 .1 5.3-1.5 6.6-1.9 4.3-2 3.3-4.8 5.4-5.7 4.3-7.2 3.3-6.2 1.5-6.7 .1-3.3-.2-9.6-1.8-3.3-1.5-2.4-1.9-8.6-8.9-5.3-3.9-3.3-.1-2.9 .2-3.3 .8-5.8 0-4.3-1-2.9-1.9 .6-.6 3.8-1.3 10.5-2.5 4.3 .9 1.4-.1 2.2-1.7 .5-1.4-.3-1.5-1.2-1.4-2.2-1.4-1.2-1.9-.6-12 .4-3.3 .5-.5 2.9 3.8 2.4 4.8 1.9 5.7 .7 5.8 .7 2.8 2.1 2.4 2.7 5.5 3.8 4.3 2.9 2.2 3.3 1 3.4-.4 6.2-3 7.1-4.5 7.3-5.6 6.6-5.9 5.9-6.5 3.7-5.3 1.7-4.2 .1-2.9z","light":"M55.6 22.8l1.9-.3 1.5 .3 .6 1 .1 .9-2 4.3-3.8 5.3-5.8 6.2-5.4 4.4-4.8 2.3-1.4 0-1.2-.5-.8-1.9 .5-3.3 2.5-4.8 3.3-4.3 2.4-2.4 5.3-3.9zM19.3 28.1l-1.4 2 .3-1.1zM21.7 49.1l.6 .5-.3 .5-.8 0zM35.8 52l1.2-.4 .9 .7 .7 1.6-.4 .9-1.2 .1-2.6-.5zM7.2 52.9l-2.9 2.9 1.2-1.6z","eyes":[[72.5,48.4,9.3,23,-15.8],[85.6,43.4,7,22.9,-21.2]]},"star":{"label":"Star","body":"M40.1 4.4l1.5-.4 1.9 .1 5.2 1.1 1.9 .9 13.2 14.9 17.1-.8 5.2 1.1 1.8 .9 1.7 1.6 .7 2.4-.4 1.9-9.7 23.6 5.6 23.7 .1 1.9-.6 1.4-2.1 1.8-2.3 .5-19.9-1.8-16.6 15.5-1.9 1-1.9 .3-7-1.5-2.6-2.1-.9-2.4-2.8-24.1-16-13.6-1.1-1.5-.5-1.9 .4-1.9 1.2-1.5 18.9-13.6 7.1-24.6 1-1.7z","paints":[],"shade":"M52 7.7l14.3 16.1 1 2.9 .3 3.1 19.4-1.3 2-1.4 .7-2.3-.4-1 .5 .5 .5 1.9-.4 1.9-9.8 23.2 5.5 23.1 .1 3.4-2 2.4-2.8 .8-19.4-2.1-1.9 1.4-14.7 14-2.4 1.4-3.3 .1-4.7-1-2-1 .6-.2 3.3 .8 2.8 .1 5.1-2.1 .7-.9 .4-2.4-2.6-22.7-.3-.3-1.4 .2-1.4 .7-5.7 .7-5.6-1.2-16.7-13.8 1-.1 5.2 1 3.8-1.1 1-.7 1.9-.4 .4-.4 1.5 .3 .4-.4 1 .2 18-12.8 6.7-23.5 0-1.8-.4-.5-.3-1.9 .4-2.4z","light":"M40.1 4.4l2-.1 4.7 1 .7 1-.5 1.4-2.8 1.5-6.6 23.1 .7 1.2 .6 .3-18.1 12.5-1.8 2.1-3.4 .7-5.2-1.2-.3-.4 .3-.9 1.4-1.4 18.3-12.9 .9-2.3 6.4-22.7 .8-1.4z","eyes":[[53.9,53.4,7.2,18.8,-10],[65.1,49.2,7.2,18.8,-10]]},"moon":{"label":"Moon","body":"M45.8 4.2l4.7-.2 4.2 .4 10.2 2.4 3.7 1.6 3.6 2.1 3.3 2.5 3 3.1 4.6 6.7 3.4 8.3 1.5 8.8 .1 4.6-.8 7.8-2.6 8.8-3.9 7.7-5.1 6.7-6.1 5.3-4.1 2.6-3.6 1.6-27.2 10.2-2.8 .7-2.6 0-5.7-1.3-2-.8-1.9-1.7-1.1-2.6-6.5-37.7-.2-5.2 .8-7.7 1.3-5.2 3.1-7.8 4.2-6.7 3-3.6 3.9-3.6 6.3-4.2 4.1-1.8z","paints":[["M57.6 9.9l.2-.3 .2 .3 2 4.7 1.9 1.9 2.6 .5 1.5-.7 1.1-1.1 .4 .4-.1 1.6-.7 1.5-2.2 2.5-1.6 .7-2 0-1.6-.8-1.3-1.4-.8-2-.4-2.6 .1-3.1z","#1783FF",1]],"shade":"M74.3 13.5l2.1 1.5 .3-.4-.3-.6 2.1 2.1 4.6 6.7 3.1 7.4 1.5 7.6 .1 10.4-.6 4.6-2.5 8.3-4.2 8.2-3.1 4.2-5.7 5.7-6.2 4.2-4.6 2-28 10.3-4.1 0-5.2-1.1-2-.9-.5-.7 .5 .5 1.5 0 3.6 1 2.6-.3 5.7-2.1 2.1-2.1-5.4-31.5-.2-4.1 .4-1.1-.1-2.6 .5-3.6 1.8-7.7 2.8-6.7 1.9-3.1 3.9-5.2 3.2-3.1 2.5-2 5.2-2.9 3.1-1.1 3.1-.8 2.1 0 .5-.4 2.6 .2 1-.3 1.6 .4 1-.5 2.1 .8 1-.8 2.1 1.2z","light":"M38 6.3l1.7-.3 2.5 .2 .6 .4 1.5 0 .5 .5 1.6 .3-3.1 1.3 .4 .7-2.5 1.6-.5 1-2.5 2.1-2.7 2.9-6.2 7.9-1.5 2.7-1 .9-1.2 2.6-1.4 1-1.3 3.7-1.3 .3-6-1.4-1 3.6-.8 0 .9-3.6-.5-1 1.1-3.6 2.7-5.7 4.1-6.2 5.7-5.8 3.1-2.4 3.6-2.2z","eyes":[[51.6,48.5,8.4,22.1,-10],[66.8,42.9,8.4,22.1,-10]]},"wave":{"label":"Wave","body":"M46.1 4l6.1 .3 9.6 2.1 4.5 1.8 4.1 2.4 3.5 2.8 4.4 4.8 2.6 4 2.1 4.1 2.2 6 4.8 26 .5 5.3-.3 4.1-1.2 3.8-1.5 2.8-2.4 2.5-2.1 1.4-3.1 1-3 .3-8.1-1.5-3.2 5.3-2.1 2.1-2.5 1.5-2.8 1-3 .4-9.1-1.6-2.7 4.2-3.4 3.1-4 1.7-4.6 .1-7-1.5-3.5-1.9-3.4-3.5-2.1-4-1.5-5.6-3.7-20.7-.6-5.6-.1-5 .5-6.1 2.3-9.6 2.3-5.5 2.7-4.9 2.7-3.7 3.2-3.6 4.2-3.6 4.7-2.9 4.4-2 4-1.2z","paints":[["M61.6 48.5l2.2-.3 2 1.1 1.1 2.2 .3 3-.6 3.1-1.5 3.5-2.5 4.1-2.4 2.8-5-2.2-3-2.2-2.3-3-.7-3.5 .6-2.6 1.8-2.1 1.6-.7 1.5 0 1.5 .6 1.5 1.3 2-3.6z","#fff",0.4]],"shade":"M69.3 13.6l2.6 1.3 .5-.3 .5-1.3 2 1.7 .5 0 2.5 2.7 3.5 5.5 3.6 8.6 1.5 6.6 3.5 19.7 .5 5.5-.4 4.6-2 5-1 1.6-2.6 2.5-3 1.5-2.1 .5-4 0-6.6-1.4-1.4 2.9-1.9 2.5-2.7 2.6-3.1 1.5-2.5 .6-4 .1-7.1-1.5-1.5 2.8-2.6 3-2 1.6-3 1.4-4.5 .6-7.1-1.5-3.6-1.5-3.5-3.1 6.6 1.5 2.8-.5 .5-.5-.3-.5 3.2-2-.4-1 1.4-1.5-.3-1 .7-1.6-.2-2.5-3.4-19.2 .3-.5-.6-5 .5-.5-.1-4.6 .4-.5 .3-4 1-4.1 1.5-4.5 3.8-7.7 5.5-6.9 3.1-2.6 6.5-3.9 7.6-2.2 3.1 0 .5-.4 3 .5 1-.5 2.5 1z","light":"M36.5 6.1l2-.3 .5 .6 4.1 .5 1 .7-3.3 1.5-.3 1.2-3 2-.3 .8-2.8 2.6-3.5 4-3.9 5-2 3.6-1 .5-1.7 4-1.5 .5-1.4 4.6-1.6 .2-.5-.4-5.6-.9-.4-.4 1.4-5.1 1.5-3.5 2.6-5.1 4-5.5 6.6-6.2 4-2.5z","eyes":[[47.5,37.2,8.4,22.1,-10],[61.6,31.9,8.4,22.1,-10]]},"squircle":{"label":"Squircle","body":"M54.5 4.2l3.9-.2 3.7 .3 11.6 2.7 3.1 1.6 2.8 1.9 2.6 2.7 2.2 3.1 2.4 4.8 1.9 5.8 3.7 19.4 .8 11.1-.4 4.7-1 4.7-1.3 3.5-1.8 3.4-4.8 5.8-6.4 4.7-8 4-14.2 5.3-9.5 2.2-7.4 .1-10.5-2.2-5.3-2.5-4.3-3.7-3.3-4.8-2.7-6.3-2.4-9.5-2.8-17.9-.2-7.8 1.3-7.9 2.2-5.3 2.8-4.2 4.1-4.2 4.3-3.1 6.3-3.4 11.6-4.6 7.9-2.7z","paints":[],"shade":"M80.5 11.6l2.1 2.1 2.1 3.2 3.2 7.3 2.1 8.4 2.7 15.8 .5 7.9-.6 7.4-2 6.3-3.8 6.3-4.2 4.3-2.6 2-6.9 3.8-15.2 6.2-9.5 2.7-6.8 .6-6.2-.7-8.5-2-5.8-3.2-3.2-3.3 .5 .4 1.1-.2 5.8 1.4 2.1-.8 1.4-.7-.3-.5 1.4-1.1-.1-1 .8-.5 0-1.1 1.1-1 .1-2.1 .4-.6-.2-3.6-2.4-17.9-.2-9.5 .8-5.3 1.1-3.6 1.2-2.7 2.2-3.5 2.7-2.8 3.1-2.5 5.8-3.2 17.9-6.9 5.3-1.4 8.4-1.4 1.6-1.1 .5 .1 .9-1.5z","light":"M39.4 8.4l1.2 0-1.6 .7-1-.1 1-.1zM36.8 9.5l1 0 .6 .9 4.2 .6 .7 .6-3.8-.4-.3 .4 1.9 .3 .1 .7-3.2 1.6-6.9 5.8-5.3 6-4.7 6.1-3.8 3.7-.2 .5-1.8 .1-6.8-1.7 .4-3.6 2.1-4.2 2.2-3.2 4.2-4.3 4.2-3 3.1-1.8 5.3-2.5zM35.1 10.5l1.7 0-.5 .4zM36.5 11.1l.3-.5 2.2 .1 .4 .4-.4 .3z","eyes":[[52.6,52.4,8.4,22.1,-10],[67.3,46.9,8.4,22.1,-10]]},"zed":{"label":"Bull","body":"M77 4.4l1.1-.4 1.1 .2 1.2 1.3 2 9.8 2.2 5.9 .4 2.8-.3 2.1-.8 1.7-4.7 5.1-1.3 1.9-.4 1.7 .1 1.6 1 1.7 4.4 .2 3.8 1.3 2 1.7 .6 1.6-.3 1.7-.7 1.1-3.5 2.7 1.7 6 .4 5.9-.8 6.6-1.9 6-3.4 5.9-4.4 5.3-5.5 4.4-6 3.1-6.5 2-7.1 .7-6.5-.7-6.5-2.1-6-3.4-4.8-4.4-3.5-4.9-3.1-6.7-3.3 1.1-2.7 .3-2-.6-1.1-1.1-.3-2.2 .9-2.7 2.9-3.8 4.6-3.8 1.8-7.1-6.3-1.8-1.6-1.3-1.3-1.8-.6-2.7 0-6.6-1.4-8.7 .2-1.1 1.5-1.4 1.1-.1 1 .5 5.5 7.9 2.2 2.2 2.7 1.4 4.9 .4 .5-.1 6.5-5.1 6.6-3.2 6-1.6 8.7-.7 3.8-.9 2.7-1.5 3.9-3.2 3-3.8 2.4-4.9 2.1-10z","paints":[["M61 36.5l1.9 .7 1.4 2-.7 5.4 .3 .4 2.8-1.2 1.1 0 1 .9 .5 1.6-.5 .8-1 .5-7.1 2.4-1.1-.5-.9-1.6 1.4-5.4-.5-.6-3.3 1.1-1.1-.1-1.6-1-1-1.6 .5-.9z","#fff",1]],"shade":"M80.2 5.5l.6 1.6 1.3 8.2 2.5 6 .2 3.7-.1 1.1-1.2 2.2-5.2 5.4-1.1 3.3 .9 2.7 3.8 3.9 1.6 .1 4.4-1.4 1.2 1.2 .1 1.1-.2 1.7-.6 1.1-3.6 2.7 .9 2.2 1.1 5.4 .1 6-1.1 6.5-2.3 6-3.8 6-6 6-4.9 3.3-5.9 2.6-7.1 1.7-7.1 .1-6-1.1-5.9-2.3-4.4-2.7-4.4-4.5 3.8 .4 5.5-1.5 7.6-3.9 6.8-4.7 7.9-6.5 7.1-6.9 5.4-6.5 4.4-6.7 1.8-4.4 .4-3.2-.3-1.1-3.3-3.8-.8-2.8 .8-2.7 6.2-7 .8-2.2-.1-2.7-1.7-4.4-.8-8.2zM14.9 29.9l.1-.5 4 6.5 2.3 2.7-1.4 .1-2-.6-3.6-7.1zM24.3 44.6l1-.3 1.1 .2 3.3 2.9 1.7 .5 .3 1.6-.5 2.2-1 1.6-1.6 1.5-1.6 .7-1.7 .1-3.2-2.2-2.2 0-2.7-.6-2.9-1.6 3.9-1.6 2.2-1.7 2.2-2.3zM21 68.6l.5-.5 1.1 .1 1.1 .5 .8 1 .6 2.7-.1 1.1-.7 1.1-.6 .1-2.2-1.2-2.7 1.1-3.8 .6-2.7-1.2 3.4-1.6z","light":"M77 4.4l.6-.2 .1 .7-1.2 .8-.1-.8zM74.2 15.8l.6 1.1 .1 2.7-.6 2.2-1 1.6-5.5 5-1.7 .7-3.3 .3 .1-.6 2.1-1.2 4.2-3.6 2.7-3.9zM11.7 28.9l.8 0-.1 .5-1.2 .8-.1-.8zM44.3 32.1l3.1 0 .8 1.1 0 1.1-1.9 4.3-3 4.1-1.7-1.1-2.1-.8-4.4-.6-4.4 .1 5.5-4.4zM22 54.4l.6 0-.3 .6 .2 .5 2.3 2.7 .4 1.7-1 .9-4.8 2.3-7.1 7.8 0-1.8 2.1-3.3 6.4-5.4 1.2-4.3z","eyes":[[61.8,69,9.5,22.3,-10.5],[78.4,62.7,6.9,22.2,-11.2]]},"hex":{"label":"Blossom","body":"M38.8 4.2l2.6-.1 6 1.3 2 1.3 3 3.3 12-4.5 2-.5 6.5 1.1 2.9 1.6 4.9 6 .8 2 .3 2-.2 2.5-1.9 7-1.3 2.2-1.9 1.8 2.9 1.3 1.8 1.7 10.1 12.5 1.5 3 .1 4-1.8 7-.9 2-2.8 2.7-7.1 2.7-5.2 20-.8 2-1.4 1.9-1.5 1.1-6.5 2.6-3 .2-6.5-1.6-2-1.4-4-4.9-16 5.7-2 .1-4.5-1-3-1.2-5.2-6-1.3-3 0-3.5 2-8.5-10.8-13.4-1.4-3-.3-2 .3-2.5 1.7-6.5 1.8-3 2.2-1.8 5.9-2.2 2.1-.4 2.5 .3 .4-.4-.7-2.5 .1-2.5 4.8-18.5 1-2.5 2.9-2.9z","paints":[],"shade":"M49.7 7.7l.2-.4 .5 .4 2 2.3 0 .7 1.6 1.5 1 2 .1 1.5-.3 .5 .6 1.3 17.5-6.5 2.5-1.3 1-1.5 4.5 6 .6 1.5 .3 3-1.9 8-1 2-3 3-.3 1 .4 .5-1.7 3 .1 .5-.5 .5 0 .7 5.5-2.2 1.5-1.5 2 2 8 10 1 1.5 1 2.5-.1 4-1.9 7-1.1 1.9-2.9 2.5-6.8 2.5-4.7 19-1.5 3.5-2.5 2.5-6.5 2.6-4 0-5.5-1.4-2.2-1.7-3.2-4 4.9 .8 2.5-1.4 1.5-2.6 .7-2.3 1.7-6.5-.4-.3-.6 .8-.7 3.5-1.1 1.5 .3 .5-.3 .5-.7-.5-1.4-5.5-.5 1-.2 2-.9 1-.1 1.5-1.1 2-2.7 2.8-1 .4-1 .1-15.5 5.8-3-.1-4.5-1-2-1-2-2-2.2-3 .2-.2 4 .9 2-1.1 1.7-1.6 1.3-3.2 1.7-6.3 1.1-2.5-.3-.3-.5 .2-6.5-.3-.5-.5-2 0-.5-.5-1.7-.1-10.4-13.4 4.1 .7 3.1-1.7 1.3-2 2.5-8.5 .9-1.5 1.7-1.3 6.5-2.7 2-1.5-.3-.5 .3-.5 1.5-1.2 1.5-3 5.6-20.3 1.9-2 6-2.4 1.1-.6zM73.2 31.2l1.5 0-.8 1-34 12.7-1 .1-1.5-.5-2 .8-1.9-2.6 .4-.9 2 .5 1.5 1 .5-.4 1 .5 1-.3 1 .4 3-1.5 1 .1 3-1.6 1 .1 3-1.6 1 .1 3-1.6 2.5-.5 1.5-1 2.5-.5 1.5-1 2.5-.5 1.5-1 2.5-.5 1.5-1 1 0zM61.3 74.6l.1-.2 .4 .2-.4 1.7z","light":"M33.4 6.2l3 .1 1.9 .9-.1 .5-1.8 2.5-3.4 3.5-4.5 17-3.6-.9-1 .4 0-1 4.4-16.5 0-1.5 2.1-3.1zM68.2 6.2l1.2 0zM14.9 37.7l3.5 .9 .4 .6-.3 1-5 5.5-1.1 4.6-2.5-.5-2 .1 0-1.7 1-4.5 1-2.5 2-2.1zM19.4 71.6l4 .7 1.8 .8-1.2 1-1.1 5.1-4.5-.5-.5-.6 1.4-5z","eyes":[[49.8,55.5,6.7,17.7,-10],[61.6,51.1,6.7,17.7,-10]]},"gumdrop":{"body":"M38.7 4.5l4.4-.5 4.6 .8 4.1 1.9 3.7 3.2 23.2 36.6 2.3 5 1.4 5.1 .7 6.4-.7 6.4-1.8 6.1-3.1 5.7-4.1 5.1-5.2 4.2-5.8 3.1-6 1.8-6.4 .6-6.4-.6-6-1.8-5.9-3.1-5.1-4.2-4.1-5.1-3-5.4-1.9-6.4-.7-6 .5-5.9 9-41.6 2-4.1 2.6-3.2 3.4-2.5z","paints":[],"shade":"M54.9 9.5l1.9 2.3 22.9 36.5 1.8 4.6 .9 3.7 .6 4.1-.1 5.9-1.4 6.4-2.3 5.5-3.7 5.4-4.1 4.2-4.5 3.3-7.3 3.2-6.4 1.2-6.4 0-5.1-.9-5.9-2.1-5.5-3.3-4.6-4.1 .5-.3 4.1 .8 5.5-1 6.4-2.6 7.3-4.5 7.2-5.7 6.5-6.4 5.5-6.9 3.5-5.9-18.1-37 1.1-3.7 .2-2.3z","light":"M37.1 4.9l2.5 0 .8 1.4-.5 2.1-1.8 2.9-3.2 3.2-3.2 2.1-2.3 .7-1.8-.1-.7-.9 .1-1.8 2.4-4.1 2.7-2.8z","eyes":[[52.1,40.3,9.7,22.9,-15.2],[64.8,35.6,6.3,23,-27]]},"peanut":{"body":"M43.5 4l6.6 .7 5.8 2.2 5.4 3.8 4.1 4.7 2 3.8 1.4 4.3 1.3 11.9 1 4.3 1.6 3.8 5.8 10.5 1.4 3.8 .8 4.3 .1 6.2-1 5.7-2.1 5.5-3.2 4.9-4.1 4.3-4.8 3.4-5.6 2.4-5.7 1.3-6.1 .1-5.8-1.1-5.7-2.2-4.7-3.1-4.3-4.1-3.3-4.8-2.5-5.7-1.2-5.7-.1-6.7 1.7-9 .4-4.3-.5-4.7-2.5-9.6-.6-3.8 .2-5.2 1.2-5.2 1.5-3.4 2.2-3.3 2.5-2.9 2.8-2.3 3.4-2.1 3.4-1.4 3.8-.9z","paints":[],"shade":"M62.7 12.6l2.6 2.8 2.8 5.8 1.1 4.2 1 11.9 1 3.4 2.3 4.7 4.2 6.7 1.9 4.7 .9 3.8 .2 2.9-.1 6.2-.5 3.3-1.9 5.3-3.4 5.7-3.4 3.8-4.2 3.3-5.7 2.9-4.8 1.4-5.7 .6-6.2-.6-3.8-1-5.2-2.3-4.8-3.4-2.9-2.8 3.9 .8 5.2-.7 6.2-2.5 5.7-3.3 6.7-5.1 6.2-5.9 5.1-6.2 3.5-5.7-1.1-2.8-2.4-2.4-3.2-1.7-11.5-4.1-2.7-1.8-1.6-2.4-.2-2.4 .8-2.9 7.8-8 4.9-7.7 1.6-5.2z","light":"M35.9 5.4l3.2-.2 1.3 .7 .5 1-.5 3.3-2.9 4.8-4.1 4.1-4.8 3.3-4.2 1.5-1.5 0-1.4-.6-.7-1.2 .2-2.4 1.9-3.8 2.4-3.3 4.3-3.9z","eyes":[[50.9,31.5,8.7,20.5,-11.9],[64.2,26.5,5.7,20.3,-16.3]]},"saucer":{"body":"M45 22.7l6.7 .1 6.7 1.9 4.3 2.5 3.5 3.1 2.8 3.5 2.5 4.5 6.8 .9 5.6 1.2 4.5 1.6 3.5 2.1 2.8 2.8 1.3 3.5-.5 3.5-2 3.5-2.6 2.8-3.5 2.8-4.5 2.8-5.1 2.6-12 4.4-13.6 3.1-13.6 1.5-12.6-.3-5.5-.7-5-1.2-4.1-1.6-3.5-2-2.8-3.1-1.1-3 .5-3.5 2-3.6 2.7-3 3.7-2.9 10.3-5.6 .7-5.1 1.5-4.5 2.6-4.5 3.1-3.5 3-2.4 3.5-2 3.5-1.4z","paints":[],"shade":"M66.5 31.3l.3-.2 .6 .7 1.9 2.5 2 4.5 1.6 1.5 .1 1.5-1.7 1.7-3 1.2-3.1 .5-3.1-.3 4-8.1 .7-3.5zM94.9 47.4l1.1 3-.5 3.5-2.1 3.5-4 4.1-5 3.5-6.1 3.1-7 2.9-6.6 2.1-8 2-9.1 1.5-6.5 .6-11.6 0-4.5-.2-8-1.4-4.6-1.5-3.6-2.1 4.1 1.2 5.1 .8 7 .3 6-.2 15.1-1.9 15.6-3.6 14.5-5.1 5.4-2.5 5.3-3.1 4-3 2.3-2.5 1.2-2.1zM7.3 71l.7 .5z","light":"M40.6 23.7l2.8 0 .8 .5 .7 1.5-.8 3.6-2.6 4-3.9 4-4.5 3.2-4.6 1.7-2.5-.4-1-1.4 0-1.6 .9-2.5 2.1-3.5 2.6-3 3-2.6 3.5-2.1zM22.4 47.4l.7 0-.5 .5 0 1.5 .4 .8 2 1.4 3 1.2 9.1 2 15.1 1.1-.2 1.5-2.2 3.6-3 2.5-4.9 2.5-6 2-7.9 1.5-6.5 .5-7.1-.4-4.9-1.1-3-1.5-1.6-1.7-.6-2.3 1.1-3.1 2.9-3.5 4.1-3.5 4.1-2.6z","eyes":[[53.6,45,7.8,18.4,-14.5],[66.2,40.3,5,18.3,-25.1]]},"bunny":{"body":"M49.3 4.4l1.5-.4 2 1.2 1.6 2.7 1.2 3.4 1.6 8.9 .2 6-.2 6.4 .6 3 2.4 2.5 5.4 3 3.4 2.4 5.1 5.5 2.4 3.9 1.7 4 1.1 4.4 .4 4.5-.5 5.9-1.6 5.5-2.8 5.4-3.6 4.5-4.6 3.8-4.9 2.7-5.5 1.7-5.9 .7-6-.5-5.4-1.7-4.9-2.5-4.7-3.7-3.8-4.5-2.7-4.9-1.8-5.5-.7-5.9 .6-6.5 1.9-5.9 3.1-5.4 4.6-5.5-.4-2-3.4-8.4-1.8-6.9-.6-6.9 .3-3 .6-2 1.3-1.4 2-.1 2.5 1.5 2.1 2.5 4 6.9 2.1 5.5 1.7 5.9 1.5 2.1 1.8-1.6 .7-2-.4-12.4 1-8.9 1.6-4.9z","paints":[],"shade":"M52.7 5.4l2.1 3.5 1.9 7.4 .7 7.9-.5 8.4 .8 3.6-4.4-2.5-2.1-2.6 1.4-17.3zM31.2 15.3l.3-.5 2 2.5 2.9 4.9 2.5 6 1.7 6.4 1.4 2.5 0 .5-1.1 .9-4.5 1.9-2.4 .2-1.2-.6zM71.5 46l3.6 4.4 2.9 6 1.5 6.4 .1 5.5-1.1 6.3-2 5-3.4 5.4-3.5 3.6-4 2.9-6.4 3-4 1-6.9 .5-5.9-1-5.5-2-5.4-3.5-3.6-3.4 2.6 .7 2.5 .1 2.9-.5 4-1.3 8.4-4.6 8.7-6.8 7.4-7.9 5.3-7.9 1.3-3 1-3.5 .2-2.9-.2-2z","light":"M49.3 4.4l.6 0-3.6 6.2 1-3.7zM26 13.3l.5-.4 .2 .4-1.7 2.2 0-.7zM44.8 34.6l.5-.1 1.2 1.1 .8 1 0 .7-.5 .3-4-.5zM45.1 42.5l.8 0-.3 1-2.4 4.5-3.8 4.4-4.1 3.5-3.8 2.4-4 1.6-2.9 .1-1.8-1.1-.4-2.5 1.1-3.5 3.5-5.4 3-3.1 .2 1.6 .8 .8 3 .1 4.4-1.2z","eyes":[[59.2,69.2,8.2,19.3,-12],[72.9,64,5.6,19.1,-15.4]]},"kitty":{"body":"M62.4 4.2l1.6-.1 1.5 1.2 7.4 21.3 3.7 6.4 6.2 7.4 3.1 5.9 1.5 4.8 .7 5.3-.2 5.4-1.1 5.3-3 7.4-4.4 6.4-5.3 5.4-6.9 4.6-7.5 3.1-8 1.7-8 .2-7.4-1.4-4.3-1.5-3.7-1.8-3.8-2.5-3.1-2.7-2.7-3-2.5-3.7-1.9-3.7-1.4-4.3-.9-5.3 .1-5.8 1.4-7 1.6-4.2 2-3.8 .8-3.2 .2-20.2 1.1-1.4 1.1-.3 1.1 .3 12.2 9.7 5.9-2.5 8-2.1 3.2-1.8 2.3-2.4 8.3-16z","paints":[],"shade":"M64.9 5.8l.1-.3 .7 .3 6.5 19.7 3.1 5.9 2.5 3.2-1.6-.8-2.6-2.4-5.1-8zM79.4 36.7l2.2 2.1 1.6 2.2 3.3 6.9 1.5 6.9-.1 6.4-1.6 7.5-3.1 6.9-3.8 5.3-5.3 5.4-6.4 4.3-7 3.1-6.3 1.6-4.3 .6-5.3 0-7.5-1.1-5.8-2-5.9-3.3-5.9-5.4 2.7 .7 3.2-.1 3.7-.8 5.2-1.9 10.3-5.5 11-7.8 10.7-9.6 7.8-9.1 3-4.6 1.6-3.4 .7-3.2z","light":"M62.4 4.2l.5-.1 0 .6-.8 1.1-4.5 14.4 .2 2.7-.3 1.6-1.1 1-2 .6-6.9-.5 2.6-1.3 3.1-3 8.1-16zM18.7 20.7l1.1-.5 0 .8-1.1 .9-.6-.1zM39.5 27.7l2.6-.3 1.9 .8 .4 1.6-.7 1.8-4.2-1.5-5.4 .2 0-.5zM16 47.4l.3 4.2 1.6 2.2 3 2.1-.6 .5-3.7 .6-1.1-.3-1.1-1.1-.4-1.8 .4-2.7z","eyes":[[59.6,65.1,9.4,22.6,-11.9],[77.5,58.4,7,22.5,-14]]},"beacon":{"body":"M40 4.1l2.7 0 2.5 .9 2 1.7 1.1 2.1 .5 2-.2 2.1-2.1 4.1-.4 1.6 1.5 7.7 9-3.1 4.1-.2 18.5 4 3.1 1.6 2.4 2.3 1.3 2.1 .9 2.6 5.8 33.4-.4 3.1-1.3 3.1-2 2.5-2.6 1.9-41.7 15.7-4.1 .7-19.6-4-3.5-1.9-2.5-2.5-1.2-2.1-.8-2.6-5.7-32.9 .4-3.1 1-2.7 1.7-2.5 2.4-1.9 28.4-10.9-1.5-9.3-.7-1-3.5-3.3-.9-1.9-.4-2 .5-2.6 1.1-2.1 1.7-1.5z","paints":[],"shade":"M47.1 7.2l.4 0 .8 1.6 .3 2-.2 2.6-2.5 4.7 1.5 8.2 0 2 .5 .6 .1 1.5 .5 1-1.2 .4-1.3-.4-.3-.5-1.9-10.3-4.1-1.5-3.2-2.6 3.1-.9 3.2-2.2 2.5-2.6zM84.2 30.9l1.2 1.1 1.5 3.6 5.7 32.4 0 2.6-1 3.6-1 1.5-3.1 3.2-4.2 1.9-40.6 15-4.2 0-16.4-3.6-3.6-1.4-2.6-2.2 .5 .4 17.5 3.4 3.8-1.2 5-3.4 1-1.3-5.4-30.3 .2-.6 3.1-3.4 40.2-15.1 2-3.6z","light":"M38.5 4.7l2 0-.1 1-.8 1.4-2.6 2.2-1 .4-1.1-.1-.1-.8 .7-1.6 1.5-1.6zM55 23.7l1.1 .1-1.6 .6-.9-.2 .9 0zM52.4 24.7l1 0-3 1.2-.9-.1 2.4-.6zM48.3 26.3l1 0-1.5 .6zM40 29.4l1.1 0-3.1 1.2-.9-.2 2.5-.5zM35.9 30.9l1 0-3 1.2-.9-.1 2.5-.6zM31.8 32.5l1 0-3 1.2-.9-.2 2.4-.5zM40.2 33l.4-.4 1-.1 1.6 .8 3 .7-1.5 .5-4.1 0-.9-1zM27.7 34l1 0-3 1.2-1-.2 2.5-.5zM23.6 35.6l1 0-3 1.1-1-.1 2.5-.5zM19.4 37.1l1 0-2.4 .8-.5 .7 15.4 3.3 .5 .3 .3 1.1-1.1 2.6-3.3 3.3-3.1 1.5-17.5-3.6-.6-1.2 .5-1.6 3.2-3.7 2.1-1.4 2.5-1.1 1 0 .6-.5 1 0z","eyes":[[55.5,65.3,8.4,22.1,-10],[74.2,58.3,8.4,22.1,-10]]},"plus":{"body":"M44.6 4.3l3.3-.1 11.9 2.5 2.5 1.3 1.3 1.4 .7 1.6 2.1 11.4 4.1-1.2 2.1 0 12.3 2.6 2.8 1.6 1.2 1.5 .7 1.5 3.8 21.6-.5 3.1-1 1.5-1.3 1.3-17 6.6 3.4 20.4-.4 2.5-1.2 2.1-2.3 1.6-19 6.9-2-.2-11.9-2.5-2.5-1.3-1.3-1.4-.7-1.6-2.1-11.4-4.1 1.2-2.1 0-12.3-2.6-2.8-1.6-1.2-1.5-.7-1.5-3.8-21.6 .5-3.1 1-1.5 1.3-1.3 17-6.6-3.4-20.4 .2-2 1.1-2.2 2.6-2z","paints":[],"shade":"M63.2 9.4l.7 .6 .5 1.5 2.1 13.3 .6 .6 0 2.5 .5 .5 .1 2.6 .5 .5 .1 2.1-.8 3.1 19-7.1 1-1.2 1-2.1 1.1 2.1 .4 2.6 3.2 18 0 3.1-1 2-2.2 2.1-15.9 5.8-.8 .8 3.6 19.5-.1 2.6-1.5 2.6-2.2 1.6-16.4 6.1-2.1 .6-2.5 0-12.4-2.7-2.2-1.5 12.5 2.5 2.4-1 2.7-2-3.9-22.1-3.8 3.5-1 .4-2.6 .5-1.5 1-2.6 .5-1.5 1-2.6 .4-1.5 1-4.6 1.5-2.5 0-11.9-2.6-2.7-1.6 12.4 2.3 2.6-.9 2.4-1.9-3.4-20.5 .3-.5 1.7-1.8 18.6-6.9 .3-.6-.7-1-3.8-22.1 2.1-2.1 16.4-6.1 .6-.5z","light":"M28.4 10.5l1.1 .5 10.2 2.1 .5 .4-.1 1.1-1.9 2.3-2.1 1-12.3-2.5-.1-1.3 1-1.6 1.2-1zM11.4 43.3l11.4 2.2 1 .6 0 .8-1.5 2.3-2.6 1.4-12.3-2.6-.2-1.1 .6-1 2.2-2.1z","eyes":[[54.5,53.1,6.1,15.9,-10],[64.5,49.4,6.1,15.9,-10]]},"magnet":{"body":"M71.9 4.2l1.2-.2 12.1 2.6 .5 .3 .6 1 6.2 35.6 .6 5.8-.1 5.7-.7 5.8-1.5 5.7-2.2 5.8-4.2 7.3-5.5 6.5-6.5 5-7.1 3.4-6.3 1.3-6.3 0-15.2-3.1-5.2-1.8-5.2-3-4.6-4.1-4-5.2-2.9-5.8-2.4-7.8-6.4-36.2 25-9.5 13.1 2.9 .5 .9 6.3 35.3 1.8-3.9 .5-4.7-6.3-36.1 .4-.6z","paints":[],"shade":"M86.2 9.5l.5 1 5.8 33 .6 4.7 0 5.2-.6 5.8-2.1 8.4-3.1 7.3-3.7 5.8-6.3 6.8-5.7 4.1-5.8 2.7-6.8 1.5-6.3 0-15.2-3.1-5.7-2-5.2-3.2-5.9-5.8 .1-.7 11.5 2.5 .3-3.4-1.9-13.6-5.7-32.4 1-.1 18.3-6.9 .9-.9 .4-1 6.1 35 1.6 2.1 .1 .6 4 4.7 3.2 1.1 3.6-.6 3.2-1.9 2.4-2.8 1.9-4.2 .6-3.7-6.4-36.6 19.3-7.1 .8-.8z","light":"M53.6 54.5l.7-.4 12 2.8 .6 1.8-.6 2.1-2.1 2.4-2.6 1-1.5 0-6.3-1.4-1.6-2.6-.2-2.1z","eyes":[[59.6,82.1,6.1,15.9,-10],[72,77.5,6.1,15.9,-10]]},"acorn":{"body":"M47.6 4l2.1 .6 1.3 1.5 .4 1.5-.4 5.2 .3 .3 8.8-.1 7.7 1 7.3 2.1 5.7 2.9 3.6 2.9 2.6 3 1.8 3.4 .9 3.7 0 4.1-1 3.6-1.7 2.2-3.9 3 2.9 8.3 .9 8.3-.9 8.3-2.7 7.7-4.2 6.8-2.9 3.1-3.2 2.6-6.7 3.8-3.7 1.2-4.1 .8-7.2 0-7.3-1.7-7-3.6-5.9-5.1-4.8-6.3-3.3-7.3-1.8-7.7-.1-8.3-4.5-1.5-2.6-1.7-2.6-4.1-1.1-4.1 0-4.2 1.2-4.1 2.2-4.1 2.8-3.7 5.2-4.6 6.3-3.8 7.2-3.2 8.3-2.3 .9-8.3 1.2-1.4z","paints":[],"shade":"M50.6 6.1l.1-.5 .6 2-.6 5.7 .2 2.1-1.2 .2-1.2-.7 .5-6.8zM85.8 23.7l1.7 2 1.6 3.7 .6 2.6-.1 4.1-.5 2.6-1.1 2.1-2.1 2-2.9 2.1 1.4 3.1 1.6 5.2 .9 8.8-.5 5.7-1.4 5.7-2.2 5.1-2.6 4.2-5.1 5.7-5.2 3.6-4.7 2.2-6.2 1.5-7.7 .1-5.7-1.2-6.8-3-4.6-3.2-4.2-4.2 2.1 1 2.1 .3 3.1-.3 3.1-.9 6.4-3.1 6.5-4.6 6.6-5.8 5.9-6.4 5.6-7.9 4-7.4-2.4 .4-.5 .5-1.1 0-.5 .5-1 0-.5 .5-1.1 0-.5 .5-1 0-.5 .6-1.6-.1-.5 .5-1.6 0-.5 .5-3.6 .5-.5 .5-2.1-.1-.5 .6-2.1-.1-.5 .7-3.1-.2-.5 .5-3.1 0-.5 .7-4.7-.2-.5 .7-15.6-.3 0-.3 8.3-.6 11.4-2.4 11.4-3.8 10.5-4.8 9.2-5.7 6-5.2 2.2-2.6 1.6-2.9 .5-1.7z","light":"M46 4.5l1.1-.1 0 .6-1.5 1.6-1.1 .2-.1-.7zM38.5 15.9l5 0 3.3 1.6 1.6 3.1 .1 3.1-.9 3.1-1.9 3.1-3.2 3.6-4 3.1-3.6 2.1-8.5 3.2-4.1 .7-4.2 .1-3.1-.5-2.6-1.5-1.1-2 .1-2.1 .5-1.5 2.1-3.7 4.1-4.6 3.7-3.1 5.1-3.2 6.3-3z","eyes":[[63.6,63.3,9.6,22.7,-11.9],[79.5,57.3,6.5,22.5,-15.5]]},"pebbles":{"body":"M47.3 4.5l2.7-.4 2.7 .1 13.7 3 4.3 2.1 3.3 3.4 1.3 2.2 1 2.8 2 12-.5 4.3-3.1 7.7 .2 .5 8.4 1.9 2.7 1 3.3 2.1 2.7 2.8 2.4 4.3 1.4 6.5 .1 4.4-.8 3.8-1.3 2.7-2 2.8-2.4 2.2-2.7 1.6-45.5 17-3.3 .6-3.2-.2-19.2-4.2-4.9-2.8-3.4-3.8-1.9-4.4-1.3-7.7 .2-3.2 .8-2.8 1.3-2.7 2-2.7 3.2-2.8 7.9-3.8 2.5-2.2-.4-1.6-5.4-6.1-1.8-3.8-2.3-12.5 .2-3.3 .7-2.7 2.6-4.4 2.2-2 2.2-1.4z","paints":[],"shade":"M73.2 12.2l.4 0 1.5 2.2 1.2 3.3 1.8 11.4-.2 4.4-3.3 7.6 0 1.1 .6 1.1-1.2 1.3-26.8 10.1-3.2 .5-5.8-.4-15.2-3.3-1.4-.5-3.5-3.8 .2-.3 1.6 .2 10.9 2.2 2.8-.5 4.4-2.2 5-3.8 .1-.6-1.5-8.7 4-4.5 24.2-9.2 2.4-3.8zM90.9 48.8l2.8 3.8 1 2.8 1.2 6 0 4.3-1.1 3.9-1.7 3.2-3.8 3.9-2.7 1.7-42.1 15.8-5.5 1.6-3.8 0-18-3.8-4.9-2.1-3.4-2.9 17.6 3.8 2.7-.2 3.3-1.2 4.3-2.6 4.4-3.6-.4-3.8 4.4-4.9 42.5-16 2.1-3.1 1.1-2.8 .5-3.3z","light":"M45.6 5.1l1.5 0-.4 .2-22.9 8.5 11.4 2.5 .6 .8 0 1.6-1.5 2.8-1.9 2.2-2.8 2.1-3.1 1.2-13.2-2.8-.1-2.2 1.2-2.2 1.7-2.2 2.7-2.2 2.2-1.1 2.2-.5 .5-.5 2.8-.6 1.6-1.1 2.7-.5 1.7-1.1 2.7-.6 1.6-1 2.8-.6 1.6-1.1 2.8-.5zM21.6 53.2l15.8 3.6 1.2 .7-.1 .9-.8 .8-3.1 1.6-1.3 3.8-3 3.8-3.3 2.5-3.3 1.4-18-3.6-.6-1.3 .6-2.2 1.6-2.7 1.7-1.8 3.8-2.8 5.5-2.2z","eyes":[[51.2,34.1,6.9,18.1,-10],[66.4,28.4,6.9,18.1,-10]]},"cushion":{"body":"M64.2 4.4l3.3-.4 2.8 .2 3.9 .8 2.8 1.1 2.7 1.7 2.4 2.1 1.9 2.4 1.5 2.8 1.2 3.9 7.1 40.6-.1 5-1.4 4.5-1.6 2.9-1.9 2.2-2.2 1.9-2.8 1.7-45.6 17.1-3.4 .9-3.4 .2-4.5-.7-3.4-1.2-3.3-2-2.9-2.7-2.3-3.4-1.5-3.9-7.3-41.7 .1-5 1.4-4.5 1.6-2.9 1.9-2.2 2.2-1.9 2.8-1.7z","paints":[],"shade":"M82.1 10l2.9 4 1.6 4.5 7.3 42.2-.5 5.1-1.1 3.3-1.7 2.9-4.6 4.5-3.3 1.7-46.8 17.4-5.6 .2-4-.7-3.3-1.2-3.4-2.2-1.7-1.8 .6 .4 3.3 .2 4.5-1.2 5.1-2.8 5.3-4.4-6.9-39.4 5-5.7 43.9-16.4 2.3-3.6 1.1-2.8 .5-3.6z","light":"M62.3 4.9l1.8 .1-43.4 16.1 1.1 .4 .8 .9 .1 1.7-1.6 3.4-2.6 3-3.4 2.7-3.4 1.5-3.4-.2-.8-.8-.2-1.2 .4-1.6 1.7-2.9 3.4-3.5 2.3-1.6 3.4-1.6 5.6-1.8 .6-.5 1.1 0 .5-.6 2.3-.5 .6-.6 1.1 0 .6-.6 2.2-.5 .6-.6 1.1 0 .6-.6 2.2-.5 .6-.6 1.1 0 .6-.5 2.2-.6 .6-.6 1.1 0 .6-.5 2.2-.6 .6-.5 1.1-.1 .6-.5 2.2-.6 .6-.5 1.1-.1 .6-.5 2.2-.6 .6-.5 1.1 0 .6-.6 2.2-.6 .6-.5 1.1 0z","eyes":[[51.1,57.2,8.4,22.1,-10],[69.9,50.1,8.4,22.1,-10]]},"ring":{"body":"M48.1 4.3l8-.1 7.8 1.8 7.3 3.5 6.7 5.4 5.2 6.7 4.1 8.3 2.3 8.9 .7 9-1 9.5-2.5 8.9-4.1 8.3-5.3 7.3-6.6 6.1-7.3 4.5-7.8 2.7-8.4 .9-7.2-.8-7.3-2.5-6.7-4.1-5.6-5.3-4.5-6.5-3.5-7.8-2-8.4-.6-8.4 .9-8.9 2.2-8.4 3.5-7.8 4.9-7.2 5.8-6.1 6.3-4.5 7.1-3.3zM50.5 33.8l2.3-.3 1.7 .4 1.6 1.1 2 2.2 1.3 2.8 .8 2.7 .4 3.4-.1 3.3-1.4 6.2-3 5.6-2.2 2.4-2.2 1.6-2.3 1-2.2 .3-1.7-.4-1.6-1.1-2.8-3.7-1.5-5.2-.1-5.5 1.2-5.6 2.4-5 3.6-4z","paints":[],"shade":"M76.2 14.9l1.1-.5 3.4 3.8 2.8 3.9 2.3 4.5 1.6 3.9 1.6 5.6 1.1 8.3-.4 10.1-1.3 6.1-2.6 7.8-4.6 8.3-4.4 5.6-6.2 5.7-6.1 3.8-7.2 2.9-6.2 1.1-7.8-.1-7.2-1.7-3.9-1.6-4-2.2-5.5-4.5-2.8-3.4 1.7-.6 2.4-2.1 2-2.8 1.2-2.8 1.2-5 1.1-13.4 1.4-7.8 2.5-7.8 3.8-7.3 3.3-4.5 3.4-3.4 3.9-3.1 4.4-2.6 3.9-1.5 4.5-1.1 12.3-.9zM50.5 33.8l.6-.3 2.8 0 1.6 .9 2.7 2.8 3 1.4 3.3 .5 6.1 .2 3.9 .9 1.7 1 1.7 1.6 2.1 4.4 .7 4.5-.3 5-1.2 5-1.9 4.5-2.8 4.2-3.3 3.6-3.9 2.8-3.9 1.7-3.4 .6-3.3-.1-3.4-1.1-2.5-1.7-2.5-3-3.6-7-2.9-3.4-2.1-5-.6-5.6 .6-4.4 1-3.4 2.3-4.4 1.4-2.1 2.3-2.2 2.7-1.7z","light":"M41.1 5.9l.5 .1 .2 .5-.3 .6-12.4 13.3-13.1 18.1-2.3 2.1-1.1 0-.2-1.2 .2-2.8 1.6-5 4.6-8.3 3.9-5.1 4.4-4.4 4.5-3.4 5-2.8zM60.5 53.3l1.2-.3 1.1 .6 1.1 1.3 .8 1.8-.2 3.3-1.5 2.8-2 1.7-2.6 1-7.3 .2 2.2-1.4 2.6-2.6z","eyes":[[56.2,84.6,5.3,13.3,-6.8],[71.7,78.8,5.1,13.4,-6.5]]},"gem":{"body":"M57 9.3l2.9-.4 14.9 3.5 19.6 14.1 1 1.4 .6 1.6-.5 2.6-27.1 56.5-1.6 1.8-2.1 .7-15.9-3.4-42.9-30.7-1.3-1.6-.6-1.6 .5-2.6 12-25.2 1.1-1.5 1.5-1z","paints":[],"shade":"M75.7 14.6l.1-.4 .6 .2 16.9 12.3 1.1 .7 .5-.2 .5 .7 .6 2.6-.5 1.6-26.4 55.1-1.2 2.1-1.1 1.1-1.6 .6-2.1 0-14.3-3.3-42.8-30.7 1.5-.2 11.6 2.5 2.2-.7 2.8-2.6 11.9-24.9 .6-.8 38.2-14.2z","light":"M19.1 23.6l1.1-.4 .5 .5 11.7 2.2 1 .9-.2 .5-1.8 2.7-11.7 24.4-1.6 .6-13.3-2.8-.5-.5 12.1-25.4 1.2-1.7z","eyes":[[51.4,42.9,6.7,17.7,-10],[66.1,37.4,6.7,17.7,-10]]}};

    function Mascot(props) {
      var member = props.member;
      var accent = props.accent || "#2563eb";
      var size = props.size || 40;
      var state = props.state || (member.enabled === false ? "sleeping" : "idle");
      var seed = hashOf(member.id || member.name || member.emoji || "m");
      var key = DS_CHARACTER_KEYS[seed % DS_CHARACTER_KEYS.length];
      var def = DS_CHARACTERS[key];
      var clipId = "dsc" + seed.toString(36) + "s" + Math.round(size);
      var maskId = "dsm" + seed.toString(36) + "s" + Math.round(size);
      var pokeState = useState(false);
      var poked = pokeState[0];
      var setPoked = pokeState[1];
      var eyes = def.eyes || [];

      return h("svg", {
        className: "ats-mascot ds " + state + (poked ? " poked" : ""),
        width: size, height: size, viewBox: "0 0 100 100",
        role: "img", "aria-label": member.name,
        style: { flex: "0 0 auto", display: "block", cursor: "pointer", overflow: "visible" },
        onClick: function () { setPoked(true); },
        onAnimationEnd: function (event) { if (event.animationName && event.animationName.indexOf("ats-poke") >= 0) setPoked(false); }
      },
        h("defs", null,
          h("clipPath", { id: clipId }, h("path", { d: def.body })),
          h("mask", { id: maskId, maskUnits: "userSpaceOnUse", x: -100, y: -100, width: 300, height: 300 },
            h("rect", { x: -100, y: -100, width: 300, height: 300, fill: "#ffffff" }),
            eyes.map(function (eye, index) {
              var cx = eye[0], cy = eye[1], ew = eye[2], eh = eye[3], tilt = eye[4];
              return h("g", { key: "m" + index, transform: "translate(" + cx + " " + cy + ") rotate(" + tilt + ")" },
                h("rect", { x: -ew / 2, y: -eh / 2, width: ew, height: eh, rx: ew / 2, fill: "#000000" })
              );
            })
          )
        ),
        h("g", { className: "ats-mascot-bob" },
          // 眼睛底片：挖空处透出来的是白色胶囊，所以眼睛是“洞”而不是贴上去的。
          h("g", { clipPath: "url(#" + clipId + ")" },
            eyes.map(function (eye, index) {
              var cx = eye[0], cy = eye[1], ew = eye[2], eh = eye[3], tilt = eye[4];
              return h("g", { key: "e" + index, transform: "translate(" + cx + " " + cy + ") rotate(" + tilt + ")" },
                h("rect", { x: -ew / 2, y: -eh / 2, width: ew, height: eh, rx: ew / 2, fill: "#ffffff" })
              );
            })
          ),
          h("g", { mask: "url(#" + maskId + ")" },
            h("path", { d: def.body, fill: accent }),
            (def.paints || []).map(function (paint, index) {
              return h("path", { key: "p" + index, d: paint[0], fill: paint[1], fillOpacity: paint[2] });
            }),
            def.shade ? h("path", { d: def.shade, fill: "#000000", fillOpacity: 0.07 }) : null,
            def.light ? h("path", { d: def.light, fill: "#ffffff", fillOpacity: 0.18 }) : null
          ),
          state === "working"
            ? h("circle", { className: "ats-mascot-ring", cx: 50, cy: 50, r: 47, fill: "none", stroke: "#fbbf24", strokeWidth: 3.4, strokeDasharray: "9 11", strokeLinecap: "round" })
            : null,
          h("circle", { cx: 84, cy: 84, r: 12, fill: "#ffffff", opacity: 0.96 }),
          h("text", { x: 84, y: 84, textAnchor: "middle", dominantBaseline: "central", fontSize: 13 }, member.emoji || "🤖")
        )
      );
    }
    /** 空状态：图标 + 一句话，比一行灰字更清楚。 */
    function Empty(props) {
      return h("div", { className: "ats-empty" },
        h("div", { className: "ats-empty-icon", "aria-hidden": "true" }, props.icon || "🫥"),
        props.title ? h("div", { className: "ats-empty-title" }, props.title) : null,
        props.hint ? h("div", { className: "ats-empty-hint" }, props.hint) : null
      );
    }

    /** 头像：上传了图片就显示图片，否则渲染动态表情。 */
    function Avatar(props) {
      var member = props.member;
      var accent = props.accent;
      var size = props.size || 40;
      var image = member.avatar && member.avatar.kind === "image" && member.avatar.imageId ? member.avatar.imageId : "";
      // 与 DS-Bot 的 BotMark 一致：照片读不出来就退回角色本身，而不是留一张破图。
      var brokenState = useState("");
      var broken = brokenState[0];
      var setBroken = brokenState[1];
      if (image.length > 0 && image !== broken) {
        return h("span", {
          className: "ats-avatar",
          style: { width: size, height: size, borderRadius: size >= 36 ? 12 : 9, overflow: "hidden", flex: "0 0 auto", display: "inline-flex" },
          title: member.name
        },
          h("img", {
            src: ROUTE_AVATAR + "?id=" + encodeURIComponent(image),
            alt: member.name,
            onError: function () { setBroken(image); },
            style: { width: "100%", height: "100%", objectFit: "cover", display: "block" }
          })
        );
      }
      return h("span", { className: "ats-avatar", style: { width: size, height: size, flex: "0 0 auto", display: "inline-flex" }, title: member.name + " · " + (member.emoji || "🤖") },
        h(Mascot, { member: member, accent: accent, size: size, state: props.state || (member.enabled === false ? "sleeping" : "idle") })
      );
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

    // 部门子智能体的批量增删改查：一个弹层里改完一次性提交（action=subs-set）。
    function SubsEditor(props) {
      var member = props.member;
      var initial = (member.department && member.department.subAgents ? member.department.subAgents : []).map(function (sub) {
        return { id: sub.id, name: sub.name, role: sub.role, emoji: sub.emoji, provider: sub.provider, model: sub.model, reasoningEffort: sub.reasoningEffort || "", roleRef: sub.roleRef };
      });
      var rowsState = useState(initial);
      var rows = rowsState[0];
      var setRows = rowsState[1];
      var selState = useState({});
      var sel = selState[0];
      var setSel = selState[1];
      var pasteState = useState({ open: false, text: "" });
      var paste = pasteState[0];
      var setPaste = pasteState[1];
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];

      var options = [{ value: "", label: "未配模型" }];
      (props.catalog || []).forEach(function (row) {
        (row.models || []).forEach(function (model) { options.push({ value: row.id + "/" + model.id, label: row.displayName + " · " + model.name }); });
      });
      var patchRow = function (index, patch) {
        setRows(function (prev) { return prev.map(function (row, i) { return i === index ? Object.assign({}, row, patch) : row; }); });
      };
      var selectedIndexes = Object.keys(sel).filter(function (key) { return sel[key] === true; }).map(Number);
      var deleteSelected = function () {
        if (selectedIndexes.length === 0) return;
        setRows(function (prev) { return prev.filter(function (row, index) { return selectedIndexes.indexOf(index) < 0; }); });
        setSel({});
      };
      var addRow = function () {
        setRows(function (prev) { return prev.concat([{ id: "", name: "", role: "", emoji: "🤖", provider: "", model: "", reasoningEffort: "", roleRef: { library: "", id: "", version: "" } }]); });
      };
      var applyPaste = function () {
        var lines = paste.text.split("\n").map(function (line) { return line.trim(); }).filter(function (line) { return line.length > 0; });
        if (lines.length === 0) { setPaste({ open: false, text: "" }); return; }
        var added = lines.map(function (line) {
          var parts = line.split("|").map(function (part) { return part.trim(); });
          var model = (parts[3] || "").split("/");
          return { id: "", name: parts[0] || "子智能体", role: parts[1] || "通用助手", emoji: parts[2] || "🤖", provider: model[0] || "", model: model[1] || "", reasoningEffort: "", roleRef: { library: "", id: "", version: "" } };
        });
        setRows(function (prev) { return prev.concat(added); });
        setPaste({ open: false, text: "" });
      };
      var save = function () {
        if (busy) return;
        setBusy(true);
        props.onSave(rows.map(function (row) { return { id: row.id, name: row.name, role: row.role, emoji: row.emoji, provider: row.provider, model: row.model, reasoningEffort: row.reasoningEffort }; }), function () { setBusy(false); });
      };
      return h("div", { className: "ats-modal" },
        h("div", { className: "ats-modal-card" },
          h("div", { className: "ats-modal-head" },
            h("span", { className: "ats-modal-title" }, "🏢 " + (member.department ? member.department.name : member.name) + " · 子智能体 " + String(rows.length)),
            h("span", { className: "ats-spacer" }),
            h("button", { className: "ats-btn tiny", type: "button", onClick: addRow }, "＋ 添加"),
            h("button", { className: "ats-btn tiny", type: "button", onClick: function () { setPaste({ open: !paste.open, text: paste.text }); } }, "📋 批量粘贴"),
            h("button", { className: "ats-btn tiny danger", type: "button", disabled: selectedIndexes.length === 0, onClick: deleteSelected }, "删除选中 " + String(selectedIndexes.length)),
            h("button", { className: "ats-btn tiny primary", type: "button", disabled: busy, onClick: save }, busy ? "保存中…" : "保存"),
            h("button", { className: "ats-btn tiny", type: "button", onClick: props.onClose }, "关闭")
          ),
          paste.open
            ? h("div", { className: "ats-field" },
                h("span", { className: "ats-label" }, "每行一个：名称 | 职责 | emoji | provider/model"),
                h("textarea", { className: "ats-textarea", rows: 4, value: paste.text, onChange: function (e) { setPaste({ open: true, text: e.target.value }); } }),
                h("button", { className: "ats-btn tiny primary", type: "button", onClick: applyPaste }, "导入")
              )
            : null,
          h("div", { className: "ats-subs-table" },
            rows.map(function (row, index) {
              var current = row.provider.length > 0 && row.model.length > 0 ? row.provider + "/" + row.model : "";
              return h("div", { key: row.id || "row-" + String(index), className: "ats-subs-row" },
                h("input", { type: "checkbox", checked: sel[index] === true, onChange: function (e) { setSel(function (prev) { return Object.assign({}, prev, { [index]: e.target.checked }); }); } }),
                h("input", { className: "ats-input", style: { width: "60px" }, value: row.emoji, onChange: function (e) { patchRow(index, { emoji: e.target.value }); } }),
                h("input", { className: "ats-input", style: { flex: "1 1 140px" }, placeholder: "名称", value: row.name, onChange: function (e) { patchRow(index, { name: e.target.value }); } }),
                h("input", { className: "ats-input", style: { flex: "1 1 120px" }, placeholder: "职责", value: row.role, onChange: function (e) { patchRow(index, { role: e.target.value }); } }),
                h("select", { className: "ats-select", style: { flex: "1 1 180px" }, value: current, onChange: function (e) {
                  var parts = e.target.value.split("/");
                  patchRow(index, { provider: parts[0] || "", model: parts[1] || "" });
                } }, options.map(function (option) { return h("option", { key: option.value, value: option.value }, option.label); })),
                h("button", { className: "ats-btn tiny", type: "button", title: "删除这一行", onClick: function () {
                  setRows(function (prev) { return prev.filter(function (item, i) { return i !== index; }); });
                  setSel({});
                } }, "🗑")
              );
            })
          )
        )
      );
    }

    function MemberCard(props) {
      var member = props.member;
      var busy = props.busy;
      var editingState = useState(false);
      var editing = editingState[0];
      var setEditing = editingState[1];
      // 删除改成“两段式”内联确认：不依赖 window.confirm（桌面端会拦截/阻塞，点了没反应）。
      var confirmState = useState(false);
      var confirmDelete = confirmState[0];
      var setConfirmDelete = confirmState[1];
      useEffect(function () {
        if (!confirmDelete) return undefined;
        var timer = setTimeout(function () { setConfirmDelete(false); }, 5000);
        return function () { clearTimeout(timer); };
      }, [confirmDelete]);
      // 从侧栏头像点进来时，直接展开这张卡的编辑表单。
      useEffect(function () { if (props.forceEdit === true) setEditing(true); }, [props.forceEdit]);
      var libraryState = useState({ open: false, loading: false, error: "", items: [] });
      var library = libraryState[0];
      var setLibrary = libraryState[1];

      var openLibrary = function () {
        setLibrary({ open: true, loading: true, error: "", items: library.items });
        fetch("/api/team-workbench/avatar-library", { cache: "no-store" })
          .then(function (res) { return readJsonResponse(res); })
          .then(function (payload) {
            if (payload.ok === false) throw new Error(payload.error || "读取头像库失败");
            setLibrary({ open: true, loading: false, error: "", items: payload.items || [] });
          })
          .catch(function (error) { setLibrary({ open: true, loading: false, error: String(error && error.message ? error.message : error), items: [] }); });
      };
      var postLibrary = function (body) {
        return fetch("/api/team-workbench/avatar-library", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
        }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
          if (payload.ok === false) throw new Error(payload.error || "操作失败");
          return payload;
        });
      };
      var useLibraryItem = function (id) {
        postLibrary({ action: "assign", memberId: member.id, id: id })
          .then(function (data) { setLibrary({ open: false, loading: false, error: "", items: library.items }); props.onReload(data); })
          .catch(function (error) { setLibrary(Object.assign({}, library, { error: String(error && error.message ? error.message : error) })); });
      };
      var importLibraryFiles = function (files) {
        var list = Array.prototype.slice.call(files || []).slice(0, 20);
        if (list.length === 0) return;
        setLibrary(Object.assign({}, library, { error: "", loading: true }));
        Promise.all(list.map(function (file) {
          return avatarDataUrl(file).then(function (url) { return { name: file.name, dataUrl: url }; }).catch(function (error) { return { name: file.name, error: String(error && error.message ? error.message : error) }; });
        })).then(function (prepared) {
          var ok = prepared.filter(function (item) { return item.dataUrl !== undefined; });
          var failed = prepared.filter(function (item) { return item.dataUrl === undefined; });
          if (ok.length === 0) throw new Error(failed.length > 0 ? failed[0].error : "没有可导入的图片");
          return postLibrary({ action: "import", items: ok }).then(function (payload) {
            var rejected = (payload.results || []).filter(function (item) { return item.ok === false; });
            setLibrary({ open: true, loading: false, error: rejected.length > 0 ? rejected.length + " 张失败：" + rejected[0].error : "", items: payload.items || [] });
          });
        }).catch(function (error) { setLibrary(Object.assign({}, library, { loading: false, error: String(error && error.message ? error.message : error) })); });
      };
      var deleteLibraryItem = function (id) {
        postLibrary({ action: "delete", id: id })
          .then(function (payload) { setLibrary(Object.assign({}, library, { open: true, items: payload.items || [] })); })
          .catch(function (error) { setLibrary(Object.assign({}, library, { error: String(error && error.message ? error.message : error) })); });
      };
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
      // 部门成员：改某个子智能体的模型（保存在 department.subAgents 里）。
      var setSubModel = function (subId, value) {
        var parts = String(value || "").split("/");
        var provider = parts.length > 1 ? parts[0] : "";
        var model = parts.length > 1 ? parts.slice(1).join("/") : "";
        var base = draft.department || member.department;
        if (base === null || base === undefined) return;
        var nextSubs = base.subAgents.map(function (sub) {
          return sub.id === subId ? Object.assign({}, sub, { provider: provider, model: model }) : sub;
        });
        patchMember({ department: Object.assign({}, base, { subAgents: nextSubs }) });
        // 立即落盘：只改下拉但不点保存时，以前会“选了又变回去”（看起来像无法选择）。
        if (typeof props.onSubModel === "function") props.onSubModel(member, nextSubs);
      };

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
                usage: props.modelUsage ? props.modelUsage[String(route.provider || "") + "::" + String(route.model || "")] : null,
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
        className: "ats-card" + (member.enabled ? "" : " off") + (props.selected ? " sel" : "") + (props.isChief ? " chief" : "") + (editing ? " editing" : ""),
        style: { borderLeftColor: accent, background: tint(accent, 0.06) },
        "data-member-card": member.id
      },
        h("div", { className: "ats-card-head" },
          h("input", {
            type: "checkbox", checked: props.selected === true, title: "选中以批量操作",
            onChange: function () { props.onSelectToggle(member.id); }
          }),
          h(Avatar, { member: member, accent: accent, size: 44, state: busy ? "working" : (member.enabled === false ? "sleeping" : "idle") }),
          h("div", { className: "ats-id" },
            h("div", { className: "ats-name-line" },
              h("span", { className: "ats-name" }, member.name),
              props.isChief ? h("span", { className: "ats-tag chief" }, "总管") : null,
              member.enabled ? null : h("span", { className: "ats-tag" }, "停用"),
              member.roleRef && member.roleRef.id ? h("span", { className: "ats-tag", title: member.roleRef.id }, "角色库") : null
            ),
            h("div", { className: "ats-role" }, member.role ? h("span", { className: "ats-role-chip", title: member.role }, member.role) : null),
            h("div", { className: "ats-role", style: { opacity: .6, fontSize: "10.5px" } },
              props.lastActive ? "上次活跃 " + agoText(props.lastActive) : "还没有对话记录",
              props.usage && props.usage.total > 0 ? " · 本机今日派发 " + String(props.usage.today || 0) + " 次" : ""
            )
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
          h("button", { className: "ats-btn" + (editing ? " primary" : ""), type: "button", "data-tip": editing ? "收起" : "编辑", "aria-label": editing ? "收起" : "编辑", onClick: function () { setEditing(!editing); } }, editing ? "⌃" : "✏️"),
          h("button", {
            className: "ats-btn" + (props.isChief ? " primary" : ""), type: "button", disabled: busy,
            "data-tip": props.isChief ? "取消总管" : "设为总管",
            onClick: function () { if (props.onChief) props.onChief(member, props.isChief !== true); }
          }, props.isChief ? "★✕" : "★"),
          h("button", { className: "ats-btn", type: "button", "data-tip": "打开对话", "aria-label": "打开对话", onClick: function () { if (props.onChat) props.onChat(member.id); } }, "💬"),
          h("button", { className: "ats-btn", type: "button", disabled: busy, "data-tip": "复制", "aria-label": "复制", onClick: function () { props.onDuplicate(member); } }, "⧉"),
          h("button", {
            className: "ats-btn", type: "button", disabled: busy || !member.enabled,
            onClick: function () { props.onDispatch(member, task || ("请用一句话介绍你在团队中的职责：" + member.role)); }
          }, busy ? "⏳" : "▶"),
          h("button", {
            className: "ats-btn", type: "button", disabled: probing,
            onClick: function () {
              setProbing(true); setProbe(null);
              postProbe({ memberId: member.id })
                .then(function (data) { setProbe(data); })
                .catch(function (error) { setProbe({ ok: false, error: String(error && error.message ? error.message : error) }); })
                .then(function () { setProbing(false); });
            }
          }, probing ? "⏳" : "🧪"),
          h("button", { className: "ats-btn tiny", type: "button", title: "展开/收起模型路由", onClick: function () { setRoutesOpen(!routesOpen); } }, (routesOpen ? "▾ 模型路由" : "▸ 模型路由"))
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
                    h("button", { className: "ats-btn tiny", type: "button", title: "从素材库选一张", "data-tip": "素材库", onClick: openLibrary }, "📚"),
                    member.avatar && member.avatar.kind === "image"
                      ? h("button", { className: "ats-btn tiny", type: "button", onClick: function () { props.onAvatarClear(member); } }, "清除")
                      : null
                  )
                )
              ),
              uploadError ? h("div", { className: "ats-note err" }, uploadError) : null,
              member.department !== null && member.department !== undefined
                ? h("div", { className: "ats-field" },
                    h("span", { className: "ats-label" }, "部门子智能体（" + String(member.department.subAgents.length) + "）",
                      h("button", { className: "ats-btn tiny", type: "button", style: { marginLeft: "6px" }, onClick: function () { props.onManageSubs(member); } }, "批量管理")
                    ),
                    h("div", { className: "ats-dep-subs" },
                      member.department.subAgents.map(function (sub) {
                        var current = sub.provider.length > 0 && sub.model.length > 0 ? sub.provider + "/" + sub.model : "";
                        var options = [{ value: "", label: "未配模型" }];
                        (props.catalog || []).forEach(function (row) {
                          (row.models || []).forEach(function (model) { options.push({ value: row.id + "/" + model.id, label: row.displayName + " · " + model.name }); });
                        });
                        return h("div", { key: sub.id, className: "ats-dep-sub" },
                          h("span", { className: "ats-dep-sub-name" }, sub.emoji + " " + sub.name),
                          h("span", { className: "ats-dep-sub-role" }, sub.role),
                          h("select", {
                            className: "ats-select", style: { flex: "0 0 210px" }, value: current,
                            onChange: function (e) { setSubModel(sub.id, e.target.value); }
                          }, options.map(function (option) { return h("option", { key: option.value, value: option.value }, option.label); }))
                        );
                      })
                    )
                  )
                : null,
              library.open
                ? h("div", { className: "ats-lib" },
                    h("div", { className: "ats-lib-head" },
                      h("span", { className: "ats-lib-title" }, "素材库（" + String(library.items.length) + "）"),
                      h("label", { className: "ats-btn tiny", style: { cursor: "pointer" } },
                        "批量导入",
                        h("input", {
                          type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true,
                          style: { display: "none" },
                          onChange: function (e) { importLibraryFiles(e.target.files); e.target.value = ""; }
                        })
                      ),
                      h("button", { className: "ats-btn tiny", type: "button", onClick: function () { setLibrary(Object.assign({}, library, { open: false })); } }, "关闭")
                    ),
                    library.error ? h("div", { className: "ats-note err" }, library.error) : null,
                    library.loading
                      ? h("div", { className: "ats-sub" }, "读取中…")
                      : library.items.length === 0
                        ? h("div", { className: "ats-sub" }, "库里还没有图片；上传或批量导入后可以重复使用。")
                        : h("div", { className: "ats-lib-grid" },
                            library.items.map(function (item) {
                              return h("div", { key: item.id, className: "ats-lib-cell" },
                                h("button", {
                                  className: "ats-lib-pick", type: "button", title: item.name || item.id,
                                  onClick: function () { useLibraryItem(item.id); }
                                }, h("img", { src: item.dataUrl || ("/api/team-workbench/avatar?id=" + encodeURIComponent(item.id)), alt: item.name || "头像" })),
                                h("button", {
                                  className: "ats-lib-del", type: "button", title: "从素材库移除",
                                  onClick: function (e) { e.stopPropagation(); deleteLibraryItem(item.id); }
                                }, "✕")
                              );
                            })
                          )
                  )
                : null,
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
                h("button", { className: "ats-btn primary", type: "button", disabled: busy, "data-tip": "保存", "aria-label": "保存", onClick: function () { props.onSave(draft, function () { setEditing(false); }); } }, "💾"),
                h("button", { className: "ats-btn", type: "button", disabled: busy, "data-tip": "取消", "aria-label": "取消", onClick: function () { setDraft(member); setEditing(false); } }, "✕"),
                h("span", { className: "ats-spacer" }),
                h("button", {
                  className: "ats-btn danger" + (confirmDelete ? " primary" : ""), type: "button", disabled: busy,
                  "data-tip": confirmDelete ? "再点一次立即删除（5 秒后取消）" : "删除智能体",
                  onClick: function () {
                    if (!confirmDelete) { setConfirmDelete(true); return; }
                    setConfirmDelete(false);
                    props.onDelete(member);
                  }
                }, confirmDelete ? "确认删除？" : "删除智能体")
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

      var state = useState({ loading: true, error: "", members: [], chiefId: "", groups: [], presets: [], preset: "", roleLibrary: null, catalog: [], defaults: EMPTY_DEFAULTS, effortOptions: [], limits: null, storePath: "", pluginVersion: "" });
      var snap = state[0];
      var setSnap = state[1];
      var busyState = useState("");
      var busy = busyState[0];
      var setBusy = busyState[1];
      var resultsState = useState({});
      var results = resultsState[0];
      var setResults = resultsState[1];
      var probeAllState = useState({ busy: false, report: "" });
      var probeAll = probeAllState[0];
      var setProbeAll = probeAllState[1];
      var checkAllModels = function () {
        setProbeAll({ busy: true, report: "真实推理检测中…（每个模型发一句 ok）" });
        var unique = new Map();
        (snap.members || []).forEach(function (m) {
          (m.routes || []).forEach(function (r) {
            if (!r.provider || !r.model) return;
            var key = r.provider + "|" + r.model + "|" + (r.reasoningEffort || "");
            if (!unique.has(key)) unique.set(key, { provider: r.provider, model: r.model, reasoningEffort: r.reasoningEffort || "", routes: [], subs: [] });
            unique.get(key).routes.push({ memberId: m.id, routeId: r.id, label: m.name });
          });
          ((m.department && m.department.subAgents) || []).forEach(function (s) {
            if (!s.provider || !s.model) return;
            var key = s.provider + "|" + s.model + "|" + (s.reasoningEffort || "");
            if (!unique.has(key)) unique.set(key, { provider: s.provider, model: s.model, reasoningEffort: s.reasoningEffort || "", routes: [], subs: [] });
            unique.get(key).subs.push({ memberId: m.id, subId: s.id, label: m.name + " / " + s.name });
          });
        });
        var entries = Array.from(unique.values());
        if (entries.length === 0) { setProbeAll({ busy: false, report: "团队里没有配置模型。" }); return; }
        var bad = [];
        var good = [];
        var run = function (index) {
          if (index >= entries.length) {
            var tasks = [];
            bad.forEach(function (entry) {
              entry.routes.forEach(function (r) {
                tasks.push(fetch("/api/team-workbench/members", {
                  method: "POST", headers: { "content-type": "application/json" },
                  body: JSON.stringify({ action: "route-delete", memberId: r.memberId, routeId: r.routeId })
                }));
              });
              entry.subs.forEach(function (s) {
                var owner = (snap.members || []).filter(function (m) { return m.id === s.memberId; })[0];
                if (owner === undefined || owner.department === null || owner.department === undefined) return;
                var subs = owner.department.subAgents.map(function (sub) {
                  return sub.id === s.subId ? Object.assign({}, sub, { provider: "", model: "" }) : sub;
                });
                tasks.push(fetch("/api/team-workbench/members", {
                  method: "POST", headers: { "content-type": "application/json" },
                  body: JSON.stringify({ action: "upsert", member: { id: owner.id, department: { name: owner.department.name, subAgents: subs } } })
                }));
              });
            });
            return Promise.all(tasks).then(function () {
              var lines = ["真实推理检测：" + String(good.length) + " 个模型可用"];
              if (bad.length > 0) {
                lines.push(String(bad.length) + " 个不可用，已清理（成员路由删除 / 子智能体模型置空）");
                bad.forEach(function (entry) { lines.push("· " + entry.provider + "/" + entry.model + " → " + String(entry.error || "无输出").slice(0, 120)); });
              }
              setProbeAll({ busy: false, report: lines.join("\n") });
              load();
            });
          }
          var entry = entries[index];
          return fetch("/api/team-workbench/probe", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "live", sessionId: sessionId, provider: entry.provider, model: entry.model, reasoningEffort: entry.reasoningEffort })
          }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
            if (payload.ok === true) good.push(entry);
            else { entry.error = String(payload.error || payload.stopReason || "不可用"); bad.push(entry); }
            return run(index + 1);
          }).catch(function (error) {
            entry.error = String(error && error.message ? error.message : error);
            bad.push(entry);
            return run(index + 1);
          });
        };
        run(0).catch(function (error) { setProbeAll({ busy: false, report: "检测失败：" + String(error && error.message ? error.message : error) }); });
      };
      // 自动分配：从宿主模型目录里挑“真实可用”的模型，轮流分给部门子智能体（以及没配路由的成员）。
      var autoAssignModels = function () {
        if (probeAll.busy) return;
        setProbeAll({ busy: true, report: "挑选可用模型…（先校验目录，再真实推理）" });
        var candidates = [];
        (snap.catalog || []).forEach(function (row) {
          (row.models || []).forEach(function (m) {
            if (candidates.length >= 40) return;
            candidates.push({ provider: row.id, model: m.id });
          });
        });
        if (candidates.length === 0) { setProbeAll({ busy: false, report: "宿主模型目录为空，无法自动分配。" }); return; }
        var valid = [];
        var metaIndex = 0;
        var liveIndex = 0;
        var metaOk = [];
        var metaStep = function () {
          if (metaIndex >= candidates.length) { return liveStep(); }
          var candidate = candidates[metaIndex];
          return fetch("/api/team-workbench/probe", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider: candidate.provider, model: candidate.model })
          }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
            if (payload.ok === true) {
              var names = (payload.inputModalities || []).map(String);
              if (names.length === 0 || names.indexOf("text") >= 0) metaOk.push(candidate);
            }
            metaIndex += 1;
            return metaStep();
          }).catch(function () { metaIndex += 1; return metaStep(); });
        };
        var liveStep = function () {
          if (liveIndex >= metaOk.length || valid.length >= 6) return assign();
          var candidate = metaOk[liveIndex];
          if (liveIndex === 0) {
            // 先把候选按 provider 轮转排序，避免 6 个名额全被同一家占满（模型多样性）。
            var grouped = new Map();
            metaOk.forEach(function (item) {
              if (!grouped.has(item.provider)) grouped.set(item.provider, []);
              grouped.get(item.provider).push(item);
            });
            var orderedNext = [];
            for (var round = 0; round < 40; round += 1) {
              var added = false;
              grouped.forEach(function (list) { if (list[round] !== undefined) { orderedNext.push(list[round]); added = true; } });
              if (!added) break;
            }
            metaOk = orderedNext;
            candidate = metaOk[0];
          }
          return fetch("/api/team-workbench/probe", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "live", sessionId: sessionId, provider: candidate.provider, model: candidate.model })
          }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
            if (payload.ok === true) valid.push(candidate);
            liveIndex += 1;
            return liveStep();
          }).catch(function () { liveIndex += 1; return liveStep(); });
        };
        var assign = function () {
          if (valid.length === 0) { setProbeAll({ busy: false, report: "没有通过真实推理的模型，未做分配。" }); return; }
          var tasks = [];
          (snap.members || []).forEach(function (m) {
            if (m.department !== null && m.department !== undefined && m.department.subAgents.length > 0) {
              var subs = m.department.subAgents.map(function (sub, index) {
                var pick = valid[index % valid.length];
                return Object.assign({}, sub, { provider: pick.provider, model: pick.model });
              });
              var lead = valid[0];
              tasks.push(fetch("/api/team-workbench/members", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "upsert", member: { id: m.id, department: { name: m.department.name, subAgents: subs }, routes: [{ id: "lead-" + m.id.slice(-6), label: "部门主管", provider: lead.provider, model: lead.model, reasoningEffort: "", enabled: true }] } })
              }));
              return;
            }
            if ((m.routes || []).length === 0) {
              var first = valid[0];
              tasks.push(fetch("/api/team-workbench/members", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "upsert", member: { id: m.id, routes: [{ id: "auto-" + m.id.slice(-6), label: "自动分配", provider: first.provider, model: first.model, reasoningEffort: "", enabled: true }] } })
              }));
            }
          });
          return Promise.all(tasks).then(function () {
            setProbeAll({ busy: false, report: "已分配 " + String(valid.length) + " 个可用模型（真实推理通过）：" + valid.map(function (v) { return v.provider + "/" + v.model; }).join("、") });
            load();
          });
        };
        metaStep();
      };
      var subsOpenState = useState("");
      var subsOpen = subsOpenState[0];
      var setSubsOpen = subsOpenState[1];
      var mergeState = useState({ open: false, busy: "", error: "" });
      var merge = mergeState[0];
      var setMergeState = mergeState[1];
      var mergeOpen = merge.open;
      var setMergeOpen = function (next) { setMergeState(function (prev) { return Object.assign({}, prev, { open: next }); }); };
      var mergeDepartment = function (name) {
        setMergeState(function (prev) { return Object.assign({}, prev, { busy: name }); });
        fetch("/api/team-workbench/chats/merge", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name })
        }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
          if (payload.ok === false) throw new Error(payload.error || "合并失败");
          setBanner("已把「" + name + "」合并成 1 个部门智能体：" + String(payload.merged) + " 个子智能体，私聊历史 " + String(payload.messages) + " 条。");
          load();
          setMergeState({ open: false, busy: "", error: "" });
        }).catch(function (error) {
          var message = String(error && error.message ? error.message : error);
          setMergeState(function (prev) { return Object.assign({}, prev, { busy: "", error: message }); });
        });
      };
      var bannerState = useState("");
      var banner = bannerState[0];
      var setBanner = bannerState[1];
      var queryState = useState("");
      var query = queryState[0];
      var setQuery = queryState[1];
      var selectedState = useState({});
      var selected = selectedState[0];
      var setSelected = selectedState[1];
      // 团队页批量删除：先勾卡片左上角复选框，再点工具栏 🗑（两段确认）。
      var bulkTeamState = useState({ confirm: false, busy: false });
      var bulkTeam = bulkTeamState[0];
      var setBulkTeam = bulkTeamState[1];
      var deleteSelected = function () {
        var ids = Object.keys(selected).filter(function (id) { return selected[id] === true; });
        if (ids.length === 0) { setBanner("先勾选要删除的智能体（卡片左上角复选框），再点这里。"); return; }
        if (bulkTeam.confirm !== true) { setBulkTeam({ confirm: true, busy: false }); setBanner("已选 " + String(ids.length) + " 个，再点一次「确认删除」即可。"); return; }
        setBulkTeam({ confirm: false, busy: true });
        fetch("/api/team-workbench/members", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "delete-many", ids: ids })
        }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
          if (payload.ok === false) throw new Error(payload.error || "删除失败");
          setSelected({});
          setBanner("已删除 " + String(ids.length) + " 个智能体。");
          load();
        }).catch(function (error) { setBanner("删除失败：" + String(error && error.message ? error.message : error)); })
          .then(function () { setBulkTeam({ confirm: false, busy: false }); });
      };
      // 勾选变化后取消"确认"状态，避免误删上一次的选择。
      useEffect(function () { setBulkTeam(function (prev) { return prev.confirm ? { confirm: false, busy: prev.busy } : prev; }); }, [Object.keys(selected).length]);
      var viewState = useState("grouped");
      var view = viewState[0];
      var setView = viewState[1];
      var presetOpenState = useState(false);
      var presetOpen = presetOpenState[0];
      var setPresetOpen = presetOpenState[1];
      var collapsedState = useState({});
      var collapsed = collapsedState[0];
      var setCollapsed = collapsedState[1];
      var usageState = useState({ models: [], members: [] });
      var usage = usageState[0];
      var setUsage = usageState[1];
      var lastActiveState = useState({});
      var lastActive = lastActiveState[0];
      var setLastActive = lastActiveState[1];

      var load = useCallback(function () {
        setSnap(function (prev) { return Object.assign({}, prev, { loading: true, error: "" }); });
        fetchState().then(function (data) {
          setSnap({
            loading: false,
            error: data.catalogError ? String(data.catalogError) : "",
            members: Array.isArray(data.members) ? data.members : [],
            chiefId: typeof data.chiefId === "string" ? data.chiefId : "",
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
        fetchUsage().then(setUsage).catch(function () { /* 统计可选 */ });
        fetchChats().then(function (payload) {
          var map = {};
          (payload.private || []).forEach(function (row) { if (row.updatedAt) map[row.memberId] = row.updatedAt; });
          setLastActive(map);
        }).catch(function () { /* 会话可选 */ });
      }, []);

      useEffect(function () { load(); }, [load]);

      // 从侧栏头像跳过来时，滚到那张卡，避免用户还要自己找。
      useEffect(function () {
        if (typeof props.focusMemberId !== "string" || props.focusMemberId.length === 0) return;
        var timer = setTimeout(function () {
          var node = document.querySelector('[data-member-card="' + props.focusMemberId + '"]');
          if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "start", behavior: "smooth" });
        }, 120);
        return function () { clearTimeout(timer); };
      }, [props.focusMemberId]);

      var modelUsage = {};
      (usage.models || []).forEach(function (row) { modelUsage[String(row.provider || "") + "::" + String(row.model || "")] = row; });
      var memberUsage = {};
      (usage.members || []).forEach(function (row) { memberUsage[row.memberId] = row; });

      var applyState = useCallback(function (data) {
        setSnap(function (prev) {
          return Object.assign({}, prev, {
            loading: false,
            members: Array.isArray(data.members) ? data.members : [],
            chiefId: typeof data.chiefId === "string" ? data.chiefId : prev.chiefId,
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
          forceEdit: props.focusMemberId === member.id,
          colorIndex: members.indexOf(member),
          catalog: snap.catalog,
          groups: groups,
          defaults: snap.defaults,
          effortOptions: snap.effortOptions,
          limits: snap.limits,
          selected: selected[member.id] === true,
          busy: busy === member.id || busy === "save",
          lastActive: lastActive[member.id] || "",
          usage: memberUsage[member.id] || null,
          modelUsage: modelUsage,
          result: results[member.id],
          onSelectToggle: function (id) {
            setSelected(function (prev) { var next = Object.assign({}, prev); if (next[id]) delete next[id]; else next[id] = true; return next; });
          },
          onSave: function (draft, done) { mutate("save", { action: "upsert", member: draft }, "已保存「" + draft.name + "」。", done); },
          onManageSubs: function (m) { setSubsOpen(m.id); },
          onSubModel: function (m, subs) {
            mutate("save", { action: "upsert", member: { id: m.id, department: { name: m.department.name, subAgents: subs } } }, "已更新「" + m.name + "」的子智能体模型。");
          },
          isChief: snap.chiefId === member.id,
          onChief: function (m, make) { mutate("save", { action: make ? "chief" : "chief-clear", id: m.id }, make ? "「" + m.name + "」现在是总管。" : "已取消总管。"); },
          onDelete: function (m) {
            if (m.id === snap.chiefId) { setBanner("「" + m.name + "」是总管台的管理员（★），不能删除；请先把别的成员设为总管。"); return; }
            mutate("save", { action: "delete", id: m.id }, "已删除「" + m.name + "」。");
          },
          onDuplicate: function (m) { mutate("save", { action: "duplicate", id: m.id }, "已复制「" + m.name + "」。"); },
          onDispatch: dispatch,
          onReload: applyState,
          onChat: props.onChat,
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
        listBody = h(Empty, { icon: "⏳", title: "正在读取团队配置…" });
      } else if (visible.length === 0) {
        listBody = members.length === 0
          ? h(Empty, { icon: "👥", title: "还没有成员", hint: "点「项目部预设」一键成立 15 人项目部，或从「角色库」挑角色加入。" })
          : h(Empty, { icon: "🔍", title: "没有匹配「" + query + "」的成员", hint: "换个关键词，或清空搜索。" });
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
                ? h("button", { className: "ats-btn tiny", type: "button", "data-tip": "重命名分组", "aria-label": "重命名分组", onClick: function () { renameGroup(group); } }, "✏️")
                : null,
              group
                ? h("button", { className: "ats-btn tiny danger", type: "button", "data-tip": "删除分组", "aria-label": "删除分组", onClick: function () { deleteGroup(group); } }, "🗑️")
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
              (function () {
                var chief = members.filter(function (m) { return m.id === snap.chiefId; })[0];
                return (chief ? "总管 " + chief.name + " · " : "未指定总管 · ") +
                  String(members.length) + " 名成员 · " + String(groups.length) + " 个分组 · " +
                  String(routeTotal) + " 条模型路由 · " + String(bound) + " 名已配置模型";
              })() +
              (snap.pluginVersion ? " · v" + snap.pluginVersion : ""))
          ),
          h("span", { className: "ats-spacer" }),
          h("button", {
            className: "ats-btn" + (bulkTeam.confirm ? " danger" : ""), type: "button", disabled: bulkTeam.busy,
            "data-tip": "批量删除：勾选成员卡片左上角复选框后点这里", "aria-label": "批量删除",
            onClick: deleteSelected
          }, bulkTeam.busy ? "删除中…" : (bulkTeam.confirm ? "确认删除 " + String(selectedCount) : "🗑 批量删除")),
          h("button", {
            className: "ats-btn", type: "button", disabled: probeAll.busy,
            "data-tip": "检测全部模型路由（真实推理），删除失效的", "aria-label": "检测全部模型",
            onClick: checkAllModels
          }, probeAll.busy ? "⏳" : "🩺"),
          h("button", {
            className: "ats-btn", type: "button", disabled: probeAll.busy,
            "data-tip": "自动分配：挑真实可用的模型，轮流分给子智能体", "aria-label": "自动分配模型",
            onClick: autoAssignModels
          }, "🎲"),
          h("button", {
            className: "ats-btn", type: "button", disabled: busy === "save",
            "data-tip": "清理失效模型：删除目录里已不存在的路由/子智能体模型", "aria-label": "清理失效模型",
            onClick: function () {
              setBanner("清理中…");
              postMembers({ action: "models-clean" }).then(function (data) {
                applyState(data);
                setBanner("已清理失效模型（目录里不存在的路由 / 子智能体模型已移除）。");
              }).catch(function (error) { setBanner("清理失败：" + String(error && error.message ? error.message : error)); });
            }
          }, "🧹"),
          h("button", {
            className: "ats-btn", type: "button", disabled: busy === "save",
            "data-tip": "把同部门成员合并成一个部门智能体", "aria-label": "合并部门",
            onClick: function () { setMergeOpen(!mergeOpen); }
          }, "🧩"),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "save", "data-tip": "刷新", "aria-label": "刷新", onClick: load }, "↻"),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "preset", onClick: function () { setPresetOpen(!presetOpen); } }, "项目部预设"),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "save", "data-tip": "新建总管", "aria-label": "新建一位总管", onClick: function () { mutate("save", { action: "chief-create" }, "已新建一位总管。"); } }, "★＋"),
          h("button", { className: "ats-btn primary", type: "button", disabled: busy === "save", "data-tip": "新建智能体", "aria-label": "新建智能体", onClick: createOne }, "＋")
        ),
        probeAll.report.length > 0
          ? h("div", { className: "ats-sub", style: { color: probeAll.report.indexOf("已删除") >= 0 ? "#b45309" : "#15803d" } }, probeAll.report)
          : null,
        subsOpen.length > 0 && members.filter(function (m) { return m.id === subsOpen; })[0] !== undefined
          ? h(SubsEditor, {
              member: members.filter(function (m) { return m.id === subsOpen; })[0],
              catalog: snap.catalog,
              onClose: function () { setSubsOpen(""); },
              onSave: function (subs, done) {
                postMembers({ action: "subs-set", deptId: subsOpen, subs: subs }).then(function (data) {
                  applyState(data);
                  setBanner("已保存 " + String(subs.length) + " 个子智能体。");
                  setSubsOpen("");
                  if (typeof done === "function") done();
                }).catch(function (error) {
                  setBanner("保存失败：" + String(error && error.message ? error.message : error));
                  if (typeof done === "function") done();
                });
              }
            })
          : null,
        mergeOpen
          ? h("div", { className: "ats-merge" },
              h("div", { className: "ats-merge-head" }, "把同部门成员合并成一个部门智能体（子智能体保留，私聊历史合并）"),
              merge.error ? h("div", { className: "ats-note err" }, merge.error) : null,
              (function () {
                var map = new Map();
                members.forEach(function (m) {
                  var name = m.departmentName || "";
                  if (name.length === 0) return;
                  if (!map.has(name)) map.set(name, []);
                  map.get(name).push(m);
                });
                var rows = Array.from(map.entries()).filter(function (entry) { return entry[1].length >= 2; });
                if (rows.length === 0) return h("div", { className: "ats-sub" }, "没有可合并的部门（需要同部门 ≥2 名成员）。");
                return h("div", { className: "ats-merge-list" },
                  rows.map(function (entry) {
                    var name = entry[0];
                    return h("div", { key: name, className: "ats-merge-row" },
                      h("span", { className: "ats-merge-name" }, "🏢 " + name),
                      h("span", { className: "ats-sub" }, String(entry[1].length) + " 个子智能体"),
                      h("span", { className: "ats-spacer" }),
                      h("button", {
                        className: "ats-btn tiny primary", type: "button", disabled: merge.busy === name,
                        onClick: function () { mergeDepartment(name); }
                      }, merge.busy === name ? "合并中…" : "合并")
                    );
                  })
                );
              })(),
              h("div", { className: "ats-row", style: { marginTop: "6px", gap: "6px" } },
                h("button", {
                  className: "ats-btn tiny primary", type: "button", disabled: merge.busy.length > 0,
                  onClick: function () {
                    var names = [];
                    var map = new Map();
                    members.forEach(function (m) {
                      var name = m.departmentName || "";
                      if (name.length === 0) return;
                      if (!map.has(name)) map.set(name, []);
                      map.get(name).push(m);
                    });
                    map.forEach(function (list, name) { if (list.length >= 2) names.push(name); });
                    if (names.length === 0) { setBanner("没有可合并的部门。"); return; }
                    if (!window.confirm("把 " + String(names.length) + " 个部门全部合并？合并后每个部门只剩 1 个成员，私聊历史会合并。")) return;
                    setMergeState(function (prev) { return Object.assign({}, prev, { busy: "全部" }); });
                    var run = function (index, total) {
                      if (index >= names.length) {
                        setBanner("已合并 " + String(total) + " 个部门。");
                        load();
                        setMergeState({ open: false, busy: "", error: "" });
                        return Promise.resolve();
                      }
                      return fetch("/api/team-workbench/chats/merge", {
                        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: names[index] })
                      }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
                        if (payload.ok === false) throw new Error(names[index] + "：" + payload.error);
                        return run(index + 1, total + 1);
                      });
                    };
                    run(0, 0).catch(function (error) {
                      setMergeState(function (prev) { return Object.assign({}, prev, { busy: "" }); });
                      setBanner("合并中断：" + String(error && error.message ? error.message : error));
                    });
                  }
                }, merge.busy === "全部" ? "全部合并中…" : "全部合并"),
                h("button", { className: "ats-btn tiny", type: "button", onClick: function () { setMergeOpen(false); } }, "关闭")
              )
            )
          : null,

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
      var deptState = useState({ busy: false, mode: "rotate", importMode: "department", catalog: [], defaults: null });
      var dept = deptState[0];
      var setDept = deptState[1];

      useEffect(function () {
        fetchState().then(function (data) {
          setGroups(Array.isArray(data.groups) ? data.groups : []);
          setDept(function (prev) {
            return Object.assign({}, prev, {
              catalog: Array.isArray(data.catalog) ? data.catalog : [],
              defaults: data.defaults !== null && typeof data.defaults === "object" ? data.defaults : null
            });
          });
        }).catch(function () { /* 分组读取失败只影响「加入分组」，不影响浏览 */ });
      }, []);

      // 部门级导入：整部门角色一次建成员，并按策略给每人配模型路由。
      var modelPool = function () {
        if (dept.mode === "default") {
          return dept.defaults !== null && dept.defaults.provider ? [{ provider: dept.defaults.provider, model: dept.defaults.model }] : [];
        }
        var pool = [];
        (dept.catalog || []).forEach(function (row) {
          (row.models || []).forEach(function (entry) {
            if (pool.length < 12) pool.push({ provider: row.id, model: entry.id });
          });
        });
        return pool;
      };
      var importDepartment = function (departmentId) {
        if (departmentId.length === 0) return;
        setDept(function (prev) { return Object.assign({}, prev, { busy: true }); });
        setBanner("");
        fetchRoles("", departmentId, 0, 200).then(function (data) {
          var roles = Array.isArray(data.roles) ? data.roles : [];
          if (roles.length === 0) throw new Error("这个部门没有可加入的角色");
          var label = departmentId;
          (data.categories || []).forEach(function (c) { if (c.id === departmentId) label = c.name; });
          var asDepartment = dept.importMode === "department";
          return postRoles({
            ids: roles.map(function (role) { return role.id; }),
            groupId: target,
            models: modelPool(),
            asDepartment: asDepartment,
            departmentName: asDepartment ? label : ""
          }).then(function (payload) {
            setBanner(asDepartment
              ? "已把「" + label + "」作为 1 个部门智能体加入（内含 " + String(roles.length) + " 个子智能体），当前团队 " + String(payload.members.length) + " 名成员。"
              : "已加入「" + label + "」" + String((payload.created || []).length) + " 个智能体，当前团队 " + String(payload.members.length) + " 名成员。");
            if (props.onTeamChanged) props.onTeamChanged(payload);
            return load(query, category, 0);
          });
        }).catch(function (error) {
          setBanner(String(error && error.message ? error.message : error));
        }).then(function () { setDept(function (prev) { return Object.assign({}, prev, { busy: false }); }); });
      };

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
          }),
          h("select", {
            className: "ats-select", style: { flex: "0 0 128px" }, value: dept.importMode, title: "加入方式：逐个成员，或整个部门作为一个智能体",
            onChange: function (e) { setDept(function (prev) { return Object.assign({}, prev, { importMode: e.target.value }); }); }
          }, [["members", "逐个加入"], ["department", "整部门=1 个智能体"]].map(function (pair) { return h("option", { key: pair[0], value: pair[0] }, pair[1]); })),
          h("select", {
            className: "ats-select", style: { flex: "0 0 132px" }, value: dept.mode, title: "部门导入时的模型分配策略",
            onChange: function (e) { setDept(function (prev) { return Object.assign({}, prev, { mode: e.target.value }); }); }
          }, [["rotate", "模型：轮流分配"], ["default", "模型：跟随默认"]].map(function (pair) { return h("option", { key: pair[0], value: pair[0] }, pair[1]); })),
          category.length > 0
            ? h("button", {
                className: "ats-btn tiny primary", type: "button", disabled: dept.busy,
                title: "把这个部门的全部角色一次加入团队，并按上面的策略配模型",
                onClick: function () { importDepartment(category); }
              }, dept.busy ? "加入中…" : (dept.importMode === "department" ? "＋ 作为部门加入" : "＋ 整部门加入"))
            : null
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
            ? h(Empty, { icon: "⏳", title: "正在读取角色库…" })
            : list.roles.length === 0
              ? h(Empty, { icon: "🧩", title: "没有匹配的角色", hint: "换个关键词试试，或切到别的分类。" })
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

    //#region 会话（私聊 / 群聊）
    var CHAT_POLL_MS = 0;
    var LAST_CHAT_KEY = "dsh.teamWorkbench.lastChat.v1";
    function readLastChat() {
      try {
        var raw = window.localStorage.getItem(LAST_CHAT_KEY);
        if (!raw) return null;
        var value = JSON.parse(raw);
        if (value && (value.kind === "private" || value.kind === "group") && typeof value.id === "string" && value.id.length > 0) {
          return { kind: value.kind, id: value.id };
        }
      } catch (error) { /* 损坏的偏好直接忽略 */ }
      return null;
    }
    function writeLastChat(target) {
      try {
        if (target === null) window.localStorage.removeItem(LAST_CHAT_KEY);
        else window.localStorage.setItem(LAST_CHAT_KEY, JSON.stringify(target));
      } catch (error) { /* 隐私模式忽略 */ }
    }

    // 会话概览的内存缓存：切标签会卸载/重挂 ChatPanel，有缓存就先渲染再后台刷新，避免侧栏闪空白。
    var CHAT_OVERVIEW_CACHE = { data: null, at: 0 };
    // 正在等待回复的会话（切标签会卸载 ChatPanel，回来时要能续上「等待中」状态）。
    var PENDING_CHATS = Object.create(null);
    function cachedOverview() {
      if (CHAT_OVERVIEW_CACHE.data === null) return null;
      return CHAT_OVERVIEW_CACHE.data;
    }

    function ChatPanel(props) {
      var scope = props.scope || {};
      var sessionId = resolveSessionId(scope);
      var initial = typeof props.initialMember === "string" ? props.initialMember : "";
      var initialRoom = typeof props.initialRoom === "string" ? props.initialRoom : "";

      var warm = cachedOverview();
      var dataState = useState(warm === null
        ? { loading: true, error: "", private: [], rooms: [] }
        : { loading: false, error: "", private: warm.private, rooms: warm.rooms });
      var data = dataState[0];
      var setData = dataState[1];
      var chiefState = useState("");
      var chiefId = chiefState[0];
      var setChiefId = chiefState[1];
      var targetState = useState(initialRoom.length > 0 ? { kind: "group", id: initialRoom } : initial.length > 0 ? { kind: "private", id: initial } : readLastChat());
      var target = targetState[0];
      var setTarget = targetState[1];
      var messagesState = useState([]);
      var messages = messagesState[0];
      var setMessages = messagesState[1];
      var textState = useState("");
      var draft = textState[0];
      var setDraft = textState[1];
      // @ 补全：与 DSH 输入框一致，输入 @ 就列出可点名的成员。
      var mentionState = useState({ open: false, query: "", index: 0, start: 0 });
      var mention = mentionState[0];
      var setMention = mentionState[1];
      var mentionCandidates = (function () {
        if (!mention.open) return [];
        var snapshot = dataState[0] || {};
        var pool = snapshot.private || [];
        var room = target !== null && target.kind === "group" ? (snapshot.rooms || []).filter(function (item) { return item.id === target.id; })[0] : null;
        if (room !== undefined && room !== null && room.memberIds && room.memberIds.length > 0) {
          pool = pool.filter(function (m) { return room.memberIds.indexOf(m.memberId) >= 0; });
        }
        var needle = mention.query.toLowerCase();
        return pool.filter(function (m) { return needle.length === 0 || String(m.name).toLowerCase().indexOf(needle) >= 0; }).slice(0, 6);
      })();
      var applyMention = function (pick) {
        var el = areaRef && areaRef.current;
        var caret = el && typeof el.selectionStart === "number" ? el.selectionStart : draft.length;
        var before = draft.slice(0, mention.start);
        var after = draft.slice(caret);
        var next = before + "@" + pick.name + " " + after;
        setDraft(next);
        setMention({ open: false, query: "", index: 0, start: 0 });
        if (el) setTimeout(function () { el.focus(); el.selectionStart = el.selectionEnd = (before + "@" + pick.name + " ").length; }, 0);
      };
      // 消息反馈（👍/👎）本地记住；不给后端增加状态。
      var feedbackState = useState({});
      var feedback = feedbackState[0];
      var setFeedback = feedbackState[1];
      var copyText = function (text, message) {
        var done = function () { setBanner(message); };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(done); return; }
        } catch { /* 回退 */ }
        try {
          var area = document.createElement("textarea");
          area.value = text;
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
          done();
        } catch (error) { setBanner("复制失败：" + String(error && error.message ? error.message : error)); }
      };
      // 会话记录快捷键：⌘⇧C 复制最后一条回复、⌘⌥C 复制整段会话、⌘J/⌘K 切下一个/上一个会话、⌘E 记忆、⌘U 聚焦输入框。
      useEffect(function () {
        var onKey = function (event) {
          if (!(event.metaKey || event.ctrlKey)) return;
          var key = String(event.key || "").toLowerCase();
          if (event.shiftKey && key === "c") {
            var last = null;
            for (var i = messages.length - 1; i >= 0; i -= 1) { if (messages[i].role !== "user") { last = messages[i]; break; } }
            if (last === null) {
              if (messages.length === 0) return;
              last = messages[messages.length - 1];
            }
            event.preventDefault();
            copyText(last.text, "已复制最后一条回复（" + String(last.name) + "）。");
            return;
          }
          if (event.shiftKey && key === "u") {
            var mine = null;
            for (var j = messages.length - 1; j >= 0; j -= 1) { if (messages[j].role === "user") { mine = messages[j]; break; } }
            if (mine === null) return;
            event.preventDefault();
            copyText(mine.text, "已复制你发的最后一条消息。");
            return;
          }
          if (event.altKey && key === "c") {
            var all = messages.map(function (m) { return "## " + (m.name || m.role) + "\n" + m.text; }).join("\n\n");
            if (all.length === 0) return;
            event.preventDefault();
            copyText(all, "已复制整段会话（" + String(messages.length) + " 条）。");
            return;
          }
          if (key === "j" || key === "k") {
            var pool = rooms.length > 0 ? rooms.map(function (r) { return { kind: "group", id: r.id }; }) : [];
            var priv = members.map(function (m) { return { kind: "private", id: m.memberId }; });
            var list = pool.concat(priv);
            if (list.length === 0) return;
            event.preventDefault();
            var index = target === null ? -1 : list.findIndex(function (item) { return item.kind === target.kind && item.id === target.id; });
            var next = index < 0 ? 0 : (key === "j" ? (index + 1) % list.length : (index - 1 + list.length) % list.length);
            var pickItem = list[next];
            if (pickItem.kind === "group") pickRoom(pickItem.id); else pickPrivate(pickItem.id);
            return;
          }
          if (key === "e") { event.preventDefault(); setMemoryOpen(!memoryOpen); return; }
          if (key === "u") { event.preventDefault(); if (areaRef && areaRef.current) areaRef.current.focus(); }
        };
        window.addEventListener("keydown", onKey);
        return function () { window.removeEventListener("keydown", onKey); };
      }, [messages, rooms, members, target, memoryOpen]);
      // 宿主会话的 token / 缓存命中率（来自 DSH session projcache，只读）。
      var statsState = useState(null);
      var sessionStats = statsState[0];
      var setSessionStats = statsState[1];
      var fmtTokens = function (value) {
        var n = Number(value) || 0;
        if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
        return String(Math.round(n));
      };
      useEffect(function () {
        var alive = true;
        var loadStats = function () {
          fetch("/api/team-workbench/session-stats?sessionId=" + encodeURIComponent(sessionId), { cache: "no-store" })
            .then(function (res) { return readJsonResponse(res); })
            .then(function (payload) { if (alive && payload.ok === true) setSessionStats(payload.stats || null); })
            .catch(function () { /* 统计失败不影响聊天 */ });
        };
        loadStats();
        var timer = setInterval(loadStats, 5000);
        return function () { alive = false; clearInterval(timer); };
      }, [sessionId]);

      // 草稿清空后把输入框高度收回去（自动撑高只应发生于有内容时）。
      useEffect(function () {
        var el = areaRef && areaRef.current;
        if (!el) return;
        if (draft.length === 0) { el.style.height = ""; return; }
        el.style.height = "auto";
        el.style.height = Math.min(280, Math.max(60, el.scrollHeight)) + "px";
      }, [draft]);
      var syncMention = function (value, caret) {
        var beforeCaret = value.slice(0, caret);
        var match = /@([^\s@]{0,20})$/.exec(beforeCaret);
        if (match === null) { if (mention.open) setMention({ open: false, query: "", index: 0, start: 0 }); return; }
        setMention({ open: true, query: match[1], index: 0, start: caret - match[0].length });
      };
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var busyTargetState = useState(null);
      var busyTarget = busyTargetState[0];
      var setBusyTarget = busyTargetState[1];
      // 输入框上方的思考状态条：计时 + 每 500ms 触发一次重渲染。
      var thinkingStartState = useState(0);
      var thinkingStart = thinkingStartState[0];
      var setThinkingStart = thinkingStartState[1];
      var tickState = useState(0);
      var tick = tickState[0];
      var setTick = tickState[1];
      useEffect(function () {
        if (!busy) return undefined;
        var timer = setInterval(function () { setTick(function (n) { return n + 1; }); }, 500);
        return function () { clearInterval(timer); };
      }, [busy]);
      var thinkingSeconds = busy && thinkingStart > 0 ? Math.max(0, Math.round((Date.now() - thinkingStart) / 1000)) : 0;
      // 过程化状态：轮询服务端的 progress，能看到「现在轮到谁」和已经跑完的每一棒。
      var thinkingProgressState = useState(null);
      var thinkingProgress = thinkingProgressState[0];
      var setThinkingProgress = thinkingProgressState[1];
      var thinkingDone = thinkingProgress && Array.isArray(thinkingProgress.steps)
        ? thinkingProgress.steps.filter(function (s) { return s.phase === "done"; }).map(function (s) { return s.name; })
        : [];
      var thinkingWho = thinkingProgress && thinkingProgress.current
        ? thinkingProgress.current
        : (thinkingProgress && thinkingDone.length > 0 ? thinkingDone[thinkingDone.length - 1] : "");
      var thinkingLastDone = (function () {
        if (!thinkingProgress || !Array.isArray(thinkingProgress.steps)) return null;
        var done = thinkingProgress.steps.filter(function (s) { return s.phase === "done"; });
        return done.length > 0 ? done[done.length - 1] : null;
      })();
      var thinkingEmoji = (function () {
        if (!thinkingProgress || !Array.isArray(thinkingProgress.steps)) return "";
        var hit = thinkingProgress.steps.filter(function (s) { return s.name === thinkingWho; })[0];
        return hit && hit.emoji ? hit.emoji : "";
      })();
      // 只有「当前这段会话」自己的请求在跑时才显示思考条；切到别的会话不会串台。
      var thinkingHere = busy && busyTarget !== null && target !== null && busyTarget.kind === target.kind && busyTarget.id === target.id;
      var bannerState = useState("");
      var banner = bannerState[0];
      var setBanner = bannerState[1];
      var micState = useState(false);
      var micOn = micState[0];
      var setMicOn = micState[1];
      var recRef = React.useRef(null);
      var recorderRef = React.useRef(null);
      var chunksRef = React.useRef([]);
      var recSecondsState = useState(0);
      var recSeconds = recSecondsState[0];
      var setRecSeconds = recSecondsState[1];
      var recLevelState = useState(0);
      var recLevel = recLevelState[0];
      var setRecLevel = recLevelState[1];
      var micPermState = useState("unknown");
      var micPerm = micPermState[0];
      var setMicPerm = micPermState[1];
      useEffect(function () {
        checkMicPermission().then(setMicPerm);
      }, []);
      var audioCtxRef = React.useRef(null);
      var levelTimerRef = React.useRef(null);
      var maxRmsRef = React.useRef(0);
      var recStartedRef = React.useRef(0);
      var sttBusyState = useState(false);
      var sttBusy = sttBusyState[0];
      var setSttBusy = sttBusyState[1];
      var sttSettingsState = useState({ enabled: true, provider: "local", baseUrl: "http://127.0.0.1:9977", model: "medium", language: "zh", fallbackWebSpeech: false, apiBase: "", apiModel: "", apiKey: "", apiKeyConfigured: false, reviewEnabled: false, reviewMemberId: "", reviewGlossary: "智能体、语音识别、接口联调、验收清单" });
      var sttSettings = sttSettingsState[0];
      var setSttSettings = sttSettingsState[1];
      var sttOpenState = useState(false);
      var sttOpen = sttOpenState[0];
      var setSttOpen = sttOpenState[1];
      var sttProbeState = useState("");
      var sttProbe = sttProbeState[0];
      var setSttProbe = sttProbeState[1];
      var catalogState = useState([]);
      var catalogProviders = catalogState[0];
      var setCatalogProviders = catalogState[1];
      useEffect(function () {
        fetch("/api/team-workbench/state", { cache: "no-store" }).then(function (res) { return readJsonResponse(res); })
          .then(function (payload) { if (Array.isArray(payload && payload.catalog)) setCatalogProviders(payload.catalog); })
          .catch(function () { /* 目录可选 */ });
      }, []);

      useEffect(function () {
        fetchSttSettings(false).then(function (payload) {
          if (payload.settings) setSttSettings(payload.settings);
        }).catch(function () { /* 语音设置可选 */ });
      }, []);

      useEffect(function () {
        if (!micOn) return undefined;
        var timer = setInterval(function () { setRecSeconds(function (n) { return n + 1; }); }, 1000);
        return function () { clearInterval(timer); };
      }, [micOn]);
      var areaRef = React.useRef(null);

      // 输入框高度跟着草稿走：发送后 setDraft("") 不会触发 input 事件，
      // 只靠 onInput 的话高度会停在最后的长文本上（看起来像「输入框越变越大」）。
      useEffect(function () {
        var el = areaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = Math.min(280, Math.max(64, el.scrollHeight)) + "px";
      }, [draft, target]);

      var sttErrorText = function (error) {
        var raw = String(error && error.message ? error.message : error);
        var base = (sttSettings && sttSettings.baseUrl) || "http://127.0.0.1:9977";
        if (raw.indexOf("fetch failed") >= 0 || raw.indexOf("Failed to fetch") >= 0 || raw.indexOf("ECONNREFUSED") >= 0) {
          return "本地语音服务没启动（" + base + "）：点「语音」→「测试」确认状态；服务已配好开机自启时通常几秒内会自动恢复";
        }
        if (raw.indexOf("STT HTTP 404") >= 0) return "地址不对：这里需要一个能处理 /api 的 stt 服务（当前 " + base + "）";
        if (raw.indexOf("语音接口异常") >= 0) return raw + "：看 Harness 控制台里 stt 的报错，或先点「测试」确认服务在线";
        if (raw.indexOf("音频为空") >= 0) return "没录到声音：检查系统麦克风权限，或说话时离麦近一点";
        if (raw.indexOf("没有识别到内容") >= 0) return raw;
        return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
      };

      // 浏览器识别：本地 STT 不可用时的回退路径。
      var startWebSpeech = function () {
        var SR = typeof window === "undefined" ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
        if (SR === null || SR === undefined) {
          setBanner("本地 STT 与浏览器识别都不可用；请在「语音」里检查 STT 地址");
          return;
        }
        var rec = new SR();
        rec.lang = "zh-CN";
        rec.interimResults = true;
        rec.continuous = false;
        rec.onresult = function (event) {
          var spoken = "";
          for (var i = event.resultIndex; i < event.results.length; i += 1) spoken += event.results[i][0].transcript;
          if (spoken.length === 0) return;
          setDraft(function (prev) { return prev + spoken; });
        };
        rec.onerror = function (event) {
          setMicOn(false);
          var code = String(event.error || "");
          var friendly = code === "not-allowed" || code === "service-not-allowed"
            ? "麦克风权限被拒绝：在系统设置里允许 DSH Desktop 使用麦克风；也可以点「语音」接本地 STT"
            : code === "no-speech" ? "没听到声音，再点一次麦克风说话"
            : code === "network" ? "浏览器识别需要联网；可改用本地 STT（点「语音」）"
            : code === "audio-capture" ? "没有可用的麦克风设备"
            : "语音识别失败：" + code;
          setBanner(friendly);
        };
        rec.onend = function () { setMicOn(false); };
        try {
          rec.start();
          recRef.current = rec;
          setMicOn(true);
          setBanner("");
        } catch (error) {
          setBanner("无法启动语音识别：" + String(error && error.message ? error.message : error));
        }
      };

      // 本地 STT：录一段 webm → POST /stt → 本地 faster-whisper 转写。
      var startRecording = function (keepHint) {
        navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true
          }
        }).then(function (stream) {
          var track = stream.getAudioTracks()[0];
          if (track === undefined) { setBanner("麦克风没有音频轨道：检查系统麦克风设备"); stream.getTracks().forEach(function (t) { t.stop(); }); return; }
          var recorderOptions = { audioBitsPerSecond: 64000 };
          try { recorderOptions.mimeType = "audio/webm;codecs=opus"; } catch (error) { /* 用默认 */ }
          var mr;
          try { mr = new MediaRecorder(stream, recorderOptions); } catch (error) { mr = new MediaRecorder(stream); }
          recorderRef.current = mr;
          chunksRef.current = [];
          setRecSeconds(0);
          setRecLevel(0);
          maxRmsRef.current = 0;
          recStartedRef.current = Date.now();
          // 实时音量：既让用户看到「真的收到了声音」，也用来判断这段录音是不是静音。
          try {
            var AC = window.AudioContext || window.webkitAudioContext;
            var audioCtx = new AC();
            var analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            audioCtx.createMediaStreamSource(stream).connect(analyser);
            audioCtxRef.current = audioCtx;
            var buffer = new Float32Array(analyser.fftSize);
            levelTimerRef.current = setInterval(function () {
              analyser.getFloatTimeDomainData(buffer);
              var sum = 0;
              for (var i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
              var rms = Math.sqrt(sum / buffer.length);
              if (rms > maxRmsRef.current) maxRmsRef.current = rms;
              setRecLevel(Math.min(100, Math.round(rms * 400)));
            }, 100);
          } catch (error) { /* 没有 AudioContext 也能继续录音 */ }
          mr.ondataavailable = function (event) { if (event.data && event.data.size > 0) chunksRef.current.push(event.data); };
          mr.onstop = function () {
            stream.getTracks().forEach(function (track) { track.stop(); });
            recorderRef.current = null;
            setMicOn(false);
            if (levelTimerRef.current !== null) { clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
            if (audioCtxRef.current !== null) { try { audioCtxRef.current.close(); } catch (error) { /* 已关闭 */ } audioCtxRef.current = null; }
            var ms = Date.now() - recStartedRef.current;
            var blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
            if (ms < 600) { setBanner("录音太短（" + (ms / 1000).toFixed(1) + "s）：点一下开始，说完再点一下结束"); return; }
            if (maxRmsRef.current < 0.01) {
              setBanner("没检测到声音（音量峰值 " + Math.round(maxRmsRef.current * 100) + "%）：检查系统麦克风权限（系统设置 → 隐私与安全性 → 麦克风）和输入设备");
              return;
            }
            setSttBusy(true);
            postSttAudio(blob, ms).then(function (payload) {
              var value = String((payload && payload.text) || "").trim();
              if (value.length === 0) { setBanner("没有识别到内容，换个说法再试一次。"); return; }
              setDraft(function (prev) { return prev.length > 0 ? prev + " " + value : value; });
            }).catch(function (error) {
              if (sttSettings.fallbackWebSpeech === true) {
                setBanner("本地 STT 不可用：" + sttErrorText(error) + "；已回退浏览器识别");
                startWebSpeech();
                return;
              }
              setBanner("语音没转成：" + sttErrorText(error));
            }).then(function () { setSttBusy(false); });
          };
          mr.start();
          setMicOn(true);
          if (keepHint !== true) setBanner("");
        }).catch(function (error) {
          var name = String(error && error.name ? error.name : "");
          var msg = String(error && error.message ? error.message : error);
          if (name === "NotAllowedError" || name === "SecurityError" || msg.indexOf("Permission") >= 0) {
            setBanner("麦克风权限被拒绝：在系统设置里允许 DSH Desktop 使用麦克风；也可以点「语音」接本地 STT");
            return;
          }
          if (sttSettings.fallbackWebSpeech === true) {
            setBanner("拿不到麦克风（" + msg + "），改用浏览器识别");
            startWebSpeech();
            return;
          }
          setBanner("拿不到麦克风（" + msg + "）。点「语音」可检查本地 STT，或在设置里打开「回退浏览器识别」");
        });
      };

      // 点麦克风先看权限：没授权就先把「去哪里授权」说清楚，再决定要不要开口。
      var toggleVoice = function () {
        if (recorderRef.current !== null && recorderRef.current.state === "recording") {
          try { recorderRef.current.stop(); } catch (error) { /* 已停止 */ }
          return;
        }
        var canRecord = typeof navigator !== "undefined" && navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
        if (!canRecord) {
          if (sttSettings.fallbackWebSpeech === true) { startWebSpeech(); return; }
          setBanner("这个客户端不支持直接录音（MediaRecorder 不可用）；点「语音」可用本地 STT，或在设置里打开回退");
          return;
        }
        checkMicPermission().then(function (state) {
          setMicPerm(state);
          if (state === "denied") {
            setBanner("麦克风权限被拒绝：打开 系统设置 → 隐私与安全性 → 麦克风，勾选 DSH Desktop，然后重启 DSH 再试");
            return;
          }
          if (state === "prompt" || state === "unknown") {
            setBanner("需要麦克风权限：系统会弹窗，请点「允许」；没弹窗就去 系统设置 → 隐私与安全性 → 麦克风 勾选 DSH Desktop");
          } else {
            setBanner("");
          }
          startRecording(state !== "granted");
        }).catch(function () { startRecording(true); });
      };
      var formState = useState(null);
      var form = formState[0];
      var setForm = formState[1];
      var memoryOpenState = useState(false);
      var memoryOpen = memoryOpenState[0];
      var setMemoryOpen = memoryOpenState[1];
      var memoryDataState = useState({ summary: "", facts: [] });
      var memoryData = memoryDataState[0];
      var setMemoryData = memoryDataState[1];
      var memoryFactState = useState("");
      var memoryFact = memoryFactState[0];
      var setMemoryFact = memoryFactState[1];
      var memoryQueryState = useState("");
      var memoryQuery = memoryQueryState[0];
      var setMemoryQuery = memoryQueryState[1];
      var memoryHitsState = useState({ q: "", hits: [] });
      var memoryHits = memoryHitsState[0];
      var setMemoryHits = memoryHitsState[1];
      var memSettingsState = useState({ embedding: { enabled: true, baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3-embedding:0.6b", key: "" } });
      var memSettings = memSettingsState[0];
      var setMemSettings = memSettingsState[1];
      var memStatusState = useState("");
      var memStatus = memStatusState[0];
      var setMemStatus = memStatusState[1];
      var patchEmbedding = function (patch) {
        setMemSettings(function (prev) { return { embedding: Object.assign({}, prev.embedding, patch) }; });
      };
      var saveMemSettings = function () {
        postMemory({ action: "settings", embedding: memSettings.embedding })
          .then(function () { setMemStatus("已保存"); })
          .catch(function (error) { setMemStatus(String(error && error.message ? error.message : error)); });
      };
      var testMemSettings = function () {
        setMemStatus("测试中…");
        postMemory({ action: "settings", embedding: memSettings.embedding })
          .then(function () { return postMemory({ action: "test" }); })
          .then(function (payload) { setMemStatus("连通，向量维度 " + String(payload.dim)); })
          .catch(function (error) { setMemStatus("失败：" + String(error && error.message ? error.message : error)); });
      };
      var runMemorySearch = function () {
        var q = memoryQuery.trim();
        if (q.length === 0) { setMemoryHits({ q: "", hits: [] }); return; }
        searchMemoryServer(q).then(function (payload) { setMemoryHits({ q: q, hits: payload.hits || [] }); })
          .catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
      };

      var loadMemorySlot = function () {
        if (target === null) return;
        var kind = target.kind === "group" ? "room" : "private";
        fetchMemory(kind, target.id).then(function (payload) {
          var slot = payload.memory || { summary: "", facts: [] };
          setMemoryData(Object.assign({}, slot, { persona: payload.persona || { items: [] }, stats: payload.stats || null }));
        })
          .catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
      };
      var openMemory = function () {
        setMemoryOpen(true);
        loadMemorySlot();
        fetchMemorySettings().then(function (payload) {
          if (payload.settings && payload.settings.embedding) setMemSettings(payload.settings);
        }).catch(function () { /* 设置可选 */ });
      };
      var addMemoryFact = function () {
        if (target === null) return;
        var value = memoryFact.trim();
        if (value.length === 0) return;
        postMemory({ action: "remember", kind: target.kind === "group" ? "room" : "private", id: target.id, text: value }).then(function (payload) {
          setMemoryData(Object.assign({}, payload.memory, { persona: payload.persona }));
          setMemoryFact("");
        }).catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
      };
      var forgetMemoryFact = function (factId) {
        if (target === null) return;
        postMemory({ action: "forget-fact", kind: target.kind === "group" ? "room" : "private", id: target.id, factId: factId }).then(function (payload) { setMemoryData(Object.assign({}, payload.memory, { persona: payload.persona })); })
          .catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
      };
      var clearMemory = function () {
        if (target === null) return;
        if (!window.confirm("清空这段会话的长期记忆？聊天记录不受影响。")) return;
        postMemory({ action: "clear", kind: target.kind === "group" ? "room" : "private", id: target.id }).then(function (payload) { setMemoryData(Object.assign({}, payload.memory, { persona: payload.persona })); })
          .catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
      };

      var loadOverview = useCallback(function () {
        fetchChats().then(function (payload) {
          var next = { private: payload.private || [], rooms: payload.rooms || [] };
          CHAT_OVERVIEW_CACHE.data = next;
          CHAT_OVERVIEW_CACHE.at = Date.now();
          setData({ loading: false, error: "", private: next.private, rooms: next.rooms });
        }).catch(function (error) {
          setData(function (prev) { return Object.assign({}, prev, { loading: false, error: String(error && error.message ? error.message : error) }); });
        });
      }, []);

      // 切页回来：如果这个会话还在等回复，恢复「等待中」并轮询，直到出现新回复。
      useEffect(function () {
        if (target === null) return undefined;
        var key = target.kind + ":" + target.id;
        if (PENDING_CHATS[key] === undefined) return undefined;
        setBusy(true);
        setBusyTarget(target);
        setThinkingStart(PENDING_CHATS[key]);
        var url = target.kind === "private"
          ? "/api/team-workbench/chats/private?memberId=" + encodeURIComponent(target.id)
          : "/api/team-workbench/chats/group?id=" + encodeURIComponent(target.id);
        var initial = messages.length;
        var timer = setInterval(function () {
          if (Date.now() - PENDING_CHATS[key] > 300000) {
            delete PENDING_CHATS[key];
            clearInterval(timer);
            setBusy(false);
            setBusyTarget(null);
            setBanner("这次回复超过 5 分钟仍无结果，可能已中断；可重新发送。");
            return;
          }
          fetch(url, { cache: "no-store" })
            .then(function (res) { return readJsonResponse(res); })
            .then(function (json) {
              var list = Array.isArray(json.messages) ? json.messages : [];
              setMessages(list);
              var last = list[list.length - 1];
              if (list.length > initial && last !== undefined && last.role !== "user") {
                delete PENDING_CHATS[key];
                clearInterval(timer);
                setThinkingProgress(null);
                setBusy(false);
                setBusyTarget(null);
                loadOverview();
              }
            })
            .catch(function () { /* 下一轮再试 */ });
        }, 1500);
        return function () { clearInterval(timer); };
      }, [target]);

      useEffect(function () { loadOverview(); }, [loadOverview]);
      // 定期刷新会话概览：团队页合并部门、新建成员后，侧栏不用切页也能更新。
      useEffect(function () {
        var timer = setInterval(function () { loadOverview(); }, 8000);
        return function () { clearInterval(timer); };
      }, [loadOverview]);

      // 总管：侧栏置顶显示，建群时默认当管理员。
      useEffect(function () {
        fetch("/api/team-workbench/state", { cache: "no-store" }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
          setChiefId(typeof payload.chiefId === "string" ? payload.chiefId : "");
        }).catch(function () { /* 总管可选 */ });
      }, []);

      // DS-Bot 的聊天页永远停在一个可输入的会话上：载入后若还没选中，就落到
      // 上次的会话，其次第一个群，最后第一个成员——否则右侧只有一句空提示，
      // 整个页面连输入框都没有。
      useEffect(function () {
        if (target !== null || data.loading) return;
        var rooms = data.rooms || [];
        var members = data.private || [];
        var stored = readLastChat();
        if (stored !== null) {
          var alive = stored.kind === "group"
            ? rooms.some(function (r) { return r.id === stored.id; })
            : members.some(function (m) { return m.memberId === stored.id; });
          if (alive) { setTarget(stored); return; }
        }
        if (rooms.length > 0) { setTarget({ kind: "group", id: rooms[0].id }); return; }
        if (members.length > 0) setTarget({ kind: "private", id: members[0].memberId });
      }, [target, data.loading, data.rooms, data.private]);

      useEffect(function () {
        if (target === null) { setMessages([]); return; }
        var url = target.kind === "private" ? "/api/team-workbench/chats/private?memberId=" + encodeURIComponent(target.id) : "/api/team-workbench/chats/group?id=" + encodeURIComponent(target.id);
        fetch(url, { cache: "no-store" }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
          if (payload && payload.ok === false) throw new Error(payload.error || "读取会话失败");
          setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        }).catch(function (error) {
          setBanner(String(error && error.message ? error.message : error));
        });
      }, [target]);

      var pickPrivate = function (memberId) { var next = { kind: "private", id: memberId }; writeLastChat(next); setTarget(next); };
      var pickRoom = function (roomId) { var next = { kind: "group", id: roomId }; writeLastChat(next); setTarget(next); };

      var send = function () {
        var body = draft.trim();
        if (body.length === 0 || target === null || busy) return;
        var pendingKey = target.kind + ":" + target.id;
        PENDING_CHATS[pendingKey] = Date.now();
        setBusy(true);
        setBusyTarget(target);
        setThinkingStart(Date.now());
        setBanner("");
        var path = target.kind === "private" ? "/api/team-workbench/chats/private" : "/api/team-workbench/chats/group";
        var payload = target.kind === "private"
          ? { sessionId: sessionId, memberId: target.id, text: body }
          : { sessionId: sessionId, id: target.id, text: body };
        var progressUrl = target.kind === "private"
          ? "/api/team-workbench/chats/private?memberId=" + encodeURIComponent(target.id) + "&progress=1"
          : "/api/team-workbench/chats/group?id=" + encodeURIComponent(target.id) + "&progress=1";
        setThinkingProgress(null);
        var poll = setInterval(function () {
          fetch(progressUrl, { cache: "no-store" })
            .then(function (res) { return readJsonResponse(res); })
            .then(function (json) { if (json && json.ok) setThinkingProgress(json.progress || null); })
            .catch(function () { /* 状态轮询失败不影响发送 */ });
        }, 700);
        fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(240000) })
          .then(function (res) { return readJsonResponse(res).then(function (json) { if (!res.ok || json.ok === false) throw new Error(json.error || ("发送失败 HTTP " + res.status)); return json; }); })
          .then(function (json) {
            setMessages(Array.isArray(json.messages) ? json.messages : []);
            setDraft("");
            loadOverview();
          })
          .catch(function (error) { setBanner(String(error && error.message ? error.message : error)); })
          .then(function () { delete PENDING_CHATS[pendingKey]; clearInterval(poll); setThinkingProgress(null); setBusy(false); setBusyTarget(null); });
      };

      var openForm = function () {
        var members = data.private || [];
        var chiefMember = members.filter(function (m) { return m.memberId === chiefId; })[0];
        setForm({ name: "", adminId: chiefMember ? chiefMember.memberId : members[0] ? members[0].memberId : "", memberIds: members.slice(0, 3).map(function (m) { return m.memberId; }), responder: "lead", relayDepth: 1, parallel: true, maxParallel: undefined });
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
      // 群聊删除：两段式（confirm 在桌面端会被拦），总管台直接拒绝并提示。
      var roomDelState = useState({ id: "", confirm: false });
      var roomDel = roomDelState[0];
      var setRoomDel = roomDelState[1];
      var removeRoom = function (room) {
        if (room.chief === true) { setBanner("「" + room.name + "」是总管台（系统默认群），不能删除；要换主管请到团队页设置 ★。"); return; }
        if (roomDel.confirm !== true || roomDel.id !== room.id) { setRoomDel({ id: room.id, confirm: true }); setBanner("再点一次「确认删除」即可删除「" + room.name + "」（聊天记录一起删除）。"); return; }
        setRoomDel({ id: "", confirm: false });
        postChatRoom({ action: "delete", id: room.id }).then(function (payload) {
          setTarget(null);
          setMessages([]);
          setData(function (prev) { return Object.assign({}, prev, { rooms: payload.rooms || [] }); });
          setBanner("已删除群聊「" + room.name + "」。");
        }).catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
      };

      var members = data.private || [];
      var rooms = data.rooms || [];
      var currentMember = target !== null && target.kind === "private" ? members.filter(function (m) { return m.memberId === target.id; })[0] : null;
      var currentRoom = target !== null && target.kind === "group" ? rooms.filter(function (r) { return r.id === target.id; })[0] : null;
      var title = currentMember ? currentMember.name : currentRoom ? currentRoom.name : "";
      var responderLabel = currentRoom ? (currentRoom.responder === "auto" ? "自动挑人" : currentRoom.responder === "mention" ? "只回应 @" : "管理员先答") : "";
      var relayDepth = currentRoom && typeof currentRoom.relayDepth === "number" ? currentRoom.relayDepth : 1;
      var autoParallel = (function (count) { return Math.max(3, Math.min(5, Math.ceil(Math.max(1, count) / 2))); })(currentRoom ? currentRoom.memberIds.length : 3);
      var parallelLabel = currentRoom ? (currentRoom.parallel === false ? "串行" : "并行 " + (currentRoom.maxParallel ? String(currentRoom.maxParallel) : "自动(" + String(autoParallel) + ")")) : "";
      // 群聊副标题用图标代替长文字：👑 管理员 · 👥 人数 · 💬 应答方式 · 🔁 接力层 · ⚡ 并行
      var subtitle = currentRoom
        ? [
            currentRoom.adminName ? "👑 " + currentRoom.adminName : "",
            "👥 " + String(currentRoom.memberIds.length),
            "💬 " + (currentRoom.responder === "auto" ? "自动挑人" : currentRoom.responder === "mention" ? "@ 才答" : "管理员先答"),
            "🔁 " + String(relayDepth),
            "⚡ " + (currentRoom.parallel === false ? "串行" : "并行" + (currentRoom.maxParallel ? "(" + String(currentRoom.maxParallel) + ")" : ""))
          ].filter(function (part) { return part.length > 0; }).join("  ·  ")
        : "";

      var memberById = {};
      members.forEach(function (m) { memberById[m.memberId] = m; });
      // 与 DS-Bot 的 order 一样：最近有动静的排前面；配色仍按成员原始顺序取，避免换序就换色。
      var colorIndex = {};
      members.forEach(function (m, index) { colorIndex[m.memberId] = index; });
      var colorOfMember = function (m) {
        var index = colorIndex[m.memberId];
        return colorOf(m, typeof index === "number" ? index : 0);
      };
      var stampOf = function (entry) { return Number(entry && entry.updatedAt) || 0; };
      // DS-Bot 的列表是「群 + 人」一条流，按最近动静排（没有置顶时不分组）。
      var rows = rooms.map(function (room) { return { kind: "room", item: room, at: stampOf(room), rank: room.chief === true ? 3 : 1 }; })
        .concat(members.map(function (member) { return { kind: "member", item: member, at: stampOf(member), rank: member.memberId === chiefId ? 2 : 1 }; }))
        .sort(function (a, b) { return b.rank - a.rank || b.at - a.at; });

      // 侧栏只放「头像 + 职称」：职称在上、头像在下；点职称进对话，点头像进属性页（增删改查）。
      // —— 拖拽：成员 → 群聊 / 部门 ——
      var dragState = useState("");
      var dragId = dragState[0];
      var setDragId = dragState[1];
      var dragRoomState = useState("");
      var dragRoomId = dragRoomState[0];
      var setDragRoomId = dragRoomState[1];
      var mergeRoom = function (room) {
        if (dragRoomId.length === 0 || dragRoomId === room.id || dropBusy) return;
        var sourceRoom = rooms.filter(function (item) { return item.id === dragRoomId; })[0];
        if (sourceRoom !== undefined && sourceRoom.chief === true) {
          setDragRoomId("");
          setBanner("总管群由系统维护（成员自动=全员、总管自动=管理员），不能作为合并源；可以把别的群并入它。");
          return;
        }
        setDropBusy(true);
        postChatRoom({ action: "merge", sourceId: dragRoomId, targetId: room.id })
          .then(function (payload) {
            if (payload.ok === false) throw new Error(payload.error || "合并失败");
            setDragRoomId("");
            var movedCount = typeof payload.moved === "number" ? payload.moved : 0;
            var movedMessages = typeof payload.messages === "number" ? payload.messages : 0;
            finishDrop("已把群聊合并进「" + room.name + "」：成员 " + String(movedCount) + " 人，消息 " + String(movedMessages) + " 条。");
          })
          .catch(function (error) { setDropBusy(false); setDragRoomId(""); setBanner("合并群聊失败：" + String(error && error.message ? error.message : error)); });
      };
      var dropBusyState = useState(false);
      var dropBusy = dropBusyState[0];
      var setDropBusy = dropBusyState[1];
      var finishDrop = function (message) {
        setDragId("");
        setDropBusy(false);
        if (message.length > 0) setBanner(message);
        loadOverview();
      };
      var joinRoom = function (room) {
        if (dragId.length === 0 || dropBusy) return;
        if ((room.memberIds || []).indexOf(dragId) >= 0) { finishDrop("「" + room.name + "」里已经有它了。"); return; }
        setDropBusy(true);
        postChatRoom({ action: "update", room: { id: room.id, memberIds: (room.memberIds || []).concat([dragId]) } })
          .then(function (payload) { if (payload.ok === false) throw new Error(payload.error || "加入失败"); finishDrop("已加入群聊「" + room.name + "」。"); })
          .catch(function (error) { setDropBusy(false); setDragId(""); setBanner("加入失败：" + String(error && error.message ? error.message : error)); });
      };
      var addSubToDept = function (deptId, deptName) {
        if (dragId.length === 0 || dropBusy) return;
        setDropBusy(true);
        postMembers({ action: "dept-add-sub", deptId: deptId, memberId: dragId })
          .then(function (payload) { if (payload.ok === false) throw new Error(payload.error || "加入部门失败"); finishDrop("已加入部门「" + deptName + "」的 子智能体。"); })
          .catch(function (error) { setDropBusy(false); setDragId(""); setBanner("加入部门失败：" + String(error && error.message ? error.message : error)); });
      };
      var createDeptFrom = function (ids, name) {
        if (dropBusy) return;
        setDropBusy(true);
        postMembers({ action: "dept-create", ids: ids, name: name })
          .then(function (payload) { if (payload.ok === false) throw new Error(payload.error || "组队失败"); finishDrop("已组成部门「" + name + "」。"); })
          .catch(function (error) { setDropBusy(false); setDragId(""); setBanner("组队失败：" + String(error && error.message ? error.message : error)); });
      };
      var memberRow = function (m) {
        var on = target !== null && target.kind === "private" && target.id === m.memberId;
        var working = busy && busyTarget !== null && busyTarget.kind === "private" && busyTarget.id === m.memberId;
        var picked = bulk.selected[m.memberId] === true;
        return h("div", {
          key: "member-" + m.memberId, className: "bt-person" + (bulk.on ? " bulk" : "") + (picked ? " picked" : ""),
          "aria-current": on ? "page" : undefined,
          "data-member": m.memberId,
          draggable: !bulk.on,
          onDragStart: function (e) { e.dataTransfer.setData("text/plain", m.memberId); e.dataTransfer.effectAllowed = "move"; setDragId(m.memberId); },
          onDragEnd: function () { setDragId(""); },
          onDragOver: function (e) { if (dragId.length > 0 && dragId !== m.memberId) { e.preventDefault(); e.currentTarget.classList.add("drag-over"); } },
          onDragLeave: function (e) { e.currentTarget.classList.remove("drag-over"); },
          onDrop: function (e) {
            e.preventDefault(); e.currentTarget.classList.remove("drag-over");
            if (dragId.length === 0 || dragId === m.memberId) return;
            if ((m.subAgentCount || 0) > 0) { addSubToDept(m.memberId, m.name); return; }
            createDeptFrom([dragId, m.memberId], m.name + " 部门");
          }
        },
          bulk.on ? h("span", { className: "bt-pick" }, picked ? "✓" : "") : null,
          h("button", {
            className: "bt-person-name", type: "button",
            title: bulk.on ? (picked ? "取消选择" : "选择") : (m.role ? m.role + " · " : "") + "点击打开对话",
            onClick: function () { if (bulk.on) toggleBulkId([m.memberId]); else pickPrivate(m.memberId); }
          },
            m.name,
            (m.subAgentCount || 0) > 0 ? h("span", { className: "bt-tag", title: "部门子智能体数量" }, "🏢" + String(m.subAgentCount)) : null,
            m.memberId === chiefId ? h("span", { className: "bt-tag chief", title: "总管" }, "★") : null
          ),
          h("button", {
            className: "bt-person-mark", type: "button",
            title: bulk.on ? (picked ? "取消选择" : "选择") : "打开「" + m.name + "」的属性页（增删改查）",
            "aria-label": m.name + " 属性页",
            onClick: function () { if (bulk.on) toggleBulkId([m.memberId]); else if (props.onEditMember) props.onEditMember(m.memberId); }
          },
            h(Avatar, { member: { id: m.memberId, name: m.name, emoji: m.emoji, color: m.color, enabled: true }, accent: colorOfMember(m), size: 54, state: working ? "working" : "idle" })
          )
        );
      };
      var roomRow = function (room) {
        var on = target !== null && target.kind === "group" && target.id === room.id;
        var stack = (room.memberIds || []).slice(0, 3);
        return h("button", {
          key: "room-" + room.id, type: "button", className: "bt-row",
          "aria-current": on ? "page" : undefined,
          onClick: function () { pickRoom(room.id); },
          title: "把智能体拖到这里 → 加入群聊；把别的群聊拖到这里 → 合并进来",
          draggable: true,
          onDragStart: function (e) { e.dataTransfer.setData("text/plain", room.id); e.dataTransfer.effectAllowed = "move"; setDragRoomId(room.id); },
          onDragEnd: function () { setDragRoomId(""); },
          onDragOver: function (e) { if (dragId.length > 0 || dragRoomId.length > 0) { e.preventDefault(); e.currentTarget.classList.add("drag-over"); } },
          onDragLeave: function (e) { e.currentTarget.classList.remove("drag-over"); },
          onDrop: function (e) { e.preventDefault(); e.currentTarget.classList.remove("drag-over"); if (dragRoomId.length > 0) mergeRoom(room); else joinRoom(room); }
        },
          h("span", { className: "bt-mark", style: { width: "36px", height: "36px" } },
            h("span", { className: "bt-stack", style: { position: "relative", display: "block", width: "36px", height: "36px" } },
              stack.map(function (memberId, index) {
                var teammate = memberById[memberId];
                if (teammate === undefined) return null;
                var side = index === 0 ? 26 : 22;
                var offset = index === 0 ? 0 : 14;
                return h("span", {
                  key: memberId,
                  className: "bt-mark",
                  style: {
                    position: "absolute", width: side + "px", height: side + "px",
                    left: (index === 0 ? 0 : offset) + "px", top: (index === 0 ? 0 : offset) + "px",
                    zIndex: 3 - index, borderRadius: "50%",
                    boxShadow: "0 0 0 2px var(--bt-sidebar)"
                  }
                },
                  h(Avatar, { member: { id: teammate.memberId, name: teammate.name, emoji: teammate.emoji, color: teammate.color, enabled: true }, accent: colorOfMember(teammate), size: side })
                );
              })
            )
          ),
          h("span", { className: "bt-row-body" },
            h("span", { className: "bt-row-name" },
              h("span", { className: "bt-row-title" }, room.name),
              room.chief ? h("span", { className: "bt-tag chief", title: "总管台：用户对接 + 派活" }, "★ 总管台") : null,
              (room.memberIds || []).length > 3 ? h("span", { className: "bt-tag" }, "+" + String(room.memberIds.length - 3)) : null
            ),
            h("span", { className: "bt-row-preview" }, room.count > 0 ? (room.lastText || "…") : "还没有发言")
          )
        );
      };

      // 批量删除模式：点成员/部门格子是选中，不是打开。
      var bulkState = useState({ on: false, selected: {}, busy: false, confirm: false });
      var bulk = bulkState[0];
      var setBulk = bulkState[1];
      var toggleBulkId = function (ids) {
        setBulk(function (prev) {
          var next = Object.assign({}, prev.selected);
          var allOn = ids.every(function (id) { return next[id] === true; });
          ids.forEach(function (id) { if (allOn) delete next[id]; else next[id] = true; });
          return { on: true, selected: next, busy: prev.busy, confirm: false };
        });
      };
      var deleteBulk = function () {
        var ids = Object.keys(bulk.selected);
        if (ids.length === 0) return;
        if (bulk.confirm !== true) { setBulk(function (prev) { return Object.assign({}, prev, { confirm: true }); }); return; }
        setBulk(function (prev) { return Object.assign({}, prev, { busy: true, confirm: false }); });
        fetch("/api/team-workbench/members", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "delete-many", ids: ids })
        }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
          if (payload.ok === false) throw new Error(payload.error || "删除失败");
          setBulk({ on: false, selected: {}, busy: false });
          loadOverview();
        }).catch(function (error) {
          setBulk(function (prev) { return Object.assign({}, prev, { busy: false }); });
          setBanner("删除失败：" + String(error && error.message ? error.message : error));
        });
      };

      // 新建群聊：部门默认折叠，点标题展开。
      var openDeptState = useState({});
      var openDepts = openDeptState[0];
      var setOpenDepts = openDeptState[1];

      // 侧栏一键合并：把每个 ≥2 人的部门合并成一个部门智能体，再刷新概览。
      var mergeAllDepartments = function () {
        var map = new Map();
        (data.private || []).forEach(function (m) {
          var name = m.departmentName || "";
          if (name.length === 0) return;
          if (!map.has(name)) map.set(name, []);
          map.get(name).push(m);
        });
        var names = Array.from(map.entries()).filter(function (entry) { return entry[1].length >= 2; }).map(function (entry) { return entry[0]; });
        if (names.length === 0) { setBanner("没有可合并的部门（需要同部门 ≥2 名成员）。"); return; }
        if (!window.confirm("把 " + String(names.length) + " 个部门合并成部门智能体？子智能体保留，私聊历史合并。")) return;
        setBanner("正在合并 " + String(names.length) + " 个部门…");
        var run = function (index) {
          if (index >= names.length) {
            setBanner("已合并 " + String(names.length) + " 个部门。");
            loadOverview();
            return Promise.resolve();
          }
          return fetch("/api/team-workbench/chats/merge", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: names[index] })
          }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
            if (payload.ok === false) throw new Error(names[index] + "：" + payload.error);
            return run(index + 1);
          });
        };
        run(0).catch(function (error) { setBanner("合并中断：" + String(error && error.message ? error.message : error)); });
      };

      // 部门视图：左侧一个部门只占一格，点开在主区里看这个部门的子智能体。
      var deptViewState = useState("");
      var deptView = deptViewState[0];
      var setDeptView = deptViewState[1];
      // 按部门分组：部门成员的 departmentName 由宿主侧补上（角色库分类或 department.name）。
      // 只有“多位普通成员同属一个部门”才折叠成部门格子；
      // 真正的部门智能体（member.department）本身就是一个成员，直接按成员展示。
      var departmentMap = (function () {
        var map = new Map();
        members.forEach(function (m) {
          if ((m.subAgentCount || 0) > 0) return;
          var name = m.departmentName || "";
          if (name.length === 0) return;
          if (!map.has(name)) map.set(name, []);
          map.get(name).push(m);
        });
        Array.from(map.keys()).forEach(function (name) { if (map.get(name).length < 2) map.delete(name); });
        return map;
      })();
      var groupedIds = new Set();
      Array.from(departmentMap.values()).forEach(function (list) { list.forEach(function (m) { groupedIds.add(m.memberId); }); });
      var looseMembers = members.filter(function (m) { return !groupedIds.has(m.memberId); });
      var memberCheck = function (m) {
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
      };

      return h("div", { className: "ats-root ats-im" },
        h("aside", { className: "bt-leftcol ats-im-appcol" },
          h("div", { className: "bt-side" },
            h("div", { className: "bt-side-top" },
              h("span", { className: "bt-brand" },
                h("span", { className: "bt-brand-whale" }, "🧑‍🤝‍🧑"),
                h("span", null, "智能体团队")
              ),
              h("button", {
                className: "bt-round", type: "button",
                title: "一键合并部门：把同部门的子智能体合并成一个部门智能体",
                "aria-label": "一键合并部门", onClick: mergeAllDepartments
              }, "🧩"),
              h("button", {
                className: "bt-round" + (bulk.on ? " on" : ""), type: "button",
                title: "批量删除智能体", "aria-label": "批量删除",
                onClick: function () { setBulk(function (prev) { return { on: !prev.on, selected: {}, busy: false }; }); }
              }, "🗑"),
              h("button", {
                className: "bt-round", type: "button",
                title: "快捷新建智能体", "aria-label": "新建智能体",
                onClick: function () {
                  setBanner("");
                  postMembers({ action: "upsert", member: { name: "新智能体", role: "通用助手", emoji: "🤖" } })
                    .then(function (payload) {
                      var list = payload.members || [];
                      var created = list[list.length - 1];
                      loadOverview();
                      if (created !== undefined) setTarget({ kind: "private", id: created.id });
                      setBanner("已新建「新智能体」，可在团队页改名与配模型。");
                    })
                    .catch(function (error) { setBanner("新建失败：" + String(error && error.message ? error.message : error)); });
                }
              }, "👤"),
              h("button", { className: "bt-round", type: "button", title: "新建群聊", "aria-label": "新建群聊", onClick: openForm }, "＋")
            ),
            h("div", { className: "bt-list" },
              rooms.length === 0 && members.length === 0
                ? h("div", { className: "bt-hint" }, "还没有成员")
                : [
                    rooms.length > 0 ? h("div", { key: "rooms", className: "bt-rooms" }, rooms.map(roomRow)) : null,
                    looseMembers.length > 0 ? h("div", { key: "people", className: "bt-people" }, looseMembers.map(memberRow)) : null,
                    Array.from(departmentMap.entries()).length > 0
                      ? h("div", { key: "depts", className: "bt-people" },
                          Array.from(departmentMap.entries()).map(function (entry) {
                            var on = deptView === entry[0];
                            var ids = entry[1].map(function (m) { return m.memberId; });
                            var picked = ids.length > 0 && ids.every(function (id) { return bulk.selected[id] === true; });
                            return h("div", {
                              key: "dept-" + entry[0], className: "bt-person" + (bulk.on ? " bulk" : "") + (picked ? " picked" : ""),
                              "aria-current": on ? "page" : undefined
                            },
                              bulk.on ? h("span", { className: "bt-pick" }, picked ? "✓" : "") : null,
                              h("button", {
                                className: "bt-person-name", type: "button",
                                title: bulk.on ? (picked ? "取消选择整个部门" : "选择整个部门") : entry[0] + " · " + String(entry[1].length) + " 个子智能体（可把智能体拖到这里并入）",
                                onClick: function () { if (bulk.on) toggleBulkId(ids); else setDeptView(entry[0]); },
                                onDragOver: function (e) { if (dragId.length > 0) { e.preventDefault(); e.currentTarget.classList.add("drag-over"); } },
                                onDragLeave: function (e) { e.currentTarget.classList.remove("drag-over"); },
                                onDrop: function (e) { e.preventDefault(); e.currentTarget.classList.remove("drag-over"); if (dragId.length > 0) createDeptFrom(ids.concat([dragId]), entry[0]); }
                              }, entry[0]),
                              h("button", {
                                className: "bt-person-mark", type: "button",
                                "aria-label": entry[0] + " 部门",
                                onClick: function () { if (bulk.on) toggleBulkId(ids); else setDeptView(entry[0]); }
                              },
                                h("span", { className: "bt-dept-mark" }, "🏢"),
                                h("span", { className: "bt-dept-badge" }, String(entry[1].length))
                              )
                            );
                          })
                        )
                      : null
                  ]
            ),
            bulk.on
              ? h("div", { className: "bt-bulkbar" },
                  h("span", { className: "bt-bulk-count" }, "已选 " + String(Object.keys(bulk.selected).length)),
                  h("span", { className: "ats-spacer" }),
                  h("button", { className: "bt-bulk-btn danger", type: "button", disabled: bulk.busy || Object.keys(bulk.selected).length === 0, onClick: deleteBulk }, bulk.busy ? "删除中…" : (bulk.confirm ? "确认删除？" : "删除")),
                  h("button", { className: "bt-bulk-btn", type: "button", onClick: function () { setBulk({ on: false, selected: {}, busy: false }); } }, "取消")
                )
              : null
          )
        ),
        h("div", { className: "ats-im-main" },
          deptView.length > 0
            ? (function () {
                var list = departmentMap.get(deptView) || [];
                return h("div", { className: "ats-dept-view" },
                  h("div", { className: "ats-dept-view-head" },
                    h("span", { className: "ats-dept-view-title" }, "🏢 " + deptView),
                    h("span", { className: "ats-dept-view-sub" }, String(list.length) + " 个子智能体 · 点一个进入它的私聊"),
                    h("span", { className: "ats-spacer" }),
                    h("button", {
                      className: "ats-btn tiny primary", type: "button",
                      title: "把可用模型轮流分配给这个部门的子智能体", "aria-label": "自动分配模型",
                      onClick: function () {
                        setBanner("正在自动分配模型…");
                        fetch("/api/team-workbench/members", {
                          method: "POST", headers: { "content-type": "application/json" },
                          body: JSON.stringify({ action: "models-auto" })
                        }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
                          if (payload.ok === false) throw new Error(payload.error || "分配失败");
                          setBanner("模型已自动分配。");
                          loadOverview();
                        }).catch(function (error) { setBanner("分配失败：" + String(error && error.message ? error.message : error)); });
                      }
                    }, "🎲"),
                    h("button", {
                      className: "ats-btn tiny", type: "button",
                      title: "把这个部门的成员合并成一个部门智能体", "aria-label": "合并本部门",
                      onClick: function () {
                        fetch("/api/team-workbench/chats/merge", {
                          method: "POST", headers: { "content-type": "application/json" },
                          body: JSON.stringify({ name: deptView })
                        }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
                          if (payload.ok === false) throw new Error(payload.error || "合并失败");
                          setBanner("已合并「" + deptView + "」：子智能体 " + String(payload.merged) + " 个。");
                          setDeptView("");
                          loadOverview();
                        }).catch(function (error) { setBanner("合并失败：" + String(error && error.message ? error.message : error)); });
                      }
                    }, "🧩"),
                    h("button", { className: "ats-btn tiny", type: "button", onClick: function () { setDeptView(""); } }, "关闭")
                  ),
                  h("div", { className: "ats-dept-list" },
                    list.map(function (m) {
                      return h("button", {
                        key: m.memberId, type: "button", className: "ats-dept-item",
                        onClick: function () { setDeptView(""); pickPrivate(m.memberId); }
                      },
                        h(Avatar, { member: { id: m.memberId, name: m.name, emoji: m.emoji, color: m.color, enabled: true }, accent: colorOfMember(m), size: 40 }),
                        h("span", { className: "ats-dept-item-body" },
                          h("span", { className: "ats-dept-item-name" }, m.name),
                          h("span", { className: "ats-dept-item-text" }, m.count > 0 ? (m.lastText || "…") : "还没有对话")
                        )
                      );
                    })
                  )
                );
              })()
            : null,
          h("div", { className: "ats-im-head" },
                currentRoom
                  ? h("span", { className: "ats-im-head-stack" },
                      (currentRoom.memberIds || []).slice(0, 3).map(function (memberId, index) {
                        var teammate = memberById[memberId];
                        if (teammate === undefined) return null;
                        return h("span", { key: memberId, className: "ats-im-stack-cell", style: { zIndex: 3 - index } },
                          h(Avatar, { member: { id: teammate.memberId, name: teammate.name, emoji: teammate.emoji, color: teammate.color, enabled: true }, accent: colorOfMember(teammate), size: 28 })
                        );
                      }),
                      (currentRoom.memberIds || []).length > 3 ? h("span", { className: "ats-im-stack-more" }, "+" + String(currentRoom.memberIds.length - 3)) : null
                    )
                  : currentMember
                    ? h(Avatar, { member: { id: currentMember.memberId, name: currentMember.name, emoji: currentMember.emoji, color: currentMember.color, enabled: true }, accent: colorOfMember(currentMember), size: 36 })
                    : h("span", { className: "ats-im-logo", style: { width: "36px", height: "36px", fontSize: "18px" } }, "🧑‍🤝‍🧑"),
                h("div", { className: "ats-im-head-text" },
                  h("div", { className: "ats-im-title" }, target === null ? "智能体团队" : title),
                  h("div", { className: "ats-im-sub" }, target === null ? "从左侧选一个成员或群聊开始" : (subtitle || (currentMember ? (currentMember.count > 0 ? currentMember.lastText : "私聊") : "")))
                ),
                h("span", { className: "ats-spacer" }),
                h("button", {
                  className: "ats-btn tiny", type: "button", title: "本地语音识别设置",
                  onClick: function () {
                    var next = !sttOpen;
                    setSttOpen(next);
                    if (!next) return;
                    // 打开面板就顺手探一次服务，省得用户点「测试」才发现没起。
                    setSttProbe("检测中…");
                    fetchSttSettings(true).then(function (payload) {
                      setSttProbe(payload.probe && payload.probe.ok ? "服务在线" : "服务不可达：" + String((payload.probe && payload.probe.error) || "无响应"));
                    }).catch(function (error) { setSttProbe("探测失败：" + String(error && error.message ? error.message : error)); });
                  }
                }, "🎤"),
                h("button", { className: "ats-btn tiny", type: "button", "data-tip": "长期记忆", "aria-label": "记忆", onClick: function () { if (memoryOpen) setMemoryOpen(false); else openMemory(); } }, "🧠"),
                h("button", { className: "ats-btn tiny", type: "button", "data-tip": "记录检索", "aria-label": "记录检索", onClick: function () { if (props.onOpenRecords && target !== null) props.onOpenRecords(target.kind, target.id); } }, "🗂️"),
                h("button", { className: "ats-btn tiny", type: "button", "data-tip": "团队设置", "aria-label": "设置", onClick: function () { if (props.onOpenSettings) props.onOpenSettings(); } }, "⚙️"),
                currentRoom !== null && currentRoom !== undefined
                  ? h("button", {
                      className: "ats-btn tiny" + (currentRoom.chief === true ? "" : " danger"), type: "button",
                      "data-tip": currentRoom.chief === true ? "总管台是系统默认群，不能删除" : "删除群聊（两段确认）",
                      "aria-label": "删除群聊",
                      onClick: function () { removeRoom(currentRoom); }
                    }, currentRoom.chief === true ? "🔒" : (roomDel.confirm && roomDel.id === currentRoom.id ? "确认删除" : "🗑️"))
                  : null
              ),
          h("div", {
            className: "ats-chat-log",
            ref: function (el) { if (el !== null) el.scrollTop = el.scrollHeight; }
          },
            target === null
              ? h(Empty, { icon: "💬", title: "选一个成员开始", hint: "或点输入框左侧的 ＋ 新建群聊。" })
              : messages.length === 0
              ? h(Empty, { icon: currentRoom ? "🧑‍🤝‍🧑" : "👋", title: currentRoom ? "群已建好" : "打个招呼开始对话", hint: currentRoom ? "说点什么让成员接话；@成员名 可直接点名。" : "直接输入问题，管理员会分派给合适的成员。" })
              : messages.map(function (m) {
                  if (m.role === "user") {
                    var userTokens = Math.max(0.1, Math.round(String(m.text || "").length / 1.6 / 100) / 10);
                    var userWhen = "";
                    try { userWhen = new Date(m.time || Date.now()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); } catch { userWhen = ""; }
                    return h("div", { key: m.id, className: "ats-bubble user" },
                      h("div", { className: "ats-bubble-body", style: { alignItems: "flex-end" } },
                        h("div", { className: "ats-bubble-text" }, m.text),
                        h("div", { className: "ats-msgbar" },
                          h("button", { className: "ats-msgbtn", type: "button", title: "复制这条消息（⌘⇧U 复制最后一条我发的）", "aria-label": "复制", onClick: function () { copyText(m.text, "已复制你的消息。"); } }, "⧉"),
                          h("button", {
                            className: "ats-msgbtn", type: "button", title: "重新编辑到输入框", "aria-label": "重新编辑",
                            onClick: function () { setDraft(m.text); if (areaRef && areaRef.current) areaRef.current.focus(); }
                          }, "✎"),
                          h("span", { className: "ats-msgmeta" }, "🗃 用量 " + String(userTokens) + "K tok"),
                          h("span", { className: "ats-msgmeta" }, userWhen)
                        )
                      )
                    );
                  }
                  var accent = colorOf(m, 0);
                  var tokens = Math.max(1, Math.round(String(m.text || "").length / 1.6 / 100) / 10);
                  var when = "";
                  try { when = new Date(m.time || Date.now()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); } catch { when = ""; }
                  return h("div", { key: m.id, className: "ats-bubble agent" },
                    h(Mascot, { member: { id: m.memberId, name: m.name, emoji: m.emoji }, accent: accent, size: 26 }),
                    h("div", { className: "ats-bubble-body" },
                      h("div", { className: "ats-bubble-name" }, m.name),
                      h("div", { className: "ats-bubble-text" }, m.text),
                      h("div", { className: "ats-msgbar" },
                        h("button", { className: "ats-msgbtn", type: "button", title: "复制这条回复（⌘⇧C 复制最后一条）", "aria-label": "复制", onClick: function () { copyText(m.text, "已复制回复。"); } }, "⧉"),
                        h("button", {
                          className: "ats-msgbtn" + (feedback[m.id] === "up" ? " on" : ""), type: "button", title: "有帮助", "aria-label": "赞",
                          onClick: function () { setFeedback(function (prev) { return Object.assign({}, prev, { [m.id]: prev[m.id] === "up" ? "" : "up" }); }); }
                        }, "👍"),
                        h("button", {
                          className: "ats-msgbtn" + (feedback[m.id] === "down" ? " on" : ""), type: "button", title: "没帮助", "aria-label": "踩",
                          onClick: function () { setFeedback(function (prev) { return Object.assign({}, prev, { [m.id]: prev[m.id] === "down" ? "" : "down" }); }); }
                        }, "👎"),
                        h("button", {
                          className: "ats-msgbtn", type: "button", title: "引用到输入框", "aria-label": "引用",
                          onClick: function () { setDraft(function (prev) { return (prev.length > 0 ? prev + "\n" : "") + "> " + String(m.name) + "：" + String(m.text).slice(0, 120) + "\n\n"; }); }
                        }, "↗"),
                        h("span", { className: "ats-msgmeta" }, "🗃 用量 " + String(tokens) + "K tok"),
                        h("span", { className: "ats-msgmeta" }, when)
                      )
                    )
                  );
                })
          ),
          h("div", { className: "ats-compose" },
            h("div", { className: "ats-thinking" + (thinkingHere ? " on" : "") },
              thinkingHere
                ? [
                    thinkingEmoji
                      ? h(Mascot, { key: "ava", member: { id: thinkingWho, name: thinkingWho, emoji: thinkingEmoji }, accent: colorOf({ name: thinkingWho }, 0), size: 16 })
                      : h("span", { key: "dot", className: "ats-thinking-dot" }),
                    (thinkingProgress && Array.isArray(thinkingProgress.parallel) && thinkingProgress.parallel.length > 1)
                      ? h("span", { key: "who" }, "「" + thinkingProgress.parallel.slice(0, 3).join("、") + "」" +
                          (thinkingProgress.parallel.length > 3 ? " 等 " + thinkingProgress.parallel.length + " 位" : "") + "并行处理中…")
                      : h("span", { key: "who" },
                          "「" + (thinkingWho || (currentRoom ? (currentRoom.adminName || "管理员") : title)) + "」"),
                    h("span", { key: "label", className: "ats-thinking-label" }, "深度求索中，用时 " + String(Math.max(1, thinkingSeconds)) + " 秒"),
                    thinkingDone.length > 0
                      ? h("span", { key: "trail", className: "ats-thinking-trail" },
                          thinkingDone.slice(-3).map(function (name, index) {
                            return h("span", { key: "step-" + name + String(index), className: "ats-thinking-chip" },
                              name + (index === Math.min(3, thinkingDone.length) - 1 ? " ✓" : ""));
                          }),
                          thinkingDone.length > 3 ? h("span", { key: "more", className: "ats-thinking-hint" }, " +" + String(thinkingDone.length - 3)) : null
                        )
                      : (currentRoom && currentRoom.memberIds && currentRoom.memberIds.length > 2
                          ? h("span", { key: "hint", className: "ats-thinking-hint" },
                              " · " + (currentRoom.memberIds.length > 7 ? "随后按需 @ 成员接力" : "随后最多 @ " + (currentRoom.memberIds.length - 1) + " 位成员接力"))
                          : null),
                    thinkingProgress && Array.isArray(thinkingProgress.queued) && thinkingProgress.queued.length > 0
                      ? h("span", { key: "queue", className: "ats-thinking-hint" }, " · 排队 " + String(thinkingProgress.queued.length) + " 位")
                      : null,
                    h("span", { key: "sec", className: "ats-thinking-sec" }, thinkingSeconds >= 3 ? " · " + thinkingSeconds + "s" : "")
                  ]
                : null
            ),
            h("div", { className: "ats-composer" },
              mention.open && mentionCandidates.length > 0
                ? h("div", { className: "ats-mention" },
                    mentionCandidates.map(function (m, index) {
                      return h("button", {
                        key: "mention-" + m.memberId, type: "button",
                        className: "ats-mention-row" + (index === mention.index ? " on" : ""),
                        onMouseDown: function (e) { e.preventDefault(); applyMention(m); }
                      },
                        h("span", { className: "ats-mention-name" }, m.name),
                        h("span", { className: "ats-mention-role" }, String(m.role || "").slice(0, 18))
                      );
                    })
                  )
                : null,
              h("textarea", {
                ref: areaRef,
                className: "ats-area", rows: 1, value: draft,
                placeholder: target === null
                  ? "先选一个成员或群聊，再输入消息"
                  : "发消息或创建任务，/" + " 调用指令，@ 成员或对话",
                disabled: busy || target === null,
                onChange: function (e) { setDraft(e.target.value); syncMention(e.target.value, e.target.selectionStart); },
                onInput: function (e) {
                  var el = e.target;
                  el.style.height = "auto";
                  el.style.height = Math.min(280, Math.max(60, el.scrollHeight)) + "px";
                },
                onClick: function (e) { syncMention(e.target.value, e.target.selectionStart); },
                onBlur: function () { setTimeout(function () { setMention({ open: false, query: "", index: 0, start: 0 }); }, 120); },
                onKeyDown: function (e) {
                  if (mention.open && mentionCandidates.length > 0) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setMention(function (prev) { return Object.assign({}, prev, { index: (prev.index + 1) % mentionCandidates.length }); }); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setMention(function (prev) { return Object.assign({}, prev, { index: (prev.index - 1 + mentionCandidates.length) % mentionCandidates.length }); }); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applyMention(mentionCandidates[mention.index] || mentionCandidates[0]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setMention({ open: false, query: "", index: 0, start: 0 }); return; }
                  }
                  // Enter 发送，Shift+Enter 换行，⌘/Ctrl+Enter 也发送（长文本时更顺手）。
                  if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
                  if (e.key === "Escape") { e.currentTarget.blur(); }
                }
              }),
              h("div", { className: "ats-composer-bar" },
                h("button", { className: "ats-round", type: "button", title: "新建群聊", "aria-label": "新建群聊", onClick: openForm }, "＋"),
                h("button", { className: "ats-round" + (micOn ? " recording" : ""), type: "button", title: "语音输入：点一下开始录音，再点一下结束并转写", "aria-label": "语音输入", disabled: sttBusy, onClick: toggleVoice }, micOn ? "●" : "🎤"),
                micOn ? h("span", { className: "ats-sub", style: { fontSize: "11px" } },
                  "● 录音 " + String(recSeconds) + "s · 音量 " + String(recLevel) + "% · 再点结束") : null,
                sttBusy ? h("span", { className: "ats-sub", style: { fontSize: "11px" } },
                  "识别中…（" + String(sttSettings.model || "medium") + (sttSettings.reviewEnabled === true ? " · 校对" : "") + "）") : null,
                h("span", { className: "ats-spacer" }),
                h("button", { className: "ats-send", type: "button", "data-tip": busy ? "等待回复" : "发送", "data-tip-side": "top", "aria-label": busy ? "等待回复" : "发送", disabled: busy || target === null || draft.trim().length === 0, onClick: send }, busy ? "⏳" : "➤")
              ),
              sessionStats !== null
                ? h("div", { className: "ats-stats" },
                    h("span", { className: "ats-stats-item" }, "⟳ " + String(sessionStats.turns) + " 轮 " + String(sessionStats.steps) + " 步"),
                    sessionStats.tokPerSec > 0 ? h("span", { className: "ats-stats-item" }, "· " + sessionStats.tokPerSec.toFixed(0) + " tok/s") : null,
                    h("span", { className: "ats-stats-item" }, "🗃 " + fmtTokens(sessionStats.totalTokens) + " tok"),
                    h("span", { className: "ats-stats-item" }, "· 缓存命中 " + (sessionStats.cacheHitRate * 100).toFixed(1) + "%"),
                    h("span", { className: "ats-stats-item muted" }, "· 本轮 " + fmtTokens((sessionStats.lastOutputTokens || 0) + (sessionStats.lastInputTokens || 0)))
                  )
                : null
            )
          )
        ),
        memoryOpen && target !== null
          ? h("div", { className: "ats-im-form", style: { maxHeight: "60%", overflow: "auto" } },
              h("div", { className: "ats-preset-title" }, "长期记忆 · " + (currentRoom ? currentRoom.name : title)),
              memoryData.stats
                ? h("div", { className: "ats-sub", style: { opacity: .6, fontSize: "11px" } },
                    "共 " + String(memoryData.stats.atoms) + " 条事实 · " + String(memoryData.stats.scenes) + " 段场景 · 画像 " + String(memoryData.stats.persona) + " 条")
                : null,
              h("div", { className: "ats-sub", style: { margin: "4px 0 2px" } },
                "向量召回：" + (memSettings.embedding.enabled ? "开" : "关") + " · " + memSettings.embedding.model +
                (memStatus.length > 0 ? " · " + memStatus : "")),
              h("div", { className: "ats-bar", style: { margin: "4px 0" } },
                h("input", {
                  className: "ats-input", style: { flex: "1 1 220px" }, value: memSettings.embedding.baseUrl,
                  placeholder: "embedding baseUrl（OpenAI 兼容 /v1）",
                  onChange: function (e) { patchEmbedding({ baseUrl: e.target.value }); }
                }),
                h("input", {
                  className: "ats-input", style: { flex: "0 1 150px" }, value: memSettings.embedding.model,
                  placeholder: "模型，如 nomic-embed-text",
                  onChange: function (e) { patchEmbedding({ model: e.target.value }); }
                }),
                h("label", { className: "ats-sub", style: { display: "flex", alignItems: "center", gap: "4px" } },
                  h("input", {
                    type: "checkbox", checked: memSettings.embedding.enabled !== false,
                    onChange: function (e) { patchEmbedding({ enabled: e.target.checked }); }
                  }),
                  "启用"
                ),
                h("button", { className: "ats-btn tiny", type: "button", onClick: saveMemSettings }, "保存"),
                h("button", { className: "ats-btn tiny primary", type: "button", onClick: testMemSettings }, "测试")
              ),
              h("div", { className: "ats-bar", style: { margin: "6px 0" } },
                h("input", {
                  className: "ats-input", style: { flex: "1 1 auto" }, value: memoryQuery,
                  placeholder: "跨会话检索记忆：例如 验收 / 偏好",
                  onChange: function (e) { setMemoryQuery(e.target.value); },
                  onKeyDown: function (e) { if (e.key === "Enter") { e.preventDefault(); runMemorySearch(); } }
                }),
                h("button", { className: "ats-btn tiny", type: "button", onClick: runMemorySearch }, "检索"),
                h("button", { className: "ats-btn tiny", type: "button", onClick: function () { setMemoryQuery(""); setMemoryHits({ q: "", hits: [] }); } }, "清除")
              ),
              memoryHits.q.length > 0
                ? h("div", null,
                    h("div", { className: "ats-sub", style: { margin: "2px 0 4px" } }, "「" + memoryHits.q + "」命中 " + String(memoryHits.hits.length) + " 条"),
                    memoryHits.hits.length === 0
                      ? h("div", { className: "ats-sub", style: { opacity: .6 } }, "没有命中")
                      : h("div", { className: "ats-check-list", style: { flexDirection: "column", alignItems: "stretch", maxHeight: "150px" } },
                          memoryHits.hits.map(function (hit) {
                            return h("button", {
                              key: hit.kind + ":" + hit.id + ":" + hit.atom.id, type: "button", className: "ats-hit",
                              onClick: function () {
                                if (hit.kind === "room") pickRoom(hit.id); else pickPrivate(hit.id);
                                setMemoryOpen(false);
                              }
                            },
                              h("span", { className: "ats-hit-kind" + (hit.kind === "group" ? " group" : "") }, hit.kind === "room" ? "群" : "私"),
                              h("span", { className: "ats-hit-meta" },
                                h("span", { className: "ats-hit-head" }, h("span", { className: "ats-hit-name" }, hit.conversationName)),
                                h("span", { className: "ats-hit-text" }, hit.atom.text)
                              )
                            );
                          })
                        )
                  )
                : null,
              h("div", { className: "ats-preset-title", style: { margin: "4px 0 2px" } }, "L3 用户画像（跨会话共享）"),
              (memoryData.persona && memoryData.persona.items || []).length === 0
                ? h("div", { className: "ats-sub", style: { opacity: .6 } }, "（还没有画像。）")
                : h("div", { className: "ats-check-list", style: { flexDirection: "column", alignItems: "stretch", maxHeight: "110px" } },
                    (memoryData.persona.items || []).map(function (item) {
                      return h("div", { key: item.id, className: "ats-row", style: { justifyContent: "space-between", gap: "8px" } },
                        h("span", { className: "ats-sub", style: { flex: "1 1 auto" } }, item.text),
                        h("button", {
                          className: "ats-btn tiny danger", type: "button",
                          onClick: function () {
                            if (target === null) return;
                            postMemory({ action: "forget-persona", kind: target.kind === "group" ? "room" : "private", id: target.id, factId: item.id })
                              .then(function (payload) { setMemoryData(Object.assign({}, payload.memory, { persona: payload.persona })); })
                              .catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
                          }
                        }, "删除")
                      );
                    })
                  ),
              h("div", { className: "ats-preset-title", style: { marginTop: "8px" } }, "L2 场景摘要"),
              h("div", { className: "ats-sub", style: { whiteSpace: "pre-wrap", lineHeight: 1.55, margin: "4px 0" } },
                memoryData.summary && memoryData.summary.length > 0 ? memoryData.summary : "（还没有摘要。）"),
              h("div", { className: "ats-preset-title", style: { marginTop: "6px" } }, "L1 原子事实（" + String((memoryData.facts || []).length) + " 条，注入时只取最相关的 6 条）"),
              (memoryData.facts || []).length === 0
                ? h("div", { className: "ats-sub" }, "还没有事实。每积累 12 条新消息会自动压缩一次，也可以手动添加。")
                : h("div", { className: "ats-check-list", style: { flexDirection: "column", alignItems: "stretch", maxHeight: "160px" } },
                    (memoryData.facts || []).map(function (fact) {
                      return h("div", { key: fact.id, className: "ats-row", style: { justifyContent: "space-between", gap: "8px" } },
                        h("span", { className: "ats-sub", style: { flex: "1 1 auto" } },
                          (fact.importance ? "★".repeat(Math.max(1, Math.min(5, fact.importance))) + " " : "") + fact.text +
                          (fact.key ? "（" + fact.key + "）" : "")),
                        h("button", { className: "ats-btn tiny danger", type: "button", onClick: function () { forgetMemoryFact(fact.id); } }, "删除")
                      );
                    })
                  ),
              h("div", { className: "ats-bar", style: { marginTop: "8px" } },
                h("input", {
                  className: "ats-input", style: { flex: "1 1 auto" }, value: memoryFact,
                  placeholder: "手动记一条：例如「用户偏好先给结论」",
                  onChange: function (e) { setMemoryFact(e.target.value); },
                  onKeyDown: function (e) { if (e.key === "Enter") { e.preventDefault(); addMemoryFact(); } }
                }),
                h("button", { className: "ats-btn tiny primary", type: "button", disabled: memoryFact.trim().length === 0, onClick: addMemoryFact }, "记住"),
                h("button", { className: "ats-btn tiny", type: "button", onClick: clearMemory }, "清空记忆"),
                h("button", { className: "ats-btn tiny", type: "button", onClick: function () { setMemoryOpen(false); } }, "关闭")
              )
            )
          : null,
        sttOpen
          ? h("div", { className: "ats-im-form" },
              h("div", { className: "ats-preset-title" }, "语音识别 · 选择转写服务"),
              h("div", { className: "ats-sub", style: { margin: "4px 0 2px", opacity: .7 } },
                "「测试转写」会用 0.8 秒测试音走一遍当前服务商，只验证连通、鉴权与延迟。"),
              h("div", { className: "ats-sub", style: { margin: "4px 0 6px" } },
                (sttSettings.provider || "local") === "local"
                  ? "本地 faster-whisper（jianchang512/stt，默认 http://127.0.0.1:9977）；准确率靠模型：medium 推荐。"
                  : "走该服务商自带的转写接口（OpenAI / 智谱 GLM-ASR / MiniMax / 自定义），需要填对应 API Key。"),
              h("div", { className: "ats-sub", style: { margin: "2px 0 6px" } },
                "麦克风权限：" + (micPerm === "granted" ? "已授权" : micPerm === "denied" ? "已被拒绝（系统设置 → 隐私与安全性 → 麦克风 → 勾选 DSH Desktop）" : micPerm === "prompt" ? "未授权（点 🎤 时系统会弹窗）" : "未知"),
                h("button", {
                  className: "ats-btn tiny", style: { marginLeft: "6px" }, type: "button",
                  title: "检测麦克风权限", "aria-label": "检测麦克风权限",
                  onClick: function () { checkMicPermission().then(setMicPerm); }
                }, "🔑")
              ),
              h("div", { className: "ats-bar" },
                h("select", {
                  className: "ats-select", style: { flex: "0 0 170px" }, value: sttSettings.provider || "local",
                  onChange: function (e) {
                    var preset = STT_PRESETS.filter(function (item) { return item.id === e.target.value; })[0] || STT_PRESETS[0];
                    setSttSettings(Object.assign({}, sttSettings, { provider: preset.id, apiBase: preset.apiBase, apiModel: preset.apiModel }));
                  }
                }, STT_PRESETS.map(function (preset) { return h("option", { key: preset.id, value: preset.id }, preset.label); })),
                (sttSettings.provider || "local") === "local"
                  ? h("input", {
                      className: "ats-input", style: { flex: "1 1 200px" }, value: sttSettings.baseUrl,
                      placeholder: "http://127.0.0.1:9977",
                      onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { baseUrl: e.target.value })); }
                    })
                  : h("input", {
                      className: "ats-input", style: { flex: "1 1 220px" }, value: sttSettings.apiBase,
                      placeholder: "https://…/v1",
                      onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { apiBase: e.target.value })); }
                    }),
                (sttSettings.provider || "local") === "local"
                  ? h("select", {
                      className: "ats-select", style: { flex: "0 0 130px" }, value: sttSettings.model,
                      onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { model: e.target.value })); }
                    }, [
                      ["tiny", "tiny（最快）"],
                      ["base", "base"],
                      ["small", "small"],
                      ["medium", "medium（推荐）"],
                      ["large-v3", "large-v3（最准）"]
                    ].map(function (pair) { return h("option", { key: pair[0], value: pair[0] }, pair[1]); }))
                  : h("input", {
                      className: "ats-input", style: { flex: "0 1 150px" }, value: sttSettings.apiModel,
                      placeholder: "model",
                      onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { apiModel: e.target.value })); }
                    }),
                (sttSettings.provider || "local") === "local"
                  ? null
                  : h("input", {
                      className: "ats-input", style: { flex: "0 1 170px" }, type: "password",
                      value: sttSettings.apiKey, placeholder: sttSettings.apiKeyConfigured ? "已配置（留空沿用）" : "API Key",
                      onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { apiKey: e.target.value })); }
                    }),
                h("select", {
                  className: "ats-select", style: { flex: "0 0 120px" }, value: sttSettings.model,
                  onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { model: e.target.value })); }
                }, [
              ["tiny", "tiny（最快，准确率低）"],
              ["base", "base（快）"],
              ["small", "small（推荐）"],
              ["medium", "medium（更准，慢）"],
              ["large-v3", "large-v3（最准，很慢）"]
            ].map(function (pair) { return h("option", { key: pair[0], value: pair[0] }, pair[1]); })),
                h("select", {
                  className: "ats-select", style: { flex: "0 0 100px" }, value: sttSettings.language,
                  onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { language: e.target.value })); }
                }, [["zh", "中文"], ["en", "英语"], ["ja", "日语"], ["ko", "韩语"]].map(function (pair) { return h("option", { key: pair[0], value: pair[0] }, pair[1]); })),
                h("label", { className: "ats-check" },
                  h("input", {
                    type: "checkbox", checked: sttSettings.enabled !== false,
                    onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { enabled: e.target.checked })); }
                  }),
                  "启用"
                ),
                h("label", { className: "ats-check", title: "识别完让团队里的成员做一次最小纠错（同音字/错字/漏标点），不改写" },
                  h("input", {
                    type: "checkbox", checked: sttSettings.reviewEnabled === true,
                    onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { reviewEnabled: e.target.checked })); }
                  }),
                  "模型校对"
                ),
                sttSettings.reviewEnabled === true
                  ? [
                      h("select", {
                        key: "rp", className: "ats-select", style: { flex: "0 0 130px" }, value: sttSettings.reviewProvider || "",
                        onChange: function (e) {
                          var provider = catalogProviders.filter(function (row) { return row.id === e.target.value; })[0];
                          var firstModel = provider && provider.models && provider.models[0] ? provider.models[0].id : "";
                          setSttSettings(Object.assign({}, sttSettings, { reviewProvider: e.target.value, reviewModel: firstModel }));
                        }
                      }, [{ value: "", label: "校对服务商" }, { value: "__same__", label: "跟随识别服务商" }].concat(catalogProviders.map(function (row) { return { value: row.id, label: row.displayName || row.id }; }))
                        .map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })),
                      h("select", {
                        key: "rm", className: "ats-select", style: { flex: "0 0 150px" }, disabled: sttSettings.reviewProvider === "__same__",
                        value: sttSettings.reviewProvider === "__same__" ? "" : (sttSettings.reviewModel || ""),
                        onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { reviewModel: e.target.value })); }
                      }, [sttSettings.reviewProvider === "__same__"
                        ? { value: "", label: "自动挑同系快模型" }
                        : { value: "", label: "校对模型" }].concat(
                        (catalogProviders.filter(function (row) { return row.id === sttSettings.reviewProvider; })[0] || { models: [] }).models
                          .map(function (model) { return { value: model.id, label: model.name || model.id }; })
                      ).map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); }))
                    ]
                  : null,
                h("label", { className: "ats-check", title: "本地 STT 不可用时用浏览器 Web Speech（Electron 里通常要联网，容易报 network）" },
                  h("input", {
                    type: "checkbox", checked: sttSettings.fallbackWebSpeech === true,
                    onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { fallbackWebSpeech: e.target.checked })); }
                  }),
                  "回退浏览器识别"
                )
              ),
              sttSettings.reviewEnabled === true
                ? h("div", { className: "ats-bar", style: { marginTop: "4px" } },
                    h("input", {
                      className: "ats-input", style: { flex: "1 1 auto" }, value: sttSettings.reviewGlossary || "",
                      placeholder: "校对术语表（可选）：智能体、语音识别、接口联调…",
                      onChange: function (e) { setSttSettings(Object.assign({}, sttSettings, { reviewGlossary: e.target.value })); }
                    })
                  )
                : null,
              h("div", { className: "ats-bar", style: { marginTop: "8px" } },
                h("button", {
                  className: "ats-btn tiny primary", type: "button", "data-tip": "保存设置", "aria-label": "保存设置",
                  onClick: function () {
                    postSttSettings(sttSettings).then(function (payload) {
                      setSttSettings(payload.settings);
                      setSttProbe("已保存");
                    }).catch(function (error) { setSttProbe("保存失败：" + String(error && error.message ? error.message : error)); });
                  }
                }, "💾"),
                h("button", {
                  className: "ats-btn tiny primary", type: "button", "data-tip": "测试转写", "aria-label": "测试转写",
                  onClick: function () {
                    setSttProbe("测试转写中…");
                    fetch("/api/team-workbench/stt", {
                      method: "POST", headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "selftest" })
                    }).then(function (res) { return readJsonResponse(res); }).then(function (payload) {
                      var result = (payload && payload.result) || {};
                      if (result.ok) {
                        var chars = String((result.text || "").length);
                        setSttProbe("连通 · " + String(result.ms) + "ms · 返回 " + chars + " 字" + (chars === "0" ? "（测试音不含语音，0 字正常）" : ""));
                      } else {
                        setSttProbe("失败 · " + String(result.ms || 0) + "ms · " + String(result.error || "未知错误").slice(0, 100));
                      }
                    }).catch(function (error) { setSttProbe("测试失败：" + String(error && error.message ? error.message : error)); });
                  }
                }, "🎙️"),
                h("button", {
                  className: "ats-btn tiny", type: "button", "data-tip": "测试连通性", "aria-label": "测试连通性",
                  onClick: function () {
                    setSttProbe("探测中…");
                    fetchSttSettings(true).then(function (payload) {
                      setSttProbe(payload.probe && payload.probe.ok ? "服务在线" : "服务不可达：" + String((payload.probe && payload.probe.error) || "无响应"));
                    }).catch(function (error) { setSttProbe("探测失败：" + String(error && error.message ? error.message : error)); });
                  }
                }, "🔌"),
                h("button", { className: "ats-btn tiny", type: "button", "data-tip": "关闭", "aria-label": "关闭", onClick: function () { setSttOpen(false); } }, "✕"),
                sttProbe.length > 0 ? h("span", { className: "ats-sub" }, sttProbe) : null
              )
            )
          : null,
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
                ),
                h("label", { className: "ats-check", title: "同一层的多个成员各自开一个子会话并发跑" },
                  h("input", {
                    type: "checkbox", checked: form.parallel !== false,
                    onChange: function (e) { setForm(Object.assign({}, form, { parallel: e.target.checked })); }
                  }),
                  "并行"
                ),
                h("select", { className: "ats-select", style: { flex: "0 0 110px" }, value: form.maxParallel === undefined ? "auto" : String(form.maxParallel), onChange: function (e) { setForm(Object.assign({}, form, { maxParallel: e.target.value === "auto" ? undefined : Number(e.target.value) })); } },
                  [{ value: "auto", label: "并发：自动" }].concat([1, 2, 3, 4, 5].map(function (n) { return { value: String(n), label: "并发 " + n }; })).map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })
                )
              ),
              h("div", { className: "ats-check-list", style: { alignItems: "flex-start" } },
                [
                  looseMembers.length > 0
                    ? h("div", { key: "loose", className: "ats-dept-members" }, looseMembers.map(memberCheck))
                    : null,
                  Array.from(departmentMap.entries()).map(function (entry) {
                    var list = entry[1];
                    var allChecked = list.every(function (m) { return form.memberIds.indexOf(m.memberId) >= 0; });
                    var expanded = openDepts[entry[0]] === true;
                    return h("div", { key: "d-" + entry[0], className: "ats-dept-block" },
                      h("div", { className: "ats-dept-head" },
                        h("button", {
                          className: "ats-dept-toggle", type: "button",
                          "aria-expanded": expanded ? "true" : "false",
                          title: expanded ? "收起" : "展开",
                          onClick: function () { setOpenDepts(function (prev) { var next = Object.assign({}, prev); next[entry[0]] = !expanded; return next; }); }
                        }, (expanded ? "▾" : "▸") + " 🏢 " + entry[0] + "（" + String(list.length) + "）"),
                        h("label", { className: "ats-check ats-dept-check", onClick: function (e) { e.stopPropagation(); } },
                          h("input", {
                            type: "checkbox", checked: allChecked,
                            onChange: function () {
                              var ids = list.map(function (m) { return m.memberId; });
                              var next = form.memberIds.filter(function (id) { return ids.indexOf(id) < 0; });
                              if (!allChecked) next = next.concat(ids);
                              setForm(Object.assign({}, form, { memberIds: next }));
                            }
                          }),
                          "全选"
                        )
                      ),
                      expanded ? h("div", { className: "ats-dept-members" }, list.map(memberCheck)) : null
                    );
                  })
                ]
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
    //#endregion

    //#region 会话记录检索
    function RecordSearch(props) {
      var queryState = useState("");
      var query = queryState[0];
      var setQuery = queryState[1];
      var kindState = useState("");
      var kind = kindState[0];
      var setKind = kindState[1];
      var initial = props.initialScope && typeof props.initialScope.id === "string" && props.initialScope.id.length > 0
        ? { kind: props.initialScope.kind || "", id: props.initialScope.id }
        : { kind: "", id: "" };
      var scopeState = useState(initial);
      var scope = scopeState[0];
      var setScope = scopeState[1];
      var optionsState = useState({ rooms: [], members: [] });
      var scopeOptions = optionsState[0];
      var setScopeOptions = optionsState[1];

      useEffect(function () {
        fetchChats().then(function (payload) {
          setScopeOptions({ rooms: payload.rooms || [], members: payload.private || [] });
        }).catch(function () { /* 范围选择可选 */ });
      }, []);
      var resultState = useState({ loading: false, error: "", hits: [], total: 0, searched: false });
      var result = resultState[0];
      var setResult = resultState[1];

      var run = function (nextQuery, nextKind, nextScope) {
        var text = (nextQuery === undefined ? query : nextQuery).trim();
        if (text.length === 0) return;
        var useScope = nextScope === undefined ? scope : nextScope;
        var useKind = useScope.id ? useScope.kind : (nextKind === undefined ? kind : nextKind);
        setResult(function (prev) { return Object.assign({}, prev, { loading: true, error: "", searched: true }); });
        fetchChatSearch(text, useKind, useScope.id).then(function (payload) {
          setResult({ loading: false, error: "", hits: payload.hits || [], total: payload.total || 0, searched: true });
        }).catch(function (error) {
          setResult({ loading: false, error: String(error && error.message ? error.message : error), hits: [], total: 0, searched: true });
        });
      };

      var pickKind = function (next) {
        setKind(next);
        setScope({ kind: "", id: "" });
        if (result.searched && query.trim().length > 0) run(query, next, { kind: "", id: "" });
      };
      var pickScope = function (value) {
        var parts = String(value || "").split(":");
        var next = parts.length === 2 && parts[1].length > 0 ? { kind: parts[0], id: parts[1] } : { kind: "", id: "" };
        setScope(next);
        if (result.searched && query.trim().length > 0) run(query, next.kind, next);
      };
      var scopeLabel = (function () {
        if (scope.id.length === 0) return "";
        if (scope.kind === "group") {
          var room = (scopeOptions.rooms || []).filter(function (r) { return r.id === scope.id; })[0];
          return room ? "群 · " + room.name : "";
        }
        var member = (scopeOptions.members || []).filter(function (m) { return m.memberId === scope.id; })[0];
        return member ? "成员 · " + member.name : "";
      })();

      var formatTime = function (value) {
        if (typeof value !== "string" || value.length === 0) return "";
        var date = new Date(value);
        if (isNaN(date.getTime())) return value;
        return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      };

      // 命中词标黄：按大小写不敏感切分，保留原大小写。
      var highlight = function (value) {
        var source = String(value === undefined || value === null ? "" : value);
        var needle = query.trim();
        if (needle.length === 0) return source;
        var lower = source.toLowerCase();
        var target = needle.toLowerCase();
        var nodes = [];
        var index = 0;
        var found = lower.indexOf(target, index);
        while (found >= 0) {
          if (found > index) nodes.push(source.slice(index, found));
          nodes.push(h("mark", { key: "m" + String(found), className: "ats-hit-mark" }, source.slice(found, found + target.length)));
          index = found + target.length;
          found = lower.indexOf(target, index);
        }
        if (index < source.length) nodes.push(source.slice(index));
        return nodes;
      };

      // 时间分组：今天 / 昨天 / 更早（按消息时间，不按搜索时间）。
      var dayBucket = function (value) {
        var date = new Date(value);
        if (isNaN(date.getTime())) return "更早";
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var time = date.getTime();
        if (time >= today) return "今天";
        if (time >= today - 86400000) return "昨天";
        return "更早";
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
          h("button", { className: "ats-btn tiny" + (kind === "group" ? " primary" : ""), type: "button", onClick: function () { pickKind("group"); } }, "群聊"),
          h("select", {
            className: "ats-select", style: { flex: "0 1 220px", minWidth: "140px" },
            value: scope.id.length > 0 ? scope.kind + ":" + scope.id : ":",
            title: "只搜某一个群或某一位成员",
            onChange: function (e) { pickScope(e.target.value); }
          },
            [{ value: ":", label: "范围：全部会话" }]
              .concat((scopeOptions.rooms || []).map(function (r) { return { value: "group:" + r.id, label: "群 · " + r.name }; }))
              .concat((scopeOptions.members || []).map(function (m) { return { value: "private:" + m.memberId, label: "成员 · " + m.name }; }))
              .map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })
          )
        ),
        scopeLabel.length > 0 ? h("div", { className: "ats-sub", style: { padding: "2px 2px 6px" } }, "当前只搜：" + scopeLabel) : null,
        result.error ? h("div", { className: "ats-sub", style: { color: "#dc2626" } }, result.error) : null,
        h("div", { className: "ats-list" },
          !result.searched
            ? h(Empty, { icon: "🔎", title: "输入关键词开始检索", hint: "会搜索所有私聊与群聊记录。" })
            : result.loading
              ? h(Empty, { icon: "⏳", title: "正在检索…" })
              : result.hits.length === 0
                ? h(Empty, { icon: "🫥", title: "没有找到包含「" + query.trim() + "」的消息", hint: "换个词，或减少筛选条件。" })
                : (function () {
                    var groups = [];
                    result.hits.forEach(function (hit) {
                      var bucket = dayBucket(hit.time);
                      var last = groups.length > 0 ? groups[groups.length - 1] : null;
                      if (last === null || last.bucket !== bucket) {
                        last = { bucket: bucket, items: [] };
                        groups.push(last);
                      }
                      last.items.push(hit);
                    });
                    return h("div", { className: "ats-search-results" },
                      h("div", { className: "ats-sub", style: { padding: "4px 2px 8px" } }, "共 " + String(result.total) + " 条，显示前 " + String(result.hits.length) + " 条"),
                      groups.map(function (group) {
                        return h("div", { key: "day-" + group.bucket, className: "ats-hit-group" },
                          h("div", { className: "ats-hit-day" },
                            h("span", { className: "ats-hit-day-dot", "aria-hidden": "true" }),
                            group.bucket,
                            h("span", { className: "ats-hit-day-count" }, String(group.items.length) + " 条")
                          ),
                          group.items.map(function (hit) {
                            return h("button", {
                              key: hit.id, type: "button", className: "ats-hit",
                              onClick: function () { if (props.onOpen) props.onOpen(hit.kind, hit.conversationId); }
                            },
                              h("span", { className: "ats-hit-kind" + (hit.kind === "group" ? " group" : "") }, hit.kind === "group" ? "群" : "私"),
                              h("span", { className: "ats-hit-meta" },
                                h("span", { className: "ats-hit-head" },
                                  h("span", { className: "ats-hit-name" }, highlight(hit.conversationName)),
                                  h("span", { className: "ats-hit-who" }, hit.role === "user" ? "我" : hit.memberName),
                                  h("span", { className: "ats-hit-time" }, formatTime(hit.time))
                                ),
                                h("span", { className: "ats-hit-text" }, highlight(hit.text))
                              )
                            );
                          })
                        );
                      })
                    );
                  })()
        )
      );
    }
    //#endregion

    //#region 服务商余额
    var BALANCE_PROVIDERS = [
      { id: "deepseek", name: "DeepSeek 官方", hint: "platform.deepseek.com 的 API Key（sk-…）" },
      { id: "moonshot", name: "Moonshot / Kimi", hint: "platform.moonshot.cn 的 API Key（sk-…）" },
      { id: "openrouter", name: "OpenRouter", hint: "openrouter.ai/keys 的 Key（sk-or-…）" }
    ];

    function BalancePanel() {
      var dataState = useState({ loading: true, error: "", items: [] });
      var data = dataState[0];
      var setData = dataState[1];
      var keyState = useState({});
      var keys = keyState[0];
      var setKeys = keyState[1];
      var busyState = useState("");
      var busy = busyState[0];
      var setBusy = busyState[1];

      var load = useCallback(function (force) {
        setData(function (prev) { return Object.assign({}, prev, { loading: true }); });
        fetchBalances(force).then(function (payload) {
          setData({ loading: false, error: "", items: payload.items || [] });
        }).catch(function (error) {
          setData({ loading: false, error: String(error && error.message ? error.message : error), items: [] });
        });
      }, []);

      useEffect(function () {
        load(false);
        var timer = setInterval(function () { load(false); }, 60000);
        return function () { clearInterval(timer); };
      }, [load]);

      var save = function (id) {
        setBusy(id);
        postBalanceKey(id, keys[id] || "").then(function (payload) {
          setData({ loading: false, error: "", items: payload.items || [] });
          setKeys(function (prev) { var next = Object.assign({}, prev); next[id] = ""; return next; });
        }).catch(function (error) {
          setData(function (prev) { return Object.assign({}, prev, { error: String(error && error.message ? error.message : error) }); });
        }).then(function () { setBusy(""); });
      };

      return h("div", { className: "ats-root" },
        h("div", { className: "ats-hero" },
          h("div", { style: { minWidth: 0 } },
            h("div", { className: "ats-hero-title" }, "服务商余额"),
            h("div", { className: "ats-hero-sub" }, "直接查官方余额接口；Key 只存在本机（0600），只发给对应服务商域名，不返回给界面")
          ),
          h("span", { className: "ats-spacer" }),
          h("button", { className: "ats-btn tiny", type: "button", disabled: data.loading, onClick: function () { load(true); } }, data.loading ? "查询中…" : "刷新")
        ),
        data.error ? h("div", { className: "ats-sub", style: { color: "#dc2626" } }, data.error) : null,
        h("div", { className: "ats-list" },
          BALANCE_PROVIDERS.map(function (provider) {
            var item = (data.items || []).filter(function (row) { return row.id === provider.id; })[0] || { configured: false, ok: false, balance: null, currency: "", detail: "", error: "", checkedAt: "" };
            return h("div", { key: provider.id, className: "ats-card", style: { padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" } },
              h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
                h("span", { className: "ats-name" }, provider.name),
                h("span", { className: "ats-tag" }, item.configured ? (item.ok ? "已连接" : "查询失败") : "未配置")
              ),
              h("div", { className: "ats-sub", style: { fontSize: "11.5px", opacity: .75 } }, provider.hint),
              item.ok && item.balance !== null
                ? h("div", { style: { fontSize: "20px", fontWeight: 700 } }, (item.currency === "USD" ? "$" : "¥") + String(item.balance), h("span", { style: { fontSize: "11px", fontWeight: 400, opacity: .6, marginLeft: "8px" } }, item.detail))
                : null,
              item.error ? h("div", { className: "ats-sub", style: { color: "#dc2626", fontSize: "11px" } }, item.error) : null,
              h("div", { style: { display: "flex", gap: "6px" } },
                h("input", { className: "ats-input", type: "password", placeholder: item.configured ? "已保存，输入新 Key 可替换" : "粘贴 API Key", value: keys[provider.id] || "", onChange: function (e) { var value = e.target.value; setKeys(function (prev) { var next = Object.assign({}, prev); next[provider.id] = value; return next; }); } }),
                h("button", { className: "ats-btn tiny primary", type: "button", disabled: busy === provider.id, onClick: function () { save(provider.id); } }, busy === provider.id ? "保存中…" : item.configured ? "更新" : "保存"),
                item.configured ? h("button", { className: "ats-btn tiny danger", type: "button", disabled: busy === provider.id, onClick: function () { setKeys(function (prev) { var next = Object.assign({}, prev); next[provider.id] = ""; return next; }); save(provider.id); } }, "清除") : null
              ),
              item.checkedAt ? h("div", { className: "ats-sub", style: { fontSize: "10.5px", opacity: .5 } }, "更新于 " + agoText(item.checkedAt)) : null
            );
          })
        )
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
        return readJsonResponse(r).then(function (j) { return { status: r.status, json: j }; });
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
    var TW_STORAGE_KEY = "dsh.teamWorkbench.view.v2";
    /** 工作台外壳样式：填满宿主分配的业务区，内部滚动，不越界、不遮挡宿主入口。 */
    var TW_CSS = [
      // 面板里大量样式用 var(--dsh-*)，这里在业务区内重定义成浅色值，
      // 与管理台原来的做法一致：只影响本面板，不动宿主其它区域。
      ".tw-root{--dsh-surface:#ffffff;--dsh-text-primary:#111111;--dsh-text-secondary:#555b63;--dsh-border:#dcdfe4;--dsh-accent:#2563eb;--dsh-input-bg:#ffffff;display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;background:#ffffff;color:#111111;}",
      ".tw-head{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #dcdfe4;flex:0 0 auto;flex-wrap:wrap;background:#f5f6f8;}",
      ".tw-tabs{display:flex;gap:4px;flex:1 1 auto;min-width:0;overflow:auto;}",
      ".tw-tour{position:fixed;inset:0;z-index:99999;pointer-events:none;}",
      ".tw-tour-mask{position:fixed;inset:0;background:rgba(15,23,42,.42);pointer-events:auto;}",
      ".tw-tour-hole{position:fixed;border-radius:12px;box-shadow:0 0 0 9999px rgba(15,23,42,.42),0 0 0 3px rgba(255,255,255,.9) inset;pointer-events:none;transition:all .18s ease;}",
      ".tw-tour-card{position:fixed;max-width:320px;background:var(--bt-bg,#fff);color:var(--bt-ink,#111);border-radius:14px;padding:14px 16px;box-shadow:0 18px 46px -12px rgba(15,23,42,.5),0 0 0 1px rgba(15,23,42,.08);pointer-events:auto;}",
      ".tw-tour-card h4{margin:0 0 6px;font-size:14px;}",
      ".tw-tour-card p{margin:0 0 10px;font-size:12.5px;line-height:1.65;opacity:.85;}",
      ".tw-tour-foot{display:flex;align-items:center;gap:6px;}",
      ".tw-tour-step{font-size:11px;opacity:.6;flex:1 1 auto;}",
      ".tw-tour-btn{font:inherit;font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--bt-line);background:transparent;cursor:pointer;}",
      ".tw-tour-btn.primary{background:var(--bt-accent,#2563eb);border-color:var(--bt-accent,#2563eb);color:#fff;}",
      ".tw-tour-btn.ghost{border-color:transparent;color:#64748b;font-size:11px;padding:4px 6px;text-decoration:underline;}",
      ".tw-tour-close{position:absolute;top:8px;right:10px;border:0;background:transparent;font-size:14px;cursor:pointer;opacity:.5;}",
      ".tw-tab{font:inherit;font-size:13px;padding:4px 10px;border-radius:6px;border:1px solid #dcdfe4;background:#eef0f3;color:#111111;cursor:pointer;white-space:nowrap;}",
      ".tw-tab{min-width:48px;height:40px;padding:0 16px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;}",
      ".tw-tab .tw-tab-icon{font-size:22px;line-height:1;display:inline-flex;align-items:center;}",
      ".ats-btn.tiny{font-size:15px;padding:5px 10px;}",
      ".ats-btn{font-size:14px;}",
      ".bt-round{width:44px;height:44px;font-size:20px;}",
      ".ats-round{width:44px;height:44px;font-size:20px;}",
      ".ats-send{font-size:17px;}",
      ".bt-dept-mark{font-size:28px;width:58px;height:58px;}",
      ".bt-dept-badge{min-width:18px;height:18px;line-height:18px;font-size:11px;}",
      ".tw-tab-on{background:#2563eb;border-color:#2563eb;color:#ffffff;font-weight:600;}",
      ".tw-session{font-size:11px;color:#666b73;white-space:nowrap;}",
      ".tw-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;}",
      ".tw-body>*{flex:1 1 auto;min-height:0;}"
    ].join("\n");

    function readTab() {
      try {
        var raw = window.localStorage.getItem(TW_STORAGE_KEY);
        if (raw === "team" || raw === "chat" || raw === "records" || raw === "roles" || raw === "skills" || raw === "balance") return raw;
      } catch (e) { /* 隐私模式降级为默认标签 */ }
      return "chat";
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
      var chatTargetState = useState("");
      var chatTarget = chatTargetState[0];
      var setChatTarget = chatTargetState[1];
      var chatRoomState = useState("");
      var chatRoom = chatRoomState[0];
      var setChatRoom = chatRoomState[1];
      var recordScopeState = useState(null);
      var recordScope = recordScopeState[0];
      var setRecordScope = recordScopeState[1];
      var focusMemberState = useState("");
      var focusMember = focusMemberState[0];
      var setFocusMember = focusMemberState[1];

      function pick(id) {
        setTab(function (prev) { return prev === id ? prev : (writeTab(id), id); });
      }

      // —— 新手引导：10 步，按标签自动切换 + 聚光灯指向真实控件 ——
      var TOUR_STEPS = [
        { title: "欢迎使用智能体团队", text: "这是一个 DSH 网页客户端插件：把一支具名智能体团队做成聊天应用。10 步带你走完核心功能，随时可按右上角 ? 重看。", center: true },
        { tab: "chat", selector: ".bt-people", title: "侧栏：成员与部门", text: "每个成员只显示职称 + 3D 头像（点头像进属性页增删改查）。同一部门的子智能体自动收成「🏢 部门名」一格，点开看部门内成员。🗑 是批量删除。" },
        { tab: "chat", selector: ".ats-im-form", title: "输入框与思考状态", text: "底部常驻输入框；发送后上方会显示「谁在思考 / 正在做什么 / 已第几棒 / 排队几位」。Enter 发送，Shift+Enter 换行，⌘Enter 也能发。" },
        { tab: "chat", selector: "button[data-tip='长期记忆']", title: "记忆入口", text: "会话头 🧠 打开这段会话的长期记忆：L1 原子事实、L2 摘要、L3 用户画像都可逐条查看与删除。" },
        { tab: "team", selector: ".ats-hero", title: "团队页：成员与模型", text: "这里是成员卡片：每个成员有一组可回退的模型路由，点 ✏️ 编辑，▶ 试跑会显示回退轨迹。" },
        { tab: "team", selector: ".ats-hero", title: "部门一键整理", text: "🧩 把同部门的多个成员合并成一个「🏢 部门智能体」：子智能体保留、私聊历史合并、群引用去重。" },
        { tab: "roles", selector: ".ats-cat", title: "角色库：313 个角色", text: "按部门筛选后可「＋ 作为部门加入」：整个部门只占 1 个成员，内部角色变成子智能体，各自配模型。" },
        { tab: "records", selector: ".ats-search", title: "记录检索", text: "跨私聊/群聊搜索，命中词标黄，结果按「今天 / 昨天 / 更早」分组，点一条回到那段对话。" },
        { tab: "chat", selector: "button[data-tip='语音识别设置']", title: "语音与模型校对", text: "🎤 打开语音设置：本地 stt / OpenAI 兼容 / 智谱 GLM-ASR / MiniMax；可选模型校对（术语表纠错，防改写）。" },
        { title: "可以开始了", text: "建议先做三件事：① 团队页「项目部预设」建一支队伍；② 每个成员配一条模型路由；③ 回聊天页发第一句。随时点右上角 ? 重看引导。", center: true }
      ];
      var tourState = useState({ on: false, step: 0, rect: null });
      var tour = tourState[0];
      var setTour = tourState[1];
      var openTour = function () { setTour({ on: true, step: 0, rect: null }); };
      var closeTour = function (done) {
        setTour({ on: false, step: 0, rect: null });
        if (done) { try { window.localStorage.setItem("team-workbench:tour-v1", "done"); } catch { /* 隐私模式忽略 */ } }
      };
      // 「不再自动弹出」：立即落盘并关掉；之后只保留右上角 ? 手动重看。
      var dismissTourForever = function () {
        setTour({ on: false, step: 0, rect: null });
        try { window.localStorage.setItem("team-workbench:tour-v1", "done"); } catch { /* 隐私模式忽略 */ }
      };
      var gotoStep = function (next) {
        if (next < 0) { setTour({ on: true, step: 0, rect: null }); return; }
        if (next >= TOUR_STEPS.length) { closeTour(true); return; }
        setTour({ on: true, step: next, rect: null });
      };
      useEffect(function () {
        if (!tour.on) return undefined;
        var step = TOUR_STEPS[tour.step];
        if (step.tab !== undefined) pick(step.tab);
        var measure = function () {
          var node = step.selector === undefined ? null : document.querySelector(step.selector);
          if (node === null) { setTour(function (prev) { return Object.assign({}, prev, { rect: null }); }); return; }
          var rect = node.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) { setTour(function (prev) { return Object.assign({}, prev, { rect: null }); }); return; }
          setTour(function (prev) { return Object.assign({}, prev, { rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }); });
        };
        var timer = setTimeout(measure, 260);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return function () { clearTimeout(timer); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
      }, [tour.on, tour.step]);
      useEffect(function () {
        var done = null;
        try { done = window.localStorage.getItem("team-workbench:tour-v1"); } catch { done = null; }
        if (done !== null) return undefined;
        var timer = setTimeout(function () { setTour({ on: true, step: 0, rect: null }); }, 1200);
        return function () { clearTimeout(timer); };
      }, []);
      useEffect(function () {
        if (!tour.on) return undefined;
        var onKey = function (e) {
          if (e.key === "Escape") closeTour(false);
          else if (e.key === "ArrowRight") gotoStep(tour.step + 1);
          else if (e.key === "ArrowLeft") gotoStep(tour.step - 1);
        };
        window.addEventListener("keydown", onKey);
        return function () { window.removeEventListener("keydown", onKey); };
      }, [tour.on, tour.step]);

      // 预取会话概览：用户还在团队页时就先拿好侧栏数据，切回聊天是“秒开”。
      useEffect(function () {
        if (CHAT_OVERVIEW_CACHE.data !== null) return undefined;
        var alive = true;
        fetchChats().then(function (payload) {
          if (!alive) return;
          CHAT_OVERVIEW_CACHE.data = { private: payload.private || [], rooms: payload.rooms || [] };
          CHAT_OVERVIEW_CACHE.at = Date.now();
        }).catch(function () { /* 预取失败不影响正常加载 */ });
        return function () { alive = false; };
      }, []);

      // 全局快捷键：⌘1..6 切标签，/ 聚焦搜索（不在输入框里时）。
      useEffect(function () {
        var ids = ["chat", "team", "records", "balance", "roles", "skills"];
        function onKey(e) {
          if ((e.metaKey || e.ctrlKey) && /^[1-6]$/.test(e.key)) {
            var id = ids[Number(e.key) - 1];
            if (id !== undefined) { e.preventDefault(); pick(id); }
            return;
          }
          if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
            var el = e.target;
            var tag = el !== null && el !== undefined && el.tagName ? String(el.tagName).toLowerCase() : "";
            if (tag === "input" || tag === "textarea" || (el && el.isContentEditable)) return;
            var box = document.querySelector(".ats-search") || document.querySelector(".ats-input") || document.querySelector("textarea");
            if (box !== null && typeof box.focus === "function") { e.preventDefault(); box.focus(); }
          }
        }
        window.addEventListener("keydown", onKey);
        return function () { window.removeEventListener("keydown", onKey); };
      }, []);
      function tabBtn(id, label, icon) {
        var on = tab === id;
        return h("button", {
          key: id,
          type: "button",
          className: "tw-tab" + (on ? " tw-tab-on" : ""),
          "aria-pressed": on ? "true" : "false",
          "aria-label": label,
          "data-tip": label,
          onClick: function () { pick(id); }
        }, h("span", { className: "tw-tab-icon", "aria-hidden": "true" }, icon));
      }

      var body = null;
      if (tab === "chat") body = h(ChatPanel, {
        scope: scope, initialMember: chatTarget, initialRoom: chatRoom,
        onOpenSettings: function () { pick("team"); },
        onOpenRecords: function (kind, id) { setRecordScope({ kind: kind, id: id }); pick("records"); },
        // 点头像 → 属性页：切到「团队」并把这张成员卡展开成编辑态
        onEditMember: function (memberId) { setFocusMember(memberId); pick("team"); }
      });
      else if (tab === "team") body = h(AgentTeamPanel, { scope: scope, focusMemberId: focusMember, onOpenRoles: function () { pick("roles"); }, onChat: function (memberId) { setChatTarget(memberId); setChatRoom(""); pick("chat"); } });
      else if (tab === "balance") body = h(BalancePanel);
      else if (tab === "records") body = h(RecordSearch, { initialScope: recordScope, onOpen: function (kind, id) { if (kind === "group") { setChatRoom(id); setChatTarget(""); } else { setChatTarget(id); setChatRoom(""); } pick("chat"); } });
      else if (tab === "roles") body = h(RoleLibrary, { onTeamChanged: function () { pick("team"); } });
      else body = h(SkillManager);

      var tourStep = tour.on ? TOUR_STEPS[tour.step] : null;
      var tourCardStyle = (function () {
        if (tourStep === null) return {};
        var rect = tour.rect;
        if (rect === null) return { left: "50%", top: "50%", transform: "translate(-50%,-50%)" };
        var width = 320;
        var left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.x + rect.w / 2 - width / 2));
        var below = rect.y + rect.h + 14;
        var cardTop = below + 180 < window.innerHeight ? below : Math.max(16, rect.y - 190);
        return { left: String(left) + "px", top: String(cardTop) + "px" };
      })();
      var tourOverlay = tourStep === null ? null : h("div", { className: "tw-tour" },
        tour.rect === null ? h("div", { className: "tw-tour-mask", onClick: function () { closeTour(false); } }) : null,
        tour.rect === null ? null : h("div", {
          className: "tw-tour-hole",
          style: {
            left: String(tour.rect.x - 6) + "px", top: String(tour.rect.y - 6) + "px",
            width: String(tour.rect.w + 12) + "px", height: String(tour.rect.h + 12) + "px"
          }
        }),
        h("div", { className: "tw-tour-card", style: tourCardStyle },
          h("button", { className: "tw-tour-close", type: "button", "aria-label": "关闭引导", onClick: function () { closeTour(false); } }, "✕"),
          h("h4", null, tourStep.title),
          h("p", null, tourStep.text),
          h("div", { className: "tw-tour-foot" },
            h("span", { className: "tw-tour-step" }, String(tour.step + 1) + " / " + String(TOUR_STEPS.length)),
            h("button", {
              className: "tw-tour-btn ghost", type: "button", title: "关闭引导，以后不再自动弹出",
              onClick: dismissTourForever
            }, "不再弹出"),
            h("button", { className: "tw-tour-btn", type: "button", onClick: function () { gotoStep(tour.step - 1); } }, "上一步"),
            h("button", { className: "tw-tour-btn primary", type: "button", onClick: function () { gotoStep(tour.step + 1); } }, tour.step === TOUR_STEPS.length - 1 ? "完成" : "下一步")
          )
        )
      );

      return h("div", { className: "tw-root" },
        h("header", { className: "tw-head" },
          h("div", { className: "tw-brand" },
            h("span", { className: "tw-logo" }, "🧑‍🤝‍🧑"),
            h("span", { className: "tw-title" }, "智能体团队")
          ),
          h("div", { className: "tw-tabs", role: "tablist" },
            tabBtn("chat", "聊天", "💬"),
            tabBtn("team", "团队", "👥"),
            tabBtn("records", "记录检索", "🗂️"),
            tabBtn("balance", "额度", "📊"),
            tabBtn("roles", "角色库", "🧩"),
            tabBtn("skills", "技能库", "🛠️")
          ),
          h("button", {
            className: "tw-tab", type: "button", title: "新手引导", "aria-label": "新手引导",
            style: { flex: "0 0 auto" }, onClick: openTour
          }, "?"),
          sessionId ? h("span", { className: "tw-session" }, "会话 " + sessionId.slice(0, 12)) : null
        ),
        h("div", { className: "tw-body" },
          // 只挂载当前标签：切走后另一块整体卸载，不保留后台定时器/请求。
          body
        ),
        tourOverlay
      );
    }

    //#region 注册（DSH Desktop 原生工作台）
    /** 全窗口团队 App：默认铺满，可收起成右下角胶囊。 */
    function TeamApp() {
      var stored = null;
      try { stored = window.localStorage.getItem("dsh.teamApp.open"); } catch (error) { stored = null; }
      var openState = useState(stored === "1");
      var open = openState[0];
      var setOpen = openState[1];
      var change = function (next) {
        setOpen(next);
        try { window.localStorage.setItem("dsh.teamApp.open", next ? "1" : "0"); } catch (error) { /* 忽略 */ }
      };

      if (!open) {
        return h("button", { className: "dta-launcher", type: "button", title: "打开智能体团队", onClick: function () { change(true); } }, "🧑‍🤝‍🧑 智能体团队");
      }
      return h("div", { className: "dta-shell" },
        h("div", { className: "dta-head" },
          h("span", { className: "dta-brand" }, "🧑‍🤝‍🧑"),
          h("span", { className: "dta-title" }, "智能体团队"),
          h("span", { className: "dta-spacer" }),
          h("button", { className: "dta-btn", type: "button", onClick: function () { change(false); } }, "收起")
        ),
        h("div", { className: "dta-body" }, h(WorkbenchPanel, {}))
      );
    }

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
        tag.textContent = CSS + "\n" + TW_CSS + "\n" + PANEL_CSS + "\n" + BT_CSS;
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }, "team-workbench: panel css");

      // 宿主工作台服务由 dsh-desktop-workbenches 提供（package.json 的
      // dsh.client.inject 保证它先加载）。拿不到就什么都不挂，而不是退回浮动窗口：
      // 浮动载体正是「无法回收」的来源，本包不再保留这条路径。
      // 网页客户端插件：把团队 App 挂到 document.body 的固定层，铺满整个窗口，
      // 类似 DS-Bot 的做法（不经过工作台 API，因此能盖住宿主导航）。
      ctx.effect(function () {
        if (typeof document === "undefined" || !document.body) return;
        var ReactDOM = require("react-dom");
        var host = document.getElementById("dsh-team-app-host");
        if (host !== null) return;
        host = document.createElement("div");
        host.id = "dsh-team-app-host";
        document.body.appendChild(host);
        var onKey = function (event) {
          // 应急出口：界面异常时按 Esc 先藏起来，不必进安全模式。
          if (event.key === "Escape") host.style.display = "none";
        };
        if (typeof window.addEventListener === "function") window.addEventListener("keydown", onKey);
        try {
          ReactDOM.render(h(TeamApp), host);
        } catch (error) {
          host.remove();
          if (typeof window.removeEventListener === "function") window.removeEventListener("keydown", onKey);
          console.warn("[team-workbench] 界面挂载失败，已卸载：", error);
          return undefined;
        }
        return function () {
          if (typeof window.removeEventListener === "function") window.removeEventListener("keydown", onKey);
          ReactDOM.unmountComponentAtNode(host);
          host.remove();
        };
      }, "team-workbench: mount app");
    }
    //#endregion

    exports.apply = apply;
    exports.inject = [];
    exports.name = "dsh-team-workbench";
    // 测试用：SSR 冒烟直接渲染面板。
    exports.__panel = WorkbenchPanel;
    return module.exports;
  }
});
