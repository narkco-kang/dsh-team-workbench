    /** 从角色库导入成员（POST /roles）。 */
    function postRoles(body) {
      return fetch(ROUTE_ROLES, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);
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
      return fetch(ROUTE_ROLES + params, { cache: "no-store" }).then(unwrap);
    }
    /** 读取角色正文（GET /roles/body）。 */
    function fetchRoleBody(id) {
      return fetch(ROLE_BODY_ROUTE + "?id=" + encodeURIComponent(id), { cache: "no-store" }).then(unwrap);
    }
