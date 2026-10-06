import { describe, expect, it } from 'vitest'

import { inferTeam, migrateRows } from '@/data/migrate'
import { SEED_ROWS } from '@/data/seed'
import type { EntryRow } from '@/data/types'

function legacyRows(): Record<string, EntryRow[]> {
  // 模拟 v1 老数据：泄洪没有责任班组/台账写回，闸门没有泄洪流量，没有检修待办模块。
  return {
    gate: [
      {
        id: 1,
        status: '运行中',
        pending: true,
        abnormal: false,
        闸门编号: 'GATE-0001',
        当前开度: '1',
      },
    ],
    flood: [
      {
        id: 1,
        status: '已结束',
        pending: false,
        abnormal: false,
        操作编号: 'FLOO-0001',
        泄洪闸号: 'GATE-0001',
        开启孔数: '3',
        泄洪流量: '900',
        操作时间: '2026-08-01 10:00',
        操作人员: '张三',
      },
      {
        id: 2,
        status: '已结束',
        pending: false,
        abnormal: false,
        操作编号: 'FLOO-0002',
        泄洪闸号: 'GATE-0001',
        开启孔数: '5',
        泄洪流量: '1600',
        操作时间: '2026-08-02 22:30',
        操作人员: '李四',
      },
      {
        id: 3,
        status: '泄洪中',
        pending: true,
        abnormal: false,
        操作编号: 'FLOO-0003',
        泄洪闸号: 'GATE-0001',
        开启孔数: '2',
        泄洪流量: '700',
        操作时间: '2026-08-03',
        操作人员: '王五',
      },
    ],
  }
}

describe('责任班组推断', () => {
  it('按操作时间的班次归属：白班运行一班，夜班运行二班', () => {
    expect(inferTeam({ 操作时间: '2026-08-01 10:00' } as never)).toBe('运行一班')
    expect(inferTeam({ 操作时间: '2026-08-01 22:30' } as never)).toBe('运行二班')
  })

  it('操作时间缺时刻或缺失时按现行版别默认运行一班', () => {
    expect(inferTeam({ 操作时间: '2026-08-01' } as never)).toBe('运行一班')
    expect(inferTeam({} as never)).toBe('运行一班')
  })
})

describe('历史数据迁移', () => {
  it('补责任班组、补闸门字段，已结束泄洪按操作时间回填闸门台账', () => {
    const { rows, changed } = migrateRows(legacyRows())
    expect(changed).toBe(true)

    const [first, second, running] = rows.flood
    expect(first['责任班组']).toBe('运行一班')
    expect(second['责任班组']).toBe('运行二班')
    expect(running['责任班组']).toBe('运行一班')

    // 同一闸门两次已结束泄洪：按操作时间升序写回，最新的一次（FLOO-0002）生效。
    const gate = rows.gate[0]
    expect(gate['当前开度']).toBe('5')
    expect(gate['泄洪流量']).toBe('1600')
    expect(gate['操作人员']).toBe('李四')
    expect(gate['操作时间']).toBe('2026-08-02 22:30')

    expect(first['台账写回']).toBe('已写回')
    expect(second['台账写回']).toBe('已写回')
    expect(running['台账写回']).toBe('未写回')
  })

  it('已结束泄洪补登记检修待办：按发生日期补数，来源单号去重', () => {
    const { rows } = migrateRows(legacyRows())
    const todos = rows.todo
    expect(todos).toHaveLength(2)
    expect(todos.map((todo) => todo['来源单号']).sort()).toEqual(['FLOO-0001', 'FLOO-0002'])
    expect(todos[0]['登记日期']).toBe('2026-08-01 10:00')
    expect(todos[1]['登记日期']).toBe('2026-08-02 22:30')
    expect(todos.every((todo) => todo.status === '待处理' && todo.pending)).toBe(true)
    // 泄洪中的记录不生成待办
    expect(todos.some((todo) => todo['来源单号'] === 'FLOO-0003')).toBe(false)
  })

  it('迁移幂等：重复导入只保留一次，不会多出一行', () => {
    const once = migrateRows(legacyRows())
    const twice = migrateRows(once.rows)
    expect(twice.changed).toBe(false)
    expect(twice.rows.todo).toHaveLength(once.rows.todo.length)
    expect(twice.rows.flood).toHaveLength(once.rows.flood.length)
    expect(twice.rows.gate[0]['当前开度']).toBe('5')
  })

  it('现行种子数据已是最新结构，迁移不产生变化', () => {
    const { changed } = migrateRows(JSON.parse(JSON.stringify(SEED_ROWS)))
    expect(changed).toBe(false)
  })
})
