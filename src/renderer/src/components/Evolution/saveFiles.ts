import { membersOf, upgradeSurvival, type SurvivalWorld } from '@shared/survival'

/**
 * Save files for survival mode, kept inside Orbit (IndexedDB), so there's no size limit worth
 * worrying about. Each save has a small summary for the list and the whole world kept separately,
 * so listing saves doesn't load every world.
 */

const DB = 'orbit-survival'
const META = 'meta'
const WORLDS = 'worlds'
export const AUTOSAVE = 'Autosave'
const FORMAT = 1

export interface SaveMeta {
  name: string
  savedAt: number
  tick: number
  groups: { name: string; color: string; people: number }[]
  walkers: number
  auto: boolean
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'name' })
      if (!db.objectStoreNames.contains(WORLDS)) db.createObjectStore(WORLDS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function listSaves(): Promise<SaveMeta[]> {
  const db = await open()
  const tx = db.transaction(META, 'readonly')
  const req = tx.objectStore(META).getAll()
  await done(tx)
  db.close()
  return (req.result as SaveMeta[]).sort((a, b) => b.savedAt - a.savedAt)
}

export async function writeSave(name: string, world: SurvivalWorld, auto = false): Promise<SaveMeta> {
  const meta: SaveMeta = {
    name,
    savedAt: Date.now(),
    tick: world.tick,
    groups: world.groups.filter((g) => g.alive).map((g) => ({ name: g.name, color: g.color, people: membersOf(world, g).length })),
    walkers: world.walkers.length,
    auto
  }
  const db = await open()
  const tx = db.transaction([META, WORLDS], 'readwrite')
  tx.objectStore(META).put(meta)
  tx.objectStore(WORLDS).put({ format: FORMAT, world }, name)
  await done(tx)
  db.close()
  return meta
}

export async function readSave(name: string): Promise<SurvivalWorld | null> {
  const db = await open()
  const tx = db.transaction(WORLDS, 'readonly')
  const req = tx.objectStore(WORLDS).get(name)
  await done(tx)
  db.close()
  const v = req.result as { format: number; world: SurvivalWorld } | undefined
  if (!v || v.format !== FORMAT || !v.world?.map) return null
  return upgradeSurvival(v.world)
}

export async function deleteSave(name: string): Promise<void> {
  const db = await open()
  const tx = db.transaction([META, WORLDS], 'readwrite')
  tx.objectStore(META).delete(name)
  tx.objectStore(WORLDS).delete(name)
  await done(tx)
  db.close()
}
