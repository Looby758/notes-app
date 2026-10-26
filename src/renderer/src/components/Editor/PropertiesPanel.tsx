import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Calendar,
  CheckSquare,
  ChevronRight,
  CircleDot,
  Code2,
  ExternalLink,
  Flag,
  Hash,
  Link2,
  List,
  Plus,
  Sigma,
  Type,
  X
} from 'lucide-react'
import {
  kindOf,
  PRIORITY_OPTIONS,
  renameProperty,
  setProperty,
  STATUS_OPTIONS,
  SUGGESTED,
  type PropKind,
  type Property,
  type PropValue
} from '../../lib/properties'
import { allTags } from '../../store/noteIndex'
import { useUI } from '../../store/ui'

interface Props {
  /** null: the note has no properties yet. */
  properties: Property[] | null
  /** Changes the note's text (the panel only ever touches the frontmatter). */
  apply: (change: (text: string) => string) => void
  showRaw: () => void
  /** Reading mode: show the values, without editing. */
  readOnly?: boolean
}

const ICONS: Record<PropKind, typeof Calendar> = {
  date: Calendar,
  tags: Hash,
  list: List,
  status: CircleDot,
  priority: Flag,
  checkbox: CheckSquare,
  number: Sigma,
  link: Link2,
  text: Type
}

/** The form at the top of a note for its properties (frontmatter). */
export default function PropertiesPanel({ properties, apply, showRaw, readOnly }: Props) {
  const collapsed = useUI((s) => s.propertiesCollapsed)
  const [adding, setAdding] = useState(false)
  const set = (key: string, value: PropValue | undefined): void => apply((text) => setProperty(text, key, value))

  if (readOnly) return properties?.length ? <ReadOnlyProperties properties={properties} /> : null

  if (!properties) {
    return (
      <div className="props-empty">
        <AddProperty existing={[]} open={adding} setOpen={setAdding} onAdd={set} />
      </div>
    )
  }

  return (
    <div className="props" data-properties>
      <div className="props-head">
        <button className="props-toggle" onClick={() => useUI.setState({ propertiesCollapsed: !collapsed })}>
          <ChevronRight size={13} className={`tree-chevron ${collapsed ? '' : 'open'}`} />
          Properties
          {collapsed && <span className="panel-count">{properties.length}</span>}
        </button>
        <button className="icon-btn props-raw" title="Edit as text" onClick={showRaw}>
          <Code2 size={13} />
        </button>
      </div>
      {!collapsed && (
        <>
          {properties.map((p) => (
            <PropertyRow
              key={p.key}
              prop={p}
              onChange={(v) => set(p.key, v)}
              onRemove={() => set(p.key, undefined)}
              onRename={(to) => apply((text) => renameProperty(text, p.key, to))}
            />
          ))}
          <AddProperty existing={properties.map((p) => p.key)} open={adding} setOpen={setAdding} onAdd={set} />
        </>
      )}
    </div>
  )
}

/** Reading mode: each property as plain text (tags as chips). */
function ReadOnlyProperties({ properties }: { properties: Property[] }) {
  return (
    <div className="props props-readonly" data-properties>
      {properties.map((p) => {
        const kind = kindOf(p)
        const Icon = ICONS[kind]
        const values = Array.isArray(p.value) ? p.value : p.value === null ? [p.raw.split('\n').slice(1).join(' ').trim()] : [p.value]
        return (
          <div className="props-row" data-prop={p.key} key={p.key}>
            <div className="props-key">
              <Icon size={13} className="props-icon" />
              <span className="props-key-text">{p.key}</span>
            </div>
            <div className="props-value">
              {kind === 'tags' || kind === 'list' ? (
                <div className="props-chips">
                  {values.map((v) => (
                    <span key={v} className="props-chip">
                      {kind === 'tags' ? '#' : ''}
                      {v}
                    </span>
                  ))}
                </div>
              ) : kind === 'checkbox' ? (
                <span>{/^true$/i.test(values[0] ?? '') ? 'Yes' : 'No'}</span>
              ) : kind === 'link' ? (
                <a href={values[0]} target="_blank" rel="noreferrer">
                  {values[0]}
                </a>
              ) : (
                <span className={kind === 'status' || kind === 'priority' ? 'props-choice-btn on' : ''} data-value={(values[0] ?? '').replace(/\s+/g, '-')}>
                  {values[0]}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PropertyRow({
  prop,
  onChange,
  onRemove,
  onRename
}: {
  prop: Property
  onChange: (v: PropValue) => void
  onRemove: () => void
  onRename: (to: string) => void
}) {
  const kind = kindOf(prop)
  const Icon = ICONS[kind]
  return (
    <div className="props-row" data-prop={prop.key}>
      <div className="props-key">
        <Icon size={13} className="props-icon" />
        <CommitInput className="props-key-input" value={prop.key} onCommit={(v) => v.trim() && v !== prop.key && onRename(v.trim())} aria-label="Property name" />
      </div>
      <div className="props-value">
        {prop.value === null ? (
          <code className="props-complex" title="Use “Edit as text” to change this one">
            {prop.raw.split('\n').slice(1).join(' ').trim() || prop.raw}
          </code>
        ) : (
          <ValueControl kind={kind} value={prop.value} onChange={onChange} name={prop.key} />
        )}
      </div>
      <button className="icon-btn props-remove" title={`Remove ${prop.key}`} onClick={onRemove}>
        <X size={12} />
      </button>
    </div>
  )
}

function ValueControl({ kind, value, onChange, name }: { kind: PropKind; value: PropValue; onChange: (v: PropValue) => void; name: string }) {
  const text = Array.isArray(value) ? value.join(', ') : value
  const list = Array.isArray(value) ? value : value ? value.split(/,\s*/).filter(Boolean) : []
  switch (kind) {
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$|^$/.test(text) ? (
        <input type="date" className="props-input props-date" value={text} onChange={(e) => onChange(e.target.value)} aria-label={name} />
      ) : (
        <CommitInput className="props-input" value={text} onCommit={onChange} aria-label={name} />
      )
    case 'tags':
      return <Chips items={list} onChange={onChange} prefix="#" suggestions={allTags().map((t) => t.name)} name={name} />
    case 'list':
      return <Chips items={list} onChange={onChange} name={name} />
    case 'status':
      return <Choice value={text} options={STATUS_OPTIONS} onChange={onChange} className="props-status" name={name} />
    case 'priority':
      return <Choice value={text} options={PRIORITY_OPTIONS} onChange={onChange} className="props-priority" name={name} />
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="props-check"
          checked={/^true$/i.test(text)}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          aria-label={name}
        />
      )
    case 'number':
      return <CommitInput className="props-input props-number" value={text} onCommit={onChange} inputMode="decimal" aria-label={name} />
    case 'link':
      return (
        <div className="props-link">
          <CommitInput className="props-input" value={text} onCommit={onChange} aria-label={name} />
          {/^https?:\/\/\S+\.\S+/i.test(text) && (
            <a className="icon-btn" href={text} target="_blank" rel="noreferrer" title="Open in your browser">
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      )
    default:
      return <CommitInput className="props-input" value={text} onCommit={onChange} placeholder="Empty" aria-label={name} />
  }
}

/** A text box that saves when you press Enter or click away (not on every key). Esc undoes. */
function CommitInput({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      {...rest}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** One-click choices (status, priority); any other value already there is kept as an option. */
function Choice({ value, options, onChange, className, name }: { value: string; options: string[]; onChange: (v: string) => void; className: string; name: string }) {
  const all = options.includes(value) || !value ? options : [...options, value]
  return (
    <div className={`props-choice ${className}`} role="radiogroup" aria-label={name}>
      {all.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={o === value}
          className={`props-choice-btn ${o === value ? 'on' : ''}`}
          data-value={o.replace(/\s+/g, '-')}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

/** Chips with × to remove, and a box to add (Enter or comma). Tags get suggestions. */
function Chips({ items, onChange, prefix = '', suggestions, name }: { items: string[]; onChange: (v: string[]) => void; prefix?: string; suggestions?: string[]; name: string }) {
  const [draft, setDraft] = useState('')
  const listId = useRef(`props-sugg-${Math.random().toString(36).slice(2)}`).current
  const add = (raw: string): void => {
    const v = raw.trim().replace(/^#/, '')
    setDraft('')
    if (!v || items.some((i) => i.toLowerCase() === v.toLowerCase())) return
    onChange([...items, v])
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && items.length) {
      onChange(items.slice(0, -1))
    } else if (e.key === 'Escape') {
      setDraft('')
      e.currentTarget.blur()
    }
  }
  const options = suggestions?.filter((s) => !items.some((i) => i.toLowerCase() === s.toLowerCase()))
  return (
    <div className="props-chips" aria-label={name}>
      {items.map((item) => (
        <span key={item} className="props-chip">
          {prefix}
          {item}
          <button title={`Remove ${item}`} onClick={() => onChange(items.filter((i) => i !== item))}>
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        className="props-chip-input"
        value={draft}
        placeholder={items.length ? '' : prefix ? 'Add a tag' : 'Add…'}
        list={options?.length ? listId : undefined}
        spellCheck={false}
        onChange={(e) => {
          // Picking a suggestion from the list adds it straight away.
          const v = e.target.value
          if (options?.includes(v)) add(v)
          else setDraft(v)
        }}
        onKeyDown={onKey}
        onBlur={() => draft && add(draft)}
        aria-label={`Add to ${name}`}
      />
      {options?.length ? (
        <datalist id={listId}>
          {options.slice(0, 50).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}

function AddProperty({
  existing,
  open,
  setOpen,
  onAdd
}: {
  existing: string[]
  open: boolean
  setOpen: (v: boolean) => void
  onAdd: (key: string, value: PropValue) => void
}) {
  const [custom, setCustom] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, setOpen])
  const choices = SUGGESTED.filter((s) => !existing.includes(s.key))
  const addCustom = (): void => {
    const key = custom.trim().replace(/:/g, '')
    if (!key || existing.includes(key)) return
    onAdd(key, '')
    setCustom('')
    setOpen(false)
  }
  let menu: ReactNode = null
  if (open) {
    menu = (
      <div className="menu props-menu">
        {choices.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              onAdd(s.key, s.initial())
              setOpen(false)
            }}
          >
            {s.label}
            <span className="props-menu-key">{s.key}</span>
          </button>
        ))}
        {choices.length > 0 && <div className="menu-sep" />}
        <div className="props-menu-custom">
          <input
            autoFocus
            value={custom}
            placeholder="Other: type a name"
            spellCheck={false}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCustom()
              if (e.key === 'Escape') setOpen(false)
            }}
          />
        </div>
      </div>
    )
  }
  return (
    <div className="props-add" ref={box}>
      <button className="props-add-btn" onClick={() => setOpen(!open)}>
        <Plus size={13} /> Add property
      </button>
      {menu}
    </div>
  )
}
