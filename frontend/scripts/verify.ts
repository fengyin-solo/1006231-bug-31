/* 端到端验证（内存 localStorage 沙箱）：迁移、越权、台账回写、幂等、待办同步、导入去重。 */
import { runAction, createFloodEntry, importFloodEntries, listFollowupTodos } from '../src/api/local-service'
import { listRows, listFollowups, resetRows } from '../src/data/local-store'
import { schemaVersion } from '../src/data/local-store'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌ FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('✅', msg)
  }
}

const floodCrew1 = { operator: '王泄洪', post: '泄洪操作工', crew: '泄洪一班' }
const floodCrew2 = { operator: '李守闸', post: '泄洪操作工', crew: '泄洪二班' }
const repair = { operator: '赵检修', post: '机械检修工', crew: '检修班' }

console.log('--- 迁移结果（v0 播种数据 → v' + schemaVersion() + '）---')
const floods = listRows('flood')
const gates = listRows('gate')
assert(schemaVersion() === 1, '数据版本迁移到 v1')

const f0004 = floods.find((r) => r['操作编号'] === 'FLOO-0004')!
const f0005 = floods.find((r) => r['操作编号'] === 'FLOO-0005')!
assert(String(f0004['责任班组']) === '泄洪二班', '历史无班组记录 FLOO-0004（闸号偶数）补记为泄洪二班')
assert(String(f0004['归属来源']) === '历史补记', '补记记录打「历史补记」标记')
assert(String(f0005['责任班组']) === '泄洪二班', 'FLOO-0005（GATE-0002）补记为泄洪二班')

// 台账回填：历史已结束记录的孔数/流量一次性写回闸门台账
const g2 = gates.find((g) => g['闸门编号'] === 'GATE-0002')!
const g4 = gates.find((g) => g['闸门编号'] === 'GATE-0004')!
assert(String(g2['开启孔数']) === '1孔' && String(g2['泄洪流量']) === '120m³/s', 'GATE-0002 台账回填 1孔/120m³/s')
assert(String(g2['当前开度']) === '0孔' && String(g2.status) === '已关闭', '泄洪结束后闸门台账为全关但保留开启孔数')
assert(String(g4['开启孔数']) === '2孔' && String(g4['泄洪流量']) === '260m³/s', 'GATE-0004 台账回填 2孔/260m³/s')
assert(f0004['台账已回写'] === true && f0005['台账已回写'] === true, '历史结束记录标记台账已回写')

// 泄洪中记录台账也已同步（不再停在泄洪前开度）
const g3 = gates.find((g) => g['闸门编号'] === 'GATE-0003')!
assert(String(g3['开启孔数']) === '3孔' && String(g3['当前开度']) === '3孔', '泄洪中 GATE-0003 台账为 3孔')

const todos = listFollowupTodos()
assert(todos.length === 3, `已结束记录生成 3 条后续检修待办（实际 ${todos.length}）`)
assert(todos.map((t) => t.sourceNo).join() === 'FLOO-0006,FLOO-0004,FLOO-0005', '待办按结束（操作）时间从早到晚排序')

console.log('--- 越权拦截 ---')
const f0002 = floods.find((r) => r['操作编号'] === 'FLOO-0002')!
const id2 = Number(f0002.id)
let r = runAction('flood', id2, '开启泄洪', repair)
assert(!r.ok && r.message.includes('越权拦截') && r.message.includes('泄洪一班'), '检修岗位开启被挡并写明归属')
r = runAction('flood', id2, '开启泄洪', floodCrew2)
assert(!r.ok && r.message.includes('无权操作'), '非本责任班组（二班）开启一班记录被挡')
r = runAction('flood', id2, '开启泄洪', floodCrew1)
assert(r.ok, '责任班组泄洪一班开启成功')
// 跨状态跳：待审批记录不能直接结束
const f0001 = floods.find((x) => x['操作编号'] === 'FLOO-0001')!
r = runAction('flood', Number(f0001.id), '结束泄洪', floodCrew1)
assert(!r.ok && r.message.includes('不能直接'), '待审批记录不能跨状态直接结束')
let g1 = listRows('gate').find((g) => g['闸门编号'] === 'GATE-0001')!
assert(String(g1['开启孔数']) === '2孔' && String(g1.status) === '运行中', '开启时台账同步孔数为 2孔/运行中')

console.log('--- 结束泄洪 + 一次性回写 + 待办同步 ---')
const nowOpen = listRows('flood').find((x) => x['操作编号'] === 'FLOO-0002')!
const idOpen = Number(nowOpen.id)
r = runAction('flood', idOpen, '结束泄洪', floodCrew2)
assert(!r.ok && r.message.includes('无权操作'), '结束也限定责任班组（二班结束一班被挡）')
r = runAction('flood', idOpen, '结束泄洪', repair)
assert(!r.ok && r.message.includes('越权拦截'), '检修岗位结束被挡')
r = runAction('flood', idOpen, '结束泄洪', floodCrew1)
assert(r.ok, '责任班组结束成功')
g1 = listRows('gate').find((g) => g['闸门编号'] === 'GATE-0001')!
assert(String(g1['开启孔数']) === '2孔' && String(g1['泄洪流量']) === '320m³/s', '结束把孔数2孔/流量320m³/s 一次性写回台账')
assert(String(g1['当前开度']) === '0孔' && String(g1.status) === '已关闭', '结束后门全关、状态已关闭')
const ended = listRows('flood').find((x) => x['操作编号'] === 'FLOO-0002')!
assert(String(ended['操作人员']) === '王泄洪', '操作记录如实写实际操作人，不伪装成原班组')
assert(ended['台账已回写'] === true, '结束记录打台账已回写标记')

console.log('--- 重复提交幂等 ---')
r = runAction('flood', idOpen, '结束泄洪', floodCrew1)
assert(!r.ok && r.message.includes('只生效一次'), '重复结束被幂等挡回')
const todosBefore = listFollowupTodos().length
const g1Before = JSON.stringify(listRows('gate').find((g) => g['闸门编号'] === 'GATE-0001'))
// 再次结束不应重复写台账或重复建待办
runAction('flood', idOpen, '结束泄洪', floodCrew1)
assert(listFollowupTodos().length === todosBefore, '重复结束不多出待办')
assert(JSON.stringify(listRows('gate').find((g) => g['闸门编号'] === 'GATE-0001')) === g1Before, '重复结束不重复写台账')

console.log('--- 待办两侧同源 + 新结束同步 ---')
assert(listFollowupTodos().length === 4, `结束 FLOO-0002 后待办变 4 条（实际 ${listFollowupTodos().length}）`)
const todoNew = listFollowupTodos().find((t) => t.sourceNo === 'FLOO-0002')!
assert(todoNew.openedHoles === '2孔' && todoNew.crew === '泄洪一班', '待办带台账同一份孔数与归属')

console.log('--- 登记 / 导入去重（先入库保留）---')
r = createFloodEntry({ 操作编号: 'FLOO-9001', 泄洪闸号: 'GATE-0002', 开启孔数: '1孔', 泄洪流量: '90m³/s', 下游预警: '无', 责任班组: '泄洪二班', 操作时间: '2026-10-06 08:00', 操作人员: '李守闸' })
assert(r.ok, '新操作编号登记成功')
r = createFloodEntry({ 操作编号: 'FLOO-9001', 泄洪闸号: 'GATE-0002', 开启孔数: '9孔', 泄洪流量: '999m³/s', 下游预警: '无', 责任班组: '泄洪二班', 操作时间: '', 操作人员: '李守闸' })
assert(!r.ok && r.message.includes('重复登记'), '重复编号登记被拒')
const kept = listRows('flood').find((x) => x['操作编号'] === 'FLOO-9001')!
assert(String(kept['开启孔数']) === '1孔', '重复登记保留先入库的取值（1孔，不被9孔覆盖）')

const imp = importFloodEntries([
  { 操作编号: 'FLOO-9002', 泄洪闸号: 'GATE-0003', 开启孔数: '2孔', 泄洪流量: '200m³/s', 下游预警: '', 责任班组: '泄洪一班', 操作时间: '', 操作人员: '王泄洪' },
  { 操作编号: 'FLOO-9002', 泄洪闸号: 'GATE-0003', 开启孔数: '8孔', 泄洪流量: '888m³/s', 下游预警: '', 责任班组: '泄洪一班', 操作时间: '', 操作人员: '王泄洪' },
  { 操作编号: 'FLOO-9001', 泄洪闸号: 'GATE-0002', 开启孔数: '7孔', 泄洪流量: '777m³/s', 下游预警: '', 责任班组: '泄洪二班', 操作时间: '', 操作人员: '李守闸' },
  { 操作编号: '', 泄洪闸号: 'GATE-0003', 开启孔数: '1孔', 泄洪流量: '1', 下游预警: '', 责任班组: '泄洪一班', 操作时间: '', 操作人员: '王泄洪' },
])
assert(imp.inserted === 1 && imp.skipped === 3, `批量导入新增1跳过3（实际 新增${imp.inserted}/跳过${imp.skipped}）`)
const impKept = listRows('flood').filter((x) => x['操作编号'] === 'FLOO-9002')
assert(impKept.length === 1 && String(impKept[0]['开启孔数']) === '2孔', '导入内重复+库内重复都只保留第一次入库取值')

console.log('--- 迁移幂等（重复跑不重复写/不多行）---')
const todosCount = listFollowupTodos().length
resetRows('flood') // 重置触发重新播种+迁移
assert(listFollowupTodos().length === 3, '重置/重跑迁移待办仍是 3 条，无重复行')
const g2again = listRows('gate').find((g) => g['闸门编号'] === 'GATE-0002')!
assert(String(g2again['开启孔数']) === '1孔', '重跑迁移台账回填结果一致')

console.log('--- 完成 ---')
