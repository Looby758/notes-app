import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react'
import { Check, Grid3x3, HeartHandshake, Loader2, MessageCircleQuestion, Plus, Sparkles, Trash2, Users, X } from 'lucide-react'
import {
  allScenes,
  buildBrain,
  dateLabel,
  ENTITY_KINDS,
  entityById,
  fingerprint,
  lastOrderOf,
  neverMet,
  newId,
  pairKey,
  relationshipAt,
  sceneText,
  stepsInOrder,
  type Brain,
  type Entity,
  type EntityKind,
  type Story
} from '@shared/writing'
import { notify } from '../../store/notify'
import {
  addEntity,
  addRelationship,
  deleteEntity,
  deleteRelationship,
  openScene,
  updateEntity,
  updateRelationship,
  updateScene,
  useWriting,
  type BrainTab
} from '../../store/writingStudio'
import Segmented from './Segmented'
import { askBrain, scenesNeedingHows, showAiProblem, writeHows } from '../../lib/writingAi'

/**
 * The story brain: a page for every character, location, item, group and event; who has met who;
 * relationships over time; and questions about the story. The "as of" slider rewinds all of it to
 * the end of any chapter.
 */

const TABS: { id: BrainTab; label: string; icon: typeof Users }[] = [
  { id: 'pages', label: 'Pages', icon: Users },
  { id: 'met', label: 'Who has met who', icon: Grid3x3 },
  { id: 'relationships', label: 'Relationships', icon: HeartHandshake },
  { id: 'ask', label: 'Ask the brain', icon: MessageCircleQuestion }
]

function useBrain(): { story: Story; brain: Brain; upTo: number; limit: number } {
  const story = useWriting((s) => s.story)!
  const asOf = useWriting((s) => s.asOf)
  const deferred = useDeferredValue(story)
  const upTo = asOf ?? Infinity
  const brain = useMemo(() => buildBrain(deferred, upTo), [deferred, upTo])
  const limit = asOf === null ? Infinity : lastOrderOf(deferred, asOf)
  return { story, brain, upTo, limit }
}

export default function BrainView() {
  const tab = useWriting((s) => s.brainTab)
  return (
    <div className="ws-brain" data-ws-brain>
      <div className="ws-brain-bar">
        <Segmented className="ws-subtabs" items={TABS} value={tab} onChange={(id) => useWriting.setState({ brainTab: id })} attr="data-ws-brain-tab" />
        <AsOfSlider />
      </div>
      <div className="ws-brain-body" key={tab}>
        {tab === 'pages' && <Pages />}
        {tab === 'met' && <MetGrid />}
        {tab === 'relationships' && <Relationships />}
        {tab === 'ask' && <Ask />}
      </div>
    </div>
  )
}

function AsOfSlider() {
  const story = useWriting((s) => s.story)!
  const asOf = useWriting((s) => s.asOf)
  const n = story.chapters.length
  const value = asOf ?? n
  return (
    <label className={`ws-asof ${asOf !== null ? 'rewound' : ''}`} title="Rewind the brain to the end of a chapter: nothing after it counts" data-ws-asof>
      <span>As of</span>
      <input type="range" min={0} max={n} value={value} onChange={(e) => useWriting.setState({ asOf: Number(e.target.value) >= n ? null : Number(e.target.value) })} />
      <b>{asOf === null ? 'the whole story' : `end of ${story.chapters[asOf]?.title ?? 'chapter'}`}</b>
    </label>
  )
}

const name = (story: Story, id: string): string => entityById(story, id)?.name ?? 'Someone'
const sceneOf = (story: Story, id: string) => allScenes(story).find((p) => p.scene.id === id)

function SceneLink({ story, id, extra }: { story: Story; id: string; extra?: string }) {
  const p = sceneOf(story, id)
  if (!p) return null
  return (
    <button className="ws-scene-link" onClick={() => openScene(id)} title="Open this scene" data-ws-scene-link={id}>
      <span className="ws-scene-link-ch">{p.chapter.title}</span>
      <span className="ws-scene-link-title">{p.scene.title}</span>
      {p.scene.date && <span className="ws-scene-link-date">{dateLabel(p.scene.date)}</span>}
      {extra && <span className="ws-scene-link-extra">{extra}</span>}
    </button>
  )
}

// ---------- pages ----------

function Pages() {
  const { story } = useBrain()
  const selected = useWriting((s) => s.entity)
  const [adding, setAdding] = useState<EntityKind | null>(null)
  const [newName, setNewName] = useState('')
  const entity = selected ? entityById(story, selected) : undefined

  const add = (): void => {
    if (adding && addEntity(adding, newName)) {
      setNewName('')
      setAdding(null)
    }
  }

  return (
    <div className="ws-pages">
      <nav className="ws-entity-list" data-ws-entity-list>
        {ENTITY_KINDS.map((k) => {
          const list = story.entities.filter((e) => e.kind === k.id).sort((a, b) => a.name.localeCompare(b.name))
          return (
            <section key={k.id}>
              <div className="ws-entity-kind">
                <span>
                  {k.emoji} {k.plural}
                </span>
                <button className="icon-btn" onClick={() => setAdding(k.id)} title={`Add a ${k.label.toLowerCase()}`} data-ws-add-entity={k.id}>
                  <Plus size={12} />
                </button>
              </div>
              {adding === k.id && (
                <input
                  className="ws-input"
                  autoFocus
                  value={newName}
                  maxLength={80}
                  placeholder={`${k.label} name`}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => !newName && setAdding(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') add()
                    if (e.key === 'Escape') setAdding(null)
                  }}
                  data-ws-new-entity
                />
              )}
              {list.map((e) => (
                <button key={e.id} className={`ws-entity-row ${e.id === selected ? 'on' : ''}`} onClick={() => useWriting.setState({ entity: e.id })} data-ws-entity={e.id}>
                  {e.name}
                </button>
              ))}
            </section>
          )
        })}
      </nav>
      <div className="ws-entity-page">
        {entity ? (
          <EntityPage key={entity.id} entity={entity} />
        ) : (
          <div className="ws-empty small">
            <h2>A page for everything in your story</h2>
            <p>Add your characters, locations, items, groups and big events. Once they have a page, every scene notices them by name (and by any nicknames you give them), so the brain fills itself in as you write.</p>
          </div>
        )}
      </div>
    </div>
  )
}

const FACT_IDEAS: Record<EntityKind, string[]> = {
  character: ['Eye colour', 'Hair', 'Age', 'Height', 'Secret', 'Wants'],
  location: ['Who runs it', 'Looks like'],
  item: ['Who has it', 'What it does'],
  group: ['Leader', 'Goal'],
  event: ['Who caused it', 'What changed']
}

function EntityPage({ entity }: { entity: Entity }) {
  const { story, brain, limit } = useBrain()
  const kind = ENTITY_KINDS.find((k) => k.id === entity.kind)!
  const [confirm, setConfirm] = useState(false)
  const scenesHere = brain.appearances.get(entity.id) ?? []

  return (
    <article className="ws-entity" data-ws-entity-page={entity.id}>
      <header className="ws-entity-head">
        <span className="ws-entity-emoji">{kind.emoji}</span>
        <input
          className="ws-entity-name"
          defaultValue={entity.name}
          maxLength={80}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== entity.name && updateEntity(entity.id, (x) => void (x.name = e.target.value.trim()), 'Renamed a page')}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Name"
          data-ws-entity-name
        />
        <span className="ws-entity-kind-label">{kind.label}</span>
        {confirm ? (
          <>
            <button className="link-button danger" onClick={() => deleteEntity(entity.id)}>
              Delete page
            </button>
            <button className="icon-btn" onClick={() => setConfirm(false)}>
              <X size={13} />
            </button>
          </>
        ) : (
          <button className="icon-btn" onClick={() => setConfirm(true)} title="Delete this page">
            <Trash2 size={13} />
          </button>
        )}
      </header>

      <label className="ws-field">
        <span>Also called</span>
        <input
          className="ws-input"
          defaultValue={entity.aliases.join(', ')}
          placeholder={entity.kind === 'character' ? 'Nicknames, titles, surname… (commas between)' : 'Other names (commas between)'}
          onBlur={(e) =>
            updateEntity(entity.id, (x) => {
              x.aliases = [...new Set(e.target.value.split(',').map((a) => a.trim()).filter((a) => a.length >= 2))].slice(0, 20)
            })
          }
          data-ws-entity-aliases
        />
      </label>

      <label className="ws-field">
        <span>Notes</span>
        <textarea
          className="ws-input ws-textarea"
          rows={4}
          defaultValue={entity.about}
          placeholder="Anything you want to remember"
          onBlur={(e) => e.target.value !== entity.about && updateEntity(entity.id, (x) => void (x.about = e.target.value))}
          data-ws-entity-about
        />
      </label>

      <section className="ws-facts">
        <h3>Facts</h3>
        {entity.facts.map((f) => (
          <div key={f.id} className="ws-fact">
            <input className="ws-input" defaultValue={f.label} placeholder="What" onBlur={(e) => updateEntity(entity.id, (x) => void (x.facts.find((y) => y.id === f.id)!.label = e.target.value.trim()))} />
            <input
              className="ws-input"
              defaultValue={f.value}
              placeholder="e.g. brown"
              onBlur={(e) => updateEntity(entity.id, (x) => void (x.facts.find((y) => y.id === f.id)!.value = e.target.value.trim()))}
              data-ws-fact-value
            />
            <button className="icon-btn" onClick={() => updateEntity(entity.id, (x) => void (x.facts = x.facts.filter((y) => y.id !== f.id)), 'Removed a fact')} title="Remove">
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="ws-fact-ideas">
          {FACT_IDEAS[entity.kind]
            .filter((idea) => !entity.facts.some((f) => f.label.toLowerCase() === idea.toLowerCase()))
            .map((idea) => (
              <button key={idea} className="ws-chip-btn" onClick={() => updateEntity(entity.id, (x) => void x.facts.push({ id: newId(), label: idea, value: '' }))} data-ws-fact-idea={idea}>
                <Plus size={10} /> {idea}
              </button>
            ))}
          <button className="ws-chip-btn" onClick={() => updateEntity(entity.id, (x) => void x.facts.push({ id: newId(), label: '', value: '' }))}>
            <Plus size={10} /> Something else
          </button>
        </div>
        {entity.kind === 'character' && <p className="ws-panel-tip">Eye colour, hair and age are checked against every scene as you write.</p>}
      </section>

      {entity.kind === 'character' && (
        <label className="ws-field ws-dies">
          <span>Dies in</span>
          <select className="ws-select" value={entity.diesIn ?? ''} onChange={(e) => updateEntity(entity.id, (x) => (e.target.value ? (x.diesIn = e.target.value) : delete x.diesIn), 'Changed when someone dies')}>
            <option value="">Doesn’t die (so far)</option>
            {allScenes(story).map((p) => (
              <option key={p.scene.id} value={p.scene.id}>
                {p.chapter.title} – {p.scene.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {entity.kind === 'character' && <CharacterLinks entity={entity} />}
      {entity.kind === 'location' && <LocationVisitors entity={entity} />}

      <section className="ws-appearances">
        <h3>
          {entity.kind === 'location' ? 'Scenes here or naming it' : 'In these scenes'} <span className="ws-count">{scenesHere.length}</span>
        </h3>
        {!scenesHere.length && <p className="ws-panel-empty">Not named in any scene{limit !== Infinity ? ' yet at this point' : ''}.</p>}
        {scenesHere.map((id) => (
          <SceneLink key={id} story={story} id={id} extra={brain.scenes.find((s) => s.id === id)?.mentioned.includes(entity.id) ? 'mentioned' : undefined} />
        ))}
      </section>
    </article>
  )
}

function CharacterLinks({ entity }: { entity: Entity }) {
  const { story, brain, limit } = useBrain()
  const others = story.entities.filter((e) => e.kind === 'character' && e.id !== entity.id)
  const met = others
    .map((o) => ({ o, scenes: brain.pairs.get(pairKey(entity.id, o.id)) ?? [] }))
    .filter((m) => m.scenes.length)
    .sort((a, b) => b.scenes.length - a.scenes.length)
  const never = others.filter((o) => !brain.pairs.has(pairKey(entity.id, o.id)))
  const rels = story.relationships.filter((r) => r.a === entity.id || r.b === entity.id)
  return (
    <>
      <section className="ws-links">
        <h3>Has met</h3>
        {!met.length && <p className="ws-panel-empty">Nobody yet.</p>}
        {met.map(({ o, scenes }) => (
          <button
            key={o.id}
            className="ws-met-row"
            onClick={() => useWriting.setState({ brainTab: 'met', pair: pairKey(entity.id, o.id) })}
            title="See their scenes together"
          >
            <b>{o.name}</b>
            <span>
              {scenes.length} scene{scenes.length === 1 ? '' : 's'} · first in {sceneOf(story, scenes[0])?.scene.title}
            </span>
          </button>
        ))}
        {never.length > 0 && (
          <p className="ws-never">
            <span>Never met:</span> {never.map((o) => o.name).join(', ')}
          </p>
        )}
      </section>
      {rels.length > 0 && (
        <section className="ws-links">
          <h3>Relationships</h3>
          {rels.map((r) => {
            const now = relationshipAt(story, r, limit)
            return (
              <button key={r.id} className="ws-met-row" onClick={() => useWriting.setState({ brainTab: 'relationships' })}>
                <b>{name(story, r.a === entity.id ? r.b : r.a)}</b>
                <span>{now ? now.label : 'not started yet'}</span>
              </button>
            )
          })}
        </section>
      )}
    </>
  )
}

function LocationVisitors({ entity }: { entity: Entity }) {
  const { story, brain } = useBrain()
  const here = brain.scenes.filter((s) => s.place === entity.id)
  const visitors = new Map<string, number>()
  for (const s of here) for (const c of s.cast) visitors.set(c, (visitors.get(c) ?? 0) + 1)
  return (
    <section className="ws-links">
      <h3>Who’s been here</h3>
      {!visitors.size && <p className="ws-panel-empty">Nobody yet. A scene counts as being here when it names this place more than any other (or you pick it).</p>}
      <div className="ws-chips">
        {[...visitors]
          .sort((a, b) => b[1] - a[1])
          .map(([id, n]) => (
            <button key={id} className="ws-chip" onClick={() => useWriting.setState({ entity: id })}>
              {name(story, id)} <span className="ws-count">{n}</span>
            </button>
          ))}
      </div>
      {here.length > 0 && <h3>Scenes set here</h3>}
      {here.map((s) => (
        <SceneLink key={s.id} story={story} id={s.id} extra={s.cast.map((c) => name(story, c)).join(', ')} />
      ))}
    </section>
  )
}

// ---------- who has met who ----------

function MetGrid() {
  const { story, brain, upTo } = useBrain()
  const pair = useWriting((s) => s.pair)
  const [busy, setBusy] = useState<string | null>(null)
  const chars = story.entities.filter((e) => e.kind === 'character')
  const most = Math.max(1, ...[...brain.pairs.values()].map((v) => v.length))
  const never = neverMet(story, brain)
  const setPair = (p: string | null): void => useWriting.setState({ pair: p })

  const writeAll = async (): Promise<void> => {
    const todo = scenesNeedingHows(story, upTo)
    if (!todo.length) return notify('Every pair already has a note.', 'info')
    let n = 0
    try {
      for (let i = 0; i < todo.length; i++) {
        setBusy(`Reading scene ${i + 1} of ${todo.length}…`)
        n += await writeHows(useWriting.getState().story!, todo[i].scene, todo[i].pairs)
      }
      notify(`Wrote ${n} note${n === 1 ? '' : 's'}. Have a look and tick the ones that are right.`, 'info')
    } catch (err) {
      showAiProblem(err)
    } finally {
      setBusy(null)
    }
  }

  if (chars.length < 2)
    return (
      <div className="ws-empty small">
        <h2>Who has met who</h2>
        <p>Add at least two characters in Pages and this grid shows how many scenes every pair shares, and who has never met.</p>
      </div>
    )

  const [pa, pb] = pair ? pair.split('|') : [null, null]
  return (
    <div className={`ws-met ${pair ? 'with-pair' : ''}`} data-ws-met>
      <div className="ws-met-main">
        <div className="ws-met-top">
          <p>
            {never.length ? (
              <>
                <b>{never.length}</b> pair{never.length === 1 ? ' has' : 's have'} never met: the squares with dashes.
              </>
            ) : (
              'Everyone has met everyone.'
            )}
          </p>
          <button className="btn" onClick={() => void writeAll()} disabled={!!busy} title="The offline AI reads each scene and writes a line on what happens between each pair, for you to check" data-ws-write-hows>
            {busy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} {busy ?? 'Write the “how” notes'}
          </button>
        </div>
        <div className="ws-grid-scroll">
          <table className="ws-grid" data-ws-grid>
            <thead>
              <tr>
                <th />
                {chars.map((c) => (
                  <th key={c.id} className="ws-grid-col">
                    <span>{c.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chars.map((r, ri) => (
                <tr key={r.id}>
                  <th className="ws-grid-row">{r.name}</th>
                  {chars.map((c, ci) => {
                    if (c.id === r.id) return <td key={c.id} className="ws-cell self" />
                    const k = pairKey(r.id, c.id)
                    const n = brain.pairs.get(k)?.length ?? 0
                    return (
                      <td key={c.id} className={`ws-cell ${n ? '' : 'never'} ${pair === k ? 'on' : ''}`} style={{ '--i': ri + ci } as CSSProperties}>
                        <button
                          onClick={() => setPair(pair === k ? null : k)}
                          style={n ? { background: `color-mix(in srgb, var(--accent) ${Math.round(15 + (n / most) * 65)}%, transparent)` } : undefined}
                          title={n ? `${r.name} and ${c.name}: ${n} scene${n === 1 ? '' : 's'} together` : `${r.name} and ${c.name} have never met`}
                          data-ws-cell={k}
                        >
                          {n || ''}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {pair && pa && pb && <PairPanel a={pa} b={pb} onClose={() => setPair(null)} />}
    </div>
  )
}

function PairPanel({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const { story, brain, limit } = useBrain()
  const k = pairKey(a, b)
  const scenes = brain.pairs.get(k) ?? []
  const rel = story.relationships.find((r) => pairKey(r.a, r.b) === k)
  const now = rel ? relationshipAt(story, rel, limit) : null
  const [busy, setBusy] = useState(false)
  const missing = scenes.filter((id) => !sceneOf(story, id)?.scene.hows[k])

  const write = async (): Promise<void> => {
    setBusy(true)
    try {
      for (const id of missing) await writeHows(useWriting.getState().story!, id, [[a, b]])
    } catch (err) {
      showAiProblem(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="ws-pair" data-ws-pair>
      <header>
        <h3>
          {name(story, a)} & {name(story, b)}
        </h3>
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={13} />
        </button>
      </header>
      <p className="ws-pair-sum">
        {scenes.length ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'} together` : 'They’ve never met.'}
        {now && <> · {now.label}</>}
      </p>
      {!rel && scenes.length > 0 && (
        <button
          className="link-button"
          onClick={() => {
            addRelationship(a, b)
            useWriting.setState({ brainTab: 'relationships' })
          }}
        >
          <Plus size={11} /> Track their relationship
        </button>
      )}
      {missing.length > 0 && (
        <button className="btn" onClick={() => void write()} disabled={busy} data-ws-pair-hows>
          {busy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} Write how they interact
        </button>
      )}
      <ol className="ws-pair-scenes">
        {scenes.map((id) => (
          <PairScene key={id} story={story} sceneId={id} k={k} />
        ))}
      </ol>
    </aside>
  )
}

function PairScene({ story, sceneId, k }: { story: Story; sceneId: string; k: string }) {
  const p = sceneOf(story, sceneId)
  const [editing, setEditing] = useState(false)
  if (!p) return null
  const how = p.scene.hows[k]
  const changed = how?.ai && how.of !== fingerprint(sceneText(p.scene))
  const save = (text: string): void =>
    updateScene(sceneId, (s) => {
      if (!text.trim()) delete s.hows[k]
      else s.hows[k] = { text: text.trim().slice(0, 160), ai: false, checked: true, of: fingerprint(sceneText(s)) }
    })
  return (
    <li className="ws-pair-scene" data-ws-pair-scene={sceneId}>
      <SceneLink story={story} id={sceneId} />
      {editing ? (
        <input
          className="ws-input"
          autoFocus
          defaultValue={how?.text ?? ''}
          placeholder="What happens between them here?"
          onBlur={(e) => {
            save(e.target.value)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : how ? (
        <div className={`ws-how ${how.ai && !how.checked ? 'unchecked' : ''}`}>
          <button className="ws-how-text" onClick={() => setEditing(true)} title="Click to change it">
            {how.text}
          </button>
          {how.ai && !how.checked && (
            <>
              <span className="ws-how-tag">{changed ? 'AI · scene changed since' : 'AI · not checked'}</span>
              <button className="icon-btn" onClick={() => updateScene(sceneId, (s) => void (s.hows[k] = { ...s.hows[k], checked: true }))} title="It’s right" data-ws-how-check>
                <Check size={12} />
              </button>
            </>
          )}
        </div>
      ) : (
        <button className="link-button" onClick={() => setEditing(true)}>
          Add a line on how they interact
        </button>
      )}
    </li>
  )
}

// ---------- relationships ----------

function Relationships() {
  const { story, limit } = useBrain()
  const chars = story.entities.filter((e) => e.kind === 'character')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const scenes = allScenes(story)
  const orderOf = new Map(scenes.map((p) => [p.scene.id, p.order]))

  return (
    <div className="ws-rels" data-ws-relationships>
      <div className="ws-rel-add">
        <select className="ws-select" value={a} onChange={(e) => setA(e.target.value)} aria-label="First character">
          <option value="">Someone…</option>
          {chars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span>and</span>
        <select className="ws-select" value={b} onChange={(e) => setB(e.target.value)} aria-label="Second character">
          <option value="">someone else…</option>
          {chars
            .filter((c) => c.id !== a)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <button
          className="btn btn-primary"
          disabled={!a || !b || a === b}
          onClick={() => {
            addRelationship(a, b)
            setA('')
            setB('')
          }}
          data-ws-add-rel
        >
          <Plus size={13} /> Track this relationship
        </button>
      </div>
      {!story.relationships.length && (
        <div className="ws-empty small">
          <p>A relationship here is a history, not one label: strangers in chapter 1, friends by chapter 4, enemies after chapter 9, each linked to the scene where it changed.</p>
        </div>
      )}
      {story.relationships.map((r) => {
        const steps = stepsInOrder(story, r)
        const now = relationshipAt(story, r, limit)
        return (
          <article key={r.id} className="ws-rel" data-ws-rel={r.id}>
            <header>
              <h3>
                {name(story, r.a)} & {name(story, r.b)}
              </h3>
              <span className="ws-rel-now">{now ? now.label : 'not started yet'}</span>
              <button className="icon-btn" onClick={() => deleteRelationship(r.id)} title="Stop tracking (Ctrl+Z brings it back)">
                <Trash2 size={12} />
              </button>
            </header>
            <ol className="ws-rel-steps">
              {steps.map((s) => {
                const later = (orderOf.get(s.scene) ?? 0) > limit
                return (
                  <li key={s.id} className={`${now?.id === s.id ? 'now' : ''} ${later ? 'later' : ''}`}>
                    <input
                      className="ws-input ws-rel-label"
                      defaultValue={s.label}
                      placeholder="Friends"
                      onBlur={(e) => updateRelationship(r.id, (x) => void (x.steps.find((y) => y.id === s.id)!.label = e.target.value.trim()))}
                    />
                    <select className="ws-select" value={s.scene} onChange={(e) => updateRelationship(r.id, (x) => void (x.steps.find((y) => y.id === s.id)!.scene = e.target.value))} aria-label="From which scene">
                      {scenes.map((p) => (
                        <option key={p.scene.id} value={p.scene.id}>
                          from {p.chapter.title} – {p.scene.title}
                        </option>
                      ))}
                    </select>
                    <input
                      className="ws-input ws-rel-note"
                      defaultValue={s.note}
                      placeholder="Why it changed (optional)"
                      onBlur={(e) => updateRelationship(r.id, (x) => void (x.steps.find((y) => y.id === s.id)!.note = e.target.value.trim()))}
                    />
                    <button className="icon-btn" onClick={() => updateRelationship(r.id, (x) => void (x.steps = x.steps.filter((y) => y.id !== s.id)), 'Removed a relationship change')} title="Remove">
                      <X size={12} />
                    </button>
                  </li>
                )
              })}
            </ol>
            <button
              className="link-button"
              onClick={() =>
                updateRelationship(r.id, (x) =>
                  void x.steps.push({ id: newId(), scene: useWriting.getState().scene ?? scenes[scenes.length - 1].scene.id, label: x.steps.length ? '' : 'Strangers', note: '' })
                )
              }
              data-ws-add-step
            >
              <Plus size={11} /> It changes…
            </button>
          </article>
        )
      })}
    </div>
  )
}

// ---------- ask ----------

function Ask() {
  const { story, upTo } = useBrain()
  const asOf = useWriting((s) => s.asOf)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{ q: string; parts: Awaited<ReturnType<typeof askBrain>> } | null>(null)

  const ask = async (): Promise<void> => {
    const question = q.trim()
    if (!question) return
    setBusy(true)
    try {
      setAnswer({ q: question, parts: await askBrain(story, question, upTo) })
    } catch (err) {
      showAiProblem(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ws-ask" data-ws-ask>
      <p className="ws-panel-tip">
        Ask anything about your story, like “When did Mara last see her brother?”. Answers link to the scenes. It runs on the offline AI, so your story stays on this computer
        {asOf !== null ? `, and it only knows what’s happened by the end of ${story.chapters[asOf]?.title}` : ''}.
      </p>
      <div className="ws-ask-row">
        <input
          className="ws-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void ask()}
          placeholder="Ask the brain…"
          data-ws-ask-input
        />
        <button className="btn btn-primary" onClick={() => void ask()} disabled={busy || !q.trim()} data-ws-ask-go>
          {busy ? <Loader2 size={13} className="spin" /> : <MessageCircleQuestion size={13} />} Ask
        </button>
      </div>
      {answer && (
        <div className="ws-answer" data-ws-answer>
          <p className="ws-answer-q">{answer.q}</p>
          <p className="ws-answer-text">
            {answer.parts.map((p, i) =>
              'scene' in p ? (
                <button key={i} className="ws-answer-link" onClick={() => openScene(p.scene)} title={sceneOf(story, p.scene)?.scene.title}>
                  {sceneOf(story, p.scene)?.scene.title ?? p.label}
                </button>
              ) : (
                <span key={i}>{p.text}</span>
              )
            )}
          </p>
        </div>
      )}
    </div>
  )
}
