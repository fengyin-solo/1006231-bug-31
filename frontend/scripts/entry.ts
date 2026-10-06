// localStorage 内存桩，在业务模块导入前装好。
const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => Array.from(mem.keys())[i] ?? null,
  get length() {
    return mem.size
  },
}
await import('./verify.ts')
