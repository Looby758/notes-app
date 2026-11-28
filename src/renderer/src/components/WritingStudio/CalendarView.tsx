import { useDeferredValue, useMemo } from 'react'
import { AlertTriangle, CalendarDays, MapPin, Undo2 } from 'lucide-react'
import { allScenes, buildBrain, dateLabel, calendarClashes, calendarOrder, entityById, flashbacks, type SceneFacts, type Story } from '@shared/writing'
import { openScene, updateScene, useWriting } from '../../store/writingStudio'

/**
 * The story calendar: an in-world timeline, separate from your real calendar. Scenes are placed by
 * the date you give them ("Day 12" or a real-looking date), and it warns when a character is in two
 * places on the same day.
 */
export default function CalendarView() {
  const story = useWriting((s) => s.story)!
  const deferred = useDeferredValue(story)
  const { brain, ordered, clashes, back } = useMemo(() => {
    const brain = buildBrain(deferred)
    return { brain, ordered: calendarOrder(brain), clashes: calendarClashes(brain), back: new Set(flashbacks(brain)) }
  }, [deferred])
  const undated = brain.scenes.filter((s) => s.dateKey === null)
  const name = (id: string | null): string => (id ? (entityById(story, id)?.name ?? '?') : '')
  const title = (id: string): string => allScenes(story).find((p) => p.scene.id === id)?.scene.title ?? ''

  const days: { date: string; scenes: SceneFacts[] }[] = []
  for (const s of ordered) {
    const last = days[days.length - 1]
    if (last && brain.scenes.find((x) => x.id === last.scenes[0].id)?.dateKey === s.dateKey) last.scenes.push(s)
    else days.push({ date: s.date, scenes: [s] })
  }
  const clashScenes = new Set(clashes.flatMap((c) => c.scenes))

  return (
    <div className="ws-calendar" data-ws-calendar>
      <div className="ws-calendar-inner">
        <header className="ws-calendar-head">
          <h2>
            <CalendarDays size={18} /> Story calendar
          </h2>
          <p>When things happen in the story, not in real life. Give a scene a date in the Write view (like “Day 3” or “1888-10-31”) and it shows up here.</p>
        </header>

        {clashes.length > 0 && (
          <section className="ws-clashes" data-ws-clashes>
            {clashes.map((c, i) => (
              <div key={i} className="ws-clash">
                <AlertTriangle size={14} />
                <span>
                  <b>{name(c.character)}</b> is at {name(c.places[0])} in “{title(c.scenes[0])}” and at {name(c.places[1])} in “{title(c.scenes[1])}”, both on {dateLabel(c.date)}.
                </span>
                <button className="link-button" onClick={() => openScene(c.scenes[1])}>
                  Fix it
                </button>
              </div>
            ))}
          </section>
        )}

        {!ordered.length && (
          <div className="ws-empty small">
            <p>No scene has a date yet.</p>
          </div>
        )}

        <ol className="ws-timeline">
          {days.map((d) => (
            <li key={d.date + d.scenes[0].id} className="ws-day-group">
              <div className="ws-day-label">{dateLabel(d.date)}</div>
              <div className="ws-day-scenes">
                {d.scenes.map((s) => (
                  <TimelineScene key={s.id} story={story} s={s} clash={clashScenes.has(s.id)} flashback={back.has(s.id)} />
                ))}
              </div>
            </li>
          ))}
        </ol>

        {undated.length > 0 && (
          <section className="ws-undated">
            <h3>Not on the calendar yet</h3>
            {undated.map((s) => (
              <div key={s.id} className="ws-undated-row">
                <button className="ws-scene-link" onClick={() => openScene(s.id)}>
                  <span className="ws-scene-link-ch">{story.chapters[s.chapterIndex]?.title}</span>
                  <span className="ws-scene-link-title">{s.title}</span>
                </button>
                <input
                  className="text-input"
                  placeholder="Day 1"
                  maxLength={40}
                  onKeyDown={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim()
                    if (e.key === 'Enter' && v) updateScene(s.id, (x) => void (x.date = v))
                  }}
                  onBlur={(e) => e.target.value.trim() && updateScene(s.id, (x) => void (x.date = e.target.value.trim()))}
                  aria-label={`When “${s.title}” happens`}
                />
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

function TimelineScene({ story, s, clash, flashback }: { story: Story; s: SceneFacts; clash: boolean; flashback: boolean }) {
  const name = (id: string): string => entityById(story, id)?.name ?? '?'
  return (
    <button className={`ws-tl-scene ${clash ? 'clash' : ''}`} onClick={() => openScene(s.id)} data-ws-tl-scene={s.id}>
      <div className="ws-tl-top">
        {s.time && <span className="ws-tl-time">{s.time}</span>}
        <b>{s.title}</b>
        <span className="ws-tl-ch">{story.chapters[s.chapterIndex]?.title}</span>
        {flashback && (
          <span className="ws-tl-flash" title="Told after scenes that happen later: a flashback (or a date to check)">
            <Undo2 size={11} /> flashback
          </span>
        )}
      </div>
      <div className="ws-tl-meta">
        {s.place && (
          <span>
            <MapPin size={11} /> {name(s.place)}
          </span>
        )}
        {s.cast.length > 0 && <span>{s.cast.map(name).join(', ')}</span>}
      </div>
    </button>
  )
}
