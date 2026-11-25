import { djPicks, libraryOverview, songsFor } from '@shared/claudeHelpers'
import type { LocalSong } from '@shared/localMusic'
import { addToQueue, loadLocalLibrary, playLocal, useLocalMusic } from '../../store/localMusic'
import { useMusic } from '../../store/music'
import { startMusicData, useMusicData } from '../../store/musicData'
import { num, pickOne, str, strs, type Answer, type Args } from './common'

/**
 * Music by mood, the DJ that fills Up next, and music routines ("gym": a playlist shuffled and
 * loud; "bedtime": calm songs with a sleep timer), which can start on their own at a time of day.
 */

async function songs(): Promise<LocalSong[]> {
  if (!useLocalMusic.getState().library) await loadLocalLibrary()
  const list = useLocalMusic.getState().library?.songs ?? []
  if (!list.length) throw new Error('Orbit has no music folder set (or it’s empty). Choose one on the Music page first.')
  return list
}

async function data(): Promise<ReturnType<typeof useMusicData.getState>['data']> {
  startMusicData()
  for (let i = 0; i < 40 && !useMusicData.getState().loaded; i++) await new Promise((r) => setTimeout(r, 50))
  return useMusicData.getState().data
}

const minutesOf = (list: LocalSong[]): number => Math.round(list.reduce((t, s) => t + (s.durationMs || 210_000), 0) / 60_000)

// ---------- routines ----------

export interface MusicRoutine {
  name: string
  playlist?: string
  search?: string
  shuffle?: boolean
  loop?: 'off' | 'song' | 'all'
  volume?: number
  /** Minutes until the music stops. */
  sleep?: number
  /** Starts by itself at this time ("07:30"), on these days (0 = Sunday; all days if empty). */
  at?: string
  days?: number[]
  /** Day key it last started by itself, so it starts once a day. */
  ran?: string
}

const KEY = 'orbit.musicRoutines'

function loadRoutines(): MusicRoutine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((r): r is MusicRoutine => !!r && typeof r.name === 'string') : []
  } catch {
    return []
  }
}
function saveRoutines(list: MusicRoutine[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    throw new Error('Orbit couldn’t save the routine.')
  }
}

const routineText = (r: MusicRoutine): string =>
  `${r.name}: ${r.playlist ? `playlist “${r.playlist}”` : r.search ? `songs matching “${r.search}”` : 'what’s on now'}${r.shuffle ? ', shuffled' : ''}${r.loop && r.loop !== 'off' ? `, loop ${r.loop}` : ''}${r.volume !== undefined ? `, volume ${r.volume}%` : ''}${r.sleep ? `, stops after ${r.sleep} min` : ''}${r.at ? `, starts by itself at ${r.at}${r.days?.length ? ` on ${r.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}` : ' every day'}` : ''}`

const pad = (n: number): string => String(n).padStart(2, '0')
const todayKey = (d = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Music answers that use the others (`run`: play_music, music_settings); `startRoutineClock`
 * starts routines at their time while Orbit is open, and returns a function that stops it.
 */
export function musicMoreAnswers(run: (name: string, args: Args) => Promise<string>): { answers: Record<string, Answer>; startRoutineClock: () => () => void } {
  async function runRoutine(r: MusicRoutine): Promise<string> {
    const said: string[] = []
    if (r.playlist || r.search) said.push(await run('play_music', { playlist: r.playlist, search: r.playlist ? undefined : r.search, shuffle: r.shuffle, loop: r.loop }))
    const settings: Args = {}
    if (!r.playlist && !r.search && r.shuffle !== undefined) settings.shuffle = r.shuffle
    if (!r.playlist && !r.search && r.loop) settings.loop = r.loop
    if (r.volume !== undefined) settings.volume = r.volume
    if (r.sleep) settings.sleep = r.sleep
    if (Object.keys(settings).length) said.push(await run('music_settings', settings))
    return said.join(' ') || 'Nothing to do in that routine.'
  }

  const saveRoutineFor = (args: Args): string => {
    const name = str(args.name).trim().slice(0, 40)
    if (!name) throw new Error('Name the routine, like "gym" or "bedtime".')
    const at = str(args.at)
    if (at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error('The time has to be like 07:30, or leave it out.')
    const r: MusicRoutine = {
      name,
      ...(str(args.playlist) ? { playlist: str(args.playlist) } : {}),
      ...(str(args.search) ? { search: str(args.search) } : {}),
      ...(typeof args.shuffle === 'boolean' ? { shuffle: args.shuffle } : {}),
      ...(['off', 'song', 'all'].includes(str(args.loop)) ? { loop: str(args.loop) as MusicRoutine['loop'] } : {}),
      ...(typeof args.volume === 'number' ? { volume: Math.min(100, Math.max(0, Math.round(args.volume))) } : {}),
      ...(typeof args.sleep_minutes === 'number' ? { sleep: Math.min(600, Math.max(1, Math.round(args.sleep_minutes))) } : {}),
      ...(at ? { at } : {}),
      ...(Array.isArray(args.days) ? { days: args.days.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6) } : {})
    }
    const list = loadRoutines().filter((x) => x.name.toLowerCase() !== name.toLowerCase())
    saveRoutines([...list, r])
    return `Saved the routine. ${routineText(r)}.${at ? ' It starts by itself while Orbit is open.' : ''}`
  }

  const routinesFor = (): string => {
    const list = loadRoutines()
    return list.length ? list.map(routineText).join('\n') : 'No music routines yet.'
  }

  const runRoutineFor = async (args: Args): Promise<string> => runRoutine(pickOne(loadRoutines(), str(args.name), (r) => r.name, 'music routine'))

  const deleteRoutineFor = (args: Args): string => {
    const r = pickOne(loadRoutines(), str(args.name), (x) => x.name, 'music routine')
    saveRoutines(loadRoutines().filter((x) => x.name !== r.name))
    return `Deleted the routine ${r.name}.`
  }

  const startRoutineClock = (): (() => void) => {
    const tick = (): void => {
      const now = new Date()
      const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
      const list = loadRoutines()
      const due = list.find((r) => r.at === time && r.ran !== todayKey(now) && (!r.days?.length || r.days.includes(now.getDay())))
      if (!due) return
      due.ran = todayKey(now)
      saveRoutines(list)
      void runRoutine(due).catch(() => undefined)
    }
    const timer = setInterval(tick, 20_000)
    return () => clearInterval(timer)
  }

  // ---------- mood and the DJ ----------

  const overviewFor = async (): Promise<string> => libraryOverview(await songs(), (await data()).tags)

  const moodFor = async (args: Args): Promise<string> => {
    const all = await songs()
    const d = await data()
    const picks = songsFor(all, { genres: strs(args.genres), artists: strs(args.artists), tags: strs(args.tags), words: strs(args.words) }, d.tags, Math.min(600, num(args.minutes, 60)), Math.random)
    if (!picks.length) throw new Error('No songs in their music fit that. Use music_library to see the genres, artists and tags there are.')
    const name = str(args.playlist_name).trim()
    const said: string[] = []
    if (name) said.push(await run('create_playlist', { name, songs: picks.map((s) => `${s.title} by ${s.artist}`) }))
    if (args.play === true) {
      await playLocal(picks, 0)
      said.push('Playing them now.')
    }
    return `${picks.length} songs, about ${minutesOf(picks)} minutes:\n${picks.map((s) => `${s.title} by ${s.artist}${s.genre ? ` (${s.genre})` : ''}`).join('\n')}${said.length ? `\n\n${said.join('\n')}` : ''}`
  }

  const djFor = async (args: Args): Promise<string> => {
    const all = await songs()
    const d = await data()
    const { queue, index } = useLocalMusic.getState()
    const playingLocal = !!useMusic.getState().local && queue.length > 0
    const current = playingLocal ? (queue[index] ?? null) : str(args.like) ? pickOne(all, str(args.like), (s) => `${s.title} by ${s.artist}`, 'song') : null
    if (!current) throw new Error('Nothing of theirs is playing. Say a song to start from (like).')
    const avoid = new Set([...d.history.slice(-60).map((h) => h.path), ...queue.slice(index).map((s) => s.path)])
    const picks = djPicks(current, all, {
      playlists: d.playlists.map((p) => p.songs),
      avoid,
      liked: new Set(Object.keys(d.liked)),
      ratings: d.ratings,
      count: Math.min(50, Math.max(1, num(args.count, 10))),
      rand: Math.random
    })
    if (!picks.length) throw new Error('There’s nothing left in their music to add.')
    if (playingLocal) await addToQueue(picks)
    else await playLocal([current, ...picks], 0)
    return `${playingLocal ? 'Added to Up next' : `Playing “${current.title}”, then`}: ${picks.map((s) => `${s.title} by ${s.artist}`).join(', ')}.`
  }

  return {
    answers: {
      music_library: overviewFor,
      songs_for_mood: moodFor,
      dj: djFor,
      save_music_routine: saveRoutineFor,
      get_music_routines: routinesFor,
      start_music_routine: runRoutineFor,
      delete_music_routine: deleteRoutineFor
    },
    startRoutineClock
  }
}
