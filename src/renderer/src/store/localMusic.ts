import { create } from 'zustand'
import { localArtUrl, localSongUrl, type LocalLibrary, type LocalSong } from '@shared/localMusic'
import { nextRepeat, type MusicRepeat, type MusicState } from '@shared/spotify'
import { errorMessage } from '../lib/paths'
import { unloadMedia } from '../lib/media'
import { useMusic } from './music'
import { queueMove, queuePlayNext, queueRemove } from '@shared/musicLibrary'
import { recordPlay } from './musicData'
import { usePrefs } from './prefs'
import { activeGains, EQ_BANDS, fadeCurve, fadeLength, shouldCrossfade, type MusicEq } from '@shared/musicSound'

/**
 * Playing your own music files, in the app itself (<audio> elements). While one is loaded the player
 * shows it instead of Spotify: store/music.ts sends play/pause, skip and the rest here.
 *
 * There are two "decks" (audio elements), so one song can fade out while the next fades in
 * (crossfade). Both go through the same Web Audio chain: each deck's fade → the equaliser → music
 * dipping → the speakers, with the visualiser and "music into voice chat" listening after the equaliser.
 */

interface LocalStore {
  library: LocalLibrary | null
  loading: boolean
  error: string | null
  /** What's playing, in order (shuffled when shuffle is on), and where we are in it. */
  queue: LocalSong[]
  index: number
  shuffle: boolean
  repeat: MusicRepeat
}

export const useLocalMusic = create<LocalStore>(() => ({ library: null, loading: false, error: null, queue: [], index: 0, shuffle: false, repeat: 'off' }))

const VOLUME_KEY = 'localMusicVolume'
/** The deck playing the current song. */
let audio: HTMLAudioElement | null = null
/** Both decks, once made (the second only when a crossfade first needs it). */
const decks: HTMLAudioElement[] = []
/** The song fading out during a crossfade, and when it stops. */
let outgoing: { el: HTMLAudioElement; timer: ReturnType<typeof setTimeout> } | null = null
/** The order you picked, kept so turning shuffle off goes back to it. */
let ordered: LocalSong[] = []

let listening = false

/**
 * A new list of your songs (after the folder changed, or details were written). Songs in Up next
 * get their new details too; `moved` says which files now have another path.
 */
export function applyLibrary(library: LocalLibrary, moved: Record<string, string> = {}): void {
  const byPath = new Map(library.songs.map((s) => [s.path, s]))
  const fresh = (s: LocalSong): LocalSong => byPath.get(moved[s.path] ?? s.path) ?? s
  const { queue, index } = useLocalMusic.getState()
  const playingPath = queue[index]?.path
  ordered = ordered.map(fresh)
  useLocalMusic.setState({ library, queue: queue.map(fresh) })
  // The song loaded now was moved: carry on from the same second in its new place.
  const to = playingPath ? moved[playingPath] : undefined
  if (to && audio) {
    const a = audio
    const at = a.currentTime
    const wasPlaying = !a.paused
    a.src = localSongUrl(to)
    a.addEventListener('loadedmetadata', () => (a.currentTime = at), { once: true })
    if (wasPlaying) void a.play().catch(() => undefined)
  }
  publish()
}

export async function loadLocalLibrary(fresh = false, choose = false): Promise<void> {
  if (!listening) {
    listening = true
    window.api.onLocalMusicChanged((library) => applyLibrary(library))
  }
  useLocalMusic.setState({ loading: true, error: null })
  try {
    const library = choose ? await window.api.localMusicChooseFolder() : await window.api.localMusicLibrary(fresh)
    useLocalMusic.setState({ library })
  } catch (err) {
    useLocalMusic.setState({ error: errorMessage(err) })
  } finally {
    useLocalMusic.setState({ loading: false })
  }
}

export const localUri = (song: LocalSong): string => `local:${song.path}`

const current = (): LocalSong | undefined => {
  const { queue, index } = useLocalMusic.getState()
  return queue[index]
}

function player(): HTMLAudioElement {
  return (audio ??= newDeck())
}

/** One of the two audio elements. Its events only count while it's the one playing the current song. */
function newDeck(): HTMLAudioElement {
  const el = new Audio()
  el.preload = 'auto'
  // Lets Web Audio (equaliser, crossfade, visualiser) use the sound (vault:// answers with the header this needs).
  el.crossOrigin = 'anonymous'
  if (audio) el.volume = audio.volume
  else {
    try {
      const v = Number(localStorage.getItem(VOLUME_KEY))
      if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(v)) el.volume = Math.min(1, Math.max(0, v / 100))
    } catch {
      // Only a convenience.
    }
  }
  decks.push(el)
  const mine = (run: () => void) => (): void => {
    if (el === audio) run()
  }
  for (const event of ['play', 'pause', 'loadedmetadata', 'seeked', 'volumechange']) el.addEventListener(event, mine(publish))
  // Often enough for the progress bar to stay right after a seek; it moves smoothly in between on its own.
  el.addEventListener(
    'timeupdate',
    mine(() => {
      const { state, at } = useMusic.getState()
      if (state?.source === 'local' && Math.abs(state.positionMs + (Date.now() - at) - el.currentTime * 1000) > 400) publish()
    })
  )
  // A play counts after 30 seconds (or at the end of a shorter song), once per time it's started.
  el.addEventListener(
    'timeupdate',
    mine(() => {
      if (counted || el.currentTime < Math.min(30, (el.duration || 60) - 1)) return
      counted = true
      const song = current()
      if (song) recordPlay(song)
    })
  )
  el.addEventListener('timeupdate', mine(saveResumeSoon))
  el.addEventListener('timeupdate', mine(maybeCrossfade))
  el.addEventListener('pause', mine(saveResume))
  el.addEventListener('ended', mine(() => void songEnded()))
  el.addEventListener(
    'error',
    mine(() => {
      const song = current()
      // An emptied deck (between songs) reports an error too; only a real file problem is worth saying.
      if (song && el.getAttribute('src')) useMusic.setState({ error: `Couldn’t play “${song.title}”. The file may have moved, or it’s in a format this computer can’t play.` })
    })
  )
  el.addEventListener('volumechange', undoTapVolume)
  el.addEventListener('play', () => graph?.ctx.state === 'suspended' && void graph.ctx.resume())
  wireDeck(el)
  return el
}

/** Tells the player (and the system's media controls) what's playing now. */
function publish(): void {
  const song = current()
  if (!song || !audio || !useMusic.getState().local) return
  const { shuffle, repeat } = useLocalMusic.getState()
  const art = song.art ? localArtUrl(song.path, song.added) : undefined
  const state: MusicState = {
    source: 'local',
    playing: !audio.paused,
    track: {
      name: song.title,
      artist: song.artist,
      album: song.album,
      art,
      uri: localUri(song),
      durationMs: Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : song.durationMs
    },
    positionMs: Math.round(audio.currentTime * 1000),
    shuffle,
    repeat,
    volume: Math.round(audio.volume * 100)
  }
  useMusic.setState({ state, at: Date.now() })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, album: song.album, artwork: art ? [{ src: art }] : [] })
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'
  }
}

/** Whether this play of the song has been counted yet. */
let counted = false

async function start(index: number): Promise<void> {
  const { queue } = useLocalMusic.getState()
  const song = queue[index]
  if (!song) return
  counted = false
  useLocalMusic.setState({ index })
  endCrossfade()
  const a = player()
  fullVolume(a)
  a.src = localSongUrl(song.path)
  useMusic.setState({ local: true, error: null })
  publish()
  try {
    await a.play()
  } catch (err) {
    // A newer song was picked before this one started; that's fine.
    if ((err as Error).name !== 'AbortError') useMusic.setState({ error: errorMessage(err) })
  }
}

const shuffled = <T,>(list: T[]): T[] => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Plays `songs` from the one at `index` (or a random one, shuffling them, when `index` is 'shuffle'). */
export async function playLocal(songs: LocalSong[], index: number | 'shuffle'): Promise<void> {
  if (!songs.length) return
  ordered = songs
  // Spotify stops so the two don't play over each other.
  const spotify = useMusic.getState()
  if (!spotify.local && spotify.state?.playing && spotify.state.source !== 'none') void window.api.musicControl('pause').catch(() => undefined)
  if (index === 'shuffle') {
    useLocalMusic.setState({ shuffle: true, queue: shuffled(songs) })
    return start(0)
  }
  const { shuffle } = useLocalMusic.getState()
  if (shuffle) {
    const first = songs[index]
    useLocalMusic.setState({ queue: [first, ...shuffled(songs.filter((_, i) => i !== index))] })
    return start(0)
  }
  useLocalMusic.setState({ queue: songs })
  return start(index)
}

async function songEnded(): Promise<void> {
  const { repeat, index, queue } = useLocalMusic.getState()
  if (repeat === 'track') {
    player().currentTime = 0
    await player().play()
  } else if (index + 1 < queue.length) await start(index + 1)
  else if (repeat === 'context') await start(0)
  else publish()
}

export function localToggle(): void {
  endCrossfade()
  const a = player()
  if (a.paused) void a.play().catch((err) => useMusic.setState({ error: errorMessage(err) }))
  else a.pause()
}

export function localPause(): void {
  endCrossfade()
  audio?.pause()
}

export async function localNext(): Promise<void> {
  const { index, queue } = useLocalMusic.getState()
  await start(index + 1 < queue.length ? index + 1 : 0)
}

/** Back to the start of the song, or to the one before if it's only just begun. */
export async function localPrevious(): Promise<void> {
  endCrossfade()
  const a = player()
  const { index, queue } = useLocalMusic.getState()
  if (a.currentTime > 3 || index === 0) {
    a.currentTime = 0
    publish()
  } else await start(Math.max(0, Math.min(queue.length - 1, index - 1)))
}

export function localSeek(ms: number): void {
  endCrossfade()
  player().currentTime = Math.max(0, ms / 1000)
}

export function localVolume(percent: number): void {
  player()
  for (const d of decks) d.volume = Math.min(1, Math.max(0, percent / 100))
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.round(percent)))
  } catch {
    // Only a convenience.
  }
}

export function localShuffle(): void {
  const { shuffle, queue, index } = useLocalMusic.getState()
  const song = queue[index]
  if (!shuffle) {
    // Keep the song playing, then the rest in a random order.
    useLocalMusic.setState({ shuffle: true, queue: song ? [song, ...shuffled(queue.filter((_, i) => i !== index))] : shuffled(queue), index: 0 })
  } else {
    const back = song ? ordered.indexOf(song) : 0
    useLocalMusic.setState({ shuffle: false, queue: ordered, index: Math.max(0, back) })
  }
  publish()
}

export function localRepeat(): void {
  useLocalMusic.setState({ repeat: nextRepeat(useLocalMusic.getState().repeat) })
  publish()
}

// ---------- The sound: crossfade, equaliser, dipping, visualiser ----------

interface Graph {
  ctx: AudioContext
  /** Where both decks meet. */
  mix: GainNode
  eq: BiquadFilterNode[]
  preamp: GainNode
  /** Music dipping (a friend talking in Discord): only what you hear. */
  duck: GainNode
  /** Each deck's own fade in or out. */
  fades: Map<HTMLAudioElement, GainNode>
}

let graph: Graph | null = null
/** Set when Web Audio couldn't be used: the music still plays, just without the extras. */
let noGraph = false
let analyser: AnalyserNode | null = null
/** Music dipping's level (1 = normal), for a graph made while it's dipped. */
let duckLevel = 1

function makeGraph(): Graph | null {
  if (graph || noGraph) return graph
  try {
    const ctx = new AudioContext()
    const mix = ctx.createGain()
    const eq = EQ_BANDS.map((hz, i) => {
      const f = ctx.createBiquadFilter()
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
      f.frequency.value = hz
      f.Q.value = 1.4
      f.gain.value = 0
      return f
    })
    const preamp = ctx.createGain()
    const duck = ctx.createGain()
    duck.gain.value = duckLevel
    let node: AudioNode = mix
    for (const f of eq) {
      node.connect(f)
      node = f
    }
    node.connect(preamp)
    preamp.connect(duck)
    duck.connect(ctx.destination)
    graph = { ctx, mix, eq, preamp, duck, fades: new Map() }
    applyEq(usePrefs.getState().prefs.musicEq, true)
    // Browsers start an AudioContext paused until something's been clicked.
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    noGraph = true
    graph = null
  }
  return graph
}

/** Sends a deck's sound through the chain (an element can only be wired in once, for good). */
function wireDeck(el: HTMLAudioElement): void {
  const g = makeGraph()
  if (!g || g.fades.has(el)) return
  try {
    const source = g.ctx.createMediaElementSource(el)
    const fade = g.ctx.createGain()
    source.connect(fade)
    fade.connect(g.mix)
    g.fades.set(el, fade)
  } catch {
    // Plays straight to the speakers instead.
  }
}

/** The equaliser's bands and preamp, moved smoothly (`now` skips the glide). */
function applyEq(eq: MusicEq, now = false): void {
  if (!graph) return
  const { bands, preamp } = activeGains(eq)
  const t = graph.ctx.currentTime
  graph.eq.forEach((f, i) => (now ? (f.gain.value = bands[i] ?? 0) : f.gain.setTargetAtTime(bands[i] ?? 0, t, 0.05)))
  const level = Math.pow(10, preamp / 20)
  if (now) graph.preamp.gain.value = level
  else graph.preamp.gain.setTargetAtTime(level, t, 0.05)
}

usePrefs.subscribe((now, before) => {
  if (now.prefs.musicEq !== before.prefs.musicEq) applyEq(now.prefs.musicEq)
})

/** A deck heard at full level (not part-way through a fade). */
function fullVolume(el: HTMLAudioElement): void {
  const fade = graph?.fades.get(el)
  if (!fade || !graph) return
  fade.gain.cancelScheduledValues(graph.ctx.currentTime)
  fade.gain.value = 1
}

/** Stops the song that was fading out, straight away (you skipped, paused or seeked during a crossfade). */
function endCrossfade(): void {
  if (!outgoing) return
  const { el, timer } = outgoing
  outgoing = null
  clearTimeout(timer)
  // Emptied, not just paused, so the file isn't held open.
  unloadMedia(el)
  fullVolume(el)
  if (audio) fullVolume(audio)
}

/** Near the end of a song: starts the next one fading in while this one fades out. */
function maybeCrossfade(): void {
  const el = audio
  if (!el || outgoing || el.paused || !graph?.fades.has(el)) return
  const seconds = usePrefs.getState().prefs.musicCrossfade
  if (!seconds) return
  // "Pause at the end of this song" means no next song.
  const sleep = useMusic.getState().sleep
  if (sleep && 'song' in sleep) return
  const { queue, index, repeat } = useLocalMusic.getState()
  const nextIndex = index + 1 < queue.length ? index + 1 : repeat === 'context' && queue.length > 1 ? 0 : -1
  const next = queue[nextIndex]
  const fade = fadeLength(seconds, el.duration, (next?.durationMs ?? 0) / 1000)
  if (!shouldCrossfade({ fade, position: el.currentTime, duration: el.duration, repeatOne: repeat === 'track', hasNext: !!next })) return
  void crossfadeTo(nextIndex, Math.max(0.5, Math.min(fade, el.duration - el.currentTime)))
}

async function crossfadeTo(index: number, seconds: number): Promise<void> {
  const g = graph
  const from = audio
  const song = useLocalMusic.getState().queue[index]
  if (!g || !from || !song) return
  const to = decks.find((d) => d !== from) ?? newDeck()
  const fadeIn = g.fades.get(to)
  const fadeOut = g.fades.get(from)
  if (!fadeIn || !fadeOut) return
  const t = g.ctx.currentTime
  fadeIn.gain.cancelScheduledValues(t)
  fadeIn.gain.value = 0
  to.src = localSongUrl(song.path)
  counted = false
  audio = to
  useLocalMusic.setState({ index })
  outgoing = { el: from, timer: setTimeout(endCrossfade, seconds * 1000 + 150) }
  publish()
  try {
    await to.play()
  } catch (err) {
    if ((err as Error).name !== 'AbortError') useMusic.setState({ error: errorMessage(err) })
    endCrossfade()
    return
  }
  // From when the new song actually starts, so its first notes aren't lost.
  const at = g.ctx.currentTime
  fadeIn.gain.cancelScheduledValues(at)
  fadeIn.gain.setValueCurveAtTime(fadeCurve(64, 'in'), at, seconds)
  if (outgoing?.el === from) {
    fadeOut.gain.cancelScheduledValues(at)
    fadeOut.gain.setValueCurveAtTime(fadeCurve(64, 'out'), at, seconds)
  }
}

export const BARS = 48

/**
 * Your music's sound as BARS levels (0–1): low notes first, high last. Null until your own music
 * has played (the sound is only wired in then).
 */
export function soundLevels(): (() => Float32Array) | null {
  const analyser = localAnalyser()
  if (!analyser) return null
  const data = new Uint8Array(analyser.frequencyBinCount)
  const out = new Float32Array(BARS)
  // Spread the bars over the notes we hear most of (the top of the range is mostly empty).
  const usable = Math.floor(data.length * 0.72)
  return () => {
    analyser.getByteFrequencyData(data)
    for (let i = 0; i < BARS; i++) {
      const from = Math.floor((i / BARS) ** 1.6 * usable)
      const to = Math.max(from + 1, Math.floor(((i + 1) / BARS) ** 1.6 * usable))
      let sum = 0
      for (let j = from; j < to; j++) sum += data[j]
      out[i] = sum / (to - from) / 255
    }
    return out
  }
}

/** The sound of your own music (after the equaliser), for the visualiser. */
export function localAnalyser(): AnalyserNode | null {
  if (analyser) return analyser
  if (!audio) return null
  const g = makeGraph()
  if (!g) return null
  analyser = g.ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.78
  g.preamp.connect(analyser)
  return analyser
}

let musicTap: { dest: MediaStreamAudioDestinationNode; gain: GainNode } | null = null

/** The voice-chat copy of your music ignores the player's volume (the call has its own). */
function undoTapVolume(): void {
  if (!musicTap || !graph || !audio) return
  const v = audio.volume
  musicTap.gain.gain.setTargetAtTime(v > 0.02 ? 1 / v : 0, graph.ctx.currentTime, 0.02)
}

/**
 * Your music as a stream, for sending into a voice call (the soundboard's "music into voice chat").
 * It's taken before the player's volume (the gain undoes it), so the call has its own volume.
 * Null until a song of your own has been played.
 */
export function localMusicStream(): MediaStream | null {
  if (musicTap) return musicTap.dest.stream
  if (!audio) return null
  const g = makeGraph()
  if (!g) return null
  const gain = g.ctx.createGain()
  const dest = g.ctx.createMediaStreamDestination()
  g.preamp.connect(gain)
  gain.connect(dest)
  musicTap = { dest, gain }
  undoTapVolume()
  return dest.stream
}

/**
 * Music dipping: turns what you hear of your own music to `level` (1 = normal) smoothly, quicker
 * going down than coming back up. Only what you hear: music sent into a call keeps its own level.
 */
export function localDuck(level: number): void {
  const next = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1))
  if (next === duckLevel) return
  const down = next < duckLevel
  duckLevel = next
  // Nothing playing yet: a graph made later starts at this level.
  if (!graph) return
  graph.duck.gain.cancelScheduledValues(graph.ctx.currentTime)
  graph.duck.gain.setTargetAtTime(next, graph.ctx.currentTime, down ? 0.06 : 0.25)
}

// ---------- Changing Up next ----------

/** After the queue changes: with shuffle off, the order you picked follows it. */
function queueChanged(queue: LocalSong[], index: number): void {
  useLocalMusic.setState({ queue, index })
  if (!useLocalMusic.getState().shuffle) ordered = queue
  saveResume()
}

/** Plays these songs straight after the one playing (or starts them if nothing's playing). */
export async function playNext(songs: LocalSong[]): Promise<void> {
  if (!songs.length) return
  const { queue, index } = useLocalMusic.getState()
  if (!useMusic.getState().local || !queue.length) return playLocal(songs, 0)
  queueChanged(queuePlayNext(queue, index, songs), index)
}

/** Puts these songs at the end of Up next (or starts them if nothing's playing). */
export async function addToQueue(songs: LocalSong[]): Promise<void> {
  if (!songs.length) return
  const { queue, index } = useLocalMusic.getState()
  if (!useMusic.getState().local || !queue.length) return playLocal(songs, 0)
  queueChanged([...queue, ...songs], index)
}

/** Moves a song in Up next (positions in the whole queue). */
export function moveInQueue(from: number, to: number): void {
  const { queue, index } = useLocalMusic.getState()
  const next = queueMove(queue, index, from, to)
  queueChanged(next.queue, next.index)
}

/** Takes a song out of Up next (a position in the whole queue). */
export function removeFromQueue(at: number): void {
  const { queue, index } = useLocalMusic.getState()
  const next = queueRemove(queue, index, at)
  queueChanged(next.queue, next.index)
}

/** Empties Up next, keeping the song playing. */
export function clearUpNext(): void {
  const { queue, index } = useLocalMusic.getState()
  queueChanged(queue.slice(0, index + 1), index)
}

// ---------- Carrying on where you left off ----------

const RESUME_KEY = 'orbit.musicResume'
interface Resume {
  queue: string[]
  index: number
  positionMs: number
  shuffle: boolean
}

let resumeTimer: ReturnType<typeof setTimeout> | undefined
function saveResumeSoon(): void {
  if (resumeTimer) return
  resumeTimer = setTimeout(() => {
    resumeTimer = undefined
    saveResume()
  }, 5000)
}

function saveResume(): void {
  const { queue, index, shuffle } = useLocalMusic.getState()
  if (!queue.length || !useMusic.getState().local) return
  try {
    // Only the next few hundred songs, so the saved list stays small.
    const from = Math.max(0, index - 50)
    const value: Resume = { queue: queue.slice(from, index + 500).map((s) => s.path), index: index - from, positionMs: Math.round((audio?.currentTime ?? 0) * 1000), shuffle }
    localStorage.setItem(RESUME_KEY, JSON.stringify(value))
  } catch {
    // Only a convenience.
  }
}

let resumed = false
/**
 * Loads the song you were on when Orbit closed, paused at the same second, with the same Up next.
 * Nothing plays until you press play. Only once, and only if nothing else has started.
 */
export async function resumeLastSession(): Promise<void> {
  if (resumed) return
  resumed = true
  let saved: Resume | null = null
  try {
    saved = JSON.parse(localStorage.getItem(RESUME_KEY) ?? 'null')
  } catch {
    saved = null
  }
  if (!saved || !Array.isArray(saved.queue) || !saved.queue.length || useMusic.getState().local) return
  if (!useLocalMusic.getState().library) await loadLocalLibrary()
  const byPath = new Map((useLocalMusic.getState().library?.songs ?? []).map((s) => [s.path, s]))
  const songs = saved.queue.map((p) => byPath.get(p)).filter((s): s is LocalSong => !!s)
  const playing = byPath.get(saved.queue[saved.index] ?? '')
  const index = playing ? songs.indexOf(playing) : -1
  if (index < 0 || useMusic.getState().local) return
  ordered = songs
  useLocalMusic.setState({ queue: songs, index, shuffle: !!saved.shuffle })
  const a = player()
  counted = false
  a.src = localSongUrl(playing!.path)
  const at = Math.max(0, (saved.positionMs ?? 0) / 1000)
  a.addEventListener('loadedmetadata', () => (a.currentTime = Math.min(at, Math.max(0, a.duration - 1))), { once: true })
  useMusic.setState({ local: true, error: null })
  publish()
}

/** Skips to a song further along the queue. */
export const localJump = (index: number): Promise<void> => start(index)

/** What plays after this song. */
export function localUpNext(): LocalSong[] {
  const { queue, index } = useLocalMusic.getState()
  return queue.slice(index + 1)
}

/** Stops your own music and hands the player back to Spotify. */
export function stopLocal(): void {
  endCrossfade()
  // Emptied, not just paused, so the song's file isn't held open (Windows would say Orbit is using it).
  unloadMedia(audio)
  useMusic.setState({ local: false })
}

// The keyboard's play/pause and skip keys (and the system's media controls).
if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
  const handlers: [MediaSessionAction, () => void][] = [
    ['play', localToggle],
    ['pause', localPause],
    ['nexttrack', () => void localNext()],
    ['previoustrack', () => void localPrevious()]
  ]
  for (const [action, run] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, () => useMusic.getState().local && run())
    } catch {
      // Not every action is supported everywhere.
    }
  }
}

/** Plays one of your files by its path in the music folder (from a song card in a note). */
export async function playLocalPath(path: string): Promise<void> {
  if (!useLocalMusic.getState().library) await loadLocalLibrary()
  const songs = useLocalMusic.getState().library?.songs ?? []
  const song = songs.find((s) => s.path === path)
  if (!song) throw new Error('That song isn’t in your music folder any more (or the folder has changed).')
  await playLocal([song], 0)
}
