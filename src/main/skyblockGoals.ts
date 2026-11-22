import { app, BrowserWindow, ipcMain, net } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { gunzipSync } from 'zlib'
import { join } from 'path'
import JSZip from 'jszip'
import {
  buildCollections,
  buildItems,
  buildLevels,
  countNbtItems,
  keyWarning,
  learnRates,
  orderGoals,
  planGoals,
  profileData,
  readNbt,
  searchItems,
  SB_DATA_VERSION,
  type SbData,
  type SbGoal,
  type SbProfileData
} from '@shared/skyblockGoals'
import type { SkyblockGoalsState, SkyblockItemHit } from '@shared/skyblockGoals'
import { buildExtras, profileView, type SbProfileView } from '@shared/skyblockProfile'
import { hypixel, KeyRejected, onSkyblockProfiles, skyblockAccount } from './skyblock'
import { logError } from './log'

/**
 * SkyBlock ironman goal planner. The recipe book comes from the NEU item repo (downloaded once a
 * week as a zip from GitHub and kept offline as one small file), collection tiers from Hypixel's
 * resources (no key needed), and what you own from your profile, using the same Hypixel key and
 * profile as the session summary. Your goals are kept in `skyblock-goals.json`.
 */

const NEU_ZIP = process.env.NOTES_NEU_REPO_URL ?? 'https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO/archive/refs/heads/master.zip'
const HYPIXEL = process.env.NOTES_HYPIXEL_URL ?? 'https://api.hypixel.net'
const DATA_MAX_AGE = 7 * 86_400_000
/** How often the profile is asked for again while you're playing. */
const PLAY_REFRESH = Number(process.env.NOTES_SKYBLOCK_GOALS_REFRESH_MS) || 10 * 60_000
const MAX_GOALS = 40

interface Stored {
  goals: SbGoal[]
  profile: SbProfileData | null
  /** The profile page's view, and the last garden and museum answers (only the parts it uses). */
  view?: SbProfileView | null
  garden?: unknown
  museum?: unknown
}

let stored: Stored | null = null
let data: SbData | null | undefined
let downloading: string | null = null
let dataError = ''
let profileError = ''
let refreshing = false

const goalsFile = (): string => join(app.getPath('userData'), 'skyblock-goals.json')
const dataFile = (): string => join(app.getPath('userData'), 'skyblock-items.json')

function load(): Stored {
  if (stored) return stored
  try {
    const raw = JSON.parse(readFileSync(goalsFile(), 'utf8'))
    stored = { goals: Array.isArray(raw.goals) ? raw.goals : [], profile: raw.profile ?? null, view: raw.view ?? null, garden: raw.garden, museum: raw.museum }
  } catch {
    stored = { goals: [], profile: null }
  }
  return stored!
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(value), 'utf8')
  renameSync(`${file}.tmp`, file)
}

function save(): void {
  try {
    writeJson(goalsFile(), load())
  } catch (err) {
    logError('saving SkyBlock goals', err)
  }
}

function getData(): SbData | null {
  if (data !== undefined) return data
  try {
    data = JSON.parse(readFileSync(dataFile(), 'utf8')) as SbData
  } catch {
    data = null
  }
  return data
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('skyblockGoals:changed')
}

function state(): SkyblockGoalsState {
  const s = load()
  const d = getData()
  const acct = skyblockAccount()
  const goals = orderGoals(s.goals)
  return {
    ready: !!acct.key && !!acct.uuid,
    data: d ? { at: d.at, items: Object.keys(d.items).length } : null,
    downloading,
    dataError,
    profile: s.profile ? { at: s.profile.at, profileName: s.profile.profileName, mode: s.profile.mode, hidden: s.profile.hidden } : null,
    profileError,
    refreshing,
    keyWarning: keyWarning(acct.keySavedAt, acct.personalKey, Date.now()),
    plans: d ? planGoals(goals, d, s.profile, learnRates(acct.sessions)) : [],
    goals
  }
}

// ---------- the recipe book ----------

async function download(): Promise<void> {
  if (downloading) return
  downloading = 'Downloading the item list…'
  dataError = ''
  broadcast()
  try {
    let res: Response
    try {
      res = await net.fetch(NEU_ZIP, { signal: AbortSignal.timeout(180_000) })
    } catch {
      throw new Error('Couldn’t reach GitHub to download the item list. Check the internet connection.')
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status} when downloading the item list. Try again in a bit.`)
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    downloading = 'Reading recipes…'
    broadcast()
    const files: unknown[] = []
    const constants: Record<string, unknown> = {}
    const jobs: Promise<void>[] = []
    zip.forEach((path, entry) => {
      if (entry.dir) return
      if (/(^|\/)items\/[^/]+\.json$/.test(path)) {
        jobs.push(
          entry.async('string').then((t) => {
            try {
              files.push(JSON.parse(t))
            } catch {
              // A broken file in the repo shouldn't stop the rest.
            }
          })
        )
      } else {
        const m = /(^|\/)constants\/(leveling|pets|misc|bestiary|garden|fairy_souls|trophyfish)\.json$/.exec(path)
        if (m)
          jobs.push(
            entry.async('string').then((t) => {
              try {
                constants[m[2]] = JSON.parse(t)
              } catch {
                // Leave that part out.
              }
            })
          )
      }
    })
    await Promise.all(jobs)
    if (files.length < 100) throw new Error('The item list from GitHub looked empty. Try again later.')
    let collections = getData()?.collections ?? {}
    try {
      const r = await net.fetch(`${HYPIXEL}/v2/resources/skyblock/collections`, { signal: AbortSignal.timeout(20_000) })
      if (r.ok) collections = buildCollections(await r.json())
    } catch {
      // Keep the old tiers; recipes still work without them.
    }
    const next: SbData = { at: Date.now(), version: SB_DATA_VERSION, items: buildItems(files), collections, ...buildLevels(constants.leveling), extras: buildExtras(constants, files) }
    writeJson(dataFile(), next)
    data = next
    // A new item list can read more of the profile, so ask again.
    void refreshProfile()
  } catch (err) {
    dataError = err instanceof Error ? err.message : String(err)
    logError('downloading the SkyBlock item list', err)
  } finally {
    downloading = null
    broadcast()
  }
}

// ---------- your profile ----------

function countItems(b64: string): Record<string, number> {
  return countNbtItems(readNbt(gunzipSync(Buffer.from(b64, 'base64'))))
}

const decodeNbt = (b64: string): unknown => readNbt(gunzipSync(Buffer.from(b64, 'base64')))

function takeProfiles(body: unknown): void {
  const acct = skyblockAccount()
  const s = load()
  const p = profileData(body, acct.uuid, acct.profileId, Date.now(), countItems)
  if (!p) return
  s.profile = p
  const d = getData()
  if (d?.extras) {
    try {
      s.view = profileView(body, acct.uuid, acct.profileId, p.at, d, decodeNbt, { garden: s.garden, museum: s.museum })
    } catch (err) {
      logError('reading your SkyBlock profile', err)
    }
  }
  profileError = ''
  save()
  broadcast()
}

/** Only what the profile page reads from the museum answer (the donated items' own data is large). */
function trimMuseum(body: unknown, uuid: string): unknown {
  const me = (body as { members?: Record<string, { value?: unknown; items?: Record<string, unknown> }> })?.members?.[uuid.replace(/-/g, '').toLowerCase()]
  if (!me) return { members: {} }
  return { members: { [uuid.replace(/-/g, '').toLowerCase()]: { value: me.value, items: Object.fromEntries(Object.keys(me.items ?? {}).map((k) => [k, 1])) } } }
}

async function refreshProfile(): Promise<void> {
  const acct = skyblockAccount()
  if (!acct.key || !acct.uuid || refreshing) return
  refreshing = true
  broadcast()
  try {
    const body = await hypixel(`/v2/skyblock/profiles?uuid=${acct.uuid}`, acct.key)
    takeProfiles(body)
    const s = load()
    if (!s.profile) profileError = 'Hypixel has no SkyBlock profile for you yet.'
    // The garden and museum are asked for separately; a failure there doesn't stop the rest.
    const pid = s.view?.profileId
    if (pid) {
      const [garden, museum] = await Promise.allSettled([hypixel(`/v2/skyblock/garden?profile=${pid}`, acct.key), hypixel(`/v2/skyblock/museum?profile=${pid}`, acct.key)])
      if (garden.status === 'fulfilled') s.garden = garden.value
      if (museum.status === 'fulfilled') s.museum = trimMuseum(museum.value, acct.uuid)
      if (garden.status === 'fulfilled' || museum.status === 'fulfilled') takeProfiles(body)
    }
  } catch (err) {
    profileError = err instanceof Error ? err.message : String(err)
    if (!(err instanceof KeyRejected)) logError('asking Hypixel for your SkyBlock items', err)
  } finally {
    refreshing = false
    broadcast()
  }
}

// ---------- setup ----------

export function setupSkyblockGoals(): void {
  // Every time the session summary asks Hypixel, the planner gets the same answer for free.
  onSkyblockProfiles((body) => {
    if (load().goals.length || load().view) takeProfiles(body)
  })

  // While you play, ask again now and then so the progress bars move.
  setInterval(() => {
    const acct = skyblockAccount()
    const p = load().profile
    if (acct.playing && (load().goals.length || load().view) && (!p || Date.now() - p.at > PLAY_REFRESH - 5000)) void refreshProfile()
  }, Math.min(PLAY_REFRESH, 60_000))

  /** `page`: the Goals page is open, so fetch the item list if there isn't one (the Home box doesn't). */
  ipcMain.handle('skyblockGoals:state', (_e, page?: boolean) => {
    const d = getData()
    if ((page || load().goals.length) && (!d || d.version !== SB_DATA_VERSION || Date.now() - d.at > DATA_MAX_AGE) && !downloading && !dataError) void download()
    return state()
  })
  /** The profile page: everything about your profile (null until Orbit has asked Hypixel with the new item list). */
  ipcMain.handle('skyblockProfile:view', () => load().view ?? null)
  ipcMain.handle('skyblockGoals:download', async () => {
    await download()
    return state()
  })
  ipcMain.handle('skyblockGoals:refresh', async () => {
    await refreshProfile()
    return state()
  })
  ipcMain.handle('skyblockGoals:search', (_e, query: string): SkyblockItemHit[] => {
    const d = getData()
    if (!d) return []
    return searchItems(d.items, String(query ?? '').slice(0, 80)).map((i) => ({ id: i.id, name: i.name, color: i.color, crafted: !!(i.craft || i.forge) }))
  })
  ipcMain.handle('skyblockGoals:add', async (_e, id: string, amount = 1) => {
    const s = load()
    const d = getData()
    if (typeof id !== 'string' || (d && !d.items[id])) throw new Error('Orbit doesn’t know that item.')
    const existing = s.goals.find((g) => g.id === id)
    if (existing) existing.amount = clampAmount(existing.amount + clampAmount(amount))
    else {
      if (s.goals.length >= MAX_GOALS) throw new Error(`That’s ${MAX_GOALS} goals already. Remove one first.`)
      s.goals.push({ id, amount: clampAmount(amount), pinned: s.goals.filter((g) => g.pinned).length < 3, added: Date.now() })
    }
    save()
    if (!s.profile || Date.now() - s.profile.at > 5 * 60_000) void refreshProfile()
    return state()
  })
  ipcMain.handle('skyblockGoals:update', (_e, id: string, change: { amount?: number; pinned?: boolean }) => {
    const g = load().goals.find((x) => x.id === id)
    if (g) {
      if (typeof change?.amount === 'number') g.amount = clampAmount(change.amount)
      if (typeof change?.pinned === 'boolean') g.pinned = change.pinned
      save()
    }
    return state()
  })
  ipcMain.handle('skyblockGoals:remove', (_e, id: string) => {
    const s = load()
    s.goals = s.goals.filter((g) => g.id !== id)
    save()
    return state()
  })
}

const clampAmount = (n: unknown): number => Math.max(1, Math.min(1_000_000, Math.floor(Number(n) || 1)))
