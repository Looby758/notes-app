import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Upload, X } from 'lucide-react'
import { activeThemeId, allThemes, getTheme, type Theme } from '@shared/themes'
import { pictureFor, themeFileUrl } from '@shared/themePack'
import { importTheme, removeTheme, useThemes } from '../../store/themes'
import { DEFAULT_PREFS, type Prefs } from '@shared/prefs'
import { SYSTEM_NAME } from '@shared/platform'
import { setPrefs, usePrefs } from '../../store/prefs'
import { ACCENT_SWATCHES, type SettingDef } from '../../lib/settingsSchema'
import { listFonts } from '../../lib/fonts'

const set = (key: keyof Prefs, value: unknown): void => setPrefs({ [key]: value } as Partial<Prefs>)

const FONT_VARS: Partial<Record<keyof Prefs, string>> = {
  editorFont: 'var(--font-editor)',
  uiFont: 'var(--font-ui)',
  codeFont: 'var(--font-mono)'
}

const APP_ICONS: [string, string][] = [
  ['default', 'Orbit'],
  ['green', 'Green'],
  ['forest', 'Forest'],
  ['ocean', 'Ocean'],
  ['sunset', 'Sunset'],
  ['light', 'Paper'],
  ['midnight', 'Midnight']
]

function AppIconPicker({ value }: { value: string }) {
  return (
    <div className="app-icons" role="radiogroup" aria-label="App icon">
      {APP_ICONS.map(([id, label]) => (
        <button key={id} role="radio" aria-checked={value === id} className={`app-icon ${value === id ? 'on' : ''}`} onClick={() => set('appIcon', id)} data-app-icon={id}>
          <img src={`./icons/${id}.png`} alt="" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

/** The input for one setting, chosen by its type. */
export function SettingControl({ def }: { def: SettingDef }) {
  const value = usePrefs((s) => s.prefs[def.key])

  switch (def.type) {
    case 'toggle':
      return (
        <button
          role="switch"
          aria-checked={!!value}
          aria-label={def.label}
          className={`switch ${value ? 'on' : ''}`}
          onClick={() => set(def.key, !value)}
        >
          <span className="switch-knob" />
        </button>
      )

    case 'choice':
      return (
        <div className="segmented" role="radiogroup" aria-label={def.label}>
          {def.options.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={String(value) === o.value}
              className={String(value) === o.value ? 'selected' : ''}
              onClick={() => set(def.key, typeof DEFAULT_PREFS[def.key] === 'number' ? Number(o.value) : o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )

    case 'slider':
      return (
        <div className="slider">
          <input
            type="range"
            aria-label={def.label}
            min={def.min}
            max={def.max}
            step={def.step}
            value={value as number}
            onChange={(e) => set(def.key, Number(e.target.value))}
          />
          <span className="slider-value">{def.format(value as number)}</span>
        </div>
      )

    case 'theme':
      return <ThemePicker />

    case 'appIcon':
      return <AppIconPicker value={String(value)} />

    case 'color':
      return <AccentPicker />

    case 'font':
      return <FontPicker def={def} value={value as string} />

    case 'language':
      return <LanguagePicker value={value as string} />

    case 'folder':
      return <FolderInput def={def} value={value as string} />

    case 'text':
      return <TextInput def={def} value={value as string} />
  }
}

/** A short text setting; saved on Enter or when you leave the box (invalid values are refused). */
function TextInput({ def, value }: { def: Extract<SettingDef, { type: 'text' }>; value: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    if (draft.trim() && draft.trim() !== value) set(def.key, draft.trim())
    else setDraft(value)
  }
  return (
    <div className="text-setting">
      <input
        className="text-input"
        value={draft}
        placeholder={def.placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(value)
        }}
        aria-label={def.label}
      />
      {def.preview && <span className="text-preview">{def.preview(draft)}</span>}
    </div>
  )
}

/** A folder path inside the vault; saved on Enter or when you leave the box. */
function FolderInput({ def, value }: { def: Extract<SettingDef, { type: 'folder' }>; value: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    const next = draft.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (next !== value) set(def.key, next)
    else setDraft(value)
  }
  return (
    <div className="folder-input">
      <span className="folder-prefix">{def.prefix ?? 'Notes folder /'}</span>
      <input
        value={draft}
        placeholder={def.placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(value)
        }}
        aria-label={def.label}
      />
    </div>
  )
}

function ThemePicker() {
  const p = usePrefs((s) => s.prefs)
  useThemes((s) => s.themes) // redraw when a theme is imported or removed
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  // Matching the system: a light and a dark theme are both chosen, one from each group.
  const chosen = (id: string, light: boolean): boolean => (p.followSystem ? (light ? p.lightTheme : p.darkTheme) === id : p.theme === id)
  const pick = (id: string, light: boolean): void => {
    if (!p.followSystem) set('theme', id)
    else set(light ? 'lightTheme' : 'darkTheme', id)
  }
  const doImport = async (): Promise<void> => {
    const result = await importTheme()
    if (result.error) setMessage({ text: `Couldn’t import that theme: ${result.error}`, error: true })
    if (result.theme) {
      setMessage({ text: `Imported ${result.theme.name}.` })
      pick(result.theme.id, !!result.theme.light)
    }
  }
  const remove = async (t: Theme): Promise<void> => {
    const ok = await window.api.confirm({ message: `Remove the ${t.name} theme?`, detail: 'You can import its theme file again later.', ok: 'Remove' })
    if (!ok) return
    await removeTheme(t.id)
    setMessage({ text: `Removed ${t.name}.` })
  }
  const group = (light: boolean) => (
    <div className="theme-grid" data-theme-group={light ? 'light' : 'dark'}>
      {allThemes()
        .filter((t) => !!t.light === light)
        .map((t) => {
          const c = t.colors
          const on = chosen(t.id, light)
          const picture = pictureFor(t.pack, 'home') ?? (t.pack?.loading?.picture ? { file: t.pack.loading.picture, position: 'center' } : undefined)
          return (
            <div key={t.id} className="theme-card-wrap">
              <button className={`theme-card ${on ? 'selected' : ''}`} onClick={() => pick(t.id, light)} aria-pressed={on} data-theme-id={t.id}>
                {/* A tiny picture of the app in this theme */}
                <span className="theme-preview" style={{ background: c.bg, borderColor: c.border }}>
                  <span className="theme-preview-side" style={{ background: c.bgPanel, borderColor: c.border }}>
                    <span style={{ background: c.textFaint }} />
                    <span style={{ background: p.accent || t.accent }} />
                    <span style={{ background: c.textFaint }} />
                  </span>
                  <span className="theme-preview-main">
                    {picture && (
                      <span
                        className="theme-preview-picture"
                        style={{ backgroundImage: `url("${themeFileUrl(t.id, picture.file)}")`, backgroundPosition: picture.position }}
                      />
                    )}
                    <span style={{ background: c.textStrong, width: '55%', height: 5 }} />
                    <span style={{ background: c.textMuted }} />
                    <span style={{ background: p.accent || t.accent, width: '35%' }} />
                    <span style={{ background: c.textMuted, width: '70%' }} />
                  </span>
                </span>
                <span className="theme-name">
                  {on && <Check size={12} />}
                  {t.name}
                </span>
              </button>
              {t.pack && (
                <button className="theme-remove" onClick={() => remove(t)} title={`Remove ${t.name}`} aria-label={`Remove ${t.name}`}>
                  <X size={11} />
                </button>
              )}
            </div>
          )
        })}
    </div>
  )
  return (
    <div className="theme-groups">
      <span className="theme-group-label">Dark{p.followSystem && ' (when your system is in dark mode)'}</span>
      {group(false)}
      <span className="theme-group-label">Light{p.followSystem && ' (when your system is in light mode)'}</span>
      {group(true)}
      <div className="theme-import">
        <button className="btn" onClick={doImport} data-theme-import>
          <Upload size={13} /> Import a theme…
        </button>
        <span className="theme-import-hint">
          {message ? <span className={message.error ? 'theme-import-error' : ''}>{message.text}</span> : 'A theme file (.notestheme) can change the colours, fonts, pictures and icons.'}
        </span>
      </div>
    </div>
  )
}
function AccentPicker() {
  const accent = usePrefs((s) => s.prefs.accent)
  // The theme showing now (matching the system picks your light or dark one).
  const themeId = usePrefs((s) => activeThemeId(s.prefs, window.matchMedia('(prefers-color-scheme: dark)').matches))
  const themeAccent = getTheme(themeId).accent ?? ACCENT_SWATCHES[0]
  const current = accent || themeAccent
  return (
    <div className="accent-picker">
      <button
        className={`swatch theme-default ${accent === '' ? 'selected' : ''}`}
        style={{ ['--swatch' as string]: themeAccent }}
        onClick={() => set('accent', '')}
        title="Use the theme's accent"
      >
        Theme
      </button>
      {ACCENT_SWATCHES.map((c) => (
        <button
          key={c}
          className={`swatch ${accent === c ? 'selected' : ''}`}
          style={{ ['--swatch' as string]: c }}
          onClick={() => set('accent', c)}
          title={c}
          aria-label={`Accent ${c}`}
        />
      ))}
      <label className="swatch custom" title="Pick any colour" style={{ ['--swatch' as string]: current }}>
        <input type="color" value={current} onChange={(e) => set('accent', e.target.value)} aria-label="Custom accent colour" />
        +
      </label>
    </div>
  )
}

/**
 * A searchable font dropdown. (The browser's built-in <datalist> doesn't scroll reliably in
 * Electron, so this draws its own list.) Each font is shown in its own typeface.
 */
function FontPicker({ def, value }: { def: Extract<SettingDef, { type: 'font' }>; value: string }) {
  const [fonts, setFonts] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listFonts().then(setFonts)
  }, [])

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const q = query.trim().toLowerCase()
  // '' stands for "Default"; a typed name that isn't installed can still be used.
  const options = ['', ...fonts.filter((f) => f.toLowerCase().includes(q))]
  if (q && !fonts.some((f) => f.toLowerCase() === q)) options.push(query.trim())

  useEffect(() => setHighlight(0), [query])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const choose = (font: string): void => {
    if (font !== value) set(def.key, font)
    setOpen(false)
    setQuery('')
    input.current?.blur()
  }

  const openList = (): void => {
    setOpen(true)
    setQuery('')
    // Start with the current font highlighted.
    setTimeout(() => setHighlight(Math.max(0, ['', ...fonts].indexOf(value))))
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault()
      openList()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(options[highlight] ?? value)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className="font-picker" ref={root}>
      <div className={`font-input ${open ? 'open' : ''}`} onMouseDown={(e) => {
        if (e.target === input.current) return
        e.preventDefault()
        if (open) setOpen(false)
        else {
          input.current?.focus()
          openList()
        }
      }}>
        <input
          ref={input}
          value={open ? query : value || ''}
          placeholder={open ? 'Type to filter…' : 'Default'}
          spellCheck={false}
          style={{ fontFamily: !open && value ? `'${value}', var(--font-ui)` : undefined }}
          onFocus={() => !open && openList()}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          aria-label={def.label}
          aria-expanded={open}
          role="combobox"
        />
        {value && !open && (
          <button
            className="icon-btn"
            title="Use the default font"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => choose('')}
          >
            <X size={13} />
          </button>
        )}
        <ChevronDown size={14} className="font-chevron" />
      </div>

      {open && (
        <div className="font-list" ref={list} role="listbox">
          {options.map((font, i) => (
            <button
              key={font || '__default'}
              data-index={i}
              role="option"
              aria-selected={font === value}
              className={`font-option ${i === highlight ? 'highlight' : ''} ${font === value ? 'current' : ''}`}
              style={{ fontFamily: font ? `'${font}', var(--font-ui)` : undefined }}
              onMouseMove={() => i !== highlight && setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(font)}
            >
              {font === value && <Check size={12} />}
              <span>{font || 'Default'}</span>
              {font && !fonts.includes(font) && <span className="font-option-note">not installed</span>}
            </button>
          ))}
        </div>
      )}

      {/* The CSS variable already reflects this setting (or its default), fallbacks included. */}
      <div className="font-sample" style={{ fontFamily: FONT_VARS[def.key] }}>
        {def.sample}
      </div>
    </div>
  )
}

function LanguagePicker({ value }: { value: string }) {
  const [languages, setLanguages] = useState<string[]>([])
  useEffect(() => {
    window.api.spellcheckLanguages().then((langs) => setLanguages([...langs].sort()))
  }, [])
  const names = new Intl.DisplayNames(undefined, { type: 'language' })
  const label = (code: string): string => {
    try {
      return `${names.of(code)} (${code})`
    } catch {
      return code
    }
  }
  return (
    <select className="select" value={value} onChange={(e) => set('spellcheckLanguage', e.target.value)} aria-label="Spelling language">
      <option value="">{SYSTEM_NAME} default</option>
      {languages.map((l) => (
        <option key={l} value={l}>
          {label(l)}
        </option>
      ))}
    </select>
  )
}
