import { useCallback, useEffect, useMemo, useState } from 'react'
import { Command as CommandIcon, FilePlus, LayoutTemplate, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useVault } from '../../store/vault'
import { usePrefs } from '../../store/prefs'
import { refreshAiStatus, useAi, usesOffline } from '../../store/ai'
import { getNoteText } from '../../store/noteIndex'
import { commands, shortcutFor } from '../../lib/commands'
import { fuzzyFilter } from '../../lib/fuzzy'
import { errorMessage, isWithin, noteTitle, notePaths } from '../../lib/paths'
import { describeCommand, interpretWithAi, parseCommand, runSmart } from '../../lib/smartCommands'
import type { SmartAction } from '../../lib/smartParse'
import { notify } from '../../store/notify'
import { EXAMPLE_TEMPLATE, fillTemplate } from '../../lib/templates'
import Picker, { Highlighted, type PickerItem } from './Picker'
import { useNoteItems } from './noteItems'
import ExportDialog from './ExportDialog'
import BulkDialog from './BulkDialog'
import ImportDialog from './ImportDialog'
import AiDialog from '../Ai/AiDialog'
import PlaceDialog from './PlaceDialog'
import { showKeys } from '@shared/platform'

/** Ctrl+P (quick switcher), Ctrl+K (command palette) and "new note from template", shown over the app. */
export default function Modals() {
  const modal = useUI((s) => s.modal)
  const close = useCallback(() => useUI.setState({ modal: null }), [])
  if (!modal) return null
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className={`modal ${modal === 'export' || modal === 'import' || modal === 'ai' ? 'modal-export' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        {modal === 'switcher' && <QuickSwitcher close={close} />}
        {modal === 'commands' && <CommandPalette close={close} />}
        {modal === 'template' && <TemplatePicker close={close} />}
        {modal === 'export' && <ExportDialog close={close} />}
        {modal === 'bulk' && <BulkDialog close={close} />}
        {modal === 'import' && <ImportDialog close={close} />}
        {modal === 'ai' && <AiDialog close={close} />}
        {modal === 'place' && <PlaceDialog close={close} />}
      </div>
    </div>
  )
}

function QuickSwitcher({ close }: { close: () => void }) {
  const [query, setQuery] = useState('')
  const items = useNoteItems(query, close)
  return (
    <Picker
      query={query}
      onQuery={setQuery}
      items={items}
      placeholder="Open a note… (type a new name to create it)"
      onEscape={close}
    />
  )
}

/** Step 1: pick a template. Step 2: name the new note. */
function TemplatePicker({ close }: { close: () => void }) {
  const [query, setQuery] = useState('')
  const [template, setTemplate] = useState<string | null>(null)
  const tree = useVault((s) => s.tree)
  const folder = usePrefs((s) => s.prefs.templatesFolder)
  const templates = useMemo(() => notePaths(tree).filter((p) => folder && isWithin(p, folder)), [tree, folder])

  const createFromTemplate = async (name: string): Promise<void> => {
    close()
    const vault = useVault.getState()
    const dir = vault.targetFolder()
    const target = dir && !isWithin(dir, folder) ? `${dir}/${name}` : name
    const { text, cursor } = fillTemplate(getNoteText(template!) ?? '', { title: name.replace(/\.md$/i, '') })
    await vault.createNoteAt(target, text, cursor)
  }

  const makeExample = async (): Promise<void> => {
    await window.api.createNoteAt(`${folder || 'Templates'}/Meeting`)
    await window.api.writeNote(`${folder || 'Templates'}/Meeting.md`, EXAMPLE_TEMPLATE)
    await useVault.getState().refresh([`${folder || 'Templates'}/Meeting.md`])
  }

  const templateItems = useMemo<PickerItem[]>(
    () =>
      fuzzyFilter(templates, query, (p) => noteTitle(p)).map(({ item: path, positions }) => ({
        id: path,
        icon: <LayoutTemplate size={15} />,
        label: <Highlighted text={noteTitle(path)} positions={positions} />,
        run: () => {
          setTemplate(path)
          setQuery('')
        }
      })),
    [templates, query]
  )

  if (!template) {
    if (templates.length === 0) {
      return (
        <div className="template-empty">
          <LayoutTemplate size={28} strokeWidth={1.4} />
          <p>
            No templates yet. Any note in the <code>{folder || '(top level)'}</code> folder can be used as a template, with
            placeholders like <code>{'{{title}}'}</code>, <code>{'{{date}}'}</code> and <code>{'{{cursor}}'}</code>.
          </p>
          <button className="btn btn-primary" onClick={makeExample}>
            <FilePlus size={15} /> Create an example template
          </button>
        </div>
      )
    }
    return (
      <Picker
        query={query}
        onQuery={setQuery}
        items={templateItems}
        placeholder="Choose a template…"
        empty="No matching templates"
        onEscape={close}
      />
    )
  }

  const name = query.trim()
  const nameItems: PickerItem[] = name
    ? [
        {
          id: 'create',
          icon: <FilePlus size={15} />,
          label: (
            <>
              Create <strong>{name}</strong> from {noteTitle(template)}
            </>
          ),
          run: () => createFromTemplate(name)
        }
      ]
    : []
  return (
    <Picker
      key="name"
      query={query}
      onQuery={setQuery}
      items={nameItems}
      placeholder={`Name the new note (from ${noteTitle(template)})…`}
      empty="Type a name, then press Enter"
      onEscape={() => setTemplate(null)}
    />
  )
}

type AiState = { text: string; state: 'working' } | { text: string; state: 'done'; action: SmartAction } | { text: string; state: 'error'; error: string }

/**
 * Ctrl+K: every command, plus plain sentences ("spent 12 on food", "remind me Friday 5pm call
 * Dave"). What a sentence will do is shown first and only happens when you press Enter. If none
 * of the built-in patterns understand it, you're asked whether to let the AI work it out; nothing
 * is sent until you say yes.
 */
function CommandPalette({ close }: { close: () => void }) {
  const [query, setQuery] = useState(() => useUI.getState().paletteQuery)
  const [ai, setAi] = useState<AiState | null>(null)
  const aiAllowed = usePrefs((s) => s.prefs.smartCommandsAi)
  const offlineAi = useAi((s) => usesOffline(s.status))
  useEffect(() => {
    refreshAiStatus().catch(() => undefined)
  }, [])
  useEffect(() => {
    if (useUI.getState().paletteQuery) useUI.setState({ paletteQuery: '' })
  }, [])

  const run = useCallback(
    (action: SmartAction) => {
      close()
      runSmart(action).catch((err) => notify(err))
    },
    [close]
  )

  const items = useMemo<PickerItem[]>(() => {
    const q = query.trim()
    const smart = q.includes(' ') || /\d/.test(q) ? parseCommand(q) : null
    const matches = fuzzyFilter(commands, query, (c) => c.title).map(({ item: c, positions }) => ({
      id: c.id,
      icon: <CommandIcon size={14} />,
      label: <Highlighted text={c.title} positions={positions} />,
      hint: shortcutFor(c) && <kbd>{showKeys(shortcutFor(c)!)}</kbd>,
      run: () => {
        close()
        c.run()
      }
    }))
    const top: PickerItem[] = []
    if (smart) {
      top.push({ id: 'smart', icon: <Wand2 size={14} />, label: <strong>{describeCommand(smart)}</strong>, hint: <kbd>Enter</kbd>, run: () => run(smart) })
    } else if (ai && ai.text === q) {
      if (ai.state === 'working') top.push({ id: 'ai', icon: <Loader2 size={14} className="spin" />, label: 'Asking the AI what you mean…', run: () => undefined })
      else if (ai.state === 'done') {
        const action = ai.action
        top.push({ id: 'ai', icon: <Sparkles size={14} />, label: <><span className="palette-ai-tag">AI</span> <strong>{describeCommand(action)}</strong></>, hint: <kbd>Enter</kbd>, run: () => run(action) })
      } else top.push({ id: 'ai', icon: <Sparkles size={14} />, label: <span className="palette-ai-error">{ai.error}</span>, run: () => setAi(null) })
    }
    // Words, and nothing understood them: offer the AI, but only send if they pick it.
    const offerAi = !smart && aiAllowed && q.split(/\s+/).length >= 2 && (!ai || ai.text !== q)
    const ask: PickerItem[] = offerAi
      ? [
          {
            id: 'ask-ai',
            icon: <Sparkles size={14} />,
            label: <>Not sure what you mean. <strong>Ask the AI to work it out?</strong></>,
            detail: offlineAi ? 'The offline AI reads it, on this computer' : 'Sends just this sentence to Claude',
            run: () => {
              setAi({ text: q, state: 'working' })
              interpretWithAi(q).then(
                (action) => setAi((cur) => (cur?.text === q ? { text: q, state: 'done', action } : cur)),
                (err) => setAi((cur) => (cur?.text === q ? { text: q, state: 'error', error: errorMessage(err) } : cur))
              )
            }
          }
        ]
      : []
    // Commands that match well stay above the offer; a long sentence rarely matches one on purpose.
    return matches.length && q.split(/\s+/).length < 3 ? [...top, ...matches, ...ask] : [...top, ...ask, ...matches]
  }, [query, close, ai, aiAllowed, offlineAi, run])

  return (
    <Picker
      query={query}
      onQuery={setQuery}
      items={items}
      placeholder="Type a command, or say what you want (“spent 12 on food”, “remind me Friday 5pm…”)"
      empty="No matching commands"
      onEscape={close}
    />
  )
}
