import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'tw-tickets-'))
process.env.DSH_HOME = home

const tickets = await import('../dsh/tickets.js')

const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, cond })
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + detail))
}

// 1. 幂等：同一 clientMessageId 重复受理只产生一张工单
const a = await tickets.openTicket({ threadKind: 'group', threadId: 'room-1', text: '做 A', clientMessageId: 'm1' })
const b = await tickets.openTicket({ threadKind: 'group', threadId: 'room-1', text: '做 A', clientMessageId: 'm1' })
ok('同一消息幂等：只开一张工单', b.duplicate === true && a.ticket.id === b.ticket.id)
ok('工单数 = 1', (await tickets.loadTickets()).length === 1)

// 2. 结束后续单：同 Thread 的新消息恢复原工单
await tickets.endTicket(a.ticket.id, '完成')
const resumed = await tickets.openTicket({ threadKind: 'group', threadId: 'room-1', text: '接着做 A2', clientMessageId: 'm2' })
ok('结束后的人消息恢复原工单', resumed.resumed === true && resumed.ticket.id === a.ticket.id)
ok('恢复后状态回到 open', resumed.ticket.status === 'open')

// 3. 用户叫停：关单并标记，之后新消息不再恢复该单
await tickets.stopThread('group', 'room-1')
const afterStop = await tickets.openTicket({ threadKind: 'group', threadId: 'room-1', text: '再开一单', clientMessageId: 'm3' })
ok('叫停后新消息开新工单（不恢复）', afterStop.ticket.id !== a.ticket.id)
const stopped = (await tickets.loadTickets()).find((t) => t.id === a.ticket.id)
ok('叫停的工单标记 stoppedByPerson', stopped.stoppedByPerson === true)

// 4. 策略变更送达活着的工单
const policy = await tickets.savePolicy({ allowThreads: ['room-1'] })
const live = (await tickets.loadTickets()).find((t) => t.status === 'open')
ok('策略版本 +1', policy.version >= 2)
ok('活工单收到 policyNotice', live.policyNotice === policy.version)

// 5. 重启恢复：running 的 assignment 标成 interrupted
const asg = await tickets.addAssignment(afterStop.ticket.id, 'member-1', '产品经理')
await tickets.markInterrupted()
const after = (await tickets.loadTickets()).find((t) => t.id === afterStop.ticket.id)
ok('重启后 running → interrupted', after.assignments.some((x) => x.id === asg && x.status === 'interrupted'))

// 6. Eval：停止词与白名单
const stopVerdict = await tickets.evaluate({ text: '停止', threadKind: 'group', threadId: 'room-1' })
ok('停止词判定为 stop', stopVerdict.verdict === 'stop')
const outside = await tickets.evaluate({ text: '做活', threadKind: 'group', threadId: 'room-2' })
ok('白名单外的会话被拒绝', outside.verdict === 'ignore')

const failed = results.filter((r) => !r.cond)
console.log('结果: ' + (results.length - failed.length) + ' 通过 / ' + failed.length + ' 失败')
rmSync(home, { recursive: true, force: true })
if (failed.length > 0) process.exit(1)
