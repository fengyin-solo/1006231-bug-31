import { MODULE_BY_KEY } from '@/data/modules'
import { buildTodoFromFlood, DEFAULT_TEAM } from '@/data/migrate'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 泄洪操作的受控口径：开启/结束只允许责任班组执行；另存与档案是只读入口，只给本岗位用。
export const FLOOD_POSITION = '泄洪值守岗'
const FLOOD_GUARDED_ACTIONS = ['开启泄洪', '结束泄洪']

// 当前操作人：页面从会话里取，服务层只认这个上下文，不认页面传的状态。
export type OperatorContext = {
  operator: string
  team: string
  position: string
}

function nowStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 泄洪记录档案：受控的只读入口，只给本岗位（泄洪值守岗）用，权限外的一律拦下。
export function listFloodArchive(
  operator: OperatorContext | undefined,
): ActionResult & { items: EntryRow[] } {
  if (!operator || operator.position !== FLOOD_POSITION) {
    return {
      ok: false,
      message: `越权操作已拦截：泄洪记录档案是只读入口，仅「${FLOOD_POSITION}」可用，当前岗位「${
        operator?.position ?? '未登记'
      }」`,
      items: [],
    }
  }
  const items = [...listRows('flood')].sort((a, b) =>
    String(b['操作时间'] ?? '').localeCompare(String(a['操作时间'] ?? '')),
  )
  return { ok: true, message: '', items }
}

// 检修待办上的提醒事项：与待办清单读同一份数据，天然同步。
export function listReminders(): { total: number; items: EntryRow[] } {
  const items = listRows('todo').filter((row) => row.pending)
  return { total: items.length, items }
}

// 结束泄洪的联动写回：开启孔数与泄洪流量一次性写回闸门台账，结论回写检修待办。
// 同一次结束重复提交只生效一次——状态守卫挡住重复流转，「台账写回」标记挡住重复写回，
// 待办按来源单号去重，先入库的那份保留。
function settleFlood(
  flood: EntryRow,
  operator: OperatorContext,
  stamp: string,
): { flood: EntryRow; notes: string[] } {
  const snapshot = allRows()
  const notes: string[] = []
  let next: EntryRow = { ...flood, 操作人员: operator.operator, 操作时间: stamp }

  if (String(next['台账写回']) !== '已写回') {
    const gateRows = [...(snapshot.gate ?? [])]
    const gateIndex = gateRows.findIndex(
      (row) => String(row['闸门编号']) === String(next['泄洪闸号']),
    )
    if (gateIndex >= 0) {
      const gate = gateRows[gateIndex]
      gateRows[gateIndex] = {
        ...gate,
        当前开度: String(next['开启孔数'] ?? gate['当前开度']),
        泄洪流量: String(next['泄洪流量'] ?? '0'),
        操作人员: operator.operator,
        操作时间: stamp,
      }
      saveRows('gate', gateRows)
      next = { ...next, 台账写回: '已写回' }
      notes.push(
        `开启孔数 ${String(next['开启孔数'])}、泄洪流量 ${String(
          next['泄洪流量'],
        )} 已写回闸门台账（${String(next['泄洪闸号'])}）`,
      )
    } else {
      notes.push(`未找到闸门「${String(next['泄洪闸号'])}」的台账，写回跳过`)
    }
  } else {
    notes.push('闸门台账此前已写回，本次不重复写回')
  }

  const todoRows = [...(snapshot.todo ?? [])]
  const source = String(next['操作编号'] ?? '')
  if (source !== '' && !todoRows.some((todo) => String(todo['来源单号']) === source)) {
    const nextId = todoRows.reduce((max, todo) => Math.max(max, Number(todo.id) || 0), 0) + 1
    todoRows.push(buildTodoFromFlood(next, nextId, stamp.slice(0, 10)))
    saveRows('todo', todoRows)
    notes.push(`检修待办 TODO-${source} 已登记`)
  } else if (source !== '') {
    notes.push(`检修待办 TODO-${source} 此前已登记，保留先入库的那份`)
  }

  return { flood: next, notes }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  operator?: OperatorContext,
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 泄洪越权拦截：开启/结束只允许责任班组操作，越权提交挡回去并写清归属。
  if (key === 'flood' && FLOOD_GUARDED_ACTIONS.includes(action)) {
    const owner = String(rows[index]['责任班组'] ?? '')
    if (!operator) {
      return { ok: false, message: `越权操作已拦截：缺少操作人信息，无法核对「${owner}」的授权` }
    }
    if (operator.team !== owner) {
      return {
        ok: false,
        message: `越权操作已拦截：「${String(
          rows[index]['操作编号'],
        )}」归属责任班组「${owner}」，当前班组「${operator.team}」无权${action}`,
      }
    }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  let updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const notes: string[] = []
  if (key === 'flood' && operator && FLOOD_GUARDED_ACTIONS.includes(action)) {
    if (action === '结束泄洪') {
      const settled = settleFlood(updated, operator, nowStamp())
      updated = settled.flood
      notes.push(...settled.notes)
    } else {
      updated = { ...updated, 操作人员: operator.operator, 操作时间: nowStamp() }
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  const suffix = notes.length > 0 ? `；${notes.join('；')}` : ''
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${suffix}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

// 另存（导出）：泄洪记录是只读入口，仅本岗位可用；其余模块不受限。
export function downloadEntries(key: string, operator?: OperatorContext): ActionResult {
  if (key === 'flood' && (!operator || operator.position !== FLOOD_POSITION)) {
    return {
      ok: false,
      message: `越权操作已拦截：泄洪记录另存是只读入口，仅「${FLOOD_POSITION}」可用，当前岗位「${
        operator?.position ?? '未登记'
      }」`,
    }
  }
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return { ok: true, message: `${moduleMeta(key).name}清单已另存` }
}

// 导入：按业务编号（第一个字段）去重，先入库的保留；重复导入只保留一次，不会多出一行。
// 泄洪记录的导入与另存同口径，仅本岗位可用。
export function importEntries(
  key: string,
  csvText: string,
  operator?: OperatorContext,
): ActionResult & { added: number; skipped: number } {
  const meta = moduleMeta(key)
  if (key === 'flood' && (!operator || operator.position !== FLOOD_POSITION)) {
    return {
      ok: false,
      message: `越权操作已拦截：泄洪记录导入仅「${FLOOD_POSITION}」可用，当前岗位「${
        operator?.position ?? '未登记'
      }」`,
      added: 0,
      skipped: 0,
    }
  }
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  const businessKey = meta.fields[0]
  if (lines.length < 2) {
    return { ok: false, message: '导入文件里没有数据行', added: 0, skipped: 0 }
  }
  const header = lines[0].split(',')
  const keyIndex = header.indexOf(businessKey)
  if (keyIndex < 0) {
    return { ok: false, message: `导入文件缺少「${businessKey}」列，无法按业务编号去重`, added: 0, skipped: 0 }
  }
  const statusIndex = header.indexOf('当前状态')
  const rows = [...listRows(key)]
  const known = new Set(rows.map((row) => String(row[businessKey] ?? '')))
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  let added = 0
  let skipped = 0
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const businessValue = (cells[keyIndex] ?? '').trim()
    // 重复登记只认第一次的取值：已存在（含本批已导入）的直接跳过，先入库的保留。
    if (businessValue === '' || known.has(businessValue)) {
      skipped += 1
      continue
    }
    known.add(businessValue)
    const status =
      statusIndex >= 0 && meta.statuses.includes(cells[statusIndex])
        ? cells[statusIndex]
        : meta.statuses[0]
    const row: EntryRow = {
      id: nextId,
      status,
      pending: status !== lastStatus,
      abnormal: false,
    }
    meta.fields.forEach((field) => {
      const column = header.indexOf(field)
      row[field] = column >= 0 ? (cells[column] ?? '') : ''
    })
    if (key === 'flood' && !row['责任班组']) {
      row['责任班组'] = DEFAULT_TEAM
    }
    if (key === 'flood' && !row['台账写回']) {
      row['台账写回'] = '未写回'
    }
    rows.push(row)
    nextId += 1
    added += 1
  }
  saveRows(key, rows)
  return {
    ok: true,
    message: `${meta.name}导入完成：新增 ${added} 条，重复跳过 ${skipped} 条`,
    added,
    skipped,
  }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
