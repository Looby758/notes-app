import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Search } from 'lucide-react'

export interface PickerItem {
  id: string
  label: ReactNode
  detail?: ReactNode
  /** Right-aligned, e.g. a keyboard shortcut. */
  hint?: ReactNode
  icon?: ReactNode
  run: () => void
}

interface Props {
  query: string
  onQuery: (q: string) => void
  items: PickerItem[]
  placeholder: string
  empty?: ReactNode
  onEscape?: () => void
  autoFocus?: boolean
}

/** A search box with a keyboard-driven list under it (↑ ↓ to move, Enter to pick). */
export default function Picker({ query, onQuery, items, placeholder, empty, onEscape, autoFocus = true }: Props) {
  const [selected, setSelected] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(0), [query])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[selected]?.run()
    } else if (e.key === 'Escape' && onEscape) {
      e.preventDefault()
      onEscape()
    }
  }

  return (
    <div className="picker">
      <div className="picker-input">
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
        />
      </div>
      <div className="picker-list" ref={list}>
        {items.length === 0 && empty && <div className="picker-empty">{empty}</div>}
        {items.map((item, i) => (
          <button
            key={item.id}
            data-index={i}
            className={`picker-item ${i === selected ? 'selected' : ''}`}
            onMouseMove={() => i !== selected && setSelected(i)}
            onMouseDown={(e) => e.preventDefault()} // keep focus in the input
            onClick={() => item.run()}
          >
            {item.icon && <span className="picker-icon">{item.icon}</span>}
            <span className="picker-label">{item.label}</span>
            {item.detail && <span className="picker-detail">{item.detail}</span>}
            {item.hint && <span className="picker-hint">{item.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Renders text with the fuzzy-matched characters highlighted. */
export function Highlighted({ text, positions, offset = 0 }: { text: string; positions: number[]; offset?: number }) {
  const set = new Set(positions.map((p) => p - offset))
  const parts: ReactNode[] = []
  let run = ''
  let inMatch = false
  const flush = (key: number): void => {
    if (!run) return
    parts.push(inMatch ? <mark key={key}>{run}</mark> : run)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i)
    if (m !== inMatch) {
      flush(i)
      inMatch = m
    }
    run += text[i]
  }
  flush(text.length)
  return <>{parts}</>
}
