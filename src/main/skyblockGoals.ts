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
import {
  addSnapshot,
  changesBetween,
  coopMembers,
  craftableNow,
  friendSummary,
  milestones,
  minionHelper,
  mpPlanner,
  networthOf,
  profileList,
  skyblockDate,
  snapshotOf,
  thin,
  upcomingEvents,
  type SbProfileChoice,
  type SbProfilePage,
  type SbSnapshot
} from '@shared/skyblockMore'
import {
  currentMayor,
  currentPrices,
  errorText,
  forgetPlayer,
  lookedUp,
  onPricesChanged,
  playerById,
  playerByName,
  readHistory,
  rememberPlayer,
  starPlayer,
  writeHistory
} from './skyblockPlayers'
import { hypixel, KeyRejected, onSkyblockProfiles, skyblockAccount } from './skyblock'
import { logError } from './log'
import { neuItemIcons, onAddonChanged, saveNeuPictures, skyblockAddonReady, slotIcon } from './skyblockAddonFiles'
import { skinFromValue } from '@shared/skyblockTextures'

/**
 * SkyBlock ironman goal planner. The recipe book comes from the NEU item repo (downloaded once a
 * week as a zip from GitHub and kept offline as one small file), collection tiers from Hypixel's
 * resources (no key needed), and what you own from your profile, using the same Hypixel key and
 * profile as the session summary. Your goals are kept in `skyblock-goals.json`.
 */

const NEU_ZIP = process.env.NOTES_NEU_REPO_URL ?? 'https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO/archive/refs/heads/master.zip'
const HYPIXEL = process.env.NOTES_HYPIXEL_URL ?? 'https://api.hypixel.net'
const MOJANG_SESSION = process.env.NOTES_MOJANG_SESSION_URL ?? 'https://sessionserver.mojang.com'
const DATA_MAX_AGE = 7 * 86_400_000
/** How often the profile is asked for again while you're playing. */
const PLAY_REFRESH = Number(process.env.NOTES_SKYBLOCK_GOALS_REFRESH_MS) || 10 * 60_000
const MAX_GOALS = 40

interface Stored {
  /** Goals for each of your profiles (by profile id; '' before Orbit knows which profile). */
  goalsBy: Record<string, SbGoal[]>
  /** The profile you're looking at in Orbit ('' = the one you're on in game). */
  viewing: string
  /** Your profiles, for the switcher. */
  choices: SbProfileChoice[]
  /** When you last looked at each profile, for "since last time". */
  seen: Record<string, number>
  profile: SbProfileData | null
  /** The profile page's view, and the last garden and museum answers (only the parts it uses). */
  view?: SbProfileView | null
  garden?: unknown
  museum?: unknown
  /** Your name and skin, from Mojang, for the head at the top of the profile. */
  player?: { name: string; skin: string; at: number }
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
    const goalsBy: Record<string, SbGoal[]> = raw.goalsBy && typeof raw.goalsBy === 'object' ? raw.goalsBy : {}
    // Goals from before profiles were kept apart belong to the profile that was showing.
    if (Array.isArray(raw.goals) && raw.goals.length) goalsBy[raw.view?.profileId ?? ''] = [...(goalsBy[raw.view?.profileId ?? ''] ?? []), ...raw.goals]
    stored = {
      goalsBy,
      viewing: typeof raw.viewing === 'string' ? raw.viewing : '',
      choices: Array.isArray(raw.choices) ? raw.choices : [],
      seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {},
      profile: raw.profile ?? null,
      view: raw.view ?? null,
      garden: raw.garden,
      museum: raw.museum,
      player: raw.player
    }
  } catch {
    stored = { goalsBy: {}, viewing: '', choices: [], seen: {}, profile: null }
  }
  return stored!
}

/** The profile whose goals are showing. */
const goalsKey = (): string => load().view?.profileId ?? load().viewing ?? ''

/** The goals for the profile you're looking at. */
function goals(): SbGoal[] {
  const s = load()
  const key = goalsKey()
  if (!s.goalsBy[key]) s.goalsBy[key] = []
  return s.goalsBy[key]
}

const anyGoals = (): boolean => Object.values(load().goalsBy).some((g) => g.length > 0)

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
  const list = orderGoals(goals())
  return {
    installed: skyblockAddonReady(),
    ready: !!acct.key && !!acct.uuid,
    data: d ? { at: d.at, items: Object.keys(d.items).length } : null,
    downloading,
    dataError,
    profile: s.profile ? { at: s.profile.at, profileName: s.profile.profileName, mode: s.profile.mode, hidden: s.profile.hidden } : null,
    profileError,
    refreshing,
    keyWarning: keyWarning(acct.keySavedAt, acct.personalKey, Date.now()),
    plans: d ? planGoals(list, d, s.profile, learnRates(acct.sessions)) : [],
    goals: list,
    choices: s.choices,
    viewing: s.view?.profileId ?? s.viewing
  }
}

// ---------- the recipe book ----------

async function download(): Promise<void> {
  if (downloading) return
  dataError = ''
  try {
    await downloadItemList()
  } catch (err) {
    dataError = err instanceof Error ? err.message : String(err)
    logError('downloading the SkyBlock item list', err)
  }
}

/** Downloads the NEU item list (recipes, accessories, levels) and Hypixel's collection tiers. Throws if it can't. */
export async function downloadItemList(signal?: AbortSignal): Promise<void> {
  if (downloading) throw new Error('The item list is already downloading.')
  downloading = 'Downloading the item list…'
  broadcast()
  try {
    let res: Response
    try {
      res = await net.fetch(NEU_ZIP, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000) })
    } catch {
      if (signal?.aborted) throw new Error('Stopped.')
      throw new Error('Couldn’t reach GitHub to download the item list. Check the internet connection.')
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status} when downloading the item list. Try again in a bit.`)
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    if (signal?.aborted) throw new Error('Stopped.')
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
    const next: SbData = {
      at: Date.now(),
      version: SB_DATA_VERSION,
      items: buildItems(files),
      collections,
      ...buildLevels(constants.leveling),
      extras: buildExtras(constants, files)
    }
    writeJson(dataFile(), next)
    data = next
    itemNames = null
    dataError = ''
    saveNeuPictures(files)
    // A new item list can read more of the profile, so ask again.
    void refreshProfile()
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

/** The last answer from Hypixel about you (kept in memory so switching profile is instant). */
let lastBody: unknown = null
/** Item id → name, for "since last time" and milestones. */
let itemNames: Record<string, string> | null = null
const namesOf = (d: SbData): Record<string, string> => (itemNames ??= Object.fromEntries(Object.values(d.items).map((i) => [i.id, i.name.replace(/§./g, '')])))

/** A profile's view with its networth and co-op members filled in. */
function fullView(body: unknown, uuid: string, profileId: string, at: number, d: SbData, extra: { garden?: unknown; museum?: unknown }): SbProfileView | null {
  const v = profileView(body, uuid, profileId, at, d, decodeNbt, { ...extra, iconOf: slotIcon })
  if (!v) return null
  const p = currentPrices()
  if (p) v.networth = networthOf(v, p.prices, p.at, namesOf(d))
  const coop = coopMembers(body, v.profileId, uuid)
  if (coop.length > 1) {
    v.coop = coop
    for (const m of coop) {
      void playerById(m.uuid).then((who) => {
        if (who.name && !m.name) {
          m.name = who.name
          broadcast()
        }
      })
    }
  }
  return v
}

function takeProfiles(body: unknown): void {
  const acct = skyblockAccount()
  const s = load()
  lastBody = body
  const pick = s.viewing || acct.profileId
  const p = profileData(body, acct.uuid, pick, Date.now(), countItems)
  if (!p) return
  s.profile = p
  s.choices = profileList(body, acct.uuid)
  const d = getData()
  if (d?.extras) {
    try {
      s.view = fullView(body, acct.uuid, pick, p.at, d, { garden: s.garden, museum: s.museum })
      if (s.view && s.player) s.view.player = { name: s.player.name, skin: s.player.skin }
      // Goals added before Orbit knew which profile go to this one.
      if (s.view && s.goalsBy['']?.length) {
        s.goalsBy[s.view.profileId] = [...(s.goalsBy[s.view.profileId] ?? []), ...s.goalsBy['']]
        delete s.goalsBy['']
      }
      saveHistory(body, acct.uuid, d)
    } catch (err) {
      logError('reading your SkyBlock profile', err)
    }
  }
  profileError = ''
  save()
  broadcast()
}

/** A snapshot of every profile you have, for the graphs and "since last time". */
function saveHistory(body: unknown, uuid: string, d: SbData): void {
  const history = readHistory<SbSnapshot>()
  const s = load()
  for (const c of s.choices) {
    const v = c.id === s.view?.profileId ? s.view : fullView(body, uuid, c.id, Date.now(), d, {})
    if (!v) continue
    history[c.id] = addSnapshot(history[c.id] ?? [], snapshotOf(v, Date.now()))
  }
  writeHistory(history)
}

/** The profile page for your own account. */
function ownPage(): SbProfilePage | null {
  const s = load()
  const view = s.view
  if (!view) return null
  const d = getData()
  const history = readHistory<SbSnapshot>()[view.profileId] ?? []
  const names = d ? namesOf(d) : {}
  const seenAt = s.seen[view.profileId] ?? 0
  const before = [...history].reverse().find((h) => h.at <= seenAt)
  const latest = history[history.length - 1]
  const changes = before && latest && latest.at > before.at ? changesBetween(before, latest, names) : []
  return {
    view,
    mine: true,
    player: { uuid: skyblockAccount().uuid, name: s.player?.name ?? '', skin: s.player?.skin ?? '' },
    choices: s.choices,
    history: thin(history),
    since: before && changes.length ? { at: before.at, changes } : null,
    milestones: milestones(history, names),
    starred: false
  }
}

// ---------- anyone else's profile ----------

const others = new Map<string, { at: number; body: unknown; extra: Map<string, { garden?: unknown; museum?: unknown }> }>()
const OTHERS_MAX_AGE = 5 * 60_000

async function otherPage(who: string, profileId: string, fresh: boolean): Promise<SbProfilePage> {
  const acct = skyblockAccount()
  if (!acct.key) throw new Error('Orbit needs your Hypixel API key to look players up. Add it on the Games page → SkyBlock.')
  const d = getData()
  if (!d?.extras) throw new Error('Orbit needs the item list first. Press Update recipes.')
  const { uuid, name } = /^[0-9a-f]{32}$/i.test(who.replace(/-/g, '')) ? { uuid: who.replace(/-/g, '').toLowerCase(), name: '' } : await playerByName(who)
  if (uuid === acct.uuid.replace(/-/g, '').toLowerCase()) {
    if (profileId && profileId !== load().view?.profileId) chooseProfile(profileId)
    const own = ownPage()
    if (own) return own
  }
  let cached = others.get(uuid)
  if (!cached || fresh || Date.now() - cached.at > OTHERS_MAX_AGE) {
    const body = await hypixel(`/v2/skyblock/profiles?uuid=${uuid}`, acct.key)
    cached = { at: Date.now(), body, extra: new Map() }
    others.set(uuid, cached)
  }
  const choices = profileList(cached.body, uuid)
  if (!choices.length) throw new Error(`${name || 'That player'} hasn’t played SkyBlock.`)
  const pid = choices.some((c) => c.id === profileId) ? profileId : (choices.find((c) => c.selected) ?? choices[0]).id
  let extra = cached.extra.get(pid)
  if (!extra) {
    const [garden, museum] = await Promise.allSettled([hypixel(`/v2/skyblock/garden?profile=${pid}`, acct.key), hypixel(`/v2/skyblock/museum?profile=${pid}`, acct.key)])
    extra = { garden: garden.status === 'fulfilled' ? garden.value : undefined, museum: museum.status === 'fulfilled' ? trimMuseum(museum.value, uuid) : undefined }
    cached.extra.set(pid, extra)
  }
  const view = fullView(cached.body, uuid, pid, cached.at, d, extra)
  if (!view) throw new Error(`Couldn’t read ${name || 'that player'}’s profile.`)
  const who2 = await playerById(uuid)
  view.player = { name: who2.name || name, skin: who2.skin }
  const known = lookedUp().find((f) => f.uuid === uuid)
  rememberPlayer({ uuid, name: who2.name || name, skin: who2.skin, at: Date.now(), summary: friendSummary(view) })
  return { view, mine: false, player: { uuid, name: who2.name || name, skin: who2.skin }, choices, history: [], since: null, milestones: [], starred: !!known?.starred }
}

/** Shows another of your profiles (goals, history and helpers follow it). */
function chooseProfile(id: string): void {
  const s = load()
  s.viewing = id
  s.garden = undefined
  s.museum = undefined
  if (lastBody) takeProfiles(lastBody)
  save()
  void refreshProfile()
}

/** Only what the profile page reads from the museum answer (the donated items' own data is large). */
function trimMuseum(body: unknown, uuid: string): unknown {
  const me = (body as { members?: Record<string, { value?: unknown; items?: Record<string, unknown> }> })?.members?.[uuid.replace(/-/g, '').toLowerCase()]
  if (!me) return { members: {} }
  return { members: { [uuid.replace(/-/g, '').toLowerCase()]: { value: me.value, items: Object.fromEntries(Object.keys(me.items ?? {}).map((k) => [k, 1])) } } }
}

/** Your skin from Mojang, once a day (it's only for the picture at the top). */
async function refreshPlayer(uuid: string): Promise<void> {
  const s = load()
  if (s.player && Date.now() - s.player.at < 86_400_000) return
  try {
    const res = await net.fetch(`${MOJANG_SESSION}/session/minecraft/profile/${uuid.replace(/-/g, '')}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return
    const body = (await res.json()) as { name?: string; properties?: { name?: string; value?: string }[] }
    const value = body.properties?.find((p) => p.name === 'textures')?.value ?? ''
    s.player = { name: body.name ?? '', skin: value ? skinFromValue(value) : '', at: Date.now() }
  } catch {
    // The head falls back to Steve.
  }
}

async function refreshProfile(): Promise<void> {
  const acct = skyblockAccount()
  if (!acct.key || !acct.uuid || refreshing || !skyblockAddonReady()) return
  refreshing = true
  broadcast()
  try {
    await refreshPlayer(acct.uuid)
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
    if (skyblockAddonReady() && (anyGoals() || load().view)) takeProfiles(body)
  })

  // Installed, removed or new packs: read the item list again and redraw the pictures.
  onAddonChanged(() => {
    data = undefined
    itemNames = null
    if (skyblockAddonReady() && load().profile) void refreshProfile()
    broadcast()
  })

  // While you play, ask again now and then so the progress bars move.
  setInterval(
    () => {
      const acct = skyblockAccount()
      const p = load().profile
      if (acct.playing && skyblockAddonReady() && (anyGoals() || load().view) && (!p || Date.now() - p.at > PLAY_REFRESH - 5000)) void refreshProfile()
    },
    Math.min(PLAY_REFRESH, 60_000)
  )

  /** `page`: the Goals page is open, so fetch the item list if there isn't one (the Home box doesn't). */
  ipcMain.handle('skyblockGoals:state', (_e, page?: boolean) => {
    const d = getData()
    if (skyblockAddonReady() && (page || anyGoals()) && (!d || d.version !== SB_DATA_VERSION || Date.now() - d.at > DATA_MAX_AGE) && !downloading && !dataError) void download()
    return state()
  })
  // New prices: work networth out again.
  onPricesChanged(() => {
    if (lastBody) takeProfiles(lastBody)
  })

  /** The profile page: everything about your profile (null until Orbit has asked Hypixel with the new item list). */
  let staleAsked = false
  ipcMain.handle('skyblockProfile:view', () => {
    const view = load().view ?? null
    // Saved by an Orbit from before loadouts and profiles: read the profile again so it all fills in.
    if (view?.gear && (!Array.isArray(view.gear.loadouts) || !load().choices.length || !lastBody) && !staleAsked) {
      staleAsked = true
      void refreshProfile()
    }
    return view
  })
  /** Your profile page: the view plus your profiles, history, "since last time" and milestones. */
  ipcMain.handle('skyblockProfile:page', () => ownPage())
  ipcMain.handle('skyblockProfile:choose', (_e, id: string) => {
    if (typeof id === 'string') chooseProfile(id)
    return state()
  })
  /** You've seen this profile's page: "since last time" starts again from now. */
  ipcMain.handle('skyblockProfile:seen', (_e, id: string) => {
    const s = load()
    if (typeof id === 'string' && id) {
      s.seen[id] = Date.now()
      save()
    }
  })
  /** Anyone's profile, by Minecraft name (or id), and which of their profiles. */
  ipcMain.handle('skyblockPlayers:lookup', async (_e, who: string, profileId?: string, fresh?: boolean) => {
    try {
      return await otherPage(String(who ?? ''), typeof profileId === 'string' ? profileId : '', !!fresh)
    } catch (err) {
      if (!(err instanceof KeyRejected)) logError('looking up a SkyBlock player', err)
      throw new Error(errorText(err))
    }
  })
  ipcMain.handle('skyblockPlayers:list', () => lookedUp())
  ipcMain.handle('skyblockPlayers:star', (_e, uuid: string, on: boolean) => {
    starPlayer(String(uuid), !!on)
    return lookedUp()
  })
  ipcMain.handle('skyblockPlayers:forget', (_e, uuid: string) => {
    forgetPlayer(String(uuid))
    return lookedUp()
  })
  /** Looks every starred player up again, a second apart, for the friends board. */
  ipcMain.handle('skyblockPlayers:refreshStarred', async () => {
    for (const f of lookedUp().filter((x) => x.starred)) {
      try {
        await otherPage(f.uuid, '', true)
      } catch {
        // Keep their last numbers.
      }
      await new Promise((r) => setTimeout(r, 800))
    }
    return lookedUp()
  })
  /** Ironman helpers for the profile you're looking at: craftable now, Magical Power planner, minions. */
  ipcMain.handle('skyblockHelpers:get', () => {
    const s = load()
    const d = getData()
    if (!d || !s.view || !s.profile) return null
    const rates = learnRates(skyblockAccount().sessions)
    return {
      craftable: craftableNow(d, s.profile.owned),
      mp: mpPlanner(s.view, d, s.profile, rates),
      minions: minionHelper(s.view, d, s.profile.owned)
    }
  })
  /** The SkyBlock date, what's on next, and the mayor. */
  ipcMain.handle('skyblock:calendar', async () => ({ now: skyblockDate(Date.now()), events: upcomingEvents(Date.now(), 10), mayor: await currentMayor() }))
  /** NEU item id → picture, for everything that isn't one of your own items. */
  ipcMain.handle('skyblockAddon:icons', () => neuItemIcons())
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
    const list = goals()
    const existing = list.find((g) => g.id === id)
    if (existing) existing.amount = clampAmount(existing.amount + clampAmount(amount))
    else {
      if (list.length >= MAX_GOALS) throw new Error(`That’s ${MAX_GOALS} goals already. Remove one first.`)
      list.push({ id, amount: clampAmount(amount), pinned: list.filter((g) => g.pinned).length < 3, added: Date.now() })
    }
    save()
    if (!s.profile || Date.now() - s.profile.at > 5 * 60_000) void refreshProfile()
    return state()
  })
  ipcMain.handle('skyblockGoals:update', (_e, id: string, change: { amount?: number; pinned?: boolean }) => {
    const g = goals().find((x) => x.id === id)
    if (g) {
      if (typeof change?.amount === 'number') g.amount = clampAmount(change.amount)
      if (typeof change?.pinned === 'boolean') g.pinned = change.pinned
      save()
    }
    return state()
  })
  ipcMain.handle('skyblockGoals:remove', (_e, id: string) => {
    const s = load()
    s.goalsBy[goalsKey()] = goals().filter((g) => g.id !== id)
    save()
    return state()
  })
}

const clampAmount = (n: unknown): number => Math.max(1, Math.min(1_000_000, Math.floor(Number(n) || 1)))
