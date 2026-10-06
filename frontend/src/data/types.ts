/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 泄洪结束后写入「后续检修待办清单」的条目：检修侧与泄洪侧共用同一份。 */
export type FollowupTodo = {
  /** 来源泄洪操作编号，同时是去重键，重复结束/重复导入只保留第一次入库的那份 */
  sourceNo: string
  title: string
  gateNo: string
  /** 泄洪时开启的孔数，随结束动作一次性回写闸门台账后带过来 */
  openedHoles: string
  /** 泄洪流量，与开启孔数同一份数据 */
  discharge: string
  /** 责任班组，沿用泄洪操作归属，检修派工时能找到归属 */
  crew: string
  operator: string
  /** 泄洪结束时间，也是待办的生成时间，历史记录按它回填排序 */
  endedAt: string
  status: string
}

/** 泄洪登记/批量导入的入参，字段与泄洪操作表对齐。 */
export type FloodDraft = {
  操作编号: string
  泄洪闸号: string
  开启孔数: string
  泄洪流量: string
  下游预警: string
  责任班组: string
  操作时间: string
  操作人员: string
}

export type ImportResult = {
  inserted: number
  skipped: number
  message: string
}
