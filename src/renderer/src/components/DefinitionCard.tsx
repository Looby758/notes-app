import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { POS_NAMES, type DictionaryEntry } from '@shared/dictionary'
import { menuTarget, replaceMenuWord } from '../lib/dictionary'

const FIRST = 6
const MAX_HEIGHT = 460

/** Every meaning of a word you right-clicked, with examples and synonyms (click one to use it). */
export default function DefinitionCard() {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null)
  const [all, setAll] = useState(false)
  const [at, setAt] = useState({ x: 0, y: 0 })
  const [editable, setEditable] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      window.api.onShowDefinition((e) => {
        const target = menuTarget()
        setAt({ x: target?.x ?? window.innerWidth / 2 - 180, y: target?.y ?? 120 })
        setEditable(!!target && !target.view.state.readOnly)
        setAll(false)
        setEntry(e)
      }),
    []
  )

  // Under where you clicked, or above it if there's more room there; never over the word.
  const [pos, setPos] = useState<{ x: number; y: number; maxHeight?: number }>(at)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width } = el.getBoundingClientRect()
    // Its full height (the list scrolls when it's cut short), up to the most it's ever shown at.
    const body = el.querySelector('.definition-body')!
    const height = Math.min(MAX_HEIGHT, el.offsetHeight - body.clientHeight + body.scrollHeight)
    const x = Math.max(8, Math.min(at.x - 24, window.innerWidth - width - 8))
    const below = window.innerHeight - at.y - 22
    const above = at.y - 18
    if (height <= below || below >= above) setPos({ x, y: at.y + 14, maxHeight: Math.min(MAX_HEIGHT, below) })
    else setPos({ x, y: Math.max(8, at.y - 10 - Math.min(height, above)), maxHeight: Math.min(MAX_HEIGHT, above) })
  }, [at, entry, all])

  useEffect(() => {
    if (!entry) return
    const close = (): void => setEntry(null)
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [entry])

  if (!entry) return null
  const senses = all ? entry.senses : entry.senses.slice(0, FIRST)
  // Grouped by part of speech, in the order they first come up.
  const groups = [...new Set(senses.map((s) => s.pos))].map((pos) => ({ pos, senses: senses.filter((s) => s.pos === pos) }))

  return (
    <div ref={ref} className="definition-card" style={{ left: pos.x, top: pos.y, maxHeight: pos.maxHeight }} role="dialog" aria-label={`Meaning of ${entry.lemma}`} data-definition-card>
      <header>
        <BookOpen size={15} className="definition-icon" />
        <h2>{entry.lemma}</h2>
        {entry.word.toLowerCase() !== entry.lemma && <span className="definition-from">from “{entry.word}”</span>}
        <button className="icon-btn" title="Close" onClick={() => setEntry(null)}>
          <X size={14} />
        </button>
      </header>
      <div className="definition-body">
        {groups.map((g) => (
          <section key={g.pos}>
            <h3>{POS_NAMES[g.pos]}</h3>
            <ol>
              {g.senses.map((s, i) => (
                <li key={i}>
                  <div>{s.definition}</div>
                  {s.examples.slice(0, 2).map((ex) => (
                    <div key={ex} className="definition-example">
                      “{ex}”
                    </div>
                  ))}
                  {s.synonyms.length > 0 && (
                    <div className="definition-synonyms">
                      {s.synonyms.slice(0, 8).map((syn) =>
                        editable && syn.replacement ? (
                          <button
                            key={syn.word}
                            title={`Use “${syn.replacement}” instead`}
                            onClick={() => {
                              replaceMenuWord(syn.replacement!)
                              setEntry(null)
                            }}
                          >
                            {syn.word}
                          </button>
                        ) : (
                          <span key={syn.word}>{syn.word}</span>
                        )
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
        {!all && entry.senses.length > FIRST && (
          <button className="definition-more" onClick={() => setAll(true)}>
            Show all {entry.senses.length} meanings
          </button>
        )}
      </div>
      <footer>From WordNet, Princeton University</footer>
    </div>
  )
}
