<template>
  <section class="page" data-module="flood">
    <header class="page-head">
      <div>
        <h2>泄洪操作管理</h2>
        <p class="page-desc">开启与结束泄洪只允许责任班组操作；结束时开启孔数与泄洪流量一次性写回闸门台账，列表、闸门页与另存记录读同一份。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记泄洪操作</button>
        <button class="btn" type="button" @click="openImport">批量导入</button>
        <button class="btn" type="button" @click="exportRows">导出泄洪操作清单</button>
        <button class="btn" type="button" @click="toggleFollowups">后续检修待办（{{ followups.length }}）</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="identity-banner" :class="{ denied: !store.isFloodOperator }">
      当前岗位：{{ store.post }} · {{ store.crew }} ·
      <template v-if="store.isFloodOperator">可操作本班组负责的泄洪闸</template>
      <template v-else>无泄洪操作权限，开启/结束提交将被拦截</template>
    </p>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>闸门台账孔数</th>
          <th>归属来源</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ gateHolesOf(row) }}</td>
          <td>{{ row['归属来源'] ?? '登记' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in allowedActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!allowedActions(row).length" class="muted-text">无权限/无需操作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无泄洪操作数据，可先登记泄洪操作</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条泄洪操作记录 · 数据版本 v{{ schemaVersion }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 受控只读入口：只给本岗位（泄洪操作工）用，权限外打开即被拦下 -->
    <section v-if="followupsVisible" class="followup-panel">
      <header class="followup-head">
        <h3>后续检修待办（只读）</h3>
        <button class="btn ghost" type="button" @click="followupsVisible = false">收起</button>
      </header>
      <p v-if="followupDenied" class="error-text">{{ followupDenied }}</p>
      <template v-else>
        <p class="page-desc">泄洪结束自动回写，共 {{ followups.length }} 条，与「机组检修」页读到同一份。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>来源操作编号</th><th>待办内容</th><th>泄洪闸号</th><th>开启孔数</th>
              <th>泄洪流量</th><th>责任班组</th><th>操作人</th><th>结束时间</th><th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="todo in followups" :key="todo.sourceNo">
              <td>{{ todo.sourceNo }}</td>
              <td>{{ todo.title }}</td>
              <td>{{ todo.gateNo }}</td>
              <td>{{ todo.openedHoles }}</td>
              <td>{{ todo.discharge }}</td>
              <td>{{ todo.crew }}</td>
              <td>{{ todo.operator }}</td>
              <td>{{ todo.endedAt }}</td>
              <td>{{ todo.status }}</td>
            </tr>
            <tr v-if="!followups.length">
              <td colspan="9" class="empty-state">暂无后续检修待办</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <!-- 登记泄洪操作 -->
    <div v-if="createVisible" class="modal-mask" @click.self="createVisible = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记泄洪操作</h3>
        <label v-for="field in createFields" :key="field" class="form-item">
          <span>{{ field }}</span>
          <select v-if="field === '责任班组'" v-model="createForm[field as keyof FloodDraft]">
            <option value="">请选择责任班组</option>
            <option value="泄洪一班">泄洪一班</option>
            <option value="泄洪二班">泄洪二班</option>
          </select>
          <input v-else v-model="createForm[field as keyof FloodDraft]" :placeholder="`请输入${field}`" />
        </label>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">提交登记</button>
          <button class="btn ghost" type="button" @click="createVisible = false">取消</button>
        </div>
      </form>
    </div>

    <!-- 批量导入：每行一条，逗号分隔 -->
    <div v-if="importVisible" class="modal-mask" @click.self="importVisible = false">
      <form class="modal-card" @submit.prevent="submitImport">
        <h3>批量导入泄洪操作</h3>
        <p class="page-desc">每行一条，字段顺序：操作编号,泄洪闸号,开启孔数,泄洪流量,下游预警,责任班组,操作时间,操作人员。重复操作编号整行跳过。</p>
        <textarea v-model="importText" class="import-box" rows="8" placeholder="FLOO-0010,GATE-0001,1孔,120m³/s,无,泄洪一班,2026-10-05 09:00,王泄洪"></textarea>
        <p v-if="importError" class="error-text">{{ importError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">开始导入</button>
          <button class="btn ghost" type="button" @click="importVisible = false">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createFloodEntry,
  downloadEntries,
  importFloodEntries,
  listEntries,
  listFollowupTodos,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listRows, schemaVersion } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, FloodDraft, FollowupTodo } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('flood')
const columns = ["操作编号", "泄洪闸号", "开启孔数", "泄洪流量", "下游预警", "责任班组", "操作时间", "操作人员", "开启时间", "结束时间", "操作状态"]
const createFields = ["操作编号", "泄洪闸号", "开启孔数", "泄洪流量", "下游预警", "责任班组", "操作时间", "操作人员"]
const gatedActions = new Set(['开启泄洪', '结束泄洪'])
const stats = [{"label": "待审批操作", "value": 0}, {"label": "泄洪中闸门", "value": 0}, {"label": "今日泄洪量", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const followups = ref<FollowupTodo[]>([])
const followupsVisible = ref(false)
const followupDenied = ref('')

const createVisible = ref(false)
const createError = ref('')
const importVisible = ref(false)
const importText = ref('')
const importError = ref('')

const emptyForm = (): FloodDraft => ({
  操作编号: '',
  泄洪闸号: '',
  开启孔数: '',
  泄洪流量: '',
  下游预警: '',
  责任班组: store.isFloodOperator ? store.crew : '',
  操作时间: '',
  操作人员: store.operator,
})
const createForm = reactive<FloodDraft>(emptyForm())

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 页面只做展示层的按钮收敛，真正的归属拦截在服务层，绕过页面直接调动作照样被挡。
function allowedActions(row: EntryRow): string[] {
  return meta.actions.filter((action) => {
    if (!gatedActions.has(action)) {
      return true
    }
    return store.isFloodOperator && store.crew === String(row['责任班组'] ?? '')
  })
}

function gateHolesOf(row: EntryRow): string {
  const gate = listRows('gate').find(
    (item) => String(item['闸门编号'] ?? '') === String(row['泄洪闸号'] ?? ''),
  )
  return gate ? String(gate['开启孔数'] ?? '—') : '—'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  Object.assign(createForm, emptyForm())
  createError.value = ''
  createVisible.value = true
}

function submitCreate() {
  const result = createFloodEntry({ ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createVisible.value = false
  errorMessage.value = result.message
  reload()
}

function openImport() {
  importText.value = ''
  importError.value = ''
  importVisible.value = true
}

function submitImport() {
  const drafts: FloodDraft[] = importText.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [no = '', gate = '', holes = '', flow = '', warn = '', crew = '', time = '', operator = ''] =
        line.split(',')
      return {
        操作编号: no.trim(),
        泄洪闸号: gate.trim(),
        开启孔数: holes.trim(),
        泄洪流量: flow.trim(),
        下游预警: warn.trim(),
        责任班组: crew.trim(),
        操作时间: time.trim(),
        操作人员: operator.trim(),
      }
    })
  if (!drafts.length) {
    importError.value = '没有可导入的数据行'
    return
  }
  const result = importFloodEntries(drafts)
  importError.value = result.message
  if (result.inserted > 0) {
    reload()
  }
}

function toggleFollowups() {
  followupsVisible.value = !followupsVisible.value
  refreshFollowups()
}

function refreshFollowups() {
  followupDenied.value = ''
  followups.value = []
  if (!followupsVisible.value) {
    return
  }
  // 受控只读入口：权限外的岗位直接拦下，并写清这条入口归属泄洪操作工。
  if (!store.isFloodOperator) {
    followupDenied.value = `越权拦截：后续检修待办只读入口仅对泄洪操作工开放，当前岗位「${store.post}」无权查看；检修派工请走「机组检修」页`
    return
  }
  followups.value = listFollowupTodos()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(
    meta.key,
    Number(row.id),
    action,
    { operator: store.operator, post: store.post, crew: store.crew },
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
  if (followupsVisible.value) {
    refreshFollowups()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '泄洪操作列表读取失败'
  }
}

onMounted(reload)
</script>
