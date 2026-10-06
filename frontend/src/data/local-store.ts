import { migrateRows, STORAGE_VERSION } from './migrate'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'
// 数据版本单独存一项：老数据打开时按版本补迁移，迁移口径见 data/migrate.ts。
const META_KEY = 'hydropower-plant-om:meta'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readVersion(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return STORAGE_VERSION
  }
  try {
    const raw = window.localStorage.getItem(META_KEY)
    const parsed = raw ? (JSON.parse(raw) as { version?: number }) : {}
    return Number(parsed.version) || 1
  } catch {
    return 1
  }
}

function writeVersion(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(META_KEY, JSON.stringify({ version: STORAGE_VERSION }))
  }
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  let merged = fallback
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      persist(fallback)
    } else {
      try {
        const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
        merged = { ...fallback, ...parsed }
      } catch {
        merged = fallback
      }
    }
  }
  // 迁移是幂等的：已是最新结构的数据跑一遍不会变，重复导入也不会多出行。
  const { rows, changed } = migrateRows(merged)
  if (changed || readVersion() < STORAGE_VERSION) {
    persist(rows)
    writeVersion()
  }
  return rows
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 全部回到示例数据：清缓存让下次读取重新播种（也会重新跑一遍幂等迁移）。
export function resetAllRows(): void {
  cache = null
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(META_KEY)
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}
