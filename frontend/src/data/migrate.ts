import { MODULES } from './modules'
import type { EntryRow } from './types'

// 数据版本：localStorage 里的存量数据按版本迁移到现行结构，迁移只升不降。
// v1 → v2：泄洪记录补「责任班组 / 台账写回」，闸门台账补「泄洪流量」，
//          历史已结束泄洪按操作时间回填闸门台账，并补登记检修待办。
export const STORAGE_VERSION = 2

export const DEFAULT_TEAM = '运行一班'
export const NIGHT_TEAM = '运行二班'

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

// 责任班组补记规则（早期记录没有责任班组时的推断口径）：
// 操作时间带时刻的按班次归属——白班 08:00-20:00 记「运行一班」，其余时段记「运行二班」；
// 操作时间缺失或解析不出时刻的，按现行版别默认记「运行一班」。
export function inferTeam(row: EntryRow): string {
  const raw = String(row['操作时间'] ?? '')
  const match = raw.match(/(\d{1,2}):(\d{2})/)
  if (!match) {
    return DEFAULT_TEAM
  }
  const hour = Number(match[1])
  return hour >= 8 && hour < 20 ? DEFAULT_TEAM : NIGHT_TEAM
}

function gateWriteBack(gateRows: EntryRow[], flood: EntryRow): boolean {
  const index = gateRows.findIndex((row) => String(row['闸门编号']) === String(flood['泄洪闸号']))
  if (index < 0) {
    return false
  }
  const gate = gateRows[index]
  gateRows[index] = {
    ...gate,
    当前开度: String(flood['开启孔数'] ?? gate['当前开度']),
    泄洪流量: String(flood['泄洪流量'] ?? '0'),
    操作人员: String(flood['操作人员'] ?? gate['操作人员'] ?? ''),
    操作时间: String(flood['操作时间'] ?? gate['操作时间'] ?? ''),
  }
  return true
}

// 由一条已结束的泄洪记录生成检修待办（结论回写）。登记日期取泄洪操作时间（按发生日期补数），
// 责任班组等缺项此时已被步骤 3 回填，仍缺则按现行版别默认。
export function buildTodoFromFlood(flood: EntryRow, id: number, registerDate?: string): EntryRow {
  const code = String(flood['操作编号'] ?? '')
  return {
    id,
    status: '待处理',
    pending: true,
    abnormal: false,
    待办编号: `TODO-${code}`,
    来源单号: code,
    待办内容: `泄洪「${code}」（${String(flood['泄洪闸号'] ?? '')}）结束后闸门跟进检查`,
    结论: `泄洪已结束：开启${String(flood['开启孔数'] ?? '?')}孔、泄洪流量${String(
      flood['泄洪流量'] ?? '?',
    )}，已写回闸门台账`,
    责任班组: String(flood['责任班组'] ?? DEFAULT_TEAM),
    登记日期: registerDate ?? String(flood['操作时间'] ?? ''),
    待办状态: '待处理',
  }
}

// 迁移顺序（定稿，改动需同步 README）：
//  1. 补齐模块桶：老数据没有后加的模块（如检修待办），先补空数组，后续步骤按桶取数。
//  2. 闸门台账补「泄洪流量」字段，默认 "0"，给第 4 步的写回备好落点。
//  3. 泄洪记录补「责任班组」（按操作时间推断）与「台账写回」标记（默认「未写回」）。
//  4. 历史已结束且未写回的泄洪记录按操作时间升序写回闸门台账：同一闸门多次泄洪时
//     时间最新的一次最终生效；写完标记「已写回」，重复迁移不会二次写回。
//  5. 已结束的泄洪记录逐条补登记检修待办：按「来源单号 = 操作编号」去重，先入库的保留，
//     重复迁移/重复导入不会多出一行；登记日期取泄洪操作时间，缺项按现行版别推断。
export function migrateRows(input: Record<string, EntryRow[]>): {
  rows: Record<string, EntryRow[]>
  changed: boolean
} {
  let changed = false
  const rows: Record<string, EntryRow[]> = { ...input }

  // 1. 补齐模块桶
  for (const meta of MODULES) {
    if (!Array.isArray(rows[meta.key])) {
      rows[meta.key] = []
      changed = true
    }
  }

  // 2. 闸门台账补「泄洪流量」
  rows.gate = rows.gate.map((gate) => {
    if (isBlank(gate['泄洪流量'])) {
      changed = true
      return { ...gate, 泄洪流量: '0' }
    }
    return gate
  })

  // 3. 泄洪记录补「责任班组」「台账写回」
  rows.flood = rows.flood.map((flood) => {
    let next = flood
    if (isBlank(next['责任班组'])) {
      changed = true
      next = { ...next, 责任班组: inferTeam(next) }
    }
    if (isBlank(next['台账写回'])) {
      changed = true
      next = { ...next, 台账写回: '未写回' }
    }
    return next
  })

  // 4. 历史已结束泄洪按操作时间升序写回闸门台账
  const ended = rows.flood
    .filter((flood) => String(flood.status) === '已结束' && String(flood['台账写回']) !== '已写回')
    .sort((a, b) => String(a['操作时间'] ?? '').localeCompare(String(b['操作时间'] ?? '')))
  if (ended.length > 0) {
    const gateRows = [...rows.gate]
    const written = new Set<number>()
    for (const flood of ended) {
      if (gateWriteBack(gateRows, flood)) {
        written.add(Number(flood.id))
        changed = true
      }
    }
    rows.gate = gateRows
    rows.flood = rows.flood.map((flood) =>
      written.has(Number(flood.id)) ? { ...flood, 台账写回: '已写回' } : flood,
    )
  }

  // 5. 已结束泄洪补登记检修待办（按来源单号去重，先入库的保留）
  const todos = [...rows.todo]
  const knownSources = new Set(todos.map((todo) => String(todo['来源单号'] ?? '')))
  let nextId = todos.reduce((max, todo) => Math.max(max, Number(todo.id) || 0), 0) + 1
  for (const flood of rows.flood) {
    if (String(flood.status) !== '已结束') {
      continue
    }
    const source = String(flood['操作编号'] ?? '')
    if (source === '' || knownSources.has(source)) {
      continue
    }
    todos.push(buildTodoFromFlood(flood, nextId))
    knownSources.add(source)
    nextId += 1
    changed = true
  }
  rows.todo = todos

  return { rows, changed }
}
