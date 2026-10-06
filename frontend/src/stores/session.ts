import { defineStore } from 'pinia'

// 会话里的当前操作人：泄洪等受控动作的权限都以这里的班组/岗位为准。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水电站机组运行检修管理平台',
    team: '运行一班',
    position: '泄洪值守岗',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTeam(team: string) {
      this.team = team
    },
    setPosition(position: string) {
      this.position = position
    },
  },
})
