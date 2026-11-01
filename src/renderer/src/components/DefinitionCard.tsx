import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, Cpu, Loader2, X } from 'lucide-react'
import { POS_NAMES, type DictionaryEntry } from '@shared/dictionary'
import { sentenceAround } from '@shared/localAi'
import { menuTarget, replaceMenuWord } from '../lib/dictionary'
import { errorMessage } from '../lib/paths'

/** The sentence the right-clicked word is in, from the note around it. */
function targetSentence(): string | null {
  const t = menuTarget()
  if (!t) return null
  const doc = t.view.state.doc
  const start = Math.max(0, t.from - 1000)
  const text = doc.sliceString(start, Math.min(doc.length, t.to + 1000))
  return sentenceAround(text, t.from - start, t.to - start)
}

/** "In this sentence": the offline AI explains the word as it's used here. Only runs when you press the button. */
function InContext({ word, sentence }: { word: string; sentence: string }) {
  const [state, setState] = useState<{ working?: boolean; text?: string; error?: string }>({})
  const explain = (): void => {
    setState({ working: true })
    window.api.aiMeaning(word, sentence).then(
      (text) => setState({ text }),
      (err) => setState({ error: errorMessage(err) })
    )
  }
  return (
    <section className="definition-context" data-definition-context>
      <h3>In this sentence</h3>
      {state.text ? (
        <div data-definition-context-text>{state.text}</div>
      ) : state.error ? (
        <div className="setting-warning">{state.error}</div>
      ) : (
        <button className="definition-more" disabled={state.working} onClick={explain} title="The offline AI reads this sentence, on this computer" data-definition-explain>
          {state.working ? <Loader2 size={12} className="spin" /> : <Cpu size={12} />} {state.working ? 'Thinking…' : 'Explain it as it’s used here'}
        </button>
      )}
    </section>
  )
}

const FIRST = 6
const MAX_HEIGHT = 460

/** Every meaning of a word you right-clicked, with examples and synonyms (click one to use it). */
export default function DefinitionCard() {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null)
  const [all, setAll] = useState(false)
  const [at, setAt] = useState({ x: 0, y: 0 })
  const [editable, setEditable] = useState(false)
  const [sentence, setSentence] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      window.api.onShowDefinition((e) => {
        const target = menuTarget()
        setAt({ x: target?.x ?? window.innerWidth / 2 - 180, y: target?.y ?? 120 })
        setEditable(!!target && !target.view.state.readOnly)
        setAll(false)
        setEntry(e)
        setSentence(null)
        // Only offered when the offline AI is here (it never runs until the button is pressed).
        const words = targetSentence()
        if (words && words.split(/\s+/).length > 2) {
          window.api.localAiState().then(
            (s) => s.state === 'ready' && setSentence(words),
            () => undefined
          )
        }
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
        {sentence && <InContext key={`${entry.word}:${sentence}`} word={entry.word} sentence={sentence} />}
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
