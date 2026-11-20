import { useRef, useState } from 'react'
import { ArrowUpRight, Check, CircleCheck, ExternalLink, Link2, Plus, Trash2, Undo2 } from 'lucide-react'
import { checklist, readyToUpload, STEP_GROUPS, type ChecklistStep, type VideoDraft } from '../../lib/publishing'
import { addStep, deleteStep, skipStep, tickStep } from '../../store/publishing'
import { markUploaded } from '../../store/videoLinks'
import { dayKeyOf } from '../../lib/when'
import { formatDate } from '../../lib/dates'
import { notify } from '../../store/notify'
import { openLink } from '../../lib/openLink'

/** Scrolls to a part of the drafts ("board", "chapters"…) and flashes it. */
function goTo(from: HTMLElement | null, section: string): void {
  const el = from?.closest('[data-pub-drafts]')?.querySelector<HTMLElement>(`[data-pub-${section}]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.remove('pub-flash')
  void el.offsetWidth
  el.classList.add('pub-flash')
}

function Step({ d, step }: { d: VideoDraft; step: ChecklistStep }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = step.skipped ? 'skipped' : step.done ? 'done' : 'todo'
  return (
    <div ref={ref} className={`pub-step ${state}`} data-pub-step={step.id}>
      {step.auto ? (
        <span
          className={`pub-step-box auto ${step.done ? 'on' : ''}`}
          title={step.done ? 'Done: Orbit can see it in your drafts' : 'Orbit ticks this when the drafts above are ready'}
          aria-label={step.done ? 'Done' : 'Not done yet'}
        >
          {step.done && <Check size={13} />}
        </span>
      ) : (
        <button
          className={`pub-step-box ${step.done ? 'on' : ''}`}
          role="checkbox"
          aria-checked={step.done}
          disabled={step.skipped}
          onClick={() => tickStep(d.id, step.id, !step.done)}
          aria-label={step.label}
          data-pub-tick
        >
          {step.done && <Check size={13} />}
        </button>
      )}
      <div className="pub-step-body">
        <div className="pub-step-label">{step.label}</div>
        {!step.skipped && step.missing && <div className="pub-step-missing">{step.missing}</div>}
        {!step.skipped && !step.missing && step.hint && <div className="pub-step-hint">{step.hint}</div>}
        {step.skipped && <div className="pub-step-hint">Not needed for this video</div>}
      </div>
      <div className="pub-step-actions">
        {step.auto && !step.done && !step.skipped && (
          <button className="link-button" onClick={() => goTo(ref.current, step.auto!)}>
            Go to it <ArrowUpRight size={12} />
          </button>
        )}
        {step.skippable && !step.done && (
          <button className="link-button" onClick={() => skipStep(d.id, step.id, !step.skipped)} title={step.skipped ? 'This video needs it after all' : 'This video doesn’t need it'}>
            {step.skipped ? 'Needed' : 'Not needed'}
          </button>
        )}
        {step.extra && (
          <button className="icon-btn" onClick={() => deleteStep(d.id, step.id)} title="Remove this step">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function AddStep({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null)
  if (text === null)
    return (
      <button className="link-button pub-add-step" onClick={() => setText('')} data-pub-add-step>
        <Plus size={13} /> Add a step of your own
      </button>
    )
  const save = (): void => {
    if (text.trim()) addStep(id, text)
    setText(null)
  }
  return (
    <div className="pub-new-step">
      <input
        className="text-input"
        autoFocus
        value={text}
        maxLength={120}
        placeholder="e.g. Sources double-checked"
        aria-label="New step"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setText(null)
        }}
        onBlur={save}
      />
    </div>
  )
}

/** A pasted link, or null (with a message) if it isn't one. Empty is fine. */
function checkLink(text: string): string | null {
  const link = text.trim()
  if (link && !/^https?:\/\//i.test(link)) {
    notify('That doesn’t look like a link. Paste the video’s address from YouTube, or leave it empty.', 'info')
    return null
  }
  return link
}

function Uploaded({ d, ready }: { d: VideoDraft; ready: boolean }) {
  const [url, setUrl] = useState('')
  const [on, setOn] = useState(() => dayKeyOf(new Date()))
  const [editing, setEditing] = useState(false)
  if (d.uploaded) {
    const up = d.uploaded
    const saveLink = (): void => {
      const link = checkLink(url)
      if (link === null) return
      if (link !== up.url) void markUploaded(d.id, { ...up, url: link })
      setEditing(false)
    }
    return (
      <div className="pub-uploaded done" data-pub-uploaded>
        <CircleCheck size={18} />
        <span>
          Uploaded {formatDate(new Date(`${up.on}T12:00`), 'ddd D MMM YYYY')}
          {up.url && !editing && (
            <>
              {' · '}
              <button className="link-button" onClick={() => openLink(up.url, '')}>
                Open on YouTube <ExternalLink size={12} />
              </button>
            </>
          )}
        </span>
        {editing ? (
          <input
            className="text-input pub-uploaded-url"
            autoFocus
            value={url}
            placeholder="Paste its YouTube link"
            aria-label="YouTube link"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveLink()
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={saveLink}
          />
        ) : (
          <button
            className="link-button"
            onClick={() => {
              setUrl(up.url)
              setEditing(true)
            }}
            data-pub-edit-link
          >
            <Link2 size={12} /> {up.url ? 'Change link' : 'Add its link'}
          </button>
        )}
        <button className="link-button" onClick={() => void markUploaded(d.id, null)} title="It isn’t up yet after all">
          <Undo2 size={12} /> Not uploaded
        </button>
      </div>
    )
  }
  const mark = (): void => {
    const link = checkLink(url)
    if (link !== null) void markUploaded(d.id, { on, url: link })
  }
  return (
    <div className={`pub-uploaded ${ready ? 'ready' : ''}`} data-pub-uploaded>
      <span className="pub-uploaded-title">{ready ? 'All done. Upload it!' : 'When it’s up'}</span>
      <input className="text-input pub-uploaded-url" value={url} placeholder="Its YouTube link (optional)" aria-label="YouTube link" onChange={(e) => setUrl(e.target.value)} />
      <input className="text-input pub-uploaded-date" type="date" value={on} aria-label="Upload date" onChange={(e) => e.target.value && setOn(e.target.value)} />
      <button className={`btn ${ready ? 'btn-primary' : ''}`} onClick={mark} data-pub-mark-uploaded>
        Mark as uploaded
      </button>
    </div>
  )
}

/** The set workflow for a video, ending with the boxes to tick in YouTube Studio before it goes up. */
export default function UploadChecklist({ d }: { d: VideoDraft }) {
  const steps = checklist(d)
  const counted = steps.filter((s) => !s.skipped)
  const done = counted.filter((s) => s.done).length
  const ready = readyToUpload(d)
  return (
    <section className="pub-section pub-checklist" data-pub-checklist>
      <header className="pub-section-head">
        <h3>Upload checklist</h3>
        <span className={`pub-hint ${ready ? 'pub-ok' : ''}`}>{ready ? '✓ Ready to upload' : `${done} of ${counted.length} done`}</span>
      </header>
      <div className="pub-checklist-bar" aria-hidden>
        <span style={{ width: `${counted.length ? (done / counted.length) * 100 : 0}%` }} />
      </div>
      <p className="pub-intro">The steps with a dashed box tick themselves when the drafts above are ready.</p>
      {STEP_GROUPS.map((g) => (
        <div key={g.id} className="pub-step-group">
          <h4>{g.label}</h4>
          {steps
            .filter((s) => s.group === g.id)
            .map((s) => (
              <Step key={s.id} d={d} step={s} />
            ))}
          {g.id === 'ready' && <AddStep id={d.id} />}
        </div>
      ))}
      <Uploaded d={d} ready={ready} />
    </section>
  )
}
