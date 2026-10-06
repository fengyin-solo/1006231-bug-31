import type { EntryRow, FollowupTodo } from './types'

// 数据版本：结构或归属规则变了就加一步迁移，老 localStorage 与新播种数据都按顺序跑到最新。
export const CURRENT_SCHEMA_VERSION = 1

export type Database = {
  version: number
  entries: Record<string, EntryRow[]>
  followups: FollowupTodo[]
}

const FLOOD_CREWS = ['泄洪一班', '泄洪二班']
const DEFAULT_CREW = '泄洪一班'

// 泄洪闸号 → 闸门台账编号：两个模块用同一把钥匙对上同一扇闸门。
function gateNoOf(floodRow: EntryRow): string {
  return String(floodRow['泄洪闸号'] ?? '').trim()
}

function nowStamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/**
 * 早期记录没有责任班组的补记规则（按现行版别推断）：
 * 1. 闸号尾号为偶数 → 泄洪二班，奇数（含无法解析）→ 泄洪一班；
 * 2. 一律打上「历史补记」归属来源，和正常登记区分开，事后可核；
 * 3. 缺开启孔数：先取闸门台账该闸号现行「开启孔数」，再缺按最小开启单位 1 孔；
 * 4. 缺泄洪流量按 0m³/s；缺操作时间按 1970-01-01 排到最早回填；缺操作人员记「历史值守（待核）」。
 */
function inferCrew(gateNo: string): string {
  const digits = gateNo.match(/\d+/)
  if (!digits) {
    return DEFAULT_CREW
  }
  const tail = Number(digits[0][digits[0].length - 1])
  return tail % 2 === 0 ? '泄洪二班' : '泄洪一班'
}

function fillFloodBlanks(entries: Record<string, EntryRow[]>, gates: EntryRow[]): void {
  const gateByNo = new Map(gates.map((gate) => [String(gate['闸门编号'] ?? '').trim(), gate]))
  for (const row of entries['flood'] ?? []) {
    if (!('责任班组' in row) || String(row['责任班组'] ?? '').trim() === '') {
      const gateNo = gateNoOf(row)
      row['责任班组'] = inferCrew(gateNo)
      row['归属来源'] = '历史补记'
    } else {
      row['归属来源'] = String(row['归属来源'] ?? '登记')
    }

    const gate = gateByNo.get(gateNoOf(row))
    if (String(row['开启孔数'] ?? '').trim() === '') {
      const fromGate = gate ? String(gate['开启孔数'] ?? '').trim() : ''
      row['开启孔数'] = fromGate || '1孔'
    }
    if (String(row['泄洪流量'] ?? '').trim() === '') {
      const fromGate = gate ? String(gate['泄洪流量'] ?? '').trim() : ''
      row['泄洪流量'] = fromGate || '0m³/s'
    }
    if (String(row['下游预警'] ?? '').trim() === '') {
      row['下游预警'] = '无'
    }
    if (String(row['操作人员'] ?? '').trim() === '') {
      row['操作人员'] = '历史值守（待核）'
    }
    if (String(row['操作时间'] ?? '').trim() === '') {
      row['操作时间'] = '1970-01-01 00:00'
    }

    const status = String(row.status)
    if (status === '已结束' && String(row['结束时间'] ?? '').trim() === '') {
      row['结束时间'] = String(row['操作时间'])
    }
    if (status === '泄洪中' && String(row['开启时间'] ?? '').trim() === '') {
      row['开启时间'] = String(row['操作时间'])
    }
  }
}

function fillGateBlanks(entries: Record<string, EntryRow[]>): void {
  for (const gate of entries['gate'] ?? []) {
    if (String(gate['开启孔数'] ?? '').trim() === '') {
      gate['开启孔数'] = '0孔'
    }
    if (String(gate['泄洪流量'] ?? '').trim() === '') {
      gate['泄洪流量'] = '0m³/s'
    }
  }
}

/** 把一条泄洪记录的孔数与流量写回闸门台账（列表页、闸门页、另存记录读的都是这一份）。 */
function writeFloodIntoGate(gate: EntryRow, floodRow: EntryRow, ended: boolean, stamp: string): void {
  gate['开启孔数'] = floodRow['开启孔数']
  gate['泄洪流量'] = floodRow['泄洪流量']
  gate['操作人员'] = floodRow['操作人员']
  gate['操作时间'] = stamp
  if (ended) {
    // 泄洪结束后闸门已全关，但本次实际开启的孔数要留在台账上备查。
    gate['当前开度'] = '0孔'
    gate['闸门状态'] = '已关闭'
    gate.status = '已关闭'
    gate.pending = false
  } else {
    gate['当前开度'] = floodRow['开启孔数']
    gate['闸门状态'] = '运行中'
    gate.status = '运行中'
    gate.pending = true
  }
}

/**
 * 台账核对回填：历史泄洪记录按操作时间从早到晚依次落到对应闸门，
 * 同一闸门被多次泄洪时以最晚一次为准；每条记录只写回一次（台账已回写标记）。
 */
function reconcileGateLedger(entries: Record<string, EntryRow[]>): void {
  const gates = entries['gate'] ?? []
  const gateByNo = new Map(gates.map((gate) => [String(gate['闸门编号'] ?? '').trim(), gate]))
  const ordered = [...(entries['flood'] ?? [])].sort((a, b) =>
    String(a['操作时间']).localeCompare(String(b['操作时间'])),
  )
  for (const row of ordered) {
    const gate = gateByNo.get(gateNoOf(row))
    if (!gate) {
      continue
    }
    const status = String(row.status)
    if (status === '泄洪中') {
      writeFloodIntoGate(gate, row, false, String(row['开启时间'] || row['操作时间']))
      continue
    }
    if (status === '已结束') {
      // 迁移重跑时已写回的记录不再重复覆盖，保证「只生效一次」。
      if (row['台账已回写'] === true) {
        continue
      }
      writeFloodIntoGate(gate, row, true, String(row['结束时间'] || row['操作时间']))
      row['台账已回写'] = true
    }
  }
}

/** 结束泄洪的结论回写后续检修待办；按操作编号去重，先入库那份保留，重复不新增一行。 */
export function upsertFollowup(followups: FollowupTodo[], todo: FollowupTodo): boolean {
  if (followups.some((item) => item.sourceNo === todo.sourceNo)) {
    return false
  }
  followups.push(todo)
  return true
}

/** 为全部已结束泄洪记录补待办，历史记录按结束（操作）时间排序，和台账回填同一批数据。 */
function rebuildFollowups(entries: Record<string, EntryRow[]>, followups: FollowupTodo[]): void {
  const ended = (entries['flood'] ?? [])
    .filter((row) => String(row.status) === '已结束')
    .sort((a, b) => String(a['结束时间'] || a['操作时间']).localeCompare(String(b['结束时间'] || b['操作时间'])))
  for (const row of ended) {
    upsertFollowup(followups, {
      sourceNo: String(row['操作编号']),
      title: `泄洪后检查：${String(row['泄洪闸号'])}（${String(row['开启孔数'])}）`,
      gateNo: String(row['泄洪闸号']),
      openedHoles: String(row['开启孔数']),
      discharge: String(row['泄洪流量']),
      crew: String(row['责任班组']),
      operator: String(row['操作人员']),
      endedAt: String(row['结束时间'] || row['操作时间']),
      status: '待检修',
    })
  }
}

/**
 * v0 → v1 迁移顺序（定下来不再变）：
 * 1) 闸门台账补「开启孔数 / 泄洪流量」两列；
 * 2) 泄洪记录补责任班组等缺项（早期无班组的按闸号奇偶归属，打历史补记）；
 * 3) 按操作时间回填台账，已结束记录一次性写回孔数与流量且只写一次；
 * 4) 已结束记录回写后续检修待办，按操作编号去重、先入库保留。
 */
function migrateV0ToV1(db: Database): void {
  fillGateBlanks(db.entries)
  fillFloodBlanks(db.entries, db.entries['gate'] ?? [])
  reconcileGateLedger(db.entries)
  rebuildFollowups(db.entries, db.followups)
  db.version = 1
}

const MIGRATIONS: Record<number, (db: Database) => void> = {
  0: migrateV0ToV1,
}

/** 从当前版本一步步迁到最新，顺序固定、每步幂等。 */
export function runMigrations(db: Database): Database {
  while (db.version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[db.version]
    if (!step) {
      throw new Error(`缺少数据版本 ${db.version} 的迁移步骤`)
    }
    step(db)
  }
  return db
}

// 供「结束泄洪」动作复用：台账写回与待办生成都走迁移里同一套规则，避免两处各写一份。
export const floodSync = {
  gateNoOf,
  writeFloodIntoGate,
  upsertFollowup,
  nowStamp,
  FLOOD_CREWS,
  DEFAULT_CREW,
}
