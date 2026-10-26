import { useCallback, useMemo, useState } from 'react'
import { Command as CommandIcon, FilePlus, LayoutTemplate } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useVault } from '../../store/vault'
import { usePrefs } from '../../store/prefs'
import { getNoteText } from '../../store/noteIndex'
import { commands, shortcutFor } from '../../lib/commands'
import { fuzzyFilter } from '../../lib/fuzzy'
import { isWithin, noteTitle, notePaths } from '../../lib/paths'
import { EXAMPLE_TEMPLATE, fillTemplate } from '../../lib/templates'
import Picker, { Highlighted, type PickerItem } from './Picker'
import { useNoteItems } from './noteItems'
import { showKeys } from '@shared/platform'

/** Ctrl+P (quick switcher), Ctrl+K (command palette) and "new note from template", shown over the app. */
export default function Modals() {
  const modal = useUI((s) => s.modal)
  const close = useCallback(() => useUI.setState({ modal: null }), [])
  if (!modal) return null
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        {modal === 'switcher' && <QuickSwitcher close={close} />}
        {modal === 'commands' && <CommandPalette close={close} />}
        {modal === 'template' && <TemplatePicker close={close} />}
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

function CommandPalette({ close }: { close: () => void }) {
  const [query, setQuery] = useState('')
  const items = useMemo<PickerItem[]>(
    () =>
      fuzzyFilter(commands, query, (c) => c.title).map(({ item: c, positions }) => ({
        id: c.id,
        icon: <CommandIcon size={14} />,
        label: <Highlighted text={c.title} positions={positions} />,
        hint: shortcutFor(c) && <kbd>{showKeys(shortcutFor(c)!)}</kbd>,
        run: () => {
          close()
          c.run()
        }
      })),
    [query, close]
  )
  return (
    <Picker
      query={query}
      onQuery={setQuery}
      items={items}
      placeholder="Type a command…"
      empty="No matching commands"
      onEscape={close}
    />
  )
}
