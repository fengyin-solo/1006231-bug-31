<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水电站机组运行检修管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向电站台账、机组运行、调速励磁、主变与闸门、大坝渗流位移监测、机组检修与发电计划的一体化水电站运行检修管理平台。</span>
        <span class="head-user">
          当前值班：{{ store.operator }} · {{ store.shiftLabel }}
          <label class="head-select">
            班组
            <select v-model="store.team">
              <option v-for="team in teams" :key="team" :value="team">{{ team }}</option>
            </select>
          </label>
          <label class="head-select">
            岗位
            <select v-model="store.position">
              <option v-for="position in positions" :key="position" :value="position">
                {{ position }}
              </option>
            </select>
          </label>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

// 班组/岗位在这里切换，用来演示泄洪的责任班组拦截与只读入口的岗位限制。
const teams = ['运行一班', '运行二班', '检修班组']
const positions = ['泄洪值守岗', '闸门操作岗', '巡检岗']

const navItems = [{ label: "运营概览", path: "/" }, { label: "电站台账", path: "/station" }, { label: "机组运行", path: "/unit" }, { label: "调速器", path: "/governor" }, { label: "励磁系统", path: "/excitation" }, { label: "主变压器", path: "/transformer" }, { label: "闸门启闭", path: "/gate" }, { label: "渗流监测", path: "/seepage" }, { label: "位移监测", path: "/displacement" }, { label: "拦污栅", path: "/trashrack" }, { label: "机组检修", path: "/overhaul" }, { label: "检修待办", path: "/todo" }, { label: "导轴承", path: "/bearing" }, { label: "技术供水", path: "/cooling" }, { label: "水情调度", path: "/hydrology" }, { label: "泄洪操作", path: "/flood" }, { label: "发电计划", path: "/generation" }, { label: "继电保护", path: "/protection" }, { label: "缺陷处置", path: "/defect" }, { label: "检修人员", path: "/crew" }, { label: "备品备件", path: "/spare" }]
</script>
