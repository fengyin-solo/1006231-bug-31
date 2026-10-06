import { beforeEach, describe, expect, it } from 'vitest'

import {
  downloadEntries,
  exportEntries,
  importEntries,
  listFloodArchive,
  listReminders,
  loadOverview,
  runAction,
  type OperatorContext,
} from '@/api/local-service'
import { listRows, resetAllRows } from '@/data/local-store'

const dutyTeam: OperatorContext = { operator: '值班员甲', team: '运行一班', position: '泄洪值守岗' }
const otherTeam: OperatorContext = { operator: '值班员乙', team: '运行二班', position: '泄洪值守岗' }
const otherPosition: OperatorContext = { operator: '值班员丙', team: '运行一班', position: '巡检岗' }

beforeEach(() => {
  resetAllRows()
})

describe('泄洪越权拦截', () => {
  it('非责任班组开启/结束泄洪被挡回，并写清归属', () => {
    const result = runAction('flood', 3, '结束泄洪', otherTeam)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('归属责任班组「运行一班」')
    expect(result.message).toContain('当前班组「运行二班」')
    // 状态与台账都没被动过
    expect(listRows('flood').find((row) => row.id === 3)?.status).toBe('泄洪中')
    expect(listRows('gate').find((row) => row['闸门编号'] === 'GATE-0003')?.['当前开度']).toBe('1')
  })

  it('缺少操作人信息时同样拦截', () => {
    const result = runAction('flood', 3, '结束泄洪')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('缺少操作人信息')
  })

  it('责任班组操作成功，操作记录写成实际操作人', () => {
    const result = runAction('flood', 3, '结束泄洪', dutyTeam)
    expect(result.ok).toBe(true)
    const flood = listRows('flood').find((row) => row.id === 3)
    expect(flood?.status).toBe('已结束')
    expect(flood?.['操作人员']).toBe('值班员甲')
  })
})

describe('结束泄洪写回闸门台账', () => {
  it('开启孔数与泄洪流量一次性写回，列表与闸门页读同一份', () => {
    runAction('flood', 3, '结束泄洪', dutyTeam)
    const gate = listRows('gate').find((row) => row['闸门编号'] === 'GATE-0003')
    expect(gate?.['当前开度']).toBe('4')
    expect(gate?.['泄洪流量']).toBe('1500')
    const flood = listRows('flood').find((row) => row.id === 3)
    expect(flood?.['台账写回']).toBe('已写回')
    // 另存的泄洪记录（导出 CSV）与闸门台账一致
    const { content } = exportEntries('flood')
    expect(content).toContain('GATE-0003')
    expect(content).toContain('1500')
  })

  it('同一操作重复提交只生效一次，不重复写回孔数', () => {
    expect(runAction('flood', 3, '结束泄洪', dutyTeam).ok).toBe(true)
    const again = runAction('flood', 3, '结束泄洪', dutyTeam)
    expect(again.ok).toBe(false)
    expect(again.message).toContain('不用重复操作')
    const gates = listRows('gate').filter((row) => row['闸门编号'] === 'GATE-0003')
    expect(gates).toHaveLength(1)
    expect(gates[0]['当前开度']).toBe('4')
    // 待办也只登记一次
    expect(listRows('todo').filter((row) => row['来源单号'] === 'FLOO-0003')).toHaveLength(1)
  })

  it('结论回写检修待办，另一个入口读到的条数与这里对应', () => {
    const before = listRows('todo').length
    runAction('flood', 3, '结束泄洪', dutyTeam)
    const todos = listRows('todo')
    expect(todos.length).toBe(before + 1)
    const todo = todos.find((row) => row['来源单号'] === 'FLOO-0003')
    expect(todo?.['结论']).toContain('开启4孔')
    expect(todo?.['责任班组']).toBe('运行一班')
    // 运营概览（另一个入口）的待处理数与待办清单、提醒事项同源
    const overview = loadOverview()
    const todoModule = overview.modules.find((item) => item.name === '检修待办')
    const pending = todos.filter((row) => row.pending).length
    expect(todoModule?.pending).toBe(pending)
    expect(listReminders().total).toBe(pending)
  })
})

describe('受控只读入口', () => {
  it('泄洪记录档案只给本岗位用，权限外拦截', () => {
    const denied = listFloodArchive(otherPosition)
    expect(denied.ok).toBe(false)
    expect(denied.message).toContain('仅「泄洪值守岗」可用')
    const allowed = listFloodArchive(dutyTeam)
    expect(allowed.ok).toBe(true)
    expect(allowed.items.length).toBeGreaterThan(0)
  })

  it('另存泄洪记录同样只给本岗位用', () => {
    const denied = downloadEntries('flood', otherPosition)
    expect(denied.ok).toBe(false)
    expect(denied.message).toContain('越权操作已拦截')
  })
})

describe('导入去重', () => {
  it('重复导入只保留一次，不会多出一行', () => {
    const { content } = exportEntries('flood')
    const first = importEntries('flood', content, dutyTeam)
    expect(first.ok).toBe(true)
    expect(first.added).toBe(0)
    expect(first.skipped).toBe(3)
    expect(listRows('flood')).toHaveLength(3)
  })

  it('新记录入库，已有编号保留先入库的那份', () => {
    const { content } = exportEntries('flood')
    const extra = `${content}\n9,FLOO-0009,GATE-0001,1,100,无,2026-09-09,值班员甲,运行一班,样例,待审批`
    const result = importEntries('flood', extra, dutyTeam)
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(3)
    expect(listRows('flood')).toHaveLength(4)
    // 重复登记只认第一次：再次导入同编号不同取值，先入库的保留
    const again = importEntries(
      'flood',
      '编号,操作编号,泄洪闸号,开启孔数,泄洪流量,下游预警,操作时间,操作人员,责任班组,操作状态,当前状态\n10,FLOO-0009,GATE-0002,9,999,无,2026-09-10,值班员乙,运行二班,样例,泄洪中',
      dutyTeam,
    )
    expect(again.added).toBe(0)
    const kept = listRows('flood').find((row) => row['操作编号'] === 'FLOO-0009')
    expect(kept?.['泄洪闸号']).toBe('GATE-0001')
  })

  it('非本岗位导入泄洪记录被拦截', () => {
    const result = importEntries('flood', '编号,操作编号\n1,FLOO-0001', otherPosition)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('越权操作已拦截')
  })
})
