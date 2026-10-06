import { SEED_ROWS } from './seed'
import { CURRENT_SCHEMA_VERSION, runMigrations, type Database } from './migrations'
import type { EntryRow, FollowupTodo } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 新播种数据从老版本起步，统一走迁移跑到最新版：这样迁移逻辑在首次打开时也会真跑一遍。
function seedDatabase(): Database {
  return runMigrations({
    version: 0,
    entries: clone(SEED_ROWS),
    followups: [],
  })
}

function normalize(raw: unknown): Database {
  // 兼容更早的扁平结构：直接是 { 模块key: 行[] } 时当作 v0 老数据迁上来。
  if (raw && typeof raw === 'object' && !('entries' in raw)) {
    return runMigrations({
      version: 0,
      entries: clone(raw as Record<string, EntryRow[]>),
      followups: [],
    })
  }
  const db = raw as Database
  const seeded = seedDatabase()
  const merged: Database = {
    version: typeof db.version === 'number' ? db.version : 0,
    // 新模块在老数据里没有时，用播种数据补齐，不会把模块读空。
    entries: { ...seeded.entries, ...(db.entries ?? {}) },
    followups: Array.isArray(db.followups) ? db.followups : [],
  }
  return runMigrations(merged)
}

function readStorage(): Database {
  const fallback = seedDatabase()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const db = normalize(JSON.parse(raw))
    persist(db)
    return db
  } catch {
    persist(fallback)
    return fallback
  }
}

function persist(db: Database): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  }
}

let cache: Database | null = null

function database(): Database {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return database().entries
}

export function listRows(key: string): EntryRow[] {
  return database().entries[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const db = database()
  db.entries = { ...db.entries, [key]: rows }
  persist(db)
}

export function resetRows(key: string): EntryRow[] {
  const fresh = seedDatabase()
  const rows = clone(fresh.entries[key] ?? [])
  const db = database()
  db.entries[key] = rows
  // 泄洪、闸门台账、后续检修待办是同一份数据：重置其中一个就整体回到播种态，
  // 避免待办指向已不存在的记录；重置其它模块时待办原样保留。
  if (key === 'flood' || key === 'gate') {
    db.entries['flood'] = clone(fresh.entries['flood'] ?? [])
    db.entries['gate'] = clone(fresh.entries['gate'] ?? [])
    db.followups = clone(fresh.followups)
  }
  persist(db)
  return rows
}

export function listFollowups(): FollowupTodo[] {
  return database().followups
}

export function saveFollowups(followups: FollowupTodo[]): void {
  const db = database()
  db.followups = followups
  persist(db)
}

export function schemaVersion(): number {
  return CURRENT_SCHEMA_VERSION
}

export function storageKey(): string {
  return STORAGE_KEY
}
