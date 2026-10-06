<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <section class="panel">
      <h3 class="panel-title">提醒事项（{{ reminders.total }}）</h3>
      <p class="panel-hint">与检修待办清单读同一份数据，待办销项后提醒同步消失。</p>
      <ul v-if="reminders.items.length" class="reminder-list">
        <li v-for="item in reminders.items" :key="String(item.id)">
          【{{ item['待办编号'] }}】{{ item['待办内容'] }} —— {{ item['责任班组'] }} ·
          {{ item['登记日期'] }}
        </li>
      </ul>
      <p v-else class="panel-hint">当前没有待跟进的检修待办。</p>
    </section>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { listReminders, loadOverview } from '@/api/local-service'
import type { EntryRow, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const reminders = ref<{ total: number; items: EntryRow[] }>({ total: 0, items: [] })

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  reminders.value = listReminders()
}

onMounted(refresh)
</script>
