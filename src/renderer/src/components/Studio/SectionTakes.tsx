import { useEffect, useRef, useState } from 'react'
import { Check, Circle, Download, FolderOpen, Merge, Play, RotateCcw, Square, X } from 'lucide-react'
import { formatLength } from '../../lib/script'
import { chosenTake, joinPlan } from '../../lib/takes'
import { useStudio } from '../../store/studio'
import { chooseTake, forgetTake, getConverterAndJoin, joinTakes, quickRetake, recordSection, selectSection, takesOf, useTakes } from '../../store/takes'

/**
 * Record by section, beside the teleprompter: every section of the script with its takes. Record
 * one, it stops by itself at the section's end and moves on to the next; Quick retake throws the
 * take away and goes again; pick the best take of each (listen back first), then join them.
 */
export function SectionTakes() {
  const t = useTakes()
  const recording = useStudio((s) => !!s.recording)
  const mine = takesOf(t)
  const plan = joinPlan(t.sections, mine.takes, mine.chosen)
  const done = t.sections.filter((s) => chosenTake(s.key, mine.takes, mine.chosen)).length
  const list = useRef<HTMLOListElement>(null)

  // Keep the selected section in view.
  useEffect(() => {
    list.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest' })
  }, [t.current])

  return (
    <div className="takes" data-section-takes>
      <div className="takes-head">
        <strong>Sections</strong>
        <span className="studio-hint">
          {done} of {t.sections.length} recorded
        </span>
      </div>
      {!t.sections.length && <p className="studio-hint">Pick a script above. Its [SECTION] markers split it up; with none, it’s one section.</p>}
      <ol className="takes-list" ref={list}>
        {t.sections.map((s) => {
          const takes = mine.takes.filter((x) => x.key === s.key)
          const used = chosenTake(s.key, mine.takes, mine.chosen)
          const isActive = t.active?.key === s.key
          const isCurrent = t.current === s.key
          return (
            <li key={s.key} className={`takes-section ${isCurrent ? 'current' : ''} ${isActive ? 'rec' : ''}`} data-take-section={s.key}>
              <div className="takes-row" onClick={() => !t.active && selectSection(s.key)}>
                <span className={`takes-num ${used ? 'done' : ''}`}>{used ? <Check size={12} /> : s.index + 1}</span>
                <span className="takes-title" title={s.title}>
                  {s.title}
                </span>
                <span className="studio-hint">{s.words ? formatLength(s.seconds) : ''}</span>
              </div>
              {isCurrent && (
                <div className="takes-detail">
                  <div className="studio-row">
                    {isActive ? (
                      <>
                        <button className="btn takes-rec on" onClick={() => void recordSection()} title="Stop now and keep this take (Enter)" data-take-stop>
                          <Square size={12} /> {t.active?.ended ? 'Stopping…' : 'Stop'}
                        </button>
                        <button className="btn" onClick={() => quickRetake()} title="Throw this take away and start the section again (R)" data-take-retake>
                          <RotateCcw size={12} /> Quick retake
                        </button>
                      </>
                    ) : (
                      <button className="btn takes-rec" onClick={() => void recordSection(s.key)} disabled={recording} title="Record this section; it stops by itself at its end (Enter)" data-take-record>
                        <Circle size={11} fill="currentColor" /> {takes.length ? 'Record again' : 'Record'}
                      </button>
                    )}
                  </div>
                  {takes.length > 0 && (
                    <ul className="takes-takes">
                      {takes
                        .slice()
                        .sort((a, b) => b.at - a.at)
                        .map((x) => (
                          <li key={x.path} className={used?.path === x.path ? 'used' : ''}>
                            <label className="studio-check" title={x.path}>
                              <input type="radio" name={`take-${s.key}`} checked={used?.path === x.path} onChange={() => chooseTake(x.path)} disabled={!!t.active} />
                              Take {x.n} <span className="studio-hint">{formatLength(Math.max(0, x.length - x.start))}</span>
                              {x.scrapped && <span className="takes-tag">retaken</span>}
                              {x.early && !x.scrapped && <span className="takes-tag" title="Stopped before the end of the section">early</span>}
                            </label>
                            <PlayTake path={x.path} start={x.start} />
                            <button className="icon-btn" title="Show in its folder" onClick={() => void window.api.studioReveal(x.path)}>
                              <FolderOpen size={13} />
                            </button>
                            <button className="icon-btn" title="Take it off the list (the file stays)" onClick={() => forgetTake(x.path)} disabled={!!t.active}>
                              <X size={13} />
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="takes-foot">
        <button className="btn" onClick={() => void joinTakes()} disabled={!plan.parts.length || !!t.active || t.joining?.state === 'working'} title="Joins the take picked for each section, in order, into one voiceover" data-takes-join>
          <Merge size={13} /> Join the takes{plan.parts.length ? ` (${formatLength(plan.length)})` : ''}
        </button>
        {t.joining?.state === 'working' && <p className="studio-hint">{t.joining.message}</p>}
        {t.joining?.state === 'done' && t.joining.path && (
          <div className="studio-row">
            <p className="studio-ok">
              <Check size={13} /> {t.joining.message} Saved as “{t.joining.path.split(/[\\/]/).pop()}”.
            </p>
            <button className="icon-btn" title="Show it in its folder" onClick={() => void window.api.studioReveal(t.joining!.path!)}>
              <FolderOpen size={14} />
            </button>
          </div>
        )}
        {t.joining?.state === 'error' && (
          <p className="studio-problem">
            {t.joining.message}{' '}
            {t.joining.needsFfmpeg && (
              <button className="btn" onClick={() => void getConverterAndJoin()}>
                <Download size={12} /> Download it (about 25 MB)
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

let playing: { audio: HTMLAudioElement; url: string; path: string; stop: () => void } | null = null

/** Listens back to a take, from where the words start. */
function PlayTake({ path, start }: { path: string; start: number }) {
  const [on, setOn] = useState(false)
  useEffect(() => () => {
    if (playing?.path === path) playing.stop()
  }, [path])
  const play = async (): Promise<void> => {
    if (playing) {
      const was = playing.path
      playing.stop()
      if (was === path) return
    }
    try {
      const data = await window.api.studioReadTake(path)
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: path.endsWith('.webm') ? 'audio/webm' : 'audio/mp4' }))
      const audio = new Audio(url)
      const stop = (): void => {
        audio.pause()
        URL.revokeObjectURL(url)
        if (playing?.audio === audio) playing = null
        setOn(false)
      }
      playing = { audio, url, path, stop }
      audio.onended = stop
      audio.currentTime = start
      setOn(true)
      await audio.play()
    } catch {
      playing?.stop()
      setOn(false)
    }
  }
  return (
    <button className="icon-btn" title={on ? 'Stop' : 'Listen'} onClick={() => void play()} data-take-play>
      {on ? <Square size={12} /> : <Play size={13} />}
    </button>
  )
}
