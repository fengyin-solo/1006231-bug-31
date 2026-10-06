import { defineStore } from 'pinia'

// 岗位归属：泄洪的开启与结束只允许「泄洪责任班组」的岗位执行，其它岗位越权提交一律挡回。
export type RoleIdentity = {
  operator: string
  post: string
  crew: string
  scope: string
}

// 演示用的可切换身份：白班/夜班两个泄洪责任班组，外加一个越权的检修岗位。
export const ROLE_IDENTITIES: RoleIdentity[] = [
  { operator: '王泄洪', post: '泄洪操作工', crew: '泄洪一班', scope: '泄洪设施启闭' },
  { operator: '李守闸', post: '泄洪操作工', crew: '泄洪二班', scope: '泄洪设施启闭' },
  { operator: '赵检修', post: '机械检修工', crew: '检修班', scope: '机组与闸门检修' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: ROLE_IDENTITIES[0].operator,
    post: ROLE_IDENTITIES[0].post,
    crew: ROLE_IDENTITIES[0].crew,
    scope: ROLE_IDENTITIES[0].scope,
    shiftLabel: '白班 08:00-20:00',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 只有泄洪操作工岗位才能动泄洪闸，检修班等其它岗位属于权限外。
    isFloodOperator: (state) => state.post === '泄洪操作工',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    useIdentity(identity: RoleIdentity) {
      this.operator = identity.operator
      this.post = identity.post
      this.crew = identity.crew
      this.scope = identity.scope
    },
  },
})
