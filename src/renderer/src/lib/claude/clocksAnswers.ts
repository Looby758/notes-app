import { clockLine, clocksText, wallTimeIn } from '@shared/claudeFormat'
import { clockId, clockText, clockTitle, differenceText, findClockPlaces, isZone, localZone, MAX_CLOCKS, messageTime, nextGoodTime, relativeDay, timeIn, type WorldClock } from '@shared/worldClock'
import { setPrefs, usePrefs } from '../../store/prefs'
import { dayKey } from '../dates'
import { pickOne, str, type Answer, type Args } from './common'

/** World clocks for Claude Desktop: the time anywhere, converting times, and the clocks page itself. */

const clocks = (): WorldClock[] => usePrefs.getState().prefs.worldClocks
const twelve = (): boolean => usePrefs.getState().prefs.timeFormat === '12h'
const save = (list: WorldClock[]): void => setPrefs({ worldClocks: list })
const pickClock = (want: string): WorldClock => pickOne(clocks(), want, (c) => `${clockTitle(c)}${c.person ? ` (${c.label})` : ''}`, 'world clock')

/** A place (or a friend on the clocks, or "here") → its name and time zone. */
async function placeZone(want: string): Promise<{ name: string; zone: string }> {
  const w = want.trim()
  if (!w || /^(here|home|me|my time|local)$/i.test(w)) return { name: 'here', zone: localZone() }
  if (isZone(w as unknown)) return { name: w, zone: w }
  const friend = clocks().find((c) => (c.person ?? c.label).toLowerCase() === w.toLowerCase())
  if (friend) return { name: clockTitle(friend), zone: friend.zone }
  const quick = findClockPlaces(w, 1)[0]
  if (quick) return { name: quick.name, zone: quick.zone }
  const found = await window.api.searchPlaces(w).catch(() => null)
  const place = found?.places[0]
  if (!place) throw new Error(`Couldn’t find a place called “${w}”${found?.error ? ` (${found.error})` : ''}. Try a nearby big city.`)
  const zone = await window.api.zoneAt(place.lat, place.lon).catch(() => null)
  if (!zone) throw new Error(`Couldn’t find the time zone for ${place.name}. Check Orbit is online, or try a nearby city.`)
  return { name: place.name, zone }
}

const clocksFor = (): string => clocksText(clocks(), localZone(), new Date(), twelve())

async function timeInFor(args: Args): Promise<string> {
  const p = await placeZone(str(args.place))
  const now = new Date()
  const t = timeIn(p.zone, now)
  return `${p.name} [${p.zone}]: ${clockText(t, twelve())} (${relativeDay(p.zone, localZone(), now)} there), ${differenceText(p.zone, localZone(), now)}. ${messageTime(t).text}.`
}

async function convertTimeFor(args: Args): Promise<string> {
  const time = str(args.time)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('The time has to be a 24-hour time like 18:30.')
  const from = await placeZone(str(args.from))
  const date = str(args.date) || dayKey(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('The date has to be like 2026-11-25.')
  const at = wallTimeIn(from.zone, date, time)
  const targets = str(args.to) ? [await placeZone(str(args.to))] : [{ name: 'here', zone: localZone() }, ...clocks().map((c) => ({ name: clockTitle(c), zone: c.zone }))]
  const lines = targets
    .filter((t) => t.zone !== from.zone || t.name !== from.name)
    .map((t) => {
      const there = timeIn(t.zone, at)
      return `${t.name}: ${there.year}-${String(there.month).padStart(2, '0')}-${String(there.day).padStart(2, '0')} ${clockText(there, twelve())}${t.name === 'here' ? '' : ` (${messageTime(there).text.toLowerCase()})`}`
    })
  return `${time} on ${date} in ${from.name} is:\n${lines.join('\n') || 'the same time everywhere asked.'}`
}

async function addClockFor(args: Args): Promise<string> {
  const list = clocks()
  if (list.length >= MAX_CLOCKS) throw new Error(`There are already ${MAX_CLOCKS} clocks, the most there’s room for. Remove one first.`)
  const p = await placeZone(str(args.place))
  if (p.name === 'here') throw new Error('Say which place.')
  const person = str(args.person).trim().slice(0, 40) || undefined
  const label = (str(args.name).trim() || p.name).slice(0, 60)
  if (list.some((c) => c.zone === p.zone && c.label === label && (c.person ?? '') === (person ?? ''))) return `${person ?? label} is already on the world clocks.`
  const clock: WorldClock = { id: clockId(), label, zone: p.zone, ...(person ? { person } : {}) }
  save([...list, clock])
  return `Added it to World clocks.\n${clockLine(clock, localZone(), new Date(), twelve())}`
}

function removeClockFor(args: Args): string {
  const c = pickClock(str(args.clock))
  save(clocks().filter((x) => x.id !== c.id))
  return `Took ${clockTitle(c)} off the world clocks.`
}

function renameClockFor(args: Args): string {
  const c = pickClock(str(args.clock))
  const name = str(args.name).trim()
  if (!name) throw new Error('Say the new name.')
  save(clocks().map((x) => (x.id !== c.id ? x : x.person ? { ...x, person: name.slice(0, 40) } : { ...x, label: name.slice(0, 60) })))
  return `Renamed ${clockTitle(c)} to ${name}.`
}

function moveClockFor(args: Args): string {
  const c = pickClock(str(args.clock))
  const list = clocks().filter((x) => x.id !== c.id)
  const to = Math.min(list.length, Math.max(0, Math.round(Number(args.position ?? 1)) - 1))
  list.splice(to, 0, c)
  save(list)
  return `Moved ${clockTitle(c)} to place ${to + 1} on the world clocks.`
}

function goodTimeFor(args: Args): string {
  const c = pickClock(str(args.clock))
  const now = new Date()
  const t = timeIn(c.zone, now)
  const next = nextGoodTime(c.zone, now)
  if (!next) return `It’s ${clockText(t, twelve())} for ${clockTitle(c)}: ${messageTime(t).text.toLowerCase()} now.`
  const there = timeIn(c.zone, next)
  return `It’s ${clockText(t, twelve())} for ${clockTitle(c)} (${messageTime(t).text.toLowerCase()}). A good time is from ${clockText(timeIn(localZone(), next), twelve())} your time (${clockText(there, twelve())} for them).`
}

export const CLOCK_ANSWERS: Record<string, Answer> = {
  get_world_clocks: clocksFor,
  time_in: timeInFor,
  convert_time: convertTimeFor,
  add_world_clock: addClockFor,
  remove_world_clock: removeClockFor,
  rename_world_clock: renameClockFor,
  move_world_clock: moveClockFor,
  good_time_to_message: goodTimeFor
}
