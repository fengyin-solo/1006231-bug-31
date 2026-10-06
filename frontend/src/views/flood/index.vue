<template>
  <section class="page" data-module="flood">
    <header class="page-head">
      <div>
        <h2>泄洪操作管理</h2>
        <p class="page-desc">维护泄洪操作，围绕操作编号、泄洪闸号、开启孔数、泄洪流量做登记、筛选与状态流转。</p>
        <p class="panel-hint">
          当前班组「{{ store.team }}」· 岗位「{{ store.position }}」；开启/结束泄洪仅责任班组可操作，
          结束时开启孔数与泄洪流量会一次性写回闸门台账。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记泄洪操作</button>
        <button class="btn" type="button" @click="exportRows">另存泄洪记录</button>
        <label class="btn">
          导入泄洪记录
          <input type="file" accept=".csv" hidden @change="importRows" />
        </label>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无泄洪操作数据，可先登记泄洪操作</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3 class="panel-title">泄洪记录档案（只读入口）</h3>
      <p v-if="!archive.ok" class="error-text">{{ archive.message }}</p>
      <template v-else>
        <p class="panel-hint">与列表、闸门台账读同一份数据，只读不可改。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>台账写回</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in archive.items" :key="String(row.id)">
              <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
              <td>{{ row.status }}</td>
              <td>{{ row['台账写回'] ?? '未写回' }}</td>
            </tr>
            <tr v-if="!archive.items.length">
              <td :colspan="columns.length + 2" class="empty-state">暂无档案记录</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条泄洪操作记录</span>
      <span v-if="noticeMessage" class="panel-hint">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  importEntries,
  listEntries,
  listFloodArchive,
  moduleMeta,
  runAction as applyAction,
  type OperatorContext,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('flood')
const columns = ["操作编号", "泄洪闸号", "开启孔数", "泄洪流量", "下游预警", "操作时间", "操作人员", "责任班组", "操作状态"]
const actions = ["提交审批", "开启泄洪", "结束泄洪"]
const statuses = ["待审批", "已批准", "泄洪中", "已结束"]
const stats = [{"label": "待审批操作", "value": 0}, {"label": "泄洪中闸门", "value": 0}, {"label": "今日泄洪量", "value": 0}]

const store = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const archive = ref<{ ok: boolean; message: string; items: EntryRow[] }>({
  ok: false,
  message: '',
  items: [],
})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 服务层只认这个上下文：班组决定能否开启/结束，岗位决定能否用只读入口。
function operator(): OperatorContext {
  return { operator: store.operator, team: store.team, position: store.position }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const result = downloadEntries(meta.key, operator())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
}

function importRows(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const result = importEntries(meta.key, String(reader.result ?? ''), operator())
    if (!result.ok) {
      errorMessage.value = result.message
    } else {
      noticeMessage.value = result.message
    }
    input.value = ''
    reload()
  }
  reader.readAsText(file)
}

function openCreate() {
  errorMessage.value = '泄洪操作登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, operator())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    archive.value = listFloodArchive(operator())
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '泄洪操作列表读取失败'
  }
}

onMounted(reload)

// 顶栏切换班组/岗位时重新核对权限与只读入口。
watch(
  () => [store.team, store.position],
  () => reload(),
)

</script>
