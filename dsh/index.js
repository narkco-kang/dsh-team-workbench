/**
 * dsh-team-workbench — 服务端半体（宿主端入口）
 *
 * 把两块业务组合成**一个**工作台的后端：
 *   · 智能体团队  —— 见 ./team.js：具名智能体、每人一组模型路由、按路由回退派发。
 *   · 共享技能库  —— 见 ./skills.js：~/.skills-src / ~/.workbuddy-ai/skills 的增删改查与派发。
 *
 * 本文件只做组合与生命周期管理，不含业务逻辑；两块业务各自独立注册自己的
 * connection.fetch 路由与模型工具，互不依赖。
 *
 * 路由前缀（都在本包自己的命名空间下，不占用其它插件路径）：
 *   /api/team-workbench/(state|members|probe|dispatch)
 *   /api/team-workbench/skills/(state|read|save|delete|deploy)
 *
 * 模型工具（与旧插件同名，界面与工具约定的调用方式不变）：
 *   agent_team_roster / agent_team_dispatch / agent_team_task
 *   skill_manager_list / skill_manager_read / skill_manager_save / skill_manager_delete / skill_manager_deploy
 *   —— 团队 4 个（含角色库检索）+ 会话 2 个 + 技能库 5 个，合计 11 个，因此不能与旧两支插件同时挂载。
 *
 * @module dsh-team-workbench
 */

import { apply as applyTeam, inject as teamInject } from './team.js'
import { apply as applySkills, inject as skillsInject } from './skills.js'
import { apply as applyChat } from './chat.js'

/** Cordis 插件名（与 package.json 的 name 一致）。 */
export const name = 'dsh-team-workbench'

/** 依赖的服务：路由通道 + 工具注册表。 */
export const inject = [...new Set([...teamInject, ...skillsInject])]

/**
 * 插件主体：依次挂载两块业务，并返回一个统一释放函数。
 *
 * 注意：这里不注册任何 cordis 服务，也不覆盖其它插件的条目；两块业务的路由前缀
 * 都在 /api/team-workbench 下（与旧插件的 /api/agent-team-studio、/api/skill-manager
 * 不冲突）。但**不能与旧两支插件同时挂载**：本包提供与它们同名的 11 个模型工具，
 * 同时挂载会工具重名冲突——迁移脚本会整包摘除旧两支（见 README「与旧插件的关系」）。
 */
export function apply(ctx, config) {
  const disposers = []
  const own = (disposer) => {
    if (typeof disposer === 'function') disposers.push(disposer)
    return disposer
  }

  own(applyTeam(ctx, config))
  own(applySkills(ctx, config))
  own(applyChat(ctx, config))

  ctx.logger.info('[team-workbench] 已挂载：/api/team-workbench（智能体团队 + 共享技能库 + 会话）')

  return () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      try {
        dispose()
      } catch {
        /* 已经释放过 */
      }
    }
  }
}
