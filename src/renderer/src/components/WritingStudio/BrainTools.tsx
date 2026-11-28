import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, Check, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react'
import { allScenes, entityById, newId, READER, type CanonFact, type Entity, type Secret, type Story } from '@shared/writing'
import { canonDifferences, knows, learnsAt, secretGaps, voices, VOICE_MIN_LINES } from '@shared/writingTools'
import { change, openScene, updateEntity, useWriting } from '../../store/writingStudio'

/** The story brain's extra parts: who knows what, the canon drawer, and how each character talks. */

const nameOf = (story: Story, id: string): string => (id === READER ? 'The reader' : (entityById(story, id)?.name ?? 'Someone'))

// ---------- who knows what ----------

export function Secrets({ limit }: { limit: number }) {
  const story = useWriting((s) => s.story)!
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const text = draft.trim()
    if (!text) return
    change('Added a secret', (s) => {
      s.secrets.push({ id: newId(), text: text.slice(0, 300), cues: [], learns: [] })
    })
    setDraft('')
  }
  return (
    <div className="ws-secrets" data-ws-secrets>
      <div className="ws-rel-add">
        <input className="ws-input" placeholder="A secret, like “Rick was bitten”" value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} data-ws-secret-input />
        <button className="btn btn-primary" onClick={add} disabled={!draft.trim()} data-ws-secret-add>
          <Plus size={13} /> Keep track of it
        </button>
      </div>
      {!story.secrets.length && (
        <div className="ws-empty small">
          <EyeOff size={22} />
          <p>Write down a secret, say who knows it and the scene each person finds out in, including the reader. The studio then flags a character acting on it before they know, and shows where the reader knows more than the characters.</p>
        </div>
      )}
      {story.secrets.map((s, i) => (
        <SecretCard key={s.id} story={story} secret={s} limit={limit} i={i} />
      ))}
    </div>
  )
}

function SecretCard({ story, secret, limit, i }: { story: Story; secret: Secret; limit: number; i: number }) {
  const scenes = allScenes(story)
  const chars = story.entities.filter((e) => e.kind === 'character')
  const edit = (fn: (s: Secret) => void, label: string | null = null): void =>
    change(label, (d) => {
      const s = d.secrets.find((x) => x.id === secret.id)
      if (s) fn(s)
    })
  const who = [READER, ...new Set(secret.learns.map((l) => l.who).filter((w) => w !== READER))]
  const gaps = secretGaps(story, secret)
  const orders = useMemo(() => new Map(scenes.map((p) => [p.scene.id, p.order])), [scenes])
  const title = (order: number | null): string => (order === null ? '' : order < 0 ? 'the start' : `“${scenes[order]?.scene.title ?? ''}”`)

  return (
    <article className="ws-secret" style={{ '--i': i } as CSSProperties} data-ws-secret={secret.id}>
      <header>
        <EyeOff size={15} className="ws-secret-icon" />
        <input className="ws-secret-text" defaultValue={secret.text} maxLength={300} onBlur={(e) => e.target.value.trim() && edit((s) => void (s.text = e.target.value.trim()))} aria-label="The secret" />
        <button className="icon-btn" onClick={() => change(`Removed “${secret.text}”`, (d) => void (d.secrets = d.secrets.filter((x) => x.id !== secret.id)))} title="Stop tracking (Ctrl+Z brings it back)">
          <Trash2 size={12} />
        </button>
      </header>
      <label className="ws-field">
        <span>Words that give it away (commas between)</span>
        <input
          className="ws-input"
          defaultValue={secret.cues.join(', ')}
          placeholder="bite, bitten, wound"
          onBlur={(e) => edit((s) => void (s.cues = [...new Set(e.target.value.split(',').map((c) => c.trim()).filter((c) => c.length >= 2))].slice(0, 30)))}
          data-ws-secret-cues
        />
      </label>

      <div className="ws-learns">
        <h4>Who finds out, and when</h4>
        {secret.learns.map((l) => (
          <div key={l.id} className="ws-learn">
            <select className="ws-select" value={l.who} onChange={(e) => edit((s) => void (s.learns.find((x) => x.id === l.id)!.who = e.target.value))} aria-label="Who">
              <option value={READER}>The reader</option>
              {chars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select className="ws-select" value={l.scene} onChange={(e) => edit((s) => void (s.learns.find((x) => x.id === l.id)!.scene = e.target.value))} aria-label="When they find out">
              <option value="">knew from the start</option>
              {scenes.map((p) => (
                <option key={p.scene.id} value={p.scene.id}>
                  finds out in {p.chapter.title} – {p.scene.title}
                </option>
              ))}
            </select>
            <button className="icon-btn" onClick={() => edit((s) => void (s.learns = s.learns.filter((x) => x.id !== l.id)), 'Removed who finds out')} title="Remove">
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          className="link-button"
          onClick={() =>
            edit((s) => {
              const first = !s.learns.length
              s.learns.push({ id: newId(), who: first ? (chars[0]?.id ?? READER) : READER, scene: first ? '' : (useWriting.getState().scene ?? '') })
            })
          }
          data-ws-learn-add
        >
          <Plus size={11} /> Someone finds out…
        </button>
      </div>

      {secret.learns.length > 0 && scenes.length > 0 && (
        <div className="ws-know-grid" style={{ '--cols': scenes.length } as CSSProperties} data-ws-know-grid>
          {who.map((w) => (
            <div key={w} className={`ws-know-row ${w === READER ? 'reader' : ''}`}>
              <span className="ws-know-who">
                {w === READER ? <Eye size={11} /> : null} {nameOf(story, w)}
              </span>
              <div className="ws-know-cells">
                {scenes.map((p, n) => {
                  const k = knows(story, secret, w, p.order, orders)
                  const at = learnsAt(story, secret, w, orders)
                  return (
                    <button
                      key={p.scene.id}
                      className={`ws-know-cell ${k ? 'on' : ''} ${at === p.order ? 'learn' : ''} ${p.order > limit ? 'later' : ''}`}
                      style={{ '--i': n } as CSSProperties}
                      onClick={() => openScene(p.scene.id)}
                      title={`${p.chapter.title} – ${p.scene.title}: ${nameOf(story, w)} ${k ? (at === p.order ? 'finds out here' : 'knows') : 'doesn’t know yet'}`}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {gaps.length > 0 && (
        <ul className="ws-gaps">
          {gaps.map((g) => (
            <li key={g.who} className={g.ahead}>
              {g.ahead === 'reader' ? (
                <>
                  <b>Dramatic irony:</b> the reader knows from {title(g.from)}, and {nameOf(story, g.who)} {g.to === null ? 'never finds out' : `doesn’t until ${title(g.to)}`}.
                </>
              ) : (
                <>
                  <b>A mystery for the reader:</b> {nameOf(story, g.who)} knows from {title(g.from)}, and the reader {g.to === null ? 'never finds out' : `finds out in ${title(g.to)}`}.
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

// ---------- canon ----------

const CANON_IDEAS = ['Eye colour', 'Hair', 'Age', 'Status']

export function CanonDrawer() {
  const story = useWriting((s) => s.story)!
  const canon = story.canon
  const scenes = allScenes(story)
  const chars = story.entities.filter((e) => e.kind === 'character')
  const diffs = canonDifferences(story)
  const editFact = (id: string, fn: (f: CanonFact) => void, label: string | null = null): void =>
    change(label, (d) => {
      const f = d.canon.facts.find((x) => x.id === id)
      if (f) fn(f)
    })
  const addFact = (label: string): void =>
    change(null, (d) => {
      d.canon.facts.push({ id: newId(), entity: useWriting.getState().entity && chars.some((c) => c.id === useWriting.getState().entity) ? useWriting.getState().entity! : (chars[0]?.id ?? ''), label, value: label === 'Status' ? 'dead' : '', changed: false })
    })

  return (
    <div className="ws-canon" data-ws-canon>
      <p className="ws-panel-tip ws-canon-how">
        For fanfic: write down facts from the show or books, like Rick’s eye colour or that someone is dead in canon. Every scene is checked against them as you write, the same way character pages are. Anything you’ve changed on purpose, tick
        “Changed on purpose” and it’s left alone. Your own character page always wins over canon.
      </p>
      <div className="ws-canon-top">
        <label className="ws-field">
          <span>Fanfic of</span>
          <input className="ws-input" defaultValue={canon.source} maxLength={200} placeholder="The Walking Dead (TV)" onBlur={(e) => change(null, (d) => void (d.canon.source = e.target.value.trim()))} data-ws-canon-source />
        </label>
        <label className="ws-field">
          <span>Where your story breaks from canon</span>
          <select className="ws-select" value={canon.splitAt} onChange={(e) => change('Set where the story breaks from canon', (d) => void (d.canon.splitAt = e.target.value))} data-ws-canon-split>
            <option value="">It doesn’t (or not set)</option>
            {scenes.map((p) => (
              <option key={p.scene.id} value={p.scene.id}>
                {p.chapter.title} – {p.scene.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canon.splitAt && (
        <label className="ws-field">
          <span>What changes there</span>
          <input className="ws-input" defaultValue={canon.splitNote} maxLength={1000} placeholder="Glenn survives Negan" onBlur={(e) => change(null, (d) => void (d.canon.splitNote = e.target.value.trim()))} />
        </label>
      )}

      {diffs.length > 0 && (
        <section className="ws-canon-diffs">
          {diffs.map((d) => {
            const f = canon.facts.find((x) => x.id === d.fact)!
            return (
              <div key={d.fact} className="ws-clash">
                <AlertTriangle size={14} />
                <span>
                  <b>{nameOf(story, d.entity)}</b>’s page says {f.label.toLowerCase()} “{d.page}”, canon says “{d.canon}”.
                </span>
                <button className="link-button" onClick={() => editFact(d.fact, (x) => void (x.changed = true), 'Marked a canon fact as changed')}>
                  Changed on purpose
                </button>
                <button
                  className="link-button"
                  onClick={() =>
                    updateEntity(
                      d.entity,
                      (e) => {
                        const p = e.facts.find((x) => x.label.trim().toLowerCase() === f.label.trim().toLowerCase())
                        if (p) p.value = d.canon
                      },
                      'Used the canon fact'
                    )
                  }
                >
                  Use canon
                </button>
              </div>
            )
          })}
        </section>
      )}

      <section className="ws-canon-facts">
        <h3>Canon facts</h3>
        {!canon.facts.length && <p className="ws-panel-empty">None yet. Add one below.</p>}
        {canon.facts.map((f, i) => (
          <div key={f.id} className={`ws-canon-fact ${f.changed ? 'changed' : ''}`} style={{ '--i': i } as CSSProperties} data-ws-canon-fact>
            <select className="ws-select" value={f.entity} onChange={(e) => editFact(f.id, (x) => void (x.entity = e.target.value))} aria-label="Who it’s about">
              <option value="">The world</option>
              {chars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="ws-input" defaultValue={f.label} placeholder="Eye colour" maxLength={80} onBlur={(e) => editFact(f.id, (x) => void (x.label = e.target.value.trim()))} aria-label="What" />
            <input className="ws-input" defaultValue={f.value} placeholder={f.label === 'Status' ? 'dead (season 7)' : 'blue'} maxLength={300} onBlur={(e) => editFact(f.id, (x) => void (x.value = e.target.value.trim()))} aria-label="Canon says" data-ws-canon-value />
            <label className="ws-toggle" title="You've changed this in your story on purpose, so it isn't flagged">
              <input type="checkbox" checked={f.changed} onChange={(e) => editFact(f.id, (x) => void (x.changed = e.target.checked))} />
              <span className="ws-toggle-box">
                <Check size={10} />
              </span>
              Changed on purpose
            </label>
            <button className="icon-btn" onClick={() => change('Removed a canon fact', (d) => void (d.canon.facts = d.canon.facts.filter((x) => x.id !== f.id)))} title="Remove">
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="ws-fact-ideas">
          {CANON_IDEAS.map((idea) => (
            <button key={idea} className="ws-chip-btn" onClick={() => addFact(idea)} data-ws-canon-idea={idea}>
              <Plus size={10} /> {idea === 'Status' ? 'Dead in canon' : idea}
            </button>
          ))}
          <button className="ws-chip-btn" onClick={() => addFact('')}>
            <Plus size={10} /> Something else
          </button>
        </div>
      </section>
    </div>
  )
}

// ---------- voice ----------

const pct = (n: number): string => `${Math.round(n * 100)}%`

/** How a character talks, on their page. */
export function VoiceCard({ entity }: { entity: Entity }) {
  const story = useWriting((s) => s.story)!
  const deferred = useDeferredValue(story)
  const v = useMemo(() => voices(deferred).get(entity.id), [deferred, entity.id])
  return (
    <section className="ws-voice" data-ws-voice>
      <h3>How they talk</h3>
      {!v ? (
        <p className="ws-panel-empty">No lines yet. Dialogue counts as theirs when they’re the one named next to it (“…,” {entity.name.split(' ')[0]} said).</p>
      ) : (
        <>
          <div className="ws-voice-stats">
            <Stat n={v.lines} label="lines" />
            <Stat n={Math.round(v.perLine)} label="words a line" />
            <Stat n={pct(v.questions)} label="are questions" />
            <Stat n={pct(v.exclaims)} label="exclaim!" />
            <Stat n={v.swears ? v.swears.toFixed(1) : '0'} label="swears / 100 words" />
            {v.contractChances > 0 && <Stat n={pct(v.contracts)} label="say “don’t” not “do not”" />}
          </div>
          {v.favourites.length > 0 && (
            <div className="ws-voice-words">
              <span>Says more than anyone:</span>
              {v.favourites.map((w) => (
                <span key={w} className="ws-chip">
                  {w}
                </span>
              ))}
            </div>
          )}
          <p className="ws-panel-tip">
            {v.lines < VOICE_MIN_LINES
              ? `After ${VOICE_MIN_LINES - v.lines} more line${VOICE_MIN_LINES - v.lines === 1 ? '' : 's'}, lines that don’t sound like ${entity.name} get flagged in the Checks panel.`
              : `Lines that don’t sound like ${entity.name} are flagged in the Checks panel as you write.`}
          </p>
        </>
      )}
    </section>
  )
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="ws-stat">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  )
}
