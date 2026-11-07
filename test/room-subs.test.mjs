import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'tw-rooms-'))
process.env.DSH_HOME = home

const team = await import('../dsh/team.js')
const chat = await import('../dsh/chat.js')

const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, cond })
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + detail))
}

const store = await team.loadStore()
store.members = [
  {
    id: 'lead-1', name: '产品部', role: '部门', emoji: '🧠', color: '', groupId: '',
    avatar: { kind: 'emoji', imageId: '' }, roleRef: { library: '', id: '', version: '' },
    instructions: '', enabled: true, createdAt: new Date().toISOString(), activeRouteId: '',
    routes: [],
    department: { name: '产品部', subAgents: [
      { id: 's1', name: '甲', role: 'a', emoji: '1', provider: '', model: '', reasoningEffort: '', roleRef: { library: '', id: '', version: '' } },
      { id: 's2', name: '乙', role: 'b', emoji: '2', provider: '', model: '', reasoningEffort: '', roleRef: { library: '', id: '', version: '' } }
    ] }
  }
]
store.chiefId = 'lead-1'
await team.saveStore(store)

const created = await chat.applyRoomAction({ action: 'create', room: { name: '子智能体群', memberIds: ['sub:s1', 'sub:s2'], adminId: 'sub:s1' } })
ok('子智能体可作为群成员创建群', created.room !== undefined && created.room.memberIds.length === 2, JSON.stringify(created).slice(0, 120))
ok('成员 id 保留 sub: 前缀', created.room.memberIds.every((id) => id.startsWith('sub:')), JSON.stringify(created.room?.memberIds))

const overview = await chat.chatOverview({ get: () => undefined })
const room = overview.rooms.find((entry) => entry.name === '子智能体群')
ok('概览能解析子智能体名字', room !== undefined && room.members.length === 2 && room.members[0].name === '甲', JSON.stringify(room?.members))

const failed = results.filter((r) => !r.cond)
console.log('结果: ' + (results.length - failed.length) + ' 通过 / ' + failed.length + ' 失败')
rmSync(home, { recursive: true, force: true })
if (failed.length > 0) process.exit(1)
