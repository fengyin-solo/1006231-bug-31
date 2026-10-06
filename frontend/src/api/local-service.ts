import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listFollowups,
  listRows,
  resetRows,
  saveFollowups,
  saveRows,
} from '@/data/local-store'
import { floodSync, upsertFollowup } from '@/data/migrations'
import type {
  ActionResult,
  EntryRow,
  FloodDraft,
  FollowupTodo,
  ImportResult,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 调用人身份：由会话状态传入，服务层据此做归属校验（页面不做业务判断）。
export type Actor = {
  operator: string
  post: string
  crew: string
}

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 只有责任班组能执行的泄洪动作；提交审批属于流程动作，不在这里限班组。
const CREW_GATED_FLOOD_ACTIONS = new Set(['开启泄洪', '结束泄洪'])

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

// 当前岗位是否能动这条泄洪操作：非泄洪岗位、或泄洪岗位但非本班组都算越权。
function denyFloodAction(actor: Actor, row: EntryRow, action: string): string | null {
  if (!CREW_GATED_FLOOD_ACTIONS.has(action)) {
    return null
  }
  const ownerCrew = String(row['责任班组'] ?? '').trim()
  if (actor.post !== '泄洪操作工') {
    return `越权拦截：「${action}」仅限责任班组${ownerCrew}的泄洪操作工执行，当前岗位「${actor.post}」无此权限`
  }
  if (actor.crew !== ownerCrew) {
    return `越权拦截：操作 ${String(row['操作编号'])} 归属${ownerCrew}，当前班组${actor.crew}无权操作，请由${ownerCrew}执行`
  }
  return null
}

// 开启泄洪：同步把本操作的孔数与流量带到闸门台账（运行中读的是泄洪值，不再停在泄洪前开度）。
function syncGateOnOpen(floodRow: EntryRow): void {
  const gates = listRows('gate')
  const index = gates.findIndex(
    (gate) => String(gate['闸门编号'] ?? '').trim() === floodSync.gateNoOf(floodRow),
  )
  if (index < 0) {
    return
  }
  floodSync.writeFloodIntoGate(gates[index], floodRow, false, String(floodRow['开启时间']))
  saveRows('gate', gates)
}

// 结束泄洪：开启孔数与泄洪流量一次性写回闸门台账，同时把结论同步进后续检修待办。
function syncGateAndTodoOnEnd(floodRow: EntryRow): void {
  const endedAt = String(floodRow['结束时间'])
  const gates = listRows('gate')
  const index = gates.findIndex(
    (gate) => String(gate['闸门编号'] ?? '').trim() === floodSync.gateNoOf(floodRow),
  )
  if (index >= 0) {
    floodSync.writeFloodIntoGate(gates[index], floodRow, true, endedAt)
    saveRows('gate', gates)
  }
  const followups = listFollowups()
  upsertFollowup(followups, {
    sourceNo: String(floodRow['操作编号']),
    title: `泄洪后检查：${String(floodRow['泄洪闸号'])}（${String(floodRow['开启孔数'])}）`,
    gateNo: String(floodRow['泄洪闸号']),
    openedHoles: String(floodRow['开启孔数']),
    discharge: String(floodRow['泄洪流量']),
    crew: String(floodRow['责任班组']),
    operator: String(floodRow['操作人员']),
    endedAt,
    status: '待检修',
  })
  saveFollowups(followups)
}

export function runAction(
  key: string,
  id: number,
  action: string,
  actor?: Actor,
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
  const current = rows[index]
  const currentStatus = String(current.status)
  if (currentStatus === target) {
    // 同一操作重复提交：直接幂等返回，不重复改状态、更不会重复写回孔数。
    return { ok: false, message: `${meta.entity}已经是「${target}」，操作只生效一次，无需重复提交` }
  }
  // 状态只能按登记顺序往下走一步，不允许跨状态跳（例如没开启就结束泄洪）。
  const currentOrder = meta.statuses.indexOf(currentStatus)
  const targetOrder = meta.statuses.indexOf(target)
  if (targetOrder !== currentOrder + 1) {
    return { ok: false, message: `${meta.entity}当前「${currentStatus}」，不能直接执行「${action}」，请先流转到「${meta.statuses[currentOrder + 1] ?? target}」` }
  }

  if (key === 'flood' && actor) {
    const denied = denyFloodAction(actor, current, action)
    if (denied) {
      return { ok: false, message: denied }
    }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const stamp = floodSync.nowStamp()
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }

  if (key === 'flood' && actor) {
    // 操作记录如实写实际操作人，不再沿用/伪装成原班组的操作人。
    updated['操作人员'] = actor.operator
    if (action === '开启泄洪') {
      updated['开启时间'] = stamp
      syncGateOnOpen(updated)
    }
    if (action === '结束泄洪') {
      updated['结束时间'] = stamp
      // 台账已回写标记：同一泄洪重复结束不再二次写回；正常状态机下到不了重复，但标记是兜底。
      syncGateAndTodoOnEnd(updated)
      updated['台账已回写'] = true
    }
  }

  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function nextEntryId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function normalizeDraft(draft: FloodDraft): FloodDraft {
  return {
    操作编号: draft.操作编号.trim(),
    泄洪闸号: draft.泄洪闸号.trim(),
    开启孔数: draft.开启孔数.trim(),
    泄洪流量: draft.泄洪流量.trim(),
    下游预警: draft.下游预警.trim() || '无',
    责任班组: draft.责任班组.trim(),
    操作时间: draft.操作时间.trim() || floodSync.nowStamp(),
    操作人员: draft.操作人员.trim(),
  }
}

/** 登记泄洪操作：操作编号即业务主键，重复登记只认第一次的取值，先入库那份保留。 */
export function createFloodEntry(draft: FloodDraft): ActionResult {
  const data = normalizeDraft(draft)
  if (!data.操作编号) {
    return { ok: false, message: '操作编号不能为空' }
  }
  if (!data.泄洪闸号) {
    return { ok: false, message: '泄洪闸号不能为空' }
  }
  if (!data.责任班组 || !floodSync.FLOOD_CREWS.includes(data.责任班组)) {
    return { ok: false, message: '责任班组必须是泄洪一班或泄洪二班' }
  }
  if (!data.操作人员) {
    return { ok: false, message: '操作人员不能为空' }
  }
  const rows = listRows('flood')
  if (rows.some((row) => String(row['操作编号']) === data.操作编号)) {
    return { ok: false, message: `操作编号 ${data.操作编号} 已登记，重复登记只保留先入库的取值` }
  }
  const row: EntryRow = {
    id: nextEntryId(rows),
    status: '待审批',
    pending: true,
    abnormal: false,
    ...data,
    操作状态: '待审批',
    归属来源: '登记',
  }
  saveRows('flood', [...rows, row])
  return { ok: true, message: `泄洪操作 ${data.操作编号} 已登记，归属${data.责任班组}` }
}

/** 批量导入：操作编号重复的整份跳过（不覆盖、不多出一行），只保留第一次导入的取值。 */
export function importFloodEntries(drafts: FloodDraft[]): ImportResult {
  const rows = listRows('flood')
  const existing = new Set(rows.map((row) => String(row['操作编号'])))
  const staged = new Set<string>()
  let inserted = 0
  let skipped = 0
  const next = [...rows]
  for (const raw of drafts) {
    const data = normalizeDraft(raw)
    if (
      !data.操作编号 ||
      !data.泄洪闸号 ||
      !data.责任班组 ||
      !floodSync.FLOOD_CREWS.includes(data.责任班组)
    ) {
      skipped += 1
      continue
    }
    if (existing.has(data.操作编号) || staged.has(data.操作编号)) {
      skipped += 1
      continue
    }
    staged.add(data.操作编号)
    next.push({
      id: nextEntryId(next),
      status: '待审批',
      pending: true,
      abnormal: false,
      ...data,
      操作状态: '待审批',
      归属来源: '导入',
    })
    inserted += 1
  }
  if (inserted > 0) {
    saveRows('flood', next)
  }
  return {
    inserted,
    skipped,
    message: `导入完成：新增 ${inserted} 条，重复/缺项跳过 ${skipped} 条（重复编号只保留第一次入库的取值）`,
  }
}

/** 后续检修待办：泄洪页与机组检修页读的是同一份，条数天然对应。 */
export function listFollowupTodos(): FollowupTodo[] {
  return listFollowups()
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
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
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
