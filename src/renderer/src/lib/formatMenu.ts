import type { PopupMenuItem } from '@shared/types'
import { EDITOR_COMMANDS, HIGHLIGHT_COLOURS } from '../components/Editor/formatting'
import { effectiveShortcut, usePrefs } from '../store/prefs'
import { runEditorCommand } from './editorController'

/** The Format menu: on a note's right-click menu when text is selected, and behind the toolbar's buttons. */

const capital = (s: string): string => s[0].toUpperCase() + s.slice(1)

function item(id: string, label?: string): PopupMenuItem {
  const cmd = EDITOR_COMMANDS.find((c) => c.id === id)!
  return { id, label: label ?? cmd.title, accelerator: effectiveShortcut(id, cmd.shortcut) ?? undefined }
}

export const highlightMenu = (): PopupMenuItem[] => [item('format.highlight', 'Yellow'), ...HIGHLIGHT_COLOURS.map((c) => item(`format.highlight.${c}`, capital(c)))]

export const linkMenu = (): PopupMenuItem[] => [item('format.linkNote', 'To a note  [[ ]]'), item('format.linkWeb', 'Web link…')]

export const turnIntoMenu = (): PopupMenuItem[] => [
  item('format.h1'),
  item('format.h2'),
  item('format.h3'),
  'separator',
  item('format.bullet'),
  item('format.numbered'),
  item('format.checklist'),
  'separator',
  item('format.quote'),
  item('format.callout')
]

export function formatMenu(): PopupMenuItem[] {
  return [
    item('format.bold'),
    item('format.italic'),
    item('format.strike'),
    item('format.code'),
    { label: 'Highlight', submenu: highlightMenu() },
    { label: 'Link', submenu: linkMenu() },
    { label: 'Turn into', submenu: turnIntoMenu() },
    item('format.clear')
  ]
}

/** Pops up a menu under an element; runs the chosen formatting command. */
export async function popupFormat(items: PopupMenuItem[], anchor: HTMLElement): Promise<void> {
  const r = anchor.getBoundingClientRect()
  const id = await window.api.popupMenu(items, r.left, r.bottom + 2)
  if (id) runEditorCommand(id)
}

/** Keeps the main process's copy of the menu (with your shortcuts) current, and runs its picks. */
export function startFormatMenu(): () => void {
  window.api.setFormatMenu(formatMenu())
  let shortcuts = usePrefs.getState().prefs.shortcuts
  const offPrefs = usePrefs.subscribe(({ prefs }) => {
    if (prefs.shortcuts === shortcuts) return
    shortcuts = prefs.shortcuts
    window.api.setFormatMenu(formatMenu())
  })
  const offFormat = window.api.onFormat((id) => runEditorCommand(id))
  return () => {
    offPrefs()
    offFormat()
  }
}
