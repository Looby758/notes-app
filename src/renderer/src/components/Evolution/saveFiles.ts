import type { SurvivalWorld } from '@shared/survival'
import { allGroups, globeFromWorld, upgradeGlobe, type Globe } from '@shared/globe'

/**
 * Save files for survival mode, kept inside Orbit (IndexedDB), so there's no size limit worth
 * worrying about. Each save has a small summary for the list and the whole world kept separately,
 * so listing saves doesn't load every world.
 */

const DB = 'orbit-survival'
const META = 'meta'
const WORLDS = 'worlds'
export const AUTOSAVE = 'Autosave'
/** 1: one area (stage one). 2: the whole globe. */
const FORMAT = 2

export interface SaveMeta {
  name: string
  savedAt: number
  tick: number
  groups: { name: string; color: string; people: number }[]
  walkers: number
  /** How many areas are open on the globe (missing for stage-one saves). */
  places?: number
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

export async function writeSave(name: string, world: Globe, auto = false): Promise<SaveMeta> {
  const meta: SaveMeta = {
    name,
    savedAt: Date.now(),
    tick: world.tick,
    groups: allGroups(world).map((x) => ({ name: x.group.name, color: x.group.color, people: x.people })),
    walkers: world.areas.reduce((n, a) => n + a.world.walkers.length, 0),
    places: world.areas.length,
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

export async function readSave(name: string): Promise<Globe | null> {
  const db = await open()
  const tx = db.transaction(WORLDS, 'readonly')
  const req = tx.objectStore(WORLDS).get(name)
  await done(tx)
  db.close()
  const v = req.result as { format: number; world: SurvivalWorld | Globe } | undefined
  if (!v?.world) return null
  // A stage-one save: one area, which becomes the Atlanta area of a new globe.
  if (v.format === 1 && 'map' in v.world) return globeFromWorld(v.world, { seed: v.world.map.seed, harshness: v.world.harshness })
  if (v.format !== FORMAT || !('areas' in v.world)) return null
  return upgradeGlobe(v.world)
}

export async function deleteSave(name: string): Promise<void> {
  const db = await open()
  const tx = db.transaction([META, WORLDS], 'readwrite')
  tx.objectStore(META).delete(name)
  tx.objectStore(WORLDS).delete(name)
  await done(tx)
  db.close()
}
