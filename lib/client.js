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
      ".ats-bubble-text{white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.55;padding:7px 10px;border-radius:10px;background:rgba(127,127,127,.12);}",
      ".ats-bubble.user .ats-bubble-text{background:var(--dsh-accent,#2563eb);color:#fff;}",
      /* 输入框照 DS-Bot / DSH 会话页：居中卡片、max-width 820、圆角 16、
         文本 14/20，底部一行「＋ / 🎤 …… 发送」。 */
      ".ats-compose{flex:0 0 auto;display:flex;justify-content:center;padding:20px 24px 64px;background:var(--bt-main);}",
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
    function shade(hex, factor) {
      var channel = function (start) {
        var value = parseInt(hex.slice(start, start + 2), 16);
        return Math.max(0, Math.min(255, Math.round(value * factor)));
      };
      return "#" + [1, 3, 5].map(function (start) { return channel(start).toString(16).padStart(2, "0"); }).join("");
    }

    var MASCOT_SHAPES = [
      { kind: "squircle", eyes: 0, node: function (id) { return h("rect", { x: 9, y: 9, width: 46, height: 46, rx: 14, fill: "url(#" + id + ")" }); } },
      { kind: "circle", eyes: 0, node: function (id) { return h("circle", { cx: 32, cy: 33, r: 23, fill: "url(#" + id + ")" }); } },
      { kind: "blob", eyes: 0, node: function (id) { return h("path", { d: "M32 8c15 0 25 9 25 24 0 14-10 24-25 24S7 46 7 32C7 17 17 8 32 8z", fill: "url(#" + id + ")" }); } },
      { kind: "star", eyes: 2, node: function (id) { return h("path", { d: "M32 5l6.8 17.9L58 25.6 43.4 37.2 48.2 56 32 45.2 15.8 56l4.8-18.8L6 25.6l19.2-2.7z", fill: "url(#" + id + ")" }); } },
      { kind: "drop", eyes: 0, node: function (id) { return h("path", { d: "M32 6c9.5 10 18 17.5 18 27a18 18 0 11-36 0C14 23.5 22.5 16 32 6z", fill: "url(#" + id + ")" }); } },
      { kind: "diamond", eyes: 2, node: function (id) { return h("path", { d: "M32 7l20 25-20 25L12 32z", fill: "url(#" + id + ")" }); } }
    ];

    /**
     * 动态表情：按成员 id 稳定生成一张会呼吸、眨眼、被戳会弹一下的小脸，
     * 造型与表情参考 DS-Bot 的 BotMark（渐变身体 + 挖空眼 + 腮红 + 状态徽标）。
     */
    function Mascot(props) {
      var member = props.member;
      var accent = props.accent || "#2563eb";
      var size = props.size || 40;
      var state = props.state || (member.enabled === false ? "sleeping" : "idle");
      var seed = hashOf(member.id || member.name || member.emoji || "m");
      var shape = MASCOT_SHAPES[seed % MASCOT_SHAPES.length];
      var gradientId = "atg" + seed.toString(36);
      var pokeState = useState(false);
      var poked = pokeState[0];
      var setPoked = pokeState[1];
      var narrow = shape.eyes > 0;
      var eyeGap = narrow ? 3 : seed % 3;
      var leftX = narrow ? 27 : 24 - eyeGap;
      var rightX = narrow ? 37 : 40 + eyeGap;
      var eyeRx = narrow ? 4.6 : 6.2;
      var eyeRy = narrow ? 5.4 : 7;
      var mouth = seed % 4;
      var mouthNode = mouth === 0
        ? h("path", { d: "M26 45q6 4 12 0", stroke: "#1f2937", strokeWidth: 1.9, strokeLinecap: "round", fill: "none", opacity: 0.7 })
        : mouth === 1
          ? h("circle", { cx: 32, cy: 45.5, r: 2.4, fill: "#1f2937", opacity: 0.62 })
          : mouth === 2
            ? h("path", { d: "M27 45h10", stroke: "#1f2937", strokeWidth: 1.9, strokeLinecap: "round", opacity: 0.6 })
            : h("path", { d: "M27 44q2.5 5 5 0q2.5 5 5 0", stroke: "#1f2937", strokeWidth: 1.7, strokeLinecap: "round", fill: "none", opacity: 0.65 });
      return h("svg", {
        className: "ats-mascot " + state + (poked ? " poked" : ""),
        width: size, height: size, viewBox: "0 0 64 64",
        role: "img", "aria-label": member.name,
        style: { flex: "0 0 auto", display: "block", cursor: "pointer", overflow: "visible" },
        onClick: function () { setPoked(true); },
        onAnimationEnd: function (event) { if (event.animationName && event.animationName.indexOf("ats-poke") >= 0) setPoked(false); }
      },
        h("defs", null,
          h("linearGradient", { id: gradientId, x1: "16", y1: "8", x2: "48", y2: "56", gradientUnits: "userSpaceOnUse" },
            h("stop", { offset: "0%", stopColor: accent }),
            h("stop", { offset: "100%", stopColor: shade(accent, 0.5) })
          )
        ),
        h("g", { className: "ats-mascot-bob" },
          shape.node(gradientId),
          h("ellipse", { cx: 22, cy: 19, rx: 8, ry: 4, fill: "#fff", opacity: 0.16 }),
          state === "working"
            ? h("circle", { className: "ats-mascot-ring", cx: 32, cy: 33, r: 27, fill: "none", stroke: "#fbbf24", strokeWidth: 2.4, strokeDasharray: "7 9", strokeLinecap: "round" })
            : null,
          h("g", { className: "ats-mascot-eyes" },
            h("ellipse", { cx: leftX, cy: 34, rx: eyeRx, ry: eyeRy, fill: "#fff" }),
            h("ellipse", { cx: rightX, cy: 34, rx: eyeRx, ry: eyeRy, fill: "#fff" }),
            h("circle", { cx: leftX + 0.6, cy: 35, r: narrow ? 2.3 : 3.1, fill: "#1f2937" }),
            h("circle", { cx: rightX + 0.6, cy: 35, r: narrow ? 2.3 : 3.1, fill: "#1f2937" }),
            h("circle", { cx: leftX + 1.6, cy: 33.6, r: 1.05, fill: "#fff" }),
            h("circle", { cx: rightX + 1.6, cy: 33.6, r: 1.05, fill: "#fff" })
          ),
          h("ellipse", { cx: narrow ? 21 : 19, cy: 43.5, rx: 4, ry: 2.2, fill: "#fb7185", opacity: 0.32 }),
          h("ellipse", { cx: narrow ? 43 : 45, cy: 43.5, rx: 4, ry: 2.2, fill: "#fb7185", opacity: 0.32 }),
          mouthNode,
          h("circle", { cx: 50, cy: 52, r: 7.6, fill: "#fff", opacity: 0.94 }),
          h("text", { x: 50, y: 52, textAnchor: "middle", dominantBaseline: "central", fontSize: 8.8 }, member.emoji || "🤖")
        )
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
        style: { borderLeftColor: accent, background: tint(accent, 0.06) }
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
          h("button", { className: "ats-btn" + (editing ? " primary" : ""), type: "button", onClick: function () { setEditing(!editing); } }, editing ? "收起" : "编辑"),
          h("button", {
            className: "ats-btn" + (props.isChief ? " primary" : ""), type: "button", disabled: busy,
            title: props.isChief ? "取消总管" : "把这一位设为团队总管",
            onClick: function () { if (props.onChief) props.onChief(member, props.isChief !== true); }
          }, props.isChief ? "取消总管" : "设为总管"),
          h("button", { className: "ats-btn", type: "button", onClick: function () { if (props.onChat) props.onChat(member.id); } }, "聊天"),
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

      var state = useState({ loading: true, error: "", members: [], chiefId: "", groups: [], presets: [], preset: "", roleLibrary: null, catalog: [], defaults: EMPTY_DEFAULTS, effortOptions: [], limits: null, storePath: "", pluginVersion: "" });
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
          isChief: snap.chiefId === member.id,
          onChief: function (m, make) { mutate("save", { action: make ? "chief" : "chief-clear", id: m.id }, make ? "「" + m.name + "」现在是总管。" : "已取消总管。"); },
          onDelete: function (m) { mutate("save", { action: "delete", id: m.id }, "已删除「" + m.name + "」。"); },
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
              (function () {
                var chief = members.filter(function (m) { return m.id === snap.chiefId; })[0];
                return (chief ? "总管 " + chief.name + " · " : "未指定总管 · ") +
                  String(members.length) + " 名成员 · " + String(groups.length) + " 个分组 · " +
                  String(routeTotal) + " 条模型路由 · " + String(bound) + " 名已配置模型";
              })() +
              (snap.pluginVersion ? " · v" + snap.pluginVersion : ""))
          ),
          h("span", { className: "ats-spacer" }),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "save", onClick: load }, "刷新"),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "preset", onClick: function () { setPresetOpen(!presetOpen); } }, "项目部预设"),
          h("button", { className: "ats-btn", type: "button", disabled: busy === "save", onClick: function () { mutate("save", { action: "chief-create" }, "已新建一位总管。"); } }, "＋ 总管"),
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

    function ChatPanel(props) {
      var scope = props.scope || {};
      var sessionId = resolveSessionId(scope);
      var initial = typeof props.initialMember === "string" ? props.initialMember : "";
      var initialRoom = typeof props.initialRoom === "string" ? props.initialRoom : "";

      var dataState = useState({ loading: true, error: "", private: [], rooms: [] });
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
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var busyTargetState = useState(null);
      var busyTarget = busyTargetState[0];
      var setBusyTarget = busyTargetState[1];
      var bannerState = useState("");
      var banner = bannerState[0];
      var setBanner = bannerState[1];
      var micState = useState(false);
      var micOn = micState[0];
      var setMicOn = micState[1];
      var recRef = React.useRef(null);
      var areaRef = React.useRef(null);

      // 输入框高度跟着草稿走：发送后 setDraft("") 不会触发 input 事件，
      // 只靠 onInput 的话高度会停在最后的长文本上（看起来像「输入框越变越大」）。
      useEffect(function () {
        var el = areaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = Math.min(280, Math.max(64, el.scrollHeight)) + "px";
      }, [draft, target]);

      var toggleVoice = function () {
        if (micOn) {
          try { if (recRef.current !== null) recRef.current.stop(); } catch (error) { /* 已停止 */ }
          return;
        }
        var SR = typeof window === "undefined" ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
        if (SR === null || SR === undefined) {
          setBanner("当前环境不支持语音识别（Web Speech API 不可用）");
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
        rec.onerror = function (event) { setMicOn(false); setBanner("语音识别失败：" + String(event.error || "")); };
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

      var loadMemorySlot = function () {
        if (target === null) return;
        var kind = target.kind === "group" ? "room" : "private";
        fetchMemory(kind, target.id).then(function (payload) {
          var slot = payload.memory || { summary: "", facts: [] };
          setMemoryData(Object.assign({}, slot, { persona: payload.persona || { items: [] } }));
        })
          .catch(function (error) { setBanner(String(error && error.message ? error.message : error)); });
      };
      var openMemory = function () {
        setMemoryOpen(true);
        loadMemorySlot();
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
          setData({ loading: false, error: "", private: payload.private || [], rooms: payload.rooms || [] });
        }).catch(function (error) {
          setData(function (prev) { return Object.assign({}, prev, { loading: false, error: String(error && error.message ? error.message : error) }); });
        });
      }, []);

      useEffect(function () { loadOverview(); }, [loadOverview]);

      // 总管：侧栏置顶显示，建群时默认当管理员。
      useEffect(function () {
        fetch("/api/team-workbench/state", { cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
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
        fetch(url, { cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
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
        setBusy(true);
        setBusyTarget(target);
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
          .then(function () { setBusy(false); setBusyTarget(null); });
      };

      var openForm = function () {
        var members = data.private || [];
        var chiefMember = members.filter(function (m) { return m.memberId === chiefId; })[0];
        setForm({ name: "", adminId: chiefMember ? chiefMember.memberId : members[0] ? members[0].memberId : "", memberIds: members.slice(0, 3).map(function (m) { return m.memberId; }), responder: "lead", relayDepth: 1 });
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

      var memberRow = function (m) {
        var on = target !== null && target.kind === "private" && target.id === m.memberId;
        var working = busy && busyTarget !== null && busyTarget.kind === "private" && busyTarget.id === m.memberId;
        return h("button", {
          key: "member-" + m.memberId, type: "button", className: "bt-row",
          "aria-current": on ? "page" : undefined,
          onClick: function () { pickPrivate(m.memberId); }
        },
          h("span", { className: "bt-mark", style: { width: "36px", height: "36px" } },
            h(Avatar, { member: { id: m.memberId, name: m.name, emoji: m.emoji, color: m.color, enabled: true }, accent: colorOfMember(m), size: 36, state: working ? "working" : "idle" })
          ),
          h("span", { className: "bt-row-body" },
            h("span", { className: "bt-row-name" },
              h("span", { className: "bt-row-title" }, m.name),
              m.memberId === chiefId ? h("span", { className: "bt-tag chief", title: "总管" }, "★ 总管") : null,
              m.role ? h("span", { className: "bt-tag", title: m.role }, m.role) : null
            ),
            h("span", { className: "bt-row-preview" }, m.count > 0 ? (m.lastText || "…") : "还没有对话")
          )
        );
      };
      var roomRow = function (room) {
        var on = target !== null && target.kind === "group" && target.id === room.id;
        var stack = (room.memberIds || []).slice(0, 3);
        return h("button", {
          key: "room-" + room.id, type: "button", className: "bt-row",
          "aria-current": on ? "page" : undefined,
          onClick: function () { pickRoom(room.id); }
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

      return h("div", { className: "ats-root ats-im" },
        h("aside", { className: "bt-leftcol ats-im-appcol" },
          h("div", { className: "bt-side" },
            h("div", { className: "bt-side-top" },
              h("span", { className: "bt-brand" },
                h("span", { className: "bt-brand-whale" }, "🧑‍🤝‍🧑"),
                h("span", null, "智能体团队")
              ),
              h("button", { className: "bt-round", type: "button", title: "新建群聊", "aria-label": "新建群聊", onClick: openForm }, "＋")
            ),
            h("div", { className: "bt-list" },
              rows.length === 0
                ? h("div", { className: "bt-hint" }, "还没有成员")
                : rows.map(function (entry) { return entry.kind === "room" ? roomRow(entry.item) : memberRow(entry.item); })
            )
          )
        ),
        h("div", { className: "ats-im-main" },
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
                h("button", { className: "ats-btn tiny", type: "button", title: "这段会话的长期记忆", onClick: function () { if (memoryOpen) setMemoryOpen(false); else openMemory(); } }, "记忆"),
                h("button", { className: "ats-btn tiny", type: "button", title: "在记录页检索这段会话", onClick: function () { if (props.onOpenRecords && target !== null) props.onOpenRecords(target.kind, target.id); } }, "记录"),
                h("button", { className: "ats-btn tiny", type: "button", onClick: function () { if (props.onOpenSettings) props.onOpenSettings(); } }, "设置"),
                currentRoom && currentRoom.chief !== true ? h("button", { className: "ats-btn tiny danger", type: "button", onClick: function () { removeRoom(currentRoom.id); } }, "删除群") : null
              ),
          h("div", {
            className: "ats-chat-log",
            ref: function (el) { if (el !== null) el.scrollTop = el.scrollHeight; }
          },
            target === null
              ? h("div", { className: "ats-empty" }, "从左侧选一个成员，或点「＋ 建群」开一个群聊")
              : messages.length === 0
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
          h("div", { className: "ats-compose" },
            h("div", { className: "ats-composer" },
              h("textarea", {
                ref: areaRef,
                className: "ats-area", rows: 1, value: draft,
                placeholder: target === null
                  ? "先选一个成员或群聊，再输入消息"
                  : currentRoom ? "在群里发言；@成员名 可直接点名（Enter 发送）" : "发消息给 " + title + "（Enter 发送，Shift+Enter 换行）",
                disabled: busy || target === null,
                onChange: function (e) { setDraft(e.target.value); },
                onInput: function (e) {
                  var el = e.target;
                  el.style.height = "auto";
                  el.style.height = Math.min(280, Math.max(64, el.scrollHeight)) + "px";
                },
                onKeyDown: function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
              }),
              h("div", { className: "ats-composer-bar" },
                h("button", { className: "ats-round", type: "button", title: "新建群聊", "aria-label": "新建群聊", onClick: openForm }, "＋"),
                h("button", { className: "ats-round" + (micOn ? " recording" : ""), type: "button", title: "语音输入（中文）", "aria-label": "语音输入", disabled: target === null, onClick: toggleVoice }, micOn ? "●" : "🎤"),
                h("span", { className: "ats-spacer" }),
                h("button", { className: "ats-send", type: "button", disabled: busy || target === null || draft.trim().length === 0, onClick: send }, busy ? "等待回复…" : "发送")
              )
            )
          )
        ),
        memoryOpen && target !== null
          ? h("div", { className: "ats-im-form", style: { maxHeight: "60%", overflow: "auto" } },
              h("div", { className: "ats-preset-title" }, "长期记忆 · " + (currentRoom ? currentRoom.name : title)),
              h("div", { className: "ats-sub", style: { margin: "4px 0 2px" } }, "L3 用户画像（跨会话共享）"),
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
    var TW_STORAGE_KEY = "dsh.teamWorkbench.view.v2";
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
      if (tab === "chat") body = h(ChatPanel, {
        scope: scope, initialMember: chatTarget, initialRoom: chatRoom,
        onOpenSettings: function () { pick("team"); },
        onOpenRecords: function (kind, id) { setRecordScope({ kind: kind, id: id }); pick("records"); }
      });
      else if (tab === "team") body = h(AgentTeamPanel, { scope: scope, onOpenRoles: function () { pick("roles"); }, onChat: function (memberId) { setChatTarget(memberId); setChatRoom(""); pick("chat"); } });
      else if (tab === "balance") body = h(BalancePanel);
      else if (tab === "records") body = h(RecordSearch, { initialScope: recordScope, onOpen: function (kind, id) { if (kind === "group") { setChatRoom(id); setChatTarget(""); } else { setChatTarget(id); setChatRoom(""); } pick("chat"); } });
      else if (tab === "roles") body = h(RoleLibrary, { onTeamChanged: function () { pick("team"); } });
      else body = h(SkillManager);

      return h("div", { className: "tw-root" },
        h("header", { className: "tw-head" },
          h("div", { className: "tw-brand" },
            h("span", { className: "tw-logo" }, "🧑‍🤝‍🧑"),
            h("span", { className: "tw-title" }, "智能体团队")
          ),
          h("div", { className: "tw-tabs", role: "tablist" },
            tabBtn("chat", "聊天"),
            tabBtn("team", "团队"),
            tabBtn("records", "记录"),
            tabBtn("balance", "额度"),
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
